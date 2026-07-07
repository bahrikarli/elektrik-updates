const fs = require('fs');

const version = String(process.argv[2] || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('HATA: Version formati x.y.z olmali. Ornek: 1.0.11');
  process.exit(1);
}

for (const file of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(file)) continue;

  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = version;

  if (json.packages && json.packages['']) {
    json.packages[''].version = version;
  }

  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${file} -> ${version}`);
}

const indexPath = 'public/index.html';
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace(/(src="(?:js\/utils\.js|js\/navigation\.js|app\.js))(?:\?v=[^"]*)?"/g, `$1?v=${version}"`);
  fs.writeFileSync(indexPath, html);
  console.log(`${indexPath} asset version -> ${version}`);
}
