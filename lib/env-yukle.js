const fs = require('fs');
const path = require('path');
const os = require('os');

function kullaniciEnvKlasoru() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
  return path.join(base, 'Elektrik Otomasyon');
}

function envDosyaAdaylari() {
  const adaylar = [];
  const kullaniciEnv = path.join(kullaniciEnvKlasoru(), '.env');
  adaylar.push(kullaniciEnv);

  if (process.versions && process.versions.electron) {
    adaylar.push(path.join(path.dirname(process.execPath), '.env'));
  }
  if (process.pkg) {
    adaylar.push(path.join(path.dirname(process.execPath), '.env'));
  }
  adaylar.push(path.join(__dirname, '..', '.env'));
  adaylar.push(path.join(__dirname, '.env'));
  adaylar.push(path.join(process.cwd(), '.env'));
  return adaylar;
}

function envDosyaYolu() {
  for (const p of envDosyaAdaylari()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return path.join(kullaniciEnvKlasoru(), '.env');
}

function envYukle() {
  const p = envDosyaYolu();
  require('dotenv').config({ path: p });
  return p;
}

module.exports = { envYukle, envDosyaYolu, envDosyaAdaylari, kullaniciEnvKlasoru };
