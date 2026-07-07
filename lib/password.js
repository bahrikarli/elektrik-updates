const crypto = require('crypto');

function sifreHashMi(s) {
  const t = String(s || '');
  return t.startsWith('scrypt$');
}

function sifreHashUret(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(plain || ''), salt, 64).toString('hex');
  return `scrypt$${salt}$${key}`;
}

function sifreHashDogrula(storedHash, plain) {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = parts[1];
    const keyHex = parts[2];
    const derived = crypto.scryptSync(String(plain || ''), salt, 64);
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== derived.length) return false;
    return crypto.timingSafeEqual(key, derived);
  } catch (_) {
    return false;
  }
}

module.exports = { sifreHashMi, sifreHashUret, sifreHashDogrula };
