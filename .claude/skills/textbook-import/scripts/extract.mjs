// Extracts each page of a textbook PDF to <outdir>/pNNN.txt (PDF page numbers).
// Usage: node extract.mjs <book.pdf> <outdir> [pdfjs-tools-dir]
// The tools dir defaults to .book-extract/tools (run from the repo root) and must
// contain pdfjs-dist@4: npm install --prefix .book-extract/tools pdfjs-dist@4
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [file, outdir, toolsDir = '.book-extract/tools'] = process.argv.slice(2);
if (!file || !outdir) {
  console.error('usage: node extract.mjs <book.pdf> <outdir> [pdfjs-tools-dir]');
  process.exit(1);
}

const pdfjsRoot = path.resolve(toolsDir, 'node_modules/pdfjs-dist');
const { getDocument } = await import(pathToFileURL(path.join(pdfjsRoot, 'legacy/build/pdf.mjs')).href);

fs.mkdirSync(outdir, { recursive: true });
const doc = await getDocument({
  data: new Uint8Array(fs.readFileSync(file)),
  cMapUrl: path.join(pdfjsRoot, 'cmaps') + '/',
  cMapPacked: true,
  verbosity: 0,
}).promise;

for (let i = 1; i <= doc.numPages; i++) {
  const content = await (await doc.getPage(i)).getTextContent();
  let text = '';
  let lastY = null;
  for (const item of content.items) {
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
    text += item.str;
    lastY = y;
  }
  fs.writeFileSync(path.join(outdir, `p${String(i).padStart(3, '0')}.txt`), text);
}
console.log('pages', doc.numPages);
