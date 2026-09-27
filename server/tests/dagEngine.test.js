const { detectCycle, computeReadyBlocked, propagateSchedule, rollbackRecheck } = require('../services/dagEngine');
const request = require('supertest');
const app = require('../index'); // requires exporting app from index.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

describe('DAG Engine', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = new Date('2026-01-01T00:00:00Z').getTime();

  // 1. Cycle detection
  describe('Cycle detection', () => {
    it('accepts valid non-cyclic edges', () => {
      const graph = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' }
      ];
      const newEdge = { from: 'A', to: 'C' };
      expect(detectCycle(graph, newEdge)).toBe(false);
    });

    it('rejects cyclic edges A->B->C->A', () => {
      const graph = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' }
      ];
      const newEdge = { from: 'C', to: 'A' };
      expect(detectCycle(graph, newEdge)).toBe(true);
    });
  });

  // 2. No-compounding
  describe('No-compounding propagation', () => {
    it('shifts D by exactly 3 days in a diamond graph A->B->D and A->C->D', () => {
      const graph = [
        { from: 'A', to: 'B', lag: 0 },
        { from: 'A', to: 'C', lag: 0 },
        { from: 'B', to: 'D', lag: 0 },
        { from: 'C', to: 'D', lag: 0 }
      ];
      const tasks = {
        A: { id: 'A', status: 'done', duration_days: 2, start_date: new Date(T0).toISOString(), end_date: new Date(T0 + 2*DAY).toISOString() },
        B: { id: 'B', status: 'ready', duration_days: 3, start_date: new Date(T0 + 2*DAY).toISOString(), end_date: new Date(T0 + 5*DAY).toISOString() },
        C: { id: 'C', status: 'ready', duration_days: 4, start_date: new Date(T0 + 2*DAY).toISOString(), end_date: new Date(T0 + 6*DAY).toISOString() },
        D: { id: 'D', status: 'blocked', duration_days: 2, start_date: new Date(T0 + 6*DAY).toISOString(), end_date: new Date(T0 + 8*DAY).toISOString() }
      };

      const newTasks = propagateSchedule(graph, tasks, 'A', 3);
      const originalDEnd = new Date(tasks.D.end_date).getTime();
      const newDEnd = new Date(newTasks.D.end_date).getTime();
      const shiftDays = (newDEnd - originalDEnd) / DAY;

      expect(shiftDays).toBe(3);
    });
  });

  // 3. Ready/Blocked
  describe('Ready/Blocked calculation', () => {
    it('flips to ready only when all prerequisites are done', () => {
      const graph = [
        { from: 'A', to: 'C' },
        { from: 'B', to: 'C' }
      ];
      const tasks = {
        A: { id: 'A', status: 'done' },
        B: { id: 'B', status: 'in_progress' },
        C: { id: 'C', status: 'blocked' }
      };

      const updatedTasks1 = computeReadyBlocked(graph, tasks);
      expect(updatedTasks1.C.computed_status).toBe('blocked');

      tasks.B.status = 'done';
      const updatedTasks2 = computeReadyBlocked(graph, tasks);
      expect(updatedTasks2.C.computed_status).toBe('ready');
    });
  });

  // 4. Rollback
  describe('Rollback recheck', () => {
    it('re-blocks downstream task if prerequisite is reverted from done', () => {
      const graph = [
        { from: 'A', to: 'B' }
      ];
      const tasks = {
        A: { id: 'A', status: 'in_progress' },
        B: { id: 'B', status: 'ready', computed_status: 'ready' }
      };
      
      const newTasks = rollbackRecheck(graph, tasks, 'A');
      expect(newTasks.B.computed_status).toBe('blocked');
    });
  });

  // 5. Multi-level propagation
  describe('Multi-level propagation', () => {
    it('propagates exactly to every level in A->B->C->D chain', () => {
      const graph = [
        { from: 'A', to: 'B', lag: 0 },
        { from: 'B', to: 'C', lag: 0 },
        { from: 'C', to: 'D', lag: 0 }
      ];
      const tasks = {
        A: { id: 'A', duration_days: 1, start_date: new Date(T0).toISOString(), end_date: new Date(T0 + 1*DAY).toISOString() },
        B: { id: 'B', duration_days: 1, start_date: new Date(T0 + 1*DAY).toISOString(), end_date: new Date(T0 + 2*DAY).toISOString() },
        C: { id: 'C', duration_days: 1, start_date: new Date(T0 + 2*DAY).toISOString(), end_date: new Date(T0 + 3*DAY).toISOString() },
        D: { id: 'D', duration_days: 1, start_date: new Date(T0 + 3*DAY).toISOString(), end_date: new Date(T0 + 4*DAY).toISOString() }
      };

      const newTasks = propagateSchedule(graph, tasks, 'A', 2);
      
      expect(new Date(newTasks.B.start_date).getTime()).toBe(T0 + 3*DAY);
      expect(new Date(newTasks.C.start_date).getTime()).toBe(T0 + 4*DAY);
      expect(new Date(newTasks.D.start_date).getTime()).toBe(T0 + 5*DAY);
    });
  });
});

describe('Integration Test: Cycle rejection', () => {
  let taskA, taskB, taskC;

  beforeAll(async () => {
    // Create 3 tasks
    taskA = await prisma.tasks.create({ data: { title: 'Test A', status: 'done', duration_days: 1 } });
    taskB = await prisma.tasks.create({ data: { title: 'Test B', status: 'backlog', duration_days: 1 } });
    taskC = await prisma.tasks.create({ data: { title: 'Test C', status: 'backlog', duration_days: 1 } });

    // Create A->B and B->C
    await prisma.dependencies.create({ data: { predecessor_id: taskA.id, successor_id: taskB.id, source: 'manual' } });
    await prisma.dependencies.create({ data: { predecessor_id: taskB.id, successor_id: taskC.id, source: 'manual' } });
  });

  afterAll(async () => {
    // Clean up
    if (taskA) {
      await prisma.dependencies.deleteMany({
        where: {
          OR: [
            { predecessor_id: taskA.id },
            { predecessor_id: taskB.id },
            { predecessor_id: taskC.id }
          ]
        }
      });
      await prisma.tasks.deleteMany({
        where: {
          id: { in: [taskA.id, taskB.id, taskC.id] }
        }
      });
    }
    await prisma.$disconnect();
  });

  it('rejects a cycle and leaves the existing graph unchanged', async () => {
    const beforeEdges = await prisma.dependencies.findMany();
    const countBefore = beforeEdges.length;

    const res = await request(app)
      .post('/api/dependencies')
      .send({ predecessor_id: taskC.id, successor_id: taskA.id, lag_days: 0 });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/cycle/i);

    const afterEdges = await prisma.dependencies.findMany();
    expect(afterEdges.length).toBe(countBefore);
  });
});
