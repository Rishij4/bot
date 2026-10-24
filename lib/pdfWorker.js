// Standalone PDF extraction worker
// Running in a separate process ensures 100% clean memory and isolate compatibility on Node 24
const fs = require('fs');
const pdfParse = require('pdf-parse');

async function run() {
  try {
    const inputPath = process.argv[2];
    if (!inputPath || !fs.existsSync(inputPath)) {
      console.error(JSON.stringify({ error: 'File path not provided or does not exist.' }));
      process.exit(1);
    }

    const rawBuffer = fs.readFileSync(inputPath);

    // Unpool buffer for Node 24 compatibility
    const cleanBuffer = Buffer.alloc(rawBuffer.length);
    rawBuffer.copy(cleanBuffer);

    const pages = [];
    const options = {
      pagerender: function (pageData) {
        return pageData.getTextContent().then(function (textContent) {
          let lastY, text = '';
          for (let item of textContent.items) {
            if (lastY === item.transform[5] || !lastY) {
              text += (text.length > 0 && !text.endsWith(' ') ? ' ' : '') + item.str;
            } else {
              text += '\n' + item.str;
            }
            lastY = item.transform[5];
          }
          pages.push({
            pageNumber: pageData.pageIndex + 1,
            text: text.trim()
          });
          return text;
        });
      }
    };

    const parsed = await pdfParse(cleanBuffer, options);

    if (pages.length === 0 && parsed.text && parsed.text.trim().length > 0) {
      pages.push({
        pageNumber: 1,
        text: parsed.text.trim()
      });
    }

    const result = {
      numPages: parsed.numpages || pages.length,
      pages: pages.filter(p => p.text.length > 0)
    };

    // Print JSON output
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message || 'PDF parse failed' }));
    process.exit(1);
  }
}

run();
