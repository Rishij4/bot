// Agentic RAG Workflow Engine
const vectorStore = require('./vectorStore');
const http = require('http');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MODEL_NAME = 'llama3.2:latest';

/**
 * Fast LLM completion helper for agent decisions
 */
function callLlama(prompt, systemInstruction = '', maxTokens = 300) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt }
      ],
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature: 0.2 // Low temperature for deterministic decisions
      }
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
        timeout: 45000
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(body);
              resolve(parsed.message?.content?.trim() || '');
            } catch (e) {
              reject(new Error('Failed to parse LLM response'));
            }
          } else {
            reject(new Error(`Ollama LLM error HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('LLM call timed out'));
    });

    req.on('error', (err) => {
      reject(new Error(`Ollama connection error: ${err.message}`));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Step 1: Router - Classifies if the question requires document retrieval or casual chat
 */
async function classifyIntent(question) {
  const prompt = `User query: "${question}"
Determine whether answering this question requires searching uploaded study documents, or if it is a casual greeting / small-talk / conversational query (like "hello", "who are you", "thank you", "tell a joke").
Respond with ONLY one word: "RETRIEVE" or "CHAT".`;

  const response = await callLlama(prompt, 'You are an intelligent query router. Output only RETRIEVE or CHAT.', 10);
  const decision = response.toUpperCase().includes('CHAT') ? 'CHAT' : 'RETRIEVE';
  return decision;
}

/**
 * Step 2 & 3: Evaluates if retrieved chunks are sufficient to answer the question
 */
async function evaluateRetrieval(question, chunks) {
  if (!chunks || chunks.length === 0) {
    return { sufficient: false, reason: 'No chunks met the similarity threshold.' };
  }

  // If the top score is very strong (e.g. >= 0.70), we are confident
  const topScore = chunks[0].score;
  if (topScore >= 0.70) {
    return { sufficient: true, reason: `High relevance score (${(topScore * 100).toFixed(0)}%).` };
  }

  // Ask LLM to evaluate relevance
  const contextSnippet = chunks.map((c, i) => `[Snippet ${i + 1}]: ${c.text.substring(0, 200)}...`).join('\n');
  const prompt = `Question: "${question}"

Retrieved Document Snippets:
${contextSnippet}

Can the question be answered using these snippets?
Answer with only "YES" or "NO" followed by a 1-sentence reason.`;

  const evaluation = await callLlama(prompt, 'You are a critical document relevance evaluator.', 60);
  const isYes = evaluation.toUpperCase().startsWith('YES');
  return {
    sufficient: isYes,
    reason: evaluation
  };
}

/**
 * Step 4: Query Rewriting - Generates a clearer search query for retrieval retry
 */
async function rewriteQuery(originalQuestion, previousQuery, attemptNumber) {
  const prompt = `Original student question: "${originalQuestion}"
Previous search keyword: "${previousQuery}"
The previous search did not find enough information in the study notes.
Generate a better, alternative 2-to-5 word search query or key terms to look up in the study notes.
Output ONLY the rewritten search query, with no punctuation or explanation.`;

  const rewritten = await callLlama(prompt, 'You are a search query optimizer. Return only the rewritten query.', 25);
  // Clean up any extra quotes or words
  return rewritten.replace(/["'\n\r]/g, '').trim() || originalQuestion;
}

/**
 * Step 5: Synthesize Grounded Answer
 */
async function generateGroundedAnswer(question, chunks, isAgentic = false) {
  const contextText = chunks
    .map(
      (c, idx) =>
        `[Document: ${c.fileName}, Page: ${c.pageNumber}]\n${c.text}`
    )
    .join('\n\n---\n\n');

  const systemInstruction = `You are an AI Student Assistant providing grounded answers based on uploaded study notes.
Rules:
1. Answer strictly using the facts presented in the provided context below.
2. If the context does not contain the answer, say honestly: "The uploaded study notes do not contain enough information to answer this question."
3. Do not invent or assume facts not found in the context.
4. Explain clearly in simple, friendly English suitable for students.
5. Use bullet points and simple examples where appropriate.`;

  const userPrompt = `Context from Study Notes:
${contextText}

Student Question: ${question}

Provide an easy-to-understand, grounded answer:`;

  const answer = await callLlama(userPrompt, systemInstruction, 700);

  // Collect distinct source references
  const sourcesMap = new Map();
  for (const c of chunks) {
    const key = `${c.fileName} (Page ${c.pageNumber})`;
    if (!sourcesMap.has(key)) {
      sourcesMap.set(key, { fileName: c.fileName, pageNumber: c.pageNumber, snippet: c.text.substring(0, 140) + '...' });
    }
  }

  return {
    reply: answer,
    sources: Array.from(sourcesMap.values())
  };
}

/**
 * Main Agentic RAG Execution Pipeline
 */
async function runAgenticRag(question) {
  const trace = [];
  const maxAttempts = 3;

  trace.push({
    step: 1,
    action: 'Intent Classification',
    detail: `Analyzing question: "${question}"`
  });

  // Check if any documents exist in store
  const availableDocs = vectorStore.listDocuments();
  if (availableDocs.length === 0) {
    trace.push({
      step: 2,
      action: 'Check Available Notes',
      detail: 'No documents currently uploaded in the vector database.'
    });
    return {
      reply: '⚠️ You have not uploaded any study notes yet. Please upload a PDF in the "Upload Notes" section so I can answer questions from your documents!',
      sources: [],
      trace: trace
    };
  }

  // Classify intent
  const intent = await classifyIntent(question);
  if (intent === 'CHAT') {
    trace.push({
      step: 2,
      action: 'Router Decision',
      detail: 'Identified as conversational / small-talk. Document retrieval bypassed.'
    });

    const chatReply = await callLlama(
      question,
      'You are a friendly, encouraging AI Student Assistant. Answer politely in simple, cheerful English.',
      250
    );

    return {
      reply: chatReply,
      sources: [],
      trace: trace
    };
  }

  trace.push({
    step: 2,
    action: 'Router Decision',
    detail: 'Question requires factual evidence from uploaded study notes. Initiating vector retrieval.'
  });

  let currentQuery = question;
  let finalChunks = [];
  let success = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    trace.push({
      step: trace.length + 1,
      action: `Retrieval Attempt ${attempt}/${maxAttempts}`,
      detail: `Searching local vector database for: "${currentQuery}"`
    });

    const retrieved = await vectorStore.search(currentQuery, 3, 0.40);

    if (retrieved.length > 0) {
      trace.push({
        step: trace.length + 1,
        action: `Evaluate Evidence (Attempt ${attempt})`,
        detail: `Found ${retrieved.length} relevant chunk(s) from [${retrieved.map(r => `${r.fileName} p.${r.pageNumber}`).join(', ')}]. Highest similarity: ${(retrieved[0].score * 100).toFixed(0)}%.`
      });

      const evaluation = await evaluateRetrieval(question, retrieved);

      if (evaluation.sufficient) {
        trace.push({
          step: trace.length + 1,
          action: 'Sufficiency Confirmed',
          detail: `Evidence is relevant and sufficient: ${evaluation.reason}`
        });
        finalChunks = retrieved;
        success = true;
        break;
      } else {
        trace.push({
          step: trace.length + 1,
          action: 'Sufficiency Check Failed',
          detail: `Retrieved content was not sufficient: ${evaluation.reason}`
        });
      }
    } else {
      trace.push({
        step: trace.length + 1,
        action: `Evaluate Evidence (Attempt ${attempt})`,
        detail: `No chunks met the similarity threshold (0.40) for query: "${currentQuery}".`
      });
    }

    // If more attempts remain, rewrite the query
    if (attempt < maxAttempts) {
      const rewritten = await rewriteQuery(question, currentQuery, attempt);
      trace.push({
        step: trace.length + 1,
        action: `Query Rewriting (${attempt} -> ${attempt + 1})`,
        detail: `Rewrote query from "${currentQuery}" to "${rewritten}" for retry.`
      });
      currentQuery = rewritten;
    }
  }

  // If retrieval succeeded
  if (success && finalChunks.length > 0) {
    trace.push({
      step: trace.length + 1,
      action: 'Synthesis',
      detail: 'Generating grounded answer with citations using Llama 3.2.'
    });

    const generated = await generateGroundedAnswer(question, finalChunks, true);
    return {
      reply: generated.reply,
      sources: generated.sources,
      trace: trace
    };
  }

  // If maximum attempts reached without sufficient evidence
  trace.push({
    step: trace.length + 1,
    action: 'Stopping Condition',
    detail: `Reached maximum attempts (${maxAttempts}) without finding sufficient evidence in the uploaded documents.`
  });

  return {
    reply: "I carefully searched through your uploaded study notes using multiple query variations, but I could not find enough information to answer this question accurately. Please verify that your uploaded notes contain this topic.",
    sources: [],
    trace: trace
  };
}

/**
 * Standard RAG Pipeline (Single-pass retrieval)
 */
async function runStandardRag(question) {
  const availableDocs = vectorStore.listDocuments();
  if (availableDocs.length === 0) {
    return {
      reply: '⚠️ You have not uploaded any study notes yet. Please upload a PDF in the "Upload Notes" section so I can answer questions from your documents!',
      sources: []
    };
  }

  // Single retrieval pass
  const retrieved = await vectorStore.search(question, 3, 0.38);

  if (!retrieved || retrieved.length === 0) {
    return {
      reply: 'The uploaded study notes do not contain enough information to answer this question. Please make sure the relevant chapters are uploaded.',
      sources: []
    };
  }

  return await generateGroundedAnswer(question, retrieved, false);
}

module.exports = {
  runStandardRag,
  runAgenticRag
};
