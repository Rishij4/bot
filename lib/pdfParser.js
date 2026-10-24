// PDF Text Extraction & Semantic Chunking
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB limit
const CHUNK_SIZE = 500; // ~100-120 words per chunk
const CHUNK_OVERLAP = 100;

/**
 * Validates that the buffer is a valid PDF.
 */
function validatePdfBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded file is empty.');
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds 10 MB limit (${(buffer.length / (1024 * 1024)).toFixed(1)} MB).`);
  }
  // Check PDF magic bytes "%PDF-"
  const header = buffer.slice(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    throw new Error('Invalid file format. Only legitimate PDF documents are supported.');
  }
}

/**
 * Extracts text page-by-page from a PDF buffer using a clean worker subprocess.
 * This guarantees complete memory isolation and compatibility on Node 24.
 */
async function extractPagesFromPdf(buffer) {
  validatePdfBuffer(buffer);

  // Write to a temporary file
  const tempPath = path.join(os.tmpdir(), `student_pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tempPath, buffer);

  const workerScript = path.join(__dirname, 'pdfWorker.js');

  return new Promise((resolve, reject) => {
    execFile(process.execPath, [workerScript, tempPath], { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      // Clean up temporary file
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (cleanErr) {
        // Ignore cleanup error
      }

      if (err) {
        let errMsg = 'Failed to extract text from PDF';
        try {
          const parsedErr = JSON.parse(stderr);
          errMsg = parsedErr.error || errMsg;
        } catch (e) {
          errMsg = stderr || err.message || errMsg;
        }
        return reject(new Error(errMsg));
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error('Failed to parse PDF worker output.'));
      }
    });
  });
}

/**
 * Splits extracted pages into chunks with page metadata and overlap.
 */
function chunkPages(pages, fileName) {
  const chunks = [];
  let chunkGlobalIndex = 1;

  for (const page of pages) {
    const text = page.text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) continue;

    if (text.length <= CHUNK_SIZE) {
      chunks.push({
        id: `${fileName}-p${page.pageNumber}-c${chunkGlobalIndex++}`,
        fileName: fileName,
        pageNumber: page.pageNumber,
        text: text
      });
      continue;
    }

    // Split text into overlapping windows
    let start = 0;
    while (start < text.length) {
      let end = start + CHUNK_SIZE;

      // Avoid splitting words in half if possible
      if (end < text.length) {
        const nextSpace = text.indexOf(' ', end);
        const prevPeriod = text.lastIndexOf('.', end);
        if (prevPeriod > start + CHUNK_SIZE * 0.6) {
          end = prevPeriod + 1;
        } else if (nextSpace !== -1 && nextSpace - end < 50) {
          end = nextSpace;
        }
      }

      const chunkText = text.substring(start, end).trim();
      if (chunkText.length > 20) {
        chunks.push({
          id: `${fileName}-p${page.pageNumber}-c${chunkGlobalIndex++}`,
          fileName: fileName,
          pageNumber: page.pageNumber,
          text: chunkText
        });
      }

      start = end - CHUNK_OVERLAP;
      if (start >= text.length - CHUNK_OVERLAP) break;
    }
  }

  return chunks;
}

module.exports = {
  validatePdfBuffer,
  extractPagesFromPdf,
  chunkPages
};
