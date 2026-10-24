// Minimal Valid 2-Page PDF Generator for Testing
const fs = require('fs');
const path = require('path');

function createSamplePdf() {
  const page1Text = "Biology Chapter 1: Cell Biology and Photosynthesis. Photosynthesis is the process used by plants, algae, and certain bacteria to turn sunlight, water, and carbon dioxide into glucose sugar and oxygen. The green pigment chlorophyll inside chloroplasts absorbs the light energy.";
  const page2Text = "Physics Chapter 2: Gravity and Motion. Sir Isaac Newton formulated the Universal Law of Gravitation in 1687. On Earth, the acceleration due to gravity is approximately 9.8 meters per second squared. Gravity keeps planets in orbit around the Sun.";

  const stream1 = `BT /F1 12 Tf 50 720 Td (${page1Text}) Tj ET`;
  const stream2 = `BT /F1 12 Tf 50 720 Td (${page2Text}) Tj ET`;

  let pdf = `%PDF-1.4\n`;
  const offsets = [];

  function addObj(content) {
    offsets.push(pdf.length);
    pdf += `${offsets.length} 0 obj\n${content}\nendobj\n`;
  }

  // 1: Catalog
  addObj(`<< /Type /Catalog /Pages 2 0 R >>`);
  // 2: Pages
  addObj(`<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>`);
  // 3: Page 1
  addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>`);
  // 4: Page 2
  addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>`);
  // 5: Font
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  // 6: Stream 1
  addObj(`<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream`);
  // 7: Stream 2
  addObj(`<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`);

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const destPath = path.join(__dirname, 'data', 'sample_notes.pdf');
  if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  }
  fs.writeFileSync(destPath, Buffer.from(pdf, 'latin1'));
  console.log(`Created test PDF at: ${destPath} (${pdf.length} bytes)`);
  return destPath;
}

if (require.main === module) {
  createSamplePdf();
}

module.exports = { createSamplePdf };
