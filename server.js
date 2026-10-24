// AI Student Assistant - Local Web Server
// Enhanced with Standard RAG and Agentic RAG

const http = require('http');
const fs = require('fs');
const path = require('path');
const { extractPagesFromPdf, chunkPages } = require('./lib/pdfParser');
const vectorStore = require('./lib/vectorStore');
const { runStandardRag, runAgenticRag } = require('./lib/agenticRag');

const PORT = process.env.PORT || 3000;
const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const DEFAULT_MODEL = 'llama3.2:latest';
const EMBED_MODEL = 'nomic-embed-text';

// MIME types for serving frontend files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

// Helper: Check if Ollama is running and get model status
function checkOllamaStatus() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/tags',
        method: 'GET',
        timeout: 2500
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const models = (parsed.models || []).map((m) => m.name);
            const hasChatModel = models.some((name) => name.startsWith('llama3.2') || name.startsWith('llama'));
            const hasEmbedModel = models.some((name) => name.startsWith('nomic-embed-text'));
            resolve({
              running: true,
              models: models,
              hasModel: hasChatModel,
              hasEmbedModel: hasEmbedModel,
              activeModel: models.find((m) => m.startsWith('llama3.2')) || DEFAULT_MODEL,
              documentsCount: vectorStore.listDocuments().length
            });
          } catch (e) {
            resolve({ running: true, models: [], hasModel: false, activeModel: DEFAULT_MODEL });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ running: false, error: 'Ollama request timed out' });
    });

    req.on('error', () => {
      resolve({ running: false, error: 'Ollama is not reachable' });
    });

    req.end();
  });
}

