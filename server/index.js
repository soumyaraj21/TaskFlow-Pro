const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { detectCycle, computeReadyBlocked, propagateSchedule, rollbackRecheck } = require('./services/dagEngine');
const { suggestDependencies, extractWhatIf, summarizeDiff } = require('./services/aiService');

const prisma = new PrismaClient();
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

function mapDbTasksToEngineTasks(dbTasks) {
  const engineTasks = {};
  for (const t of dbTasks) {
    engineTasks[t.id] = {
      ...t,
      start_date: t.start_date ? t.start_date.toISOString() : null,
      end_date: t.end_date ? t.end_date.toISOString() : null,
    };
  }
  return engineTasks;
}

function mapDbEdgesToEngineEdges(dbDeps) {
  return dbDeps.map(d => ({
    id: d.id,
    from: d.predecessor_id,
    to: d.successor_id,
    lag: d.lag_days || 0
  }));
}

app.get('/api/tasks', async (req, res) => {
  const dbTasks = await prisma.tasks.findMany();
  const dbDeps = await prisma.dependencies.findMany();
  
  const engineTasks = mapDbTasksToEngineTasks(dbTasks);
  const engineEdges = mapDbEdgesToEngineEdges(dbDeps);
  
  const computedTasks = computeReadyBlocked(engineEdges, engineTasks);
  res.json(Object.values(computedTasks));
});

app.post('/api/tasks', async (req, res) => {
  const task = await prisma.tasks.create({
    data: {
      title: req.body.title,
      description: req.body.description,
      status: req.body.status || 'backlog',
      start_date: req.body.start_date ? new Date(req.body.start_date) : null,
      end_date: req.body.end_date ? new Date(req.body.end_date) : null,
      duration_days: req.body.duration_days,
      column_position: req.body.column_position
    }
  });
  
  const allTasks = await prisma.tasks.findMany();
  try {
    const suggestions = await suggestDependencies(task, allTasks);
    for (const sug of suggestions) {
      const pred = allTasks.find(t => t.title.toLowerCase() === sug.suggested_task_title.toLowerCase());
      if (pred) {
        await prisma.ai_suggestions.create({
          data: {
            task_id: task.id,
            suggested_predecessor_id: pred.id,
            confidence: sug.confidence,
            rationale: sug.rationale,
            status: 'pending'
          }
        });
      }
    }
  } catch (err) {
    console.error('AI suggestion failed:', err);
  }
  
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', async (req, res) => {
  const taskId = parseInt(req.params.id);
  const updates = req.body;
  const deltaDays = updates.deltaDays; 
  
  try {
    await prisma.$transaction(async (tx) => {
      const oldTask = await tx.tasks.findUnique({ where: { id: taskId } });
      if (!oldTask) throw new Error('Task not found');
      
      const newTask = await tx.tasks.update({
        where: { id: taskId },
        data: {
          title: updates.title !== undefined ? updates.title : oldTask.title,
          description: updates.description !== undefined ? updates.description : oldTask.description,
          status: updates.status !== undefined ? updates.status : oldTask.status,
          start_date: updates.start_date !== undefined ? new Date(updates.start_date) : oldTask.start_date,
          end_date: updates.end_date !== undefined ? new Date(updates.end_date) : oldTask.end_date,
          duration_days: updates.duration_days !== undefined ? updates.duration_days : oldTask.duration_days,
          column_position: updates.column_position !== undefined ? updates.column_position : oldTask.column_position
        }
      });

      await tx.audit_log.create({
        data: {
          task_id: taskId,
          change_type: 'update',
          old_value: oldTask,
          new_value: newTask
        }
      });

      const allDbTasks = await tx.tasks.findMany();
      const allDbDeps = await tx.dependencies.findMany();
      let engineTasks = mapDbTasksToEngineTasks(allDbTasks);
      const engineEdges = mapDbEdgesToEngineEdges(allDbDeps);

      if (oldTask.status === 'done' && newTask.status !== 'done') {
        engineTasks = rollbackRecheck(engineEdges, engineTasks, taskId);
      } else {
        engineTasks = computeReadyBlocked(engineEdges, engineTasks);
      }

      if (deltaDays) {
        engineTasks = propagateSchedule(engineEdges, engineTasks, taskId, deltaDays);
      }

      for (const tId in engineTasks) {
        const eTask = engineTasks[tId];
        await tx.tasks.update({
          where: { id: parseInt(tId) },
          data: {
            start_date: eTask.start_date ? new Date(eTask.start_date) : null,
            end_date: eTask.end_date ? new Date(eTask.end_date) : null
          }
        });
      }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/dependencies', async (req, res) => {
  const { predecessor_id, successor_id, lag_days, source } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dbDeps = await tx.dependencies.findMany();
      const engineEdges = mapDbEdgesToEngineEdges(dbDeps);
      const newEdge = { from: predecessor_id, to: successor_id, lag: lag_days || 0 };
      
      if (detectCycle(engineEdges, newEdge)) {
        throw new Error('CYCLE_DETECTED');
      }

      const dep = await tx.dependencies.create({
        data: {
          predecessor: { connect: { id: predecessor_id } },
          successor: { connect: { id: successor_id } },
          lag_days: lag_days || 0,
          source: source || 'manual'
        }
      });

      const allDbTasks = await tx.tasks.findMany();
      engineEdges.push(newEdge);
      const engineTasks = mapDbTasksToEngineTasks(allDbTasks);
      const computedTasks = computeReadyBlocked(engineEdges, engineTasks);

      for (const tId in computedTasks) {
        // No longer saving computed status to db
      }

      return dep;
    });

    res.status(201).json(result);
  } catch (error) {
    if (error.message === 'CYCLE_DETECTED') {
      return res.status(400).json({ error: 'CYCLE_DETECTED' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dependencies', async (req, res) => {
  const dbDeps = await prisma.dependencies.findMany();
  res.json(dbDeps);
});

app.delete('/api/dependencies/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.$transaction(async (tx) => {
    await tx.dependencies.delete({ where: { id } });
    
    const dbDeps = await tx.dependencies.findMany();
    const allDbTasks = await tx.tasks.findMany();
    
    const engineEdges = mapDbEdgesToEngineEdges(dbDeps);
    const engineTasks = mapDbTasksToEngineTasks(allDbTasks);
    const computedTasks = computeReadyBlocked(engineEdges, engineTasks);

    for (const tId in computedTasks) {
        // No longer saving computed status to db
    }
  });
  res.json({ success: true });
});

app.get('/api/audit-log/:taskId', async (req, res) => {
  const logs = await prisma.audit_log.findMany({
    where: { task_id: parseInt(req.params.taskId) },
    orderBy: { timestamp: 'desc' }
  });
  res.json(logs);
});

app.post('/api/simulate', async (req, res) => {
  const { taskId, deltaDays } = req.body;
  const dbTasks = await prisma.tasks.findMany();
  const dbDeps = await prisma.dependencies.findMany();
  
  let engineTasks = mapDbTasksToEngineTasks(dbTasks);
  const engineEdges = mapDbEdgesToEngineEdges(dbDeps);

  const originalState = JSON.parse(JSON.stringify(engineTasks));

  engineTasks = propagateSchedule(engineEdges, engineTasks, taskId, deltaDays);
  engineTasks = computeReadyBlocked(engineEdges, engineTasks);

  const diff = [];
  for (const tId in engineTasks) {
    const orig = originalState[tId];
    const sim = engineTasks[tId];
    
    let changed = false;
    const changes = {};
    if (orig.computed_status !== sim.computed_status) {
      changed = true;
      changes.computed_status = { from: orig.computed_status, to: sim.computed_status };
    }
    if (orig.start_date !== sim.start_date) {
      changed = true;
      changes.start_date = { from: orig.start_date, to: sim.start_date };
    }
    if (orig.end_date !== sim.end_date) {
      changed = true;
      changes.end_date = { from: orig.end_date, to: sim.end_date };
    }
    
    if (changed) {
      diff.push({ taskId: tId, title: orig.title, changes });
    }
  }

  res.json({ diff });
});

app.get('/api/ai-suggestions', async (req, res) => {
  const suggestions = await prisma.ai_suggestions.findMany({
    where: { status: 'pending' }
  });
  res.json(suggestions);
});

app.patch('/api/ai-suggestions/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  const sug = await prisma.ai_suggestions.update({
    where: { id },
    data: { status }
  });
  res.json(sug);
});

