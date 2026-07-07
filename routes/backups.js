const fs = require('fs/promises');
const path = require('path');

function registerBackupRoutes(app, deps) {
  const { sql, poolPromise, YEDEK_TABLOLAR, tabloVarMi, yedekKlasorYolu, yedekDosyaAdi } = deps;

app.get('/api/yedekler', async (req, res) => {
  try {
    const dir = yedekKlasorYolu();
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir, { withFileTypes: true });
    const list = [];
    for (const f of files) {
      if (!f.isFile() || !f.name.toLowerCase().endsWith('.json')) continue;
      const full = path.join(dir, f.name);
      const st = await fs.stat(full);
      list.push({
        dosyaAdi: f.name,
        boyut: Number(st.size || 0),
        tarih: st.mtime?.toISOString?.() || null,
      });
    }
    list.sort((a, b) => String(b.tarih || '').localeCompare(String(a.tarih || '')));
    res.json({ success: true, backups: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Yedek listesi alınamadı.' });
  }
});

app.post('/api/yedek-al', async (req, res) => {
  try {
    const pool = await poolPromise;
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      app: 'ELEKTRIK',
      tables: {},
    };
    for (const t of YEDEK_TABLOLAR) {
      const varMi = await tabloVarMi(pool, t.name);
      if (!varMi) {
        payload.tables[t.name] = [];
        continue;
      }
      const rs = await pool.request().query(`SELECT * FROM dbo.${t.name}`);
      payload.tables[t.name] = rs.recordset || [];
    }
    const dir = yedekKlasorYolu();
    await fs.mkdir(dir, { recursive: true });
    const dosyaAdi = yedekDosyaAdi();
    const full = path.join(dir, dosyaAdi);
    await fs.writeFile(full, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ success: true, message: 'Yedek oluşturuldu.', dosyaAdi });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Yedek alınamadı.' });
  }
});

app.post('/api/yedek-geri-yukle', async (req, res) => {
  try {
    const dosyaAdiRaw = String(req.body?.dosyaAdi || '').trim();
    const dosyaAdi = path.basename(dosyaAdiRaw);
    if (!dosyaAdi || dosyaAdi !== dosyaAdiRaw || !dosyaAdi.toLowerCase().endsWith('.json')) {
      return res.status(400).json({ success: false, message: 'Geçersiz dosya adı.' });
    }
    const dir = yedekKlasorYolu();
    const full = path.join(dir, dosyaAdi);
    const txt = await fs.readFile(full, 'utf8');
    const json = JSON.parse(txt || '{}');
    const tables = json?.tables && typeof json.tables === 'object' ? json.tables : null;
    if (!tables) return res.status(400).json({ success: false, message: 'Yedek dosyası bozuk.' });

    const pool = await poolPromise;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const mevcutTablolar = [];
      for (const t of YEDEK_TABLOLAR) {
        const varMi = await tabloVarMi(pool, t.name);
        if (varMi) mevcutTablolar.push(t);
      }

      // Önce child tabloları temizle.
      for (const t of [...mevcutTablolar].reverse()) {
        await new sql.Request(tx).query(`DELETE FROM dbo.${t.name}`);
      }
      // Sonra parent -> child sırayla geri yaz.
      for (const t of mevcutTablolar) {
        const rows = Array.isArray(tables[t.name]) ? tables[t.name] : [];
        if (!rows.length) continue;
        const colsRs = await new sql.Request(tx)
          .input('TableName', sql.NVarChar(128), t.name)
          .query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @TableName
            ORDER BY ORDINAL_POSITION
          `);
        const cols = colsRs.recordset.map((r) => String(r.COLUMN_NAME));
        if (!cols.length) continue;
        if (t.identity) {
          await new sql.Request(tx).query(`SET IDENTITY_INSERT dbo.${t.name} ON`);
        }
        for (const r of rows) {
          const req = new sql.Request(tx);
          const valuesSql = cols.map((c, i) => {
            const p = `p${i}`;
            req.input(p, r[c] ?? null);
            return `@${p}`;
          });
          await req.query(`INSERT INTO dbo.${t.name} (${cols.map((c) => `[${c}]`).join(',')}) VALUES (${valuesSql.join(',')})`);
        }
        if (t.identity) {
          await new sql.Request(tx).query(`SET IDENTITY_INSERT dbo.${t.name} OFF`);
        }
      }
      await tx.commit();
      res.json({ success: true, message: 'Yedek başarıyla geri yüklendi.' });
    } catch (innerErr) {
      try { await tx.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Yedek geri yüklenemedi.' });
  }
});

}

module.exports = { registerBackupRoutes };
