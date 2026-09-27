const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const tasks = await prisma.tasks.count();
  const dependencies = await prisma.dependencies.count();
  const ai_suggestions = await prisma.ai_suggestions.count();
  const audit_log = await prisma.audit_log.count();

  console.log(`Tasks: ${tasks}`);
  console.log(`Dependencies: ${dependencies}`);
  console.log(`AI Suggestions: ${ai_suggestions}`);
  console.log(`Audit Logs: ${audit_log}`);

  const A = await prisma.tasks.findFirst({ where: { title: 'Project Planning' } });
  const D = await prisma.tasks.findFirst({ where: { title: 'Implementation' } });
  
  if (A && D) {
    const paths = await prisma.dependencies.findMany({
      where: {
        OR: [
          { predecessor_id: A.id },
          { successor_id: D.id }
        ]
      },
      include: {
        predecessor: true,
        successor: true
      }
    });
    console.log('Convergence Paths:', paths.map(p => `${p.predecessor.title} -> ${p.successor.title}`));
  }
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
