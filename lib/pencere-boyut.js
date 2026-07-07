const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VARSAYILAN_W = 1720;
const VARSAYILAN_H = 980;
const MIN_W = 1024;
const MIN_H = 700;

function envdenOku(envPath) {
  let maxW = VARSAYILAN_W;
  let maxH = VARSAYILAN_H;
  const p = envPath || path.join(process.cwd(), '.env');
  try {
    if (!fs.existsSync(p)) return { maxW, maxH };
    const satirlar = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const satir of satirlar) {
      const m = satir.match(/^\s*APP_WINDOW_WIDTH\s*=\s*(\d+)/i);
      if (m) maxW = parseInt(m[1], 10) || maxW;
      const m2 = satir.match(/^\s*APP_WINDOW_HEIGHT\s*=\s*(\d+)/i);
      if (m2) maxH = parseInt(m2[1], 10) || maxH;
    }
  } catch (_) {}
  return { maxW, maxH };
}

function windowsCalismaAlani() {
  if (process.platform !== 'win32') return null;
  try {
    const cmd = 'Add-Type -AssemblyName System.Windows.Forms; $a=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Write-Output ($a.Width.ToString()+\',\'+$a.Height.ToString())';
    const out = execSync(`powershell -NoProfile -Command "${cmd}"`, {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    }).trim();
    const [sw, sh] = out.split(',').map((n) => parseInt(n, 10));
    if (sw > 0 && sh > 0) return { sw, sh };
  } catch (_) {}
  return null;
}

/** Buyuk monitor: 1720x980; laptop: ekrana sigar (kenar bosluk birakir). */
function pencereBoyutuHesapla(envPath) {
  const env = process.env;
  let maxW = parseInt(env.APP_WINDOW_WIDTH || '', 10) || VARSAYILAN_W;
  let maxH = parseInt(env.APP_WINDOW_HEIGHT || '', 10) || VARSAYILAN_H;
  if (envPath || !env.APP_WINDOW_WIDTH) {
    const dosyadan = envdenOku(envPath);
    if (!env.APP_WINDOW_WIDTH) maxW = dosyadan.maxW;
    if (!env.APP_WINDOW_HEIGHT) maxH = dosyadan.maxH;
  }

  const alan = windowsCalismaAlani();
  if (!alan) return { w: maxW, h: maxH };

  const w = Math.min(maxW, Math.max(MIN_W, alan.sw - 24));
  const h = Math.min(maxH, Math.max(MIN_H, alan.sh - 48));
  return { w, h };
}

module.exports = { pencereBoyutuHesapla, VARSAYILAN_W, VARSAYILAN_H };
