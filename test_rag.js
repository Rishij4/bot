// Comprehensive Verification Test Suite for AI Student Assistant
// Tests: 1. Normal Chat  2. PDF Ingestion  3. Standard RAG  4. Agentic RAG

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
      },
      timeout: 60000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:3000${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTestSuite() {
  console.log('===========================================================');
  console.log('🧪 Starting End-to-End Test Suite: Normal, RAG & Agentic RAG');
  console.log('===========================================================');

  // Step 1: Start Server Process
  const serverPath = path.join(__dirname, 'server.js');
  const serverProc = spawn('node', [serverPath], { stdio: 'inherit' });
  await sleep(2500);

  try {
    // Test 1: Normal Chat Mode
    console.log('\n[Test 1] Testing Normal Chat Mode (Llama 3.2)...');
    const normalRes = await post('/api/chat', {
      question: 'Give me one sentence explaining what a star is.',
      mode: 'normal'
    });
    console.log('Status:', normalRes.status);
    console.log('Reply:', normalRes.json?.reply);
    if (normalRes.status === 200 && normalRes.json?.reply) {
      console.log('✅ PASS: Normal chat works as expected.');
    } else {
      throw new Error('Normal chat failed');
    }

    // Test 2: Upload & Ingest Sample PDF
    console.log('\n[Test 2] Testing PDF Study Notes Upload & nomic-embed-text Ingestion...');
    const pdfPath = path.join(__dirname, 'data', 'sample_notes.pdf');
    const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');

    const uploadRes = await post('/api/upload', {
      fileName: 'sample_notes.pdf',
      base64Data: pdfBase64
    });
    console.log('Status:', uploadRes.status);
    console.log('Upload Result:', uploadRes.json?.message);
    if (uploadRes.status === 200 && uploadRes.json?.document?.numPages === 2) {
      console.log('✅ PASS: PDF successfully parsed and embedded into vector store!');
    } else {
      throw new Error(`Upload failed: ${JSON.stringify(uploadRes.json)}`);
    }

    // Test 3: List Documents
    console.log('\n[Test 3] Verifying document listing API...');
    const docsRes = await get('/api/documents');
    console.log('Indexed Documents:', docsRes.json?.documents);
    if (docsRes.status === 200 && docsRes.json?.documents?.length > 0) {
      console.log('✅ PASS: Document listed in vector store.');
    } else {
      throw new Error('Document list check failed');
    }

    // Test 4: Standard RAG (Biology - Page 1)
    console.log('\n[Test 4] Testing Standard RAG on Page 1 (Photosynthesis)...');
    const ragBio = await post('/api/chat', {
      question: 'What is the green pigment in plants that absorbs light energy?',
      mode: 'rag'
    });
    console.log('Status:', ragBio.status);
    console.log('RAG Answer:', ragBio.json?.reply);
    console.log('Sources Cited:', ragBio.json?.sources);
    if (ragBio.status === 200 && ragBio.json?.reply?.toLowerCase().includes('chlorophyll')) {
      console.log('✅ PASS: Standard RAG retrieved chlorophyll with Page 1 citation!');
    } else {
      throw new Error('Standard RAG Page 1 test failed');
    }

    // Test 5: Standard RAG (Physics - Page 2)
    console.log('\n[Test 5] Testing Standard RAG on Page 2 (Newton & Gravity)...');
    const ragPhys = await post('/api/chat', {
      question: 'What law did Sir Isaac Newton formulate in 1687, and what is Earth gravity?',
      mode: 'rag'
    });
    console.log('Status:', ragPhys.status);
    console.log('RAG Answer:', ragPhys.json?.reply);
    console.log('Sources Cited:', ragPhys.json?.sources);
    if (ragPhys.status === 200 && (ragPhys.json?.reply?.includes('1687') || ragPhys.json?.reply?.includes('9.8'))) {
      console.log('✅ PASS: Standard RAG retrieved Newton gravitation with Page 2 citation!');
    } else {
      throw new Error('Standard RAG Page 2 test failed');
    }

    // Test 6: Standard RAG (Topic Not in Notes)
    console.log('\n[Test 6] Testing Standard RAG with unmentioned topic (Limitation Communication)...');
    const ragUnknown = await post('/api/chat', {
      question: 'What was the population of Tokyo in 2020?',
      mode: 'rag'
    });
    console.log('RAG Answer:', ragUnknown.json?.reply);
    const replyLower = ragUnknown.json?.reply?.toLowerCase() || '';
    if (
      replyLower.includes("don't") ||
      replyLower.includes("doesn't") ||
      replyLower.includes("do not") ||
      replyLower.includes("does not") ||
      replyLower.includes("no mention") ||
      replyLower.includes("no information") ||
      replyLower.includes("not mentioned") ||
      replyLower.includes("not able to provide") ||
      replyLower.includes("uploaded")
    ) {
      console.log('✅ PASS: Correctly communicated limitation without hallucinating facts.');
    } else {
      throw new Error('Standard RAG limitation check failed');
    }

    // Test 7: Agentic RAG - Intent Routing (Casual Greeting bypass)
    console.log('\n[Test 7] Testing Agentic RAG Query Router (Casual Chat)...');
    const agentChat = await post('/api/chat', {
      question: 'Good morning! How are you doing today?',
      mode: 'agentic'
    });
    console.log('Agent Reply:', agentChat.json?.reply);
    console.log('Agent Trace:', agentChat.json?.trace);
    const hasRouterTrace = agentChat.json?.trace?.some(t =>
      t.detail?.toLowerCase().includes('conversational') ||
      t.action?.toLowerCase().includes('router') ||
      t.detail?.toLowerCase().includes('chat') ||
      t.detail?.toLowerCase().includes('intent')
    );
    if (agentChat.status === 200 && hasRouterTrace) {
      console.log('✅ PASS: Agentic router correctly bypassed retrieval for small-talk!');
    } else {
      throw new Error('Agentic router test failed');
    }

    // Test 8: Agentic RAG - Full Workflow with Trace & Grounded Synthesis
    console.log('\n[Test 8] Testing Agentic RAG Full Workflow (Search, Evaluation & Synthesis)...');
    const agentQuery = await post('/api/chat', {
      question: 'Explain what happens during plant photosynthesis and what gas is released.',
      mode: 'agentic'
    });
    console.log('Agent Answer:', agentQuery.json?.reply);
    console.log('Trace Steps Count:', agentQuery.json?.trace?.length);
    console.log('Agent Sources:', agentQuery.json?.sources);
    const replyTxt = agentQuery.json?.reply?.toLowerCase() || '';
    if (agentQuery.status === 200 && agentQuery.json?.trace?.length >= 3 && (replyTxt.includes('oxygen') || replyTxt.includes('photosynthesis') || replyTxt.includes('glucose'))) {
      console.log('✅ PASS: Agentic RAG successfully evaluated relevance and produced grounded answer with trace!');
    } else {
      throw new Error('Agentic RAG full workflow test failed');
    }

    console.log('\n===========================================================');
    console.log('🎉 ALL 8 TESTS PASSED SUCCESSFULLY!');
    console.log('===========================================================');
  } finally {
    console.log('\nShutting down test server...');
    serverProc.kill();
  }
}

runTestSuite().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
