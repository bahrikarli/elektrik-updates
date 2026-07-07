const os = require('os');
const path = require('path');

function yedekKlasorYolu() {
  return path.join(os.homedir(), 'ELEKTRIK-backups');
}

function yedekDosyaAdi() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `yedek-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

module.exports = { yedekKlasorYolu, yedekDosyaAdi };
