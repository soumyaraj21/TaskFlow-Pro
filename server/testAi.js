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
  console.log('1. Testing POST /api/tasks (Create Authentication task)');
  let task = await req('POST', '/api/tasks', { title: 'Implement User Login', description: 'Create JWT auth endpoints and frontend login modal', status: 'backlog', duration_days: 2 });
  console.log('Status:', task.status, 'ID:', task.data.id);
  
  console.log('2. Fetching AI Suggestions...');
  let sugs = await req('GET', '/api/ai-suggestions');
  console.log('Suggestions:', JSON.stringify(sugs.data, null, 2));
  
  const mySugs = sugs.data.filter(s => s.task_id === task.data.id);
  if (mySugs.length > 0) {
    const sug = mySugs[0];
    console.log('Accepting suggestion ID:', sug.id);
    let accRes = await req('POST', '/api/dependencies', {
      predecessor_id: sug.suggested_predecessor_id,
      successor_id: task.data.id,
      lag_days: 0,
      source: 'ai_suggested'
    });
    console.log('Accept result:', accRes.data);
  } else {
    console.log('No AI suggestions generated for this task.');
  }
  
  console.log('\n3. Testing Natural-Language What-If');
  let nlRes = await req('POST', '/api/simulate/nl', { query: 'what if Project Planning slips 5 days?' });
  console.log('NL Sim Status:', nlRes.status);
  if (nlRes.status === 200) {
    console.log('Extracted Params:', nlRes.data.extracted);
    console.log('Summary:', nlRes.data.summary);
    console.log('Diff count:', nlRes.data.diff.length);
  } else {
    console.log('Error:', nlRes.data);
  }
}

test().catch(console.error);
