const fs = require('fs');
const path = require('path');
const readline = require('readline');

const COOKIE_FILE = path.join(__dirname, 'cookie.txt');

function parseCookieFile() {
    if (!fs.existsSync(COOKIE_FILE)) return '';
    const content = fs.readFileSync(COOKIE_FILE, 'utf-8');
    const cookies = {};

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const parts = trimmed.split('\t');
        if (parts.length >= 7) {
            cookies[parts[5].trim()] = parts[6].trim();
        } else if (trimmed.includes('=')) {
            for (const p of trimmed.split(';')) {
                const pair = p.trim();
                if (pair.includes('=') && !pair.startsWith('#')) {
                    const [k, ...v] = pair.split('=');
                    cookies[k.trim()] = v.join('=').trim();
                }
            }
        }
    }

    return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

function formatSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function extractSurl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        if (parsed.searchParams.has('surl')) {
            const surl = parsed.searchParams.get('surl');
            return surl.startsWith('1') ? surl : '1' + surl;
        }
    } catch (e) {}

    const match = urlStr.match(/\/s\/(?:1)?([a-zA-Z0-9_-]+)/);
    if (match) {
        return '1' + match[1];
    }
    return null;
}

async function fetchTeraboxInfo(targetUrl, cookieStr) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Cookie': cookieStr,
        'Referer': targetUrl
    };

    let surl = extractSurl(targetUrl);
    if (!surl) {
        // Coba follow redirect jika shortlink
        try {
            const resInit = await fetch(targetUrl, { headers, redirect: 'follow' });
            surl = extractSurl(resInit.url) || extractSurl(targetUrl);
        } catch (e) {}
    }

    if (!surl) {
        return { error: "Format link Terabox tidak valid atau surl tidak ditemukan." };
    }

    const apiUrl = `https://www.terabox.app/api/shorturlinfo?shorturl=${surl}&root=1`;

    try {
        const res = await fetch(apiUrl, { headers });
        const data = await res.json();

        if (data.errno !== 0 || !data.list || data.list.length === 0) {
            return { error: `Terabox API Error: ${data.errmsg || 'File tidak ditemukan'}` };
        }

        const files = data.list.map(item => ({
            fs_id: item.fs_id,
            filename: item.server_filename || 'file_download',
            size: Number(item.size) || 0,
            stream_url: `https://www.terabox.app/share/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&uk=${data.uk}&shareid=${data.shareid}&type=M3U8_AUTO_480&fid=${item.fs_id}&sign=${data.sign}&timestamp=${data.timestamp}`
        }));

        return { files, metadata: data };
    } catch (e) {
        return { error: `Gagal menghubungi API: ${e.message}` };
    }
}

async function downloadVideoStream(streamUrl, outputPath, cookieStr) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Cookie': cookieStr,
        'Referer': 'https://www.terabox.app/'
    };

    const res = await fetch(streamUrl, { headers });
    if (!res.ok) throw new Error(`Gagal mengambil manifest m3u8 (HTTP ${res.status})`);
    
    const manifestText = await res.text();
    if (!manifestText.includes('#EXTM3U')) {
        throw new Error('Manifest video stream tidak valid.');
    }

    const tsUrls = manifestText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('http'));

    if (tsUrls.length === 0) {
        throw new Error('Tidak ada segmen video dalam manifest stream.');
    }

    console.log(`\n[+] Total Segmen : ${tsUrls.length} bagian video`);
    console.log(`[+] Menyimpan ke : ${outputPath}`);

    const fileStream = fs.createWriteStream(outputPath);
    let downloadedBytes = 0;
    const startTime = Date.now();

    for (let i = 0; i < tsUrls.length; i++) {
        const tsUrl = tsUrls[i];
        let success = false;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const tsRes = await fetch(tsUrl, { headers });
                if (tsRes.ok) {
                    const arrayBuffer = await tsRes.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    fileStream.write(buffer);
                    downloadedBytes += buffer.length;

                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = elapsed > 0 ? downloadedBytes / elapsed : 0;
                    const percent = (((i + 1) / tsUrls.length) * 100).toFixed(1);
                    const filled = Math.floor((30 * (i + 1)) / tsUrls.length);
                    const bar = '='.repeat(filled) + '-'.repeat(30 - filled);

                    process.stdout.write(`\r[${bar}] ${percent}% (${i + 1}/${tsUrls.length}) | ${formatSize(downloadedBytes)} | ${formatSize(speed)}/s`);
                    success = true;
                    break;
                }
            } catch (err) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        if (!success) {
            console.log(`\n[!] Gagal mengunduh segmen #${i + 1}`);
        }
    }

    fileStream.end();
    console.log('\n[OK] Unduhan selesai dengan sukses!');
}

async function main() {
    console.log('='.repeat(60));
    console.log('       TERABOX FILE DOWNLOADER (NODE.JS CLI)');
    console.log('='.repeat(60));

    const cookieStr = parseCookieFile();
    if (cookieStr) {
        console.log('[OK] Cookie Terabox terdeteksi dari cookie.txt');
    } else {
        console.log('[!] Peringatan: Cookie tidak ditemukan di cookie.txt');
    }

    let targetUrl = process.argv[2];

    if (!targetUrl) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        targetUrl = await new Promise(resolve => rl.question('\nMasukkan Link Terabox: ', ans => {
            rl.close();
            resolve(ans.trim());
        }));
    }

    if (!targetUrl) {
        console.log('[!] URL tidak boleh kosong!');
        return;
    }

    console.log('\n[*] Sedang mengambil metadata & informasi file...');
    const result = await fetchTeraboxInfo(targetUrl, cookieStr);

    if (result.error || !result.files || result.files.length === 0) {
        console.log(`\n[x] Gagal: ${result.error || 'File tidak ditemukan.'}`);
        return;
    }

    const files = result.files;
    console.log(`\n[OK] Ditemukan ${files.length} file:`);
    files.forEach((f, idx) => {
        console.log(`  ${idx + 1}. ${f.filename} (${formatSize(f.size)})`);
    });

    const downloadDir = path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }

    for (const f of files) {
        const cleanName = f.filename.replace(/[/\\?%*:|"<>]/g, '_');
        const outputPath = path.join(downloadDir, cleanName);

        console.log(`\n[*] Memulai download: ${cleanName}`);
        try {
            await downloadVideoStream(f.stream_url, outputPath, cookieStr);
        } catch (err) {
            console.log(`\n[x] Error saat mengunduh: ${err.message}`);
        }
    }
}

main();
