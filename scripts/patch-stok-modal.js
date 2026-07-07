const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const snippetPath = path.join(__dirname, '_stok-modal-snippet.html');
const targets = [
  path.join(root, 'public', 'index.html'),
  path.join(root, 'demo', 'public', 'index.html'),
];

const replacement = fs.readFileSync(snippetPath, 'utf8');
const startMark = '<div class="modal fade" id="stokEkleModal"';
const endMark = '<div class="modal fade" id="makbuzOnizlemeModal"';

for (const file of targets) {
  let html = fs.readFileSync(file, 'utf8');
  const startIdx = html.indexOf(startMark);
  const endIdx = html.indexOf(endMark, startIdx);
  if (startIdx < 0 || endIdx < 0) {
    console.error('markers not found in', file, startIdx, endIdx);
    process.exit(1);
  }
  html = html.slice(0, startIdx) + replacement + html.slice(endIdx);
  fs.writeFileSync(file, html);
  console.log('patched', path.relative(root, file));
}
