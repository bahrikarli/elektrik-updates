const fs = require('fs');
const path = require('path');

const hedef = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const kaynak = path.join(__dirname, '..', 'public');
const pubHedef = path.join(hedef, 'public');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(kaynak)) {
  console.error('public bulunamadi:', kaynak);
  process.exit(1);
}
copyDir(kaynak, pubHedef);
console.log('public ->', pubHedef);
