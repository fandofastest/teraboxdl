const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '..', 'cookie.txt');

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

function saveCookie(cookieStr) {
    fs.writeFileSync(COOKIE_FILE, cookieStr.trim(), 'utf-8');
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

function determineCategory(filename, categoryId) {
    const ext = path.extname(filename).toLowerCase().replace('.', '');
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm', 'ts', 'm4v', '3gp'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
    const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'];
    const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'iso'];

    if (categoryId === '1' || categoryId === 1 || videoExts.includes(ext)) return 'video';
    if (categoryId === '3' || categoryId === 3 || imageExts.includes(ext)) return 'image';
    if (categoryId === '2' || categoryId === 2 || audioExts.includes(ext)) return 'audio';
    if (categoryId === '4' || categoryId === 4 || docExts.includes(ext)) return 'document';
    if (categoryId === '5' || categoryId === 5 || archiveExts.includes(ext)) return 'archive';
    return 'other';
}

/**
 * Validasi status akun dan cookie Terabox
 */
async function getAccountInfo() {
    const cookie = parseCookieFile();
    if (!cookie) return { loggedIn: false, message: 'Cookie belum diatur' };

    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Cookie': cookie,
            'Referer': 'https://www.terabox.app/main?category=all'
        };
        const res = await fetch('https://www.terabox.app/api/home/info?app_id=250528&web=1&channel=dubox&clienttype=0&jsToken=&dp-logid=', { headers });
        const data = await res.json();
        
        if (data.errno === 0 && data.data) {
            return {
                loggedIn: true,
                username: data.data.username || 'Terabox User',
                uk: data.data.uk,
                country: data.data.user_country
            };
        }
        return { loggedIn: false, message: data.errmsg || 'Cookie kadaluarsa atau tidak valid' };
    } catch (e) {
        return { loggedIn: false, message: e.message };
    }
}

/**
 * Mendapatkan Live Dynamic Stream URL (Selalu Fresh & Anti-Expired)
 */
async function getFreshStreamUrl(fileDoc) {
    const cookie = parseCookieFile();
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Cookie': cookie,
        'Referer': 'https://www.terabox.app/main?category=all'
    };

    if (fileDoc.source_type === 'folder' || fileDoc.source_type === 'account' || (!fileDoc.share_url && fileDoc.path)) {
        return `https://www.terabox.app/api/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&type=M3U8_AUTO_480&path=${encodeURIComponent(fileDoc.path)}`;
    }

    if (fileDoc.share_url || fileDoc.surl) {
        const surl = fileDoc.surl || extractSurl(fileDoc.share_url);
        if (surl) {
            const apiUrl = `https://www.terabox.app/api/shorturlinfo?shorturl=${surl}&root=1`;
            const res = await fetch(apiUrl, { headers });
            const data = await res.json();

            if (data.errno === 0) {
                return `https://www.terabox.app/share/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&uk=${data.uk}&shareid=${data.shareid}&type=M3U8_AUTO_480&fid=${fileDoc.fs_id}&sign=${data.sign}&timestamp=${data.timestamp}`;
            }
        }
    }

    return fileDoc.stream_url;
}

/**
 * 1. Fetch File Dari Link Share (Support Single File & Folder Share Rekursif)
 */
