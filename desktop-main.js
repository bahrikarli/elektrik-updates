const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { sunucuyuBaslat } = require('./server');

const PORT = Number(process.env.PORT || 3010);
const APP_URL = `http://127.0.0.1:${PORT}`;

let serverInstance = null;
let mainWindow = null;
let updateDownloaded = false;
let desktopUpdateState = {
  status: 'idle',
  version: null,
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
  error: null,
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReady() {
  try {
    const res = await fetch(`${APP_URL}/favicon.ico`, { method: 'GET' });
    return res.ok || res.status === 204;
  } catch (_) {
    return false;
  }
}

async function waitForServer(maxTries = 60) {
  for (let i = 0; i < maxTries; i += 1) {
    if (await isServerReady()) return true;
    await wait(500);
  }
  return false;
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.on('focus', () => {
    if (!mainWindow?.webContents) return;
    mainWindow.focus();
    mainWindow.webContents.focus();
    mainWindow.webContents.executeJavaScript(
      'typeof arayuzuSerbestBirak==="function"&&arayuzuSerbestBirak()'
    ).catch(() => {});
  });

  mainWindow.on('show', () => {
    if (!mainWindow?.webContents) return;
    mainWindow.webContents.focus();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      if (typeof arayuzuKorumaBaslat === 'function') arayuzuKorumaBaslat();
      if (typeof arayuzuSerbestBirak === 'function') arayuzuSerbestBirak();
      if (document.getElementById('ana-uygulama')?.style.display === 'block' && typeof anaUygulamayiAc === 'function') {
        anaUygulamayiAc();
      }
    `).catch(() => {});
  });

  await mainWindow.loadURL(APP_URL);
}

function configureAutoUpdate() {
  // Auto update works only on packaged desktop app.
  if (!app.isPackaged) return;

  const updateUrl = String(process.env.ELECTRON_UPDATE_URL || '').trim();
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // If ELECTRON_UPDATE_URL is set, use generic provider.
    // Otherwise electron-updater reads app-update.yml (e.g. GitHub publish config).
    if (updateUrl) {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: updateUrl,
      });
      console.log(`Guncelleme kaynagi (generic): ${updateUrl}`);
    } else {
      console.log('Guncelleme kaynagi: package publish config (ornek: GitHub Releases)');
    }
  } catch (err) {
    console.error('Guncelleme feed ayarlanamadi:', err?.message || err);
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('Guncelleme kontrol ediliyor...');
    desktopUpdateState = { ...desktopUpdateState, status: 'checking', error: null };
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`Yeni surum bulundu: ${info?.version || 'bilinmiyor'}`);
    desktopUpdateState = { ...desktopUpdateState, status: 'downloading', version: info?.version || null, percent: 0 };
  });

  autoUpdater.on('update-not-available', () => {
    console.log('Yeni surum yok.');
    desktopUpdateState = { ...desktopUpdateState, status: 'up-to-date' };
  });

  autoUpdater.on('error', async (error) => {
    console.error('Guncelleme hatasi:', error?.message || error);
    desktopUpdateState = { ...desktopUpdateState, status: 'error', error: error?.message || 'Bilinmeyen hata' };
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number(progress?.percent || 0).toFixed(1);
    console.log(`Guncelleme indiriliyor: %${percent}`);
    desktopUpdateState = {
      ...desktopUpdateState,
      status: 'downloading',
      percent: Number(percent),
      bytesPerSecond: progress?.bytesPerSecond || 0,
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
    };
  });

  autoUpdater.on('update-downloaded', async (info) => {
    updateDownloaded = true;
    desktopUpdateState = { ...desktopUpdateState, status: 'ready', percent: 100 };
    const nextVersion = info?.version ? `v${info.version}` : 'yeni sürüm';
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Şimdi yeniden başlat', 'Daha sonra'],
      defaultId: 0,
      cancelId: 1,
      title: 'Güncelleme hazır',
      message: `${nextVersion} indirildi. Uygulama şimdi yeniden başlatılsın mı?`,
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Guncelleme kontrolu basarisiz:', err?.message || err);
  });
}

function registerDesktopUpdateAPI() {
  const { app: expressApp } = require('./server');

  expressApp.get('/api/desktop-update-status', (req, res) => {
    res.json({ success: true, ...desktopUpdateState });
  });

  expressApp.post('/api/desktop-update-install', (req, res) => {
    if (desktopUpdateState.status !== 'ready') {
      return res.json({ success: false, message: 'Güncelleme henüz hazır değil.' });
    }
    res.json({ success: true, message: 'Yeniden başlatılıyor...' });
    setTimeout(() => autoUpdater.quitAndInstall(), 500);
  });

  expressApp.post('/api/desktop-update-check', (req, res) => {
    if (!app.isPackaged) {
      return res.json({ success: false, message: 'Masaüstü modunda değil.' });
    }
    desktopUpdateState = { ...desktopUpdateState, status: 'checking', error: null };
    autoUpdater.checkForUpdates().catch((err) => {
      desktopUpdateState = { ...desktopUpdateState, status: 'error', error: err?.message || 'Kontrol başarısız' };
    });
    res.json({ success: true, message: 'Kontrol başlatıldı.' });
  });
}

function stopServer() {
  if (!serverInstance) return;
  try {
    serverInstance.close();
  } catch (_) {}
  serverInstance = null;
}

app.whenReady().then(async () => {
  try {
    serverInstance = await sunucuyuBaslat({ exitOnError: false });
  } catch (_) {
    serverInstance = null;
  }
  const ready = await waitForServer();
  if (!ready) {
    dialog.showErrorBox(
      'Uygulama başlatılamadı',
      'Sunucu başlatılamadı. Lütfen veritabanı bağlantısı ve .env ayarlarını kontrol edin.'
    );
    stopServer();
    app.quit();
    return;
  }
  await createMainWindow();
  configureAutoUpdate();
  registerDesktopUpdateAPI();
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopServer();
});

app.on('quit', () => {
  if (updateDownloaded) {
    console.log('Guncelleme sonrasi cikis.');
  }
});
