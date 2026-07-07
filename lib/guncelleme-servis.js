const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

let durum = {
  status: 'idle',
  remoteVersion: null,
  currentVersion: null,
  percent: 0,
  transferred: 0,
  total: 0,
  message: null,
  stagingDir: null,
};

let indirmeCalisiyor = false;

function durumOku() {
  return { ...durum };
}

function indirmeUrlListesi(info) {
  const urls = [];
  const push = (u) => {
    const t = String(u || '').trim();
    if (t && !urls.includes(t)) urls.push(t);
  };
  push(info.updateUrl);
  if (info.repo && info.tag && info.assetName) {
    push(require('./http').githubReleaseAssetUrlTahmini(info.repo, info.tag, info.assetName));
    push(`https://github.com/${String(info.repo).replace(/^\/+|\/+$/g, '')}/releases/latest/download/${encodeURIComponent(String(info.assetName))}`);
  }
  return urls;
}

function urlIndirIlerlemeli(url, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(String(url || '').trim());
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, {
        method: 'GET',
        headers: { 'User-Agent': 'elektrik-otomasyon-updater', Accept: '*/*' },
      }, (res) => {
        const status = Number(res.statusCode || 0);
        const loc = res.headers?.location;
        if ([301, 302, 303, 307, 308].includes(status) && loc) {
          res.resume();
          urlIndirIlerlemeli(new URL(loc, u).toString(), onProgress).then(resolve).catch(reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        const chunks = [];
        let transferred = 0;
        res.on('data', (c) => {
          chunks.push(c);
          transferred += c.length;
          if (onProgress) onProgress(transferred, total);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), total: total || transferred }));
      });
      req.on('error', reject);
      req.setTimeout(180000, () => req.destroy(new Error('Timeout')));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function hazirStagingYukle(APP_ROOT) {
  const metaPath = path.join(APP_ROOT, 'updates', 'pending-ready.json');
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw);
    if (meta?.stagingDir && meta?.remoteVersion) {
      await fs.access(meta.stagingDir);
      durum = {
        status: 'ready',
        remoteVersion: meta.remoteVersion,
        currentVersion: meta.currentVersion || null,
        percent: 100,
        stagingDir: meta.stagingDir,
        message: null,
        transferred: 0,
        total: 0,
      };
    }
  } catch (_) {}
}

async function guncellemePaketiIndir(deps) {
  const { APP_ROOT, guncellemeManifestOku } = deps;
  if (!process.pkg) {
    return { success: false, message: 'Güncelleme EXE modunda calisir.' };
  }
  await hazirStagingYukle(APP_ROOT);
  if (durum.status === 'ready') {
    return { success: true, ...durumOku() };
  }
  if (indirmeCalisiyor) {
    return { success: true, ...durumOku() };
  }

  const info = await guncellemeManifestOku();
  if (!info.success) return info;
  if (!info.updateAvailable) {
    durum = { status: 'idle', remoteVersion: info.remoteVersion, currentVersion: info.currentVersion, percent: 0, message: 'Guncel', stagingDir: null, transferred: 0, total: 0 };
    return { success: true, ...durumOku() };
  }

  indirmeCalisiyor = true;
  durum = {
    status: 'downloading',
    remoteVersion: info.remoteVersion,
    currentVersion: info.currentVersion,
    percent: 0,
    message: null,
    stagingDir: null,
    transferred: 0,
    total: 0,
  };

  try {
    const updDir = path.join(APP_ROOT, 'updates');
    await fs.mkdir(updDir, { recursive: true });
    const stagingDir = path.join(updDir, 'pending-staging');
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(stagingDir, { recursive: true });
    const zipPath = path.join(updDir, 'pending-update.zip');

    const urls = indirmeUrlListesi(info);
    let zipBuffer = null;
    const errors = [];
    for (const u of urls) {
      try {
        const r = await urlIndirIlerlemeli(u, (tr, tot) => {
          durum.transferred = tr;
          durum.total = tot || durum.total;
          durum.percent = tot > 0 ? Math.min(99, Math.round((tr / tot) * 100)) : Math.min(50, durum.percent + 1);
        });
        zipBuffer = r.buffer;
        if (zipBuffer?.length) break;
      } catch (e) {
        errors.push(`${u}: ${e.message}`);
      }
    }
    if (!zipBuffer?.length) {
      throw new Error(errors.join(' | ') || 'Indirme basarisiz');
    }

    durum.percent = 99;
    await fs.writeFile(zipPath, zipBuffer);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(stagingDir, true);
    await fs.rm(zipPath, { force: true });

    let sourceDir = stagingDir;
    const entries = await fs.readdir(stagingDir, { withFileTypes: true });
    const topDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const topFiles = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (topDirs.length === 1 && topFiles.length === 0) {
      sourceDir = path.join(stagingDir, topDirs[0]);
    }

    await fs.writeFile(path.join(updDir, 'pending-ready.json'), JSON.stringify({
      remoteVersion: info.remoteVersion,
      currentVersion: info.currentVersion,
      stagingDir: sourceDir,
      downloadedAt: new Date().toISOString(),
    }), 'utf8');

    durum = {
      status: 'ready',
      remoteVersion: info.remoteVersion,
      currentVersion: info.currentVersion,
      percent: 100,
      stagingDir: sourceDir,
      message: null,
      transferred: zipBuffer.length,
      total: zipBuffer.length,
    };
    return { success: true, ...durumOku() };
  } catch (e) {
    durum = {
      status: 'error',
      remoteVersion: info.remoteVersion,
      currentVersion: info.currentVersion,
      percent: 0,
      message: e.message || String(e),
      stagingDir: null,
      transferred: 0,
      total: 0,
    };
    return { success: false, ...durumOku(), message: durum.message };
  } finally {
    indirmeCalisiyor = false;
  }
}