async function fetchLink(link, onProgress = null) {
    const cookie = parseCookieFile();
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Cookie': cookie,
        'Referer': link
    };

    let surl = extractSurl(link);
    if (!surl) {
        try {
            const resInit = await fetch(link, { headers, redirect: 'follow' });
            surl = extractSurl(resInit.url) || extractSurl(link);
        } catch (e) {}
    }

    if (!surl) {
        throw new Error("Format link Terabox tidak valid atau surl tidak ditemukan.");
    }

    // 1. Ambil info root dari share link
    const apiUrl = `https://www.terabox.app/api/shorturlinfo?shorturl=${surl}&root=1`;
    const res = await fetch(apiUrl, { headers });
    const data = await res.json();

    if (data.errno !== 0 || !data.list || data.list.length === 0) {
        throw new Error(data.errmsg || 'File tidak ditemukan atau link sudah kadaluarsa.');
    }

    const uk = data.uk;
    const shareid = data.shareid;
    const sign = data.sign;
    const timestamp = data.timestamp;

    const allFiles = [];

    // Fungsi rekursif untuk scan subfolder di dalam link share
    async function scanShareList(dirPath = '', rootFlag = 1) {
        let page = 1;
        let hasMore = true;

        if (onProgress) {
            onProgress({
                status: 'scanning',
                currentDir: dirPath || '/',
                filesFound: allFiles.length,
                message: `Memindai isi share: ${dirPath || 'Root folder'} (Ditemukan: ${allFiles.length} file)...`
            });
        }

        while (hasMore) {
            let listUrl = `https://www.terabox.app/share/list?app_id=250528&web=1&channel=dubox&clienttype=0&shorturl=${surl}&num=100&page=${page}&by=name&order=asc`;
            if (rootFlag === 1) {
                listUrl += `&root=1`;
            } else {
                listUrl += `&dir=${encodeURIComponent(dirPath)}&root=0`;
            }

            try {
                const rList = await fetch(listUrl, { headers });
                const listData = await rList.json();

                if (listData.errno === 0 && listData.list && listData.list.length > 0) {
                    for (const item of listData.list) {
                        if (item.isdir === 1 || item.isdir === '1') {
                            // Rekursif ke dalam subfolder
                            await scanShareList(item.path, 0);
                        } else {
                            const cat = determineCategory(item.server_filename, item.category);
                            const streamUrl = cat === 'video'
                                ? `https://www.terabox.app/share/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&uk=${uk}&shareid=${shareid}&type=M3U8_AUTO_480&fid=${item.fs_id}&sign=${sign}&timestamp=${timestamp}`
                                : '';

                            const thumb = item.thumbs ? (item.thumbs.url3 || item.thumbs.url2 || item.thumbs.url1 || item.thumbs.icon) : '';

                            allFiles.push({
                                fs_id: String(item.fs_id),
                                title: item.server_filename || 'file_download',
                                category: cat,
                                size: Number(item.size) || 0,
                                size_formatted: formatSize(item.size),
                                thumbnail: thumb,
                                stream_url: streamUrl,
                                share_url: link,
                                surl: surl,
                                dlink: item.dlink || '',
                                path: item.path || '/',
                                source_type: 'link',
                                shareid: String(shareid),
                                uk: String(uk),
                                sign: String(sign),
                                timestamp: Number(timestamp)
                            });
                        }
                    }

                    if (listData.list.length < 100) {
                        hasMore = false;
                    } else {
                        page++;
                    }
                } else {
                    hasMore = false;
                }
            } catch (e) {
                hasMore = false;
            }
        }
    }

    // Cek apakah ada item berjenis folder di response root
    const hasDirectory = data.list.some(item => item.isdir === 1 || item.isdir === '1');

    if (hasDirectory) {
        await scanShareList('', 1);
    } else {
        // Single / Multi files langsung di root
        for (const item of data.list) {
            const cat = determineCategory(item.server_filename, item.category);
            const streamUrl = cat === 'video' 
                ? `https://www.terabox.app/share/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&uk=${uk}&shareid=${shareid}&type=M3U8_AUTO_480&fid=${item.fs_id}&sign=${sign}&timestamp=${timestamp}`
                : '';

            const thumb = item.thumbs ? (item.thumbs.url3 || item.thumbs.url2 || item.thumbs.url1 || item.thumbs.icon) : '';

            allFiles.push({
                fs_id: String(item.fs_id),
                title: item.server_filename || 'file_download',
                category: cat,
                size: Number(item.size) || 0,
                size_formatted: formatSize(item.size),
                thumbnail: thumb,
                stream_url: streamUrl,
                share_url: link,
                surl: surl,
                dlink: item.dlink || '',
                path: item.path || '/',
                source_type: 'link',
                shareid: String(shareid),
                uk: String(uk),
                sign: String(sign),
                timestamp: Number(timestamp)
            });
        }
    }

    return allFiles;
}

