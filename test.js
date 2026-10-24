// Automated End-to-End Test for AI Student Assistant
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:3000${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('--- Starting Verification of AI Student Assistant ---');

  // 1. Start server process
  console.log('\n[Step 1] Starting server.js in background...');
  const serverPath = path.join(__dirname, 'server.js');
  const server = spawn('node', [serverPath], { stdio: 'inherit' });

  // Wait 2 seconds for server to bind
  await sleep(2000);

  try {
    // Test 1: Frontend HTML
    console.log('\n[Test 1] Fetching homepage (GET /)...');
    const home = await get('/');
    console.log('HTTP Status:', home.status);
    if (home.status === 200 && home.data.includes('AI Student Assistant')) {
      console.log('✅ PASS: Homepage loaded successfully.');
    } else {
      throw new Error('Homepage content check failed');
    }

    // Test 2: Ollama Status Endpoint
    console.log('\n[Test 2] Checking Ollama Status (GET /api/status)...');
    const statusRes = await get('/api/status');
    console.log('HTTP Status:', statusRes.status);
    console.log('Response body:', statusRes.data);
    const statusJson = JSON.parse(statusRes.data);
    if (statusRes.status === 200 && statusJson.running) {
      console.log(`✅ PASS: Ollama is detected as online! Model: ${statusJson.activeModel}`);
    } else {
      throw new Error(`Ollama status check failed: ${statusRes.data}`);
    }

    // Test 3: Chat API with a student question
    console.log('\n[Test 3] Sending student question to AI: "What is water made of? Answer in 2 short sentences."');
    const chatRes = await post('/api/chat', { question: 'What is water made of? Answer in 2 short sentences.' });
    console.log('HTTP Status:', chatRes.status);
    const chatJson = JSON.parse(chatRes.data);
    if (chatRes.status === 200 && chatJson.reply) {
      console.log('\n✅ PASS: AI answered successfully:');
      console.log('----------------------------------------------------');
      console.log(chatJson.reply.trim());
      console.log('----------------------------------------------------');
    } else {
      throw new Error(`Chat API error: ${chatRes.data}`);
    }

    console.log('\n==========================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
    console.log('==========================================');
  } finally {
    console.log('\nCleaning up: shutting down test server...');
    server.kill();
  }
}

runTests().catch(err => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
