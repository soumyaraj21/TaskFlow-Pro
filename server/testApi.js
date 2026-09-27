const http = require('http');

function req(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const request = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    request.on('error', reject);
    if (body) {
      request.write(JSON.stringify(body));
    }
    request.end();
  });
}

async function test() {
  console.log('Testing GET /api/tasks');
  let res = await req('GET', '/api/tasks');
  console.log('Status:', res.status, 'Count:', res.data.length);

  console.log('\nTesting POST /api/tasks (Create X)');
  let taskX = await req('POST', '/api/tasks', { title: 'Task X', status: 'done', duration_days: 1 });
  console.log('Status:', taskX.status, 'ID:', taskX.data.id);

  console.log('\nTesting POST /api/tasks (Create Y)');
  let taskY = await req('POST', '/api/tasks', { title: 'Task Y', status: 'backlog', duration_days: 1 });
  console.log('Status:', taskY.status, 'ID:', taskY.data.id);

  console.log('\nTesting POST /api/dependencies (X -> Y)');
  let dep1 = await req('POST', '/api/dependencies', { predecessor_id: taskX.data.id, successor_id: taskY.data.id, lag_days: 1 });
  console.log('Status:', dep1.status, 'Result:', dep1.data);

  console.log('\nTesting POST /api/dependencies (Y -> X) [Should fail with cycle]');
  let dep2 = await req('POST', '/api/dependencies', { predecessor_id: taskY.data.id, successor_id: taskX.data.id, lag_days: 1 });
  console.log('Status:', dep2.status, 'Result:', dep2.data);

  console.log('\nTesting GET /api/dependencies to verify graph unchanged by cycle error');
  let deps = await req('GET', '/api/dependencies');
  const cycleExists = deps.data.some(d => d.predecessor_id === taskY.data.id && d.successor_id === taskX.data.id);
  console.log('Cycle edge created?', cycleExists);

  console.log('\nTesting PATCH /api/tasks (Update X duration)');
  let patchRes = await req('PATCH', `/api/tasks/${taskX.data.id}`, { deltaDays: 2 });
  console.log('Status:', patchRes.status, 'Result:', patchRes.data);

  console.log('\nTesting GET /api/audit-log/:taskId (Audit log for X)');
  let auditRes = await req('GET', `/api/audit-log/${taskX.data.id}`);
  console.log('Status:', auditRes.status, 'Logs:', auditRes.data.length);

  console.log('\nTesting POST /api/simulate on X (+2 days)');
  let sim = await req('POST', '/api/simulate', { taskId: taskX.data.id, deltaDays: 2 });
  console.log('Status:', sim.status, 'Diff:', JSON.stringify(sim.data.diff, null, 2));

  console.log('\nTesting POST /api/simulate on real graph from db');
  const tasks = await req('GET', '/api/tasks');
  const taskA = tasks.data.find(t => t.title === 'Project Planning');
  if (taskA) {
    let simReal = await req('POST', '/api/simulate', { taskId: taskA.id, deltaDays: 3 });
    console.log('Simulate A +3 days result Diff:', JSON.stringify(simReal.data.diff, null, 2));
  }
}

test().catch(console.error);