function yenidenBaslatScriptiOlustur(APP_ROOT, sourceDir, logPath) {
  const Q = (s) => String(s).replace(/"/g, '""');
  const root = Q(APP_ROOT);
  const src = Q(sourceDir);
  const log = Q(logPath);
  return [
    '@echo off',
    'setlocal',
    `echo [%date% %time%] Guncelleme kurulumu >> "${log}"`,
    'timeout /t 2 /nobreak >nul',
    'taskkill /F /IM "Elektrik-Otomasyon.exe" >nul 2>&1',
    'taskkill /F /IM "elektrik-otomasyon.exe" >nul 2>&1',
    'taskkill /F /IM "Elektrik Otomasyon.exe" >nul 2>&1',
    'for /f "tokens=5" %%a in (\'netstat -ano ^| findstr :3010 ^| findstr LISTENING\') do taskkill /F /PID %%a >nul 2>&1',
    'timeout /t 2 /nobreak >nul',
    `robocopy "${src}" "${root}" /E /IS /IT /R:8 /W:2 /NFL /NDL /NJH /NJS >> "${log}"`,
    `if errorlevel 8 echo robocopy HATA >> "${log}"`,
    `cd /d "${root}"`,
    'if exist elektrik-otomasyon.exe if not exist Elektrik-Otomasyon.exe copy /Y elektrik-otomasyon.exe Elektrik-Otomasyon.exe >> "${log}"',
    'if exist sunucu-gizli.vbs (',
    '  wscript //nologo sunucu-gizli.vbs',
    ') else if exist Elektrik-Otomasyon.exe (',
    `  start /min /D "${root}" Elektrik-Otomasyon.exe`,
    ') else if exist elektrik-otomasyon.exe (',
    `  start /min /D "${root}" elektrik-otomasyon.exe`,
    ')',
    'timeout /t 7 /nobreak >nul',
    'if exist PENCERE-AC.bat call PENCERE-AC.bat',
    `echo [%date% %time%] Tamamlandi >> "${log}"`,
    'endlocal',
    'del "%~f0" >nul 2>&1',
  ].join('\r\n');
}

async function guncellemeKurUygula(deps) {
  const { APP_ROOT } = deps;
  if (!process.pkg) {
    return { success: false, message: 'Kurulum EXE modunda calisir.' };
  }

  await hazirStagingYukle(APP_ROOT);
  if (durum.status !== 'ready' || !durum.stagingDir) {
    return { success: false, message: 'Güncelleme paketi hazır değil.' };
  }

  const updDir = path.join(APP_ROOT, 'updates');
  await fs.mkdir(updDir, { recursive: true });
  const updaterCmdPath = path.join(updDir, 'apply-update.cmd');
  const updaterLogPath = path.join(updDir, 'apply-update.log');

  const cmd = yenidenBaslatScriptiOlustur(APP_ROOT, durum.stagingDir, updaterLogPath);
  await fs.writeFile(updaterCmdPath, cmd, 'utf8');
  await fs.rm(path.join(updDir, 'pending-ready.json'), { force: true }).catch(() => {});

  const child = spawn('cmd.exe', ['/c', updaterCmdPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: APP_ROOT,
  });
  child.unref();

  setTimeout(() => {
    try { process.exit(0); } catch (_) {}
  }, 1500);

  return { success: true, message: 'Güncelleme kuruluyor, program yeniden başlayacak…', remoteVersion: durum.remoteVersion };
}

async function guncellemeIndirVeKur(deps) {
  const indir = await guncellemePaketiIndir(deps);
  if (!indir.success && durum.status !== 'ready') {
    return indir;
  }
  return guncellemeKurUygula(deps);
}

module.exports = {
  durumOku,
  hazirStagingYukle,
  guncellemePaketiIndir,
  guncellemeKurUygula,
  guncellemeIndirVeKur,
};
