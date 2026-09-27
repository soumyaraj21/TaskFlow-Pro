const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing old data...');
  await prisma.audit_log.deleteMany();
  await prisma.ai_suggestions.deleteMany();
  await prisma.dependencies.deleteMany();
  await prisma.tasks.deleteMany();

  console.log('Inserting tasks...');
  const taskA = await prisma.tasks.create({ data: { title: 'Project Planning', status: 'done', duration_days: 2 } });
  const taskB = await prisma.tasks.create({ data: { title: 'Design UI', status: 'review', duration_days: 5 } });
  const taskC = await prisma.tasks.create({ data: { title: 'Design DB Schema', status: 'review', duration_days: 3 } });
  const taskD = await prisma.tasks.create({ data: { title: 'Implementation', status: 'in_progress', duration_days: 10 } });

  const taskE = await prisma.tasks.create({ data: { title: 'Marketing Copy', status: 'done', duration_days: 2 } });
  const taskF = await prisma.tasks.create({ data: { title: 'Marketing Graphics', status: 'in_progress', duration_days: 4 } });
  const taskG = await prisma.tasks.create({ data: { title: 'Launch Campaign', status: 'backlog', duration_days: 7 } });
  const taskH = await prisma.tasks.create({ data: { title: 'Setup Infrastructure', status: 'done', duration_days: 2 } });
  const taskI = await prisma.tasks.create({ data: { title: 'Deploy Staging', status: 'backlog', duration_days: 1 } });
  const taskJ = await prisma.tasks.create({ data: { title: 'Deploy Production', status: 'backlog', duration_days: 1 } });

  console.log('Inserting dependencies...');
  await prisma.dependencies.createMany({
    data: [
      { predecessor_id: taskA.id, successor_id: taskB.id, source: 'manual' },
      { predecessor_id: taskA.id, successor_id: taskC.id, source: 'manual' },
      { predecessor_id: taskB.id, successor_id: taskD.id, source: 'manual' },
      { predecessor_id: taskC.id, successor_id: taskD.id, source: 'manual' },
      
      { predecessor_id: taskE.id, successor_id: taskF.id, source: 'manual' },
      { predecessor_id: taskF.id, successor_id: taskG.id, source: 'manual' },

      { predecessor_id: taskH.id, successor_id: taskI.id, source: 'manual' },
      { predecessor_id: taskI.id, successor_id: taskJ.id, source: 'manual' },
    ]
  });

  console.log('Inserting mock AI suggestion...');
  await prisma.ai_suggestions.create({
    data: {
      task_id: taskI.id,
      suggested_predecessor_id: taskD.id,
      confidence: 0.95,
      rationale: 'Deployment needs implementation to finish.',
      status: 'pending'
    }
  });

  console.log('Inserting mock audit log...');
  await prisma.audit_log.create({
    data: {
      task_id: taskA.id,
      change_type: 'status_update',
      old_value: { status: 'in_progress' },
      new_value: { status: 'done' }
    }
  });

  console.log('Seed completed successfully.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
