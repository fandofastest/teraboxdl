require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger');
const dbService = require('./services/dbService');
const teraboxService = require('./services/teraboxService');

const app = express();
const PORT = process.env.PORT || 5000;

// Percayai reverse proxy seperti Nginx / Cloudflare agar req.protocol dan host akurat
app.set('trust proxy', true);

// Penyimpanan URL segmen TS dalam memori agar query URL pendek & aman
const tsUrlStore = new Map();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi Database
dbService.initDB();

// ==================== SWAGGER API DOCS ====================
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "TeraCloud API Documentation (OpenAPI)"
}));

// ==================== REST API ENDPOINTS ====================

// 1. System & Dashboard Stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await dbService.getStats();
        const account = await teraboxService.getAccountInfo();
        res.json({ success: true, stats, account });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Cookie Status & Update
app.get('/api/cookie', async (req, res) => {
    const raw = teraboxService.parseCookieFile();
    const account = await teraboxService.getAccountInfo();
    res.json({
        success: true,
        hasCookie: raw.length > 0,
        account
    });
});

app.post('/api/cookie', async (req, res) => {
    try {
        const { cookie } = req.body;
        if (!cookie || !cookie.trim()) {
            return res.status(400).json({ success: false, error: 'Cookie content is required' });
        }
        teraboxService.saveCookie(cookie);
        const account = await teraboxService.getAccountInfo();
        res.json({ success: true, message: 'Cookie updated successfully', account });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Get Account Folders
app.get('/api/folders', async (req, res) => {
    try {
        const folders = await teraboxService.getAccountFolders();
        res.json({ success: true, folders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Fetch Link (Single / Multi / Folder Share)
app.post('/api/fetch/link', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || !url.trim()) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }

        const files = await teraboxService.fetchLink(url.trim());
        const savedDocs = await dbService.insertBatchFiles(files);
        
        res.json({
            success: true,
            message: `Berhasil mengambil & menyimpan ${savedDocs.length} file ke database`,
            count: savedDocs.length,
            files: savedDocs
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4b. Fetch Link with SSE Progress (untuk link share folder besar)
app.get('/api/fetch/link/stream', async (req, res) => {
    const url = req.query.url;
    if (!url || !url.trim()) {
        return res.status(400).send('URL is required');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        sendEvent({ type: 'start', message: 'Memulai ekstraksi share link...' });

        const files = await teraboxService.fetchLink(url.trim(), (progress) => {
            sendEvent({ type: 'progress', ...progress });
        });

        sendEvent({ type: 'saving', message: `Menyimpan ${files.length} file ke database...`, filesFound: files.length });
        const savedDocs = await dbService.insertBatchFiles(files);

        sendEvent({
            type: 'done',
            success: true,
            message: `Selesai! Berhasil menyimpan ${savedDocs.length} file ke database`,
            count: savedDocs.length
        });
    } catch (err) {
        sendEvent({ type: 'error', message: err.message });
    } finally {
        res.end();
    }
});

// 5. Fetch Folder Files with SSE Realtime Progress
app.get('/api/fetch/folder/stream', async (req, res) => {
    const folderPath = req.query.folderPath || '/';
    const recursive = req.query.recursive !== 'false';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        sendEvent({ type: 'start', message: `Memulai pemindaian folder: ${folderPath}` });

        const files = await teraboxService.fetchFolderFiles(folderPath, recursive, (progress) => {
            sendEvent({ type: 'progress', ...progress });
        });

        sendEvent({ type: 'saving', message: `Menyimpan ${files.length} file ke database...`, filesFound: files.length });
        const savedDocs = await dbService.insertBatchFiles(files);

        sendEvent({
            type: 'done',
            success: true,
            message: `Selesai! Berhasil menyimpan ${savedDocs.length} file dari "${folderPath}"`,
            count: savedDocs.length
        });
    } catch (err) {
        sendEvent({ type: 'error', message: err.message });
    } finally {
        res.end();
    }
});

// 6. Fetch All Account Files with SSE Realtime Progress
app.get('/api/fetch/account/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        sendEvent({ type: 'start', message: 'Memulai pemindaian menyeluruh akun Terabox...' });

        const files = await teraboxService.fetchAllAccountFiles((progress) => {
            sendEvent({ type: 'progress', ...progress });
        });

        sendEvent({ type: 'saving', message: `Menyimpan ${files.length} file ke database...`, filesFound: files.length });
        const savedDocs = await dbService.insertBatchFiles(files);

        sendEvent({
            type: 'done',
            success: true,
            message: `Selesai! Berhasil mensinkronisasi ${savedDocs.length} file dari seluruh akun ke database`,
            count: savedDocs.length
        });
    } catch (err) {
        sendEvent({ type: 'error', message: err.message });
    } finally {
        res.end();
    }
});

// Fallback POST Endpoints untuk backwards compatibility
app.post('/api/fetch/folder', async (req, res) => {
    try {
        const { folderPath, recursive } = req.body;
        const files = await teraboxService.fetchFolderFiles(folderPath || '/', recursive !== false);
        const savedDocs = await dbService.insertBatchFiles(files);
        res.json({ success: true, count: savedDocs.length, files: savedDocs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/fetch/account', async (req, res) => {
    try {
        const files = await teraboxService.fetchAllAccountFiles();
        const savedDocs = await dbService.insertBatchFiles(files);
        res.json({ success: true, count: savedDocs.length, files: savedDocs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. CRUD: List Files (Filter, Search, Pagination)
app.get('/api/files', async (req, res) => {
    try {
        const search = req.query.search || '';
        const category = req.query.category || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 24;
        const sort = req.query.sort || 'newest';

        const data = await dbService.getFiles({ search, category, page, limit, sort });
        res.json({ success: true, ...data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. CRUD: Get Single File
app.get('/api/files/:id', async (req, res) => {
    try {
        const file = await dbService.getFileById(req.params.id);
        if (!file) return res.status(404).json({ success: false, error: 'File tidak ditemukan' });
        res.json({ success: true, file });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. CRUD: Create Manual File Record
app.post('/api/files', async (req, res) => {
    try {
        const fileData = req.body;
        if (!fileData.fs_id || !fileData.title) {
            return res.status(400).json({ success: false, error: 'fs_id dan title wajib diisi' });
        }
        const doc = await dbService.insertOrUpdateFile(fileData);
        res.json({ success: true, message: 'File berhasil disimpan', file: doc });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. CRUD: Update File
app.put('/api/files/:id', async (req, res) => {
    try {
        const updated = await dbService.updateFile(req.params.id, req.body);
        if (!updated) return res.status(404).json({ success: false, error: 'File tidak ditemukan' });
        res.json({ success: true, message: 'File berhasil diperbarui', file: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 11. CRUD: Delete File
app.delete('/api/files/:id', async (req, res) => {
    try {
        const deleted = await dbService.deleteFile(req.params.id);
        if (!deleted) return res.status(404).json({ success: false, error: 'File tidak ditemukan' });
        res.json({ success: true, message: 'File berhasil dihapus dari database' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 12. Dynamic Auto-Refreshing Stream Proxy Endpoint (Anti-Expired & Mixed-Content Proof)
app.get('/api/stream/:id', async (req, res) => {
    try {
        const file = await dbService.getFileById(req.params.id);
        if (!file) return res.status(404).send('File not found');

        const streamUrl = await teraboxService.getFreshStreamUrl(file);

        if (!streamUrl) {
            return res.status(400).send('Stream URL tidak dapat dibuat untuk file ini');
        }

        const cookie = teraboxService.parseCookieFile();
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Cookie': cookie,
            'Referer': 'https://www.terabox.app/main?category=all'
        };

        const response = await fetch(streamUrl, { headers });
        if (!response.ok) {
            return res.status(response.status).send('Failed to fetch stream from Terabox');
        }

        const m3u8Content = await response.text();
        if (!m3u8Content.includes('#EXTM3U')) {
            return res.status(400).send('Invalid video manifest');
        }

        const lines = m3u8Content.split('\n');

        const rewrittenLines = lines.map((line, idx) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                const segKey = `${file._id || file.fs_id}_${idx}_${Date.now()}`;
                tsUrlStore.set(segKey, trimmed);
                
                if (tsUrlStore.size > 2000) {
                    const firstKey = tsUrlStore.keys().next().value;
                    tsUrlStore.delete(firstKey);
                }

                return `/api/ts/${segKey}`;
            }
            return line;
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewrittenLines.join('\n'));
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 13. TS Segment Local Proxy Bypass CORS
app.get('/api/ts/:key', async (req, res) => {
    try {
        const segKey = req.params.key;
        const targetUrl = tsUrlStore.get(segKey);

        if (!targetUrl) {
            return res.status(404).send('TS Segment expired or not found');
        }

        const cookie = teraboxService.parseCookieFile();
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Cookie': cookie,
            'Referer': 'https://www.terabox.app/'
        };

        const response = await fetch(targetUrl, { headers });
        if (!response.ok) {
            return res.status(response.status).send('Failed to stream video segment');
        }

        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Serve frontend SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 Terabox Admin & Streaming Server Active!`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`📚 Swagger API Docs: http://localhost:${PORT}/api-docs`);
    console.log(`==================================================\n`);
});
