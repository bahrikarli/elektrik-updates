const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');

function normalTarayiciAc(url) {
  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${url}"`, { windowsHide: true });
  } else {
    exec(`xdg-open "${url}"`, { windowsHide: true });
  }
}

function edgeChromeYollari() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
}

const { pencereBoyutuHesapla } = require('./pencere-boyut');

function uygulamaPencereAc(url) {
  if (process.platform !== 'win32') {
    normalTarayiciAc(url);
    return;
  }
  const exeDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..', 'demo');
  const ps1 = [
    path.join(exeDir, 'pencere-ac.ps1'),
    path.join(__dirname, '..', 'demo', 'pencere-ac.ps1'),
  ].find((p) => fs.existsSync(p));
  if (ps1) {
    const envPath = path.join(process.env.LOCALAPPDATA || '', 'Elektrik Otomasyon', '.env');
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Url', url, '-EnvPath', envPath],
      { windowsHide: true },
      (err) => { if (err) uygulamaPencereAcBasit(url); },
    );
    return;
  }
  uygulamaPencereAcBasit(url);
}

function uygulamaPencereAcBasit(url) {
  const { w, h } = pencereBoyutuHesapla();
  const profile = path.join(process.env.LOCALAPPDATA || '', 'Elektrik Otomasyon', 'app-pencere');
  try { fs.mkdirSync(profile, { recursive: true }); } catch (_) {}
  const args = [
    `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`,
    `--app=${url}`,
    '--disable-features=TranslateUI',
    '--no-first-run',
  ];
  for (const exe of edgeChromeYollari()) {
    if (fs.existsSync(exe)) {
      execFile(exe, args, { windowsHide: true }, (err) => {
        if (err) normalTarayiciAc(url);
      });
      return;
    }
  }
  normalTarayiciAc(url);
}

function varsayilanTarayiciAc(port) {
  if (String(process.env.OPEN_BROWSER || '').trim() === '0') return;
  const url = `http://127.0.0.1:${port}/`;
  const appMode = String(process.env.OPEN_APP || '').trim() === '1';
  if (appMode) uygulamaPencereAc(url);
  else normalTarayiciAc(url);
}

module.exports = { varsayilanTarayiciAc, uygulamaPencereAc, normalTarayiciAc };
