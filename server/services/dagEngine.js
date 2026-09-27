function detectCycle(graph, newEdge) {
  const adj = {};
  for (const edge of graph) {
    if (!adj[edge.from]) adj[edge.from] = [];
    adj[edge.from].push(edge.to);
  }
  if (!adj[newEdge.from]) adj[newEdge.from] = [];
  adj[newEdge.from].push(newEdge.to);

  const visited = new Set();
  const recStack = new Set();

  function dfs(node) {
    if (recStack.has(node)) return true;
    if (visited.has(node)) return false;

    visited.add(node);
    recStack.add(node);

    if (adj[node]) {
      for (const neighbor of adj[node]) {
        if (dfs(neighbor)) return true;
      }
    }

    recStack.delete(node);
    return false;
  }

  for (const node of Object.keys(adj)) {
    if (!visited.has(node)) {
      if (dfs(node)) return true;
    }
  }
  return false;
}

function computeReadyBlocked(graph, tasks) {
  const updatedTasks = JSON.parse(JSON.stringify(tasks));
  
  const preds = {};
  for (const edge of graph) {
    if (!preds[edge.to]) preds[edge.to] = [];
    preds[edge.to].push(edge.from);
  }

  for (const taskId in updatedTasks) {
    const task = updatedTasks[taskId];
    if (task.status === 'done') continue;

    const predecessors = preds[taskId] || [];
    const allDone = predecessors.every(predId => updatedTasks[predId]?.status === 'done');
    
    task.computed_status = allDone ? 'ready' : 'blocked';
  }

  return updatedTasks;
}

function propagateSchedule(graph, tasks, changedTaskId, deltaDays) {
  changedTaskId = String(changedTaskId);
  const updatedTasks = JSON.parse(JSON.stringify(tasks));
  
  if (updatedTasks[changedTaskId] && updatedTasks[changedTaskId].end_date) {
    const d = new Date(updatedTasks[changedTaskId].end_date);
    d.setDate(d.getDate() + deltaDays);
    updatedTasks[changedTaskId].end_date = d.toISOString();
    
    if (updatedTasks[changedTaskId].start_date) {
        const sd = new Date(updatedTasks[changedTaskId].start_date);
        sd.setDate(sd.getDate() + deltaDays);
        updatedTasks[changedTaskId].start_date = sd.toISOString();
    }
  }

  const inDegree = {};
  const adj = {};
  
  for (const taskId in updatedTasks) {
    inDegree[taskId] = 0;
  }
  
  for (const edge of graph) {
    if (!adj[edge.from]) adj[edge.from] = [];
    adj[edge.from].push({ to: edge.to, lag: edge.lag || 0 });
    inDegree[edge.to] = (inDegree[edge.to] || 0) + 1;
  }

  const queue = [];
  for (const taskId in inDegree) {
    if (inDegree[taskId] === 0) queue.push(taskId);
  }

  const sorted = [];
  while (queue.length > 0) {
    const u = queue.shift();
    sorted.push(u);
    if (adj[u]) {
      for (const edge of adj[u]) {
        inDegree[edge.to]--;
        if (inDegree[edge.to] === 0) queue.push(edge.to);
      }
    }
  }

  const changedIndex = sorted.indexOf(changedTaskId);
  if (changedIndex !== -1) {
    for (let i = changedIndex + 1; i < sorted.length; i++) {
      const u = sorted[i];
      const incomingEdges = graph.filter(e => e.to === u);
      
      if (incomingEdges.length > 0) {
        let maxPredecessorEndMs = -Infinity;
        let hasDates = false;
        
        for (const edge of incomingEdges) {
          const pred = updatedTasks[edge.from];
          if (pred && pred.end_date) {
            hasDates = true;
            const predTime = new Date(pred.end_date).getTime();
            const lagMs = (edge.lag || 0) * 24 * 60 * 60 * 1000;
            if (predTime + lagMs > maxPredecessorEndMs) {
              maxPredecessorEndMs = predTime + lagMs;
            }
          }
        }
        
        if (hasDates) {
          // ---------------------------------------------------------
          // CRITICAL PATH METHOD (CPM) FORWARD PASS:
          // The new start date of this task is the MAX (not sum) of 
          // (predecessor's end_date + lag) across all incoming edges.
          // This prevents compounding delays. For instance, if task A 
          // delays by 3 days, both paths A->B->D and A->C->D pass that 
          // 3-day delay to D. By taking the MAX of incoming dates, D 
          // is only delayed by 3 days total, not 3 + 3 = 6 days.
          // ---------------------------------------------------------
          const currentTask = updatedTasks[u];
          const newStartMs = maxPredecessorEndMs;
          const durationMs = (currentTask.duration_days || 0) * 24 * 60 * 60 * 1000;
          
          currentTask.start_date = new Date(newStartMs).toISOString();
          currentTask.end_date = new Date(newStartMs + durationMs).toISOString();
        }
      }
    }
  }

  return updatedTasks;
}

function rollbackRecheck(graph, tasks, revertedTaskId) {
  const adj = {};
  for (const edge of graph) {
    if (!adj[edge.from]) adj[edge.from] = [];
    adj[edge.from].push(edge.to);
  }

  const descendants = new Set();
  const queue = [revertedTaskId];
  while (queue.length > 0) {
    const u = queue.shift();
    if (adj[u]) {
      for (const v of adj[u]) {
        if (!descendants.has(v)) {
          descendants.add(v);
          queue.push(v);
        }
      }
    }
  }

  const updatedAll = computeReadyBlocked(graph, tasks);
  const resultTasks = JSON.parse(JSON.stringify(tasks));

  for (const desc of descendants) {
    if (resultTasks[desc]) {
      resultTasks[desc].computed_status = updatedAll[desc].computed_status;
    }
  }

  return resultTasks;
}

module.exports = {
  detectCycle,
  computeReadyBlocked,
  propagateSchedule,
  rollbackRecheck
};
