const {
  durumOku,
  hazirStagingYukle,
  guncellemePaketiIndir,
  guncellemeKurUygula,
  guncellemeIndirVeKur,
} = require('../lib/guncelleme-servis');

function registerUpdateRoutes(app, deps) {
  const {
    APP_ROOT,
    packageJson,
    yedekKlasorYolu,
    guncellemeManifestOku,
  } = deps;

  hazirStagingYukle(APP_ROOT).catch(() => {});

  const guncellemeDeps = { APP_ROOT, guncellemeManifestOku };

  app.get('/api/surum', async (req, res) => {
    try {
      res.json({
        success: true,
        appName: packageJson?.name || 'elektrik-otomasyon',
        version: packageJson?.version || '0.0.0',
        description: packageJson?.description || '',
        node: process.version,
        env: process.env.NODE_ENV || 'production',
        backupPath: yedekKlasorYolu(),
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Sürüm bilgisi alınamadı.' });
    }
  });

  app.get('/api/guncelleme-kontrol', async (req, res) => {
    try {
      const data = await guncellemeManifestOku();
      if (!data.success) return res.status(502).json(data);
      const d = durumOku();
      res.json({
        ...data,
        downloadStatus: d.status,
        downloadPercent: d.percent,
        transferred: d.transferred,
        total: d.total,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Güncelleme kontrolü başarısız.' });
    }
  });

  app.get('/api/guncelleme-indir-durum', (req, res) => {
    res.json({ success: true, ...durumOku() });
  });

  app.post('/api/guncelleme-indir', async (req, res) => {
    try {
      const data = await guncellemePaketiIndir(guncellemeDeps);
      if (!data.success) return res.status(502).json(data);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message || 'Indirme basarisiz.' });
    }
  });

  app.post('/api/guncelleme-kur', async (req, res) => {
    try {
      const data = await guncellemeKurUygula(guncellemeDeps);
      if (!data.success) return res.status(400).json(data);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Kurulum basarisiz.' });
    }
  });

  app.post('/api/guncelleme-indir-kur', async (req, res) => {
    try {
      const data = await guncellemeIndirVeKur(guncellemeDeps);
      if (!data.success) return res.status(data.status === 'error' ? 502 : 400).json(data);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message || 'Güncelleme basarisiz.' });
    }
  });

  app.post('/api/guncelleme-uygula', async (req, res) => {
    try {
      const data = await guncellemeIndirVeKur(guncellemeDeps);
      if (!data.success) return res.status(data.status === 'error' ? 502 : 400).json(data);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Güncelleme uygulanamadı.' });
    }
  });
}

module.exports = { registerUpdateRoutes };
