// Local Vector Store with Cosine Similarity Search
const fs = require('fs');
const path = require('path');
const http = require('http');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const EMBED_MODEL = 'nomic-embed-text';
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'vector_store.json');

class LocalVectorStore {
  constructor() {
    this.chunks = []; // Array of { id, fileName, pageNumber, text, embedding }
    this.documents = {}; // fileName -> { fileName, numPages, numChunks, uploadedAt }
    this.ensureDataDir();
    this.load();
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const data = JSON.parse(raw);
        this.chunks = data.chunks || [];
        this.documents = data.documents || {};
        console.log(`📚 Local Vector Store loaded: ${this.chunks.length} chunks across ${Object.keys(this.documents).length} documents.`);
      }
    } catch (err) {
      console.error('Warning: Failed to load existing vector store, starting fresh:', err.message);
      this.chunks = [];
      this.documents = {};
    }
  }

  save() {
    try {
      this.ensureDataDir();
      fs.writeFileSync(STORE_PATH, JSON.stringify({
        documents: this.documents,
        chunks: this.chunks
      }, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save vector store to disk:', err.message);
    }
  }

  /**
   * Request embedding vector from Ollama
   */
  async getEmbedding(text) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model: EMBED_MODEL,
        input: text
      });

      const req = http.request({
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/embed',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 20000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              if (data.embeddings && data.embeddings[0]) {
                resolve(data.embeddings[0]);
              } else {
                reject(new Error('Embedding response missing vector'));
              }
            } catch (err) {
              reject(new Error('Failed to parse Ollama embedding response'));
            }
          } else {
            reject(new Error(`Ollama embed error HTTP ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Embedding generation timed out'));
      });

      req.on('error', (err) => {
        reject(new Error(`Ollama connection error during embedding: ${err.message}`));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Computes cosine similarity between two numeric vectors
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Index chunks with embeddings
   */
  async addDocument(fileName, numPages, rawChunks) {
    // Remove previous chunks of this file if re-uploaded
    this.deleteDocument(fileName, false);

    console.log(`Generating embeddings for ${rawChunks.length} chunks from "${fileName}"...`);
    const indexedChunks = [];

    for (let i = 0; i < rawChunks.length; i++) {
      const chunk = rawChunks[i];
      const embedding = await this.getEmbedding(chunk.text);
      indexedChunks.push({
        id: chunk.id,
        fileName: chunk.fileName,
        pageNumber: chunk.pageNumber,
        text: chunk.text,
        embedding: embedding
      });
    }

    this.chunks.push(...indexedChunks);
    this.documents[fileName] = {
      fileName: fileName,
      numPages: numPages,
      numChunks: indexedChunks.length,
      uploadedAt: new Date().toISOString()
    };

    this.save();
    console.log(`✅ Successfully indexed "${fileName}" (${indexedChunks.length} chunks).`);
    return this.documents[fileName];
  }

  /**
   * Delete a document and its chunks
   */
  deleteDocument(fileName, doSave = true) {
    this.chunks = this.chunks.filter(c => c.fileName !== fileName);
    delete this.documents[fileName];
    if (doSave) this.save();
  }

  /**
   * List all indexed documents
   */
  listDocuments() {
    return Object.values(this.documents);
  }

  /**
   * Search top K most relevant chunks for a question
   */
  async search(query, topK = 3, minScore = 0.40) {
    if (this.chunks.length === 0) {
      return [];
    }

    const queryEmbedding = await this.getEmbedding(query);

    const scored = this.chunks.map(chunk => ({
      id: chunk.id,
      fileName: chunk.fileName,
      pageNumber: chunk.pageNumber,
      text: chunk.text,
      score: this.cosineSimilarity(queryEmbedding, chunk.embedding)
    }));

    scored.sort((a, b) => b.score - a.score);

    // Return top K that meet the minimum score threshold
    return scored.filter(c => c.score >= minScore).slice(0, topK);
  }
}

// Export singleton instance
const vectorStore = new LocalVectorStore();
module.exports = vectorStore;