// Helper: Send question to Ollama for Normal Chat
function askOllama(studentQuestion, systemPrompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            systemPrompt ||
            'You are a friendly, encouraging AI Student Assistant. Your goal is to explain concepts clearly in simple, easy-to-understand English for beginner students. Use short paragraphs, simple vocabulary, bullet points, and real-life examples where suitable. Keep your tone cheerful, polite, and motivating.'
        },
        {
          role: 'user',
          content: studentQuestion
        }
      ],
      stream: false
    });

    const req = http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 60000
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const result = JSON.parse(body);
              const reply = result.message?.content || 'No response generated.';
              resolve({ reply: reply, model: result.model });
            } catch (err) {
              reject(new Error('Invalid response from Ollama'));
            }
          } else {
            reject(new Error(`Ollama returned HTTP error ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('The AI model took too long to respond. Please try asking again.'));
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(
          new Error(
            'Cannot connect to Ollama. Please make sure the Ollama application is running on your computer.'
          )
        );
      } else {
        reject(new Error(`Ollama connection error: ${err.message}`));
      }
    });

    req.write(payload);
    req.end();
  });
}

// Helper: Parse multipart/form-data for direct file uploads
function parseMultipartBuffer(bodyBuffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let startIndex = bodyBuffer.indexOf(boundaryBuf);
  if (startIndex === -1) return null;

  while (startIndex !== -1) {
    const nextIndex = bodyBuffer.indexOf(boundaryBuf, startIndex + boundaryBuf.length);
    if (nextIndex === -1) break;

    const part = bodyBuffer.slice(startIndex + boundaryBuf.length, nextIndex);
    const headerEndIndex = part.indexOf('\r\n\r\n');
    if (headerEndIndex !== -1) {
      const headerStr = part.slice(0, headerEndIndex).toString('utf-8');
      const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
      if (filenameMatch) {
        const fileName = path.basename(filenameMatch[1]);
        // Slice body excluding the trailing \r\n
        let fileData = part.slice(headerEndIndex + 4);
        if (fileData.slice(-2).toString() === '\r\n') {
          fileData = fileData.slice(0, -2);
        }
        return { fileName, buffer: fileData };
      }
    }
    startIndex = nextIndex;
  }
  return null;
}

// Main HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Endpoint 1: Health & System Status
  if (pathname === '/api/status' && req.method === 'GET') {
    const status = await checkOllamaStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(status));
    return;
  }

  // Endpoint 2: List Uploaded Documents
  if (pathname === '/api/documents' && req.method === 'GET') {
    const docs = vectorStore.listDocuments();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ documents: docs, totalChunks: vectorStore.chunks.length }));
    return;
  }

  // Endpoint 3: Delete Document
  if (pathname === '/api/documents' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { fileName } = JSON.parse(body || '{}');
        if (!fileName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Filename is required' }));
          return;
        }
        vectorStore.deleteDocument(fileName);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `Document "${fileName}" deleted.` }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Endpoint 4: Upload PDF Notes
  if (pathname === '/api/upload' && req.method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const totalBuffer = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        let fileName = 'notes.pdf';
        let pdfBuffer = null;

        if (contentType.includes('application/json')) {
          // JSON with base64 payload
          const jsonBody = JSON.parse(totalBuffer.toString('utf-8'));
          fileName = path.basename(jsonBody.fileName || 'notes.pdf');
          const base64Content = jsonBody.base64Data.replace(/^data:application\/pdf;base64,/, '');
          pdfBuffer = Buffer.from(base64Content, 'base64');
        } else if (contentType.includes('multipart/form-data')) {
          // Standard multipart
          const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
          const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
          if (!boundary) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing multipart boundary.' }));
            return;
          }
          const parsed = parseMultipartBuffer(totalBuffer, boundary);
          if (!parsed) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Could not extract PDF file from upload.' }));
            return;
          }
          fileName = parsed.fileName;
          pdfBuffer = parsed.buffer;
        } else {
          // Raw binary
          fileName = path.basename(req.headers['x-filename'] || 'notes.pdf');
          pdfBuffer = totalBuffer;
        }

        // Sanitize filename
        fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!fileName.toLowerCase().endsWith('.pdf')) {
          fileName += '.pdf';
        }
        console.log(`[Upload] Processing ${fileName} (${pdfBuffer ? pdfBuffer.length : 0} bytes)...`);

        // Extract pages & validate
        const { numPages, pages } = await extractPagesFromPdf(pdfBuffer);
        if (pages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No readable text could be extracted from this PDF. Please check if the document contains scanned images without text.' }));
          return;
        }

        // Split into chunks
        const docChunks = chunkPages(pages, fileName);
        if (docChunks.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to split document into readable study chunks.' }));
          return;
        }

        // Index in vector store with nomic-embed-text
        const docInfo = await vectorStore.addDocument(fileName, numPages, docChunks);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          message: `Successfully indexed "${fileName}"!`,
          document: docInfo
        }));
      } catch (err) {
        console.error('Upload Error:', err);
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message || 'Failed to process PDF document.' }));
      }
    });
    return;
  }

  // Endpoint 5: Chat API (Supports Normal, RAG, and Agentic RAG)
  if (pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { question, mode = 'normal' } = JSON.parse(body || '{}');

        if (!question || !question.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Please provide a valid question.' }));
          return;
        }

        // Verify Ollama connection
        const status = await checkOllamaStatus();
        if (!status.running) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({
              error: 'Ollama is not running. Please open the Ollama app on your computer, wait a few seconds, and try again!',
              offline: true
            })
          );
          return;
        }

        let responsePayload = null;

        if (mode === 'rag') {
          // Standard RAG: Retrieve context + grounded answer
          const ragResult = await runStandardRag(question.trim());
          responsePayload = {
            reply: ragResult.reply,
            sources: ragResult.sources || [],
            mode: 'rag',
            model: DEFAULT_MODEL
          };
        } else if (mode === 'agentic') {
          // Agentic RAG: Classify -> Search -> Evaluate -> Query Rewrite (max 3 tries) -> Grounded answer with trace
          const agenticResult = await runAgenticRag(question.trim());
          responsePayload = {
            reply: agenticResult.reply,
            sources: agenticResult.sources || [],
            trace: agenticResult.trace || [],
            mode: 'agentic',
            model: DEFAULT_MODEL
          };
        } else {
          // Normal Chat: Standard Llama 3.2 completion
          const normalResult = await askOllama(question.trim());
          responsePayload = {
            reply: normalResult.reply,
            sources: [],
            mode: 'normal',
            model: normalResult.model
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(responsePayload));
      } catch (err) {
        console.error('Chat Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Endpoint 6: Serve Static Frontend Files
  let relativeFilePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const publicDir = path.join(__dirname, 'public');
  const safeFilePath = path.join(publicDir, relativeFilePath);

  if (!safeFilePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.readFile(safeFilePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
      return;
    }

    const ext = path.extname(safeFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️ Port ${PORT} is already in use by another running instance.`);
    console.error(`👉 Solution: Close any existing terminal running the server, or use a different port by running:`);
    console.error(`   $env:PORT=3001; npm start   (in PowerShell)\n`);
  } else {
    console.error(`Server error:`, err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🎓 AI Student Assistant (Normal, RAG & Agentic) running!`);
  console.log(`👉 Open your browser at: http://localhost:${PORT}`);
  console.log(`🤖 Chat Model: ${DEFAULT_MODEL} | Embed: ${EMBED_MODEL}`);
  console.log(`====================================================`);
});