app.post('/api/simulate/nl', async (req, res) => {
  const { query } = req.body;
  try {
    const allDbTasks = await prisma.tasks.findMany();
    const extracted = await extractWhatIf(query, allDbTasks);
    
    if (!extracted || !extracted.task_id || !extracted.delta_days) {
      return res.status(400).json({ error: 'Could not understand the task or days' });
    }
    
    const dbDeps = await prisma.dependencies.findMany();
    let engineTasks = mapDbTasksToEngineTasks(allDbTasks);
    const engineEdges = mapDbEdgesToEngineEdges(dbDeps);

    const originalState = JSON.parse(JSON.stringify(engineTasks));
    engineTasks = propagateSchedule(engineEdges, engineTasks, extracted.task_id, extracted.delta_days);
    engineTasks = computeReadyBlocked(engineEdges, engineTasks);

    const diff = [];
    for (const tId in engineTasks) {
      const orig = originalState[tId];
      const sim = engineTasks[tId];
      
      let changed = false;
      const changes = {};
      if (orig.computed_status !== sim.computed_status) {
        changed = true;
        changes.computed_status = { from: orig.computed_status, to: sim.computed_status };
      }
      if (orig.start_date !== sim.start_date) {
        changed = true;
        changes.start_date = { from: orig.start_date, to: sim.start_date };
      }
      if (orig.end_date !== sim.end_date) {
        changed = true;
        changes.end_date = { from: orig.end_date, to: sim.end_date };
      }
      
      if (changed) {
        diff.push({ taskId: tId, title: orig.title, changes });
      }
    }
    
    const summary = await summarizeDiff(query, diff);
    res.json({ diff, summary, extracted });
  } catch (e) {
    console.error('[AI Simulation Error]', e);
    res.status(500).json({ error: e.message || 'AI failed to process the simulation' });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}
module.exports = app;