/**
 * 2. Fetch File Dalam Folder Akun Pengguna dengan Progress Callback
 */
async function fetchFolderFiles(folderPath = '/', recursive = true, onProgress = null) {
    const cookie = parseCookieFile();
    if (!cookie) throw new Error("Cookie Terabox belum diatur. Silakan masukkan cookie di Settings.");

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Cookie': cookie,
        'Referer': 'https://www.terabox.app/main?category=all'
    };

    const cleanPath = folderPath.startsWith('/') ? folderPath : '/' + folderPath;
    const allFiles = [];
    let scannedFoldersCount = 0;

    async function scanDir(currentDir) {
        scannedFoldersCount++;
        let page = 1;
        let hasMore = true;

        if (onProgress) {
            onProgress({
                status: 'scanning',
                currentDir: currentDir,
                filesFound: allFiles.length,
                foldersScanned: scannedFoldersCount,
                message: `Memindai folder: ${currentDir} (Ditemukan: ${allFiles.length} file)...`
            });
        }

        while (hasMore) {
            const url = `https://www.terabox.app/api/list?app_id=250528&web=1&channel=dubox&clienttype=0&order=time&desc=1&dir=${encodeURIComponent(currentDir)}&num=100&page=${page}`;
            const res = await fetch(url, { headers });
            const data = await res.json();

            if (data.errno !== 0 || !data.list) {
                break;
            }

            for (const item of data.list) {
                if (item.isdir === 1 || item.isdir === '1') {
                    if (recursive) {
                        await scanDir(item.path);
                    }
                } else {
                    const cat = determineCategory(item.server_filename, item.category);
                    const thumb = item.thumbs ? (item.thumbs.url3 || item.thumbs.url2 || item.thumbs.url1 || item.thumbs.icon) : '';
                    const fullPath = item.path || (currentDir.endsWith('/') ? currentDir + item.server_filename : currentDir + '/' + item.server_filename);

                    allFiles.push({
                        fs_id: String(item.fs_id),
                        title: item.server_filename,
                        category: cat,
                        size: Number(item.size) || 0,
                        size_formatted: formatSize(item.size),
                        thumbnail: thumb,
                        stream_url: `https://www.terabox.app/api/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&type=M3U8_AUTO_480&path=${encodeURIComponent(fullPath)}`,
                        dlink: item.dlink || '',
                        path: fullPath,
                        source_type: 'folder'
                    });

                    if (onProgress && allFiles.length % 5 === 0) {
                        onProgress({
                            status: 'scanning',
                            currentDir: currentDir,
                            filesFound: allFiles.length,
                            foldersScanned: scannedFoldersCount,
                            message: `Menemukan file: ${item.server_filename}`
                        });
                    }
                }
            }

            if (data.list.length < 100) {
                hasMore = false;
            } else {
                page++;
            }
        }
    }

    await scanDir(cleanPath);
    return allFiles;
}

/**
 * 3. Fetch Semua File Dalam Seluruh Akun Pengguna
 */
async function fetchAllAccountFiles(onProgress = null) {
    return await fetchFolderFiles('/', true, onProgress);
}

/**
 * 4. Ambil Daftar Folder Akun Pengguna
 */
async function getAccountFolders() {
    const cookie = parseCookieFile();
    if (!cookie) throw new Error("Cookie belum diatur.");

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Cookie': cookie,
        'Referer': 'https://www.terabox.app/main?category=all'
    };

    const url = 'https://www.terabox.app/api/list?app_id=250528&web=1&channel=dubox&clienttype=0&order=name&desc=0&dir=%2F&num=100&page=1';
    const res = await fetch(url, { headers });
    const data = await res.json();

    if (data.errno === 0 && data.list) {
        return data.list.filter(item => item.isdir === 1 || item.isdir === '1').map(item => ({
            path: item.path,
            name: item.server_filename
        }));
    }
    return [];
}

module.exports = {
    parseCookieFile,
    saveCookie,
    getAccountInfo,
    getFreshStreamUrl,
    fetchLink,
    fetchFolderFiles,
    fetchAllAccountFiles,
    getAccountFolders,
    formatSize
};
