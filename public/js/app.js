// TeraCloud Dashboard Controller
let currentPage = 1;
let currentLimit = 24;
let currentView = 'grid';
let hlsInstance = null;
let activeStreamFile = null;

// DOM Elements
const statTotalFiles = document.getElementById('stat-total-files');
const statTotalVideos = document.getElementById('stat-total-videos');
const statTotalSize = document.getElementById('stat-total-size');
const statDbType = document.getElementById('stat-db-type');
const userName = document.getElementById('user-name');
const accountStatus = document.getElementById('account-status');

const filesGridContainer = document.getElementById('files-grid-container');
const filesTableContainer = document.getElementById('files-table-container');
const filesTableBody = document.getElementById('files-table-body');
const paginationContainer = document.getElementById('pagination-container');

const inputSearch = document.getElementById('input-search');
const selectCategory = document.getElementById('select-category');
const selectSort = document.getElementById('select-sort');
const btnViewGrid = document.getElementById('btn-view-grid');
const btnViewTable = document.getElementById('btn-view-table');

// Progress Bar DOM
const progressContainer = document.getElementById('fetch-progress-container');
const progressStatusText = document.getElementById('progress-status-text');
const progressCountText = document.getElementById('progress-count-text');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressLogText = document.getElementById('progress-log-text');

// Modals
const modalPlayer = document.getElementById('modal-player');
const modalEdit = document.getElementById('modal-edit');
const modalSettings = document.getElementById('modal-settings');
const videoElement = document.getElementById('video-element');
const modalPlayerTitle = document.getElementById('modal-player-title');
const playerFileSize = document.getElementById('player-file-size');

// Toast Notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// 1. Fetch Stats & System Status
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (data.success) {
            statTotalFiles.innerText = (data.stats.totalFiles || 0).toLocaleString();
            statTotalVideos.innerText = (data.stats.totalVideos || 0).toLocaleString();
            statTotalSize.innerText = formatSize(data.stats.totalSize);
            statDbType.innerText = data.stats.isMongoDB ? 'MongoDB Connected' : 'Embedded Local DB';

            if (data.account && data.account.loggedIn) {
                userName.innerText = data.account.username;
                accountStatus.innerText = 'Connected';
                accountStatus.style.color = 'var(--success)';
            } else {
                userName.innerText = 'Akun Belum Login';
                accountStatus.innerText = 'Need Cookie';
                accountStatus.style.color = 'var(--warning)';
            }
        }
    } catch (e) {
        console.error('Error loadStats:', e);
    }
}

// 2. Fetch File List from Database (CRUD Read)
async function loadFiles(page = 1) {
    currentPage = page;
    const search = inputSearch.value.trim();
    const category = selectCategory.value;
    const sort = selectSort.value;

    try {
        const url = `/api/files?page=${page}&limit=${currentLimit}&search=${encodeURIComponent(search)}&category=${category}&sort=${sort}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            renderFiles(data.files);
            renderPagination(data.page, data.totalPages);
        }
    } catch (e) {
        showToast('Gagal memuat data file: ' + e.message, 'error');
    }
}

// Render Files to Grid & Table
function renderFiles(files) {
    if (!files || files.length === 0) {
        const emptyHtml = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
                <i class="fa-solid fa-cloud-arrow-up" style="font-size: 48px; margin-bottom: 16px; color: var(--text-dim);"></i>
                <h3 style="font-size: 16px; color: #fff;">Belum Ada File di Database</h3>
                <p style="font-size: 13px; margin-top: 6px;">Gunakan panel Fetch Engine di atas untuk mengambil link atau memindai folder Terabox Anda.</p>
            </div>
        `;
        filesGridContainer.innerHTML = emptyHtml;
        filesTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">Belum ada file di database</td></tr>`;
        return;
    }

    // Grid View Render
    filesGridContainer.innerHTML = files.map(file => {
        const thumbHtml = file.thumbnail 
            ? `<img src="${file.thumbnail}" alt="${escapeHtml(file.title)}" loading="lazy" onerror="this.src='/thumb_fallback.png'">`
            : `<div class="thumb-placeholder"><i class="fa-solid ${getCategoryIcon(file.category)}"></i></div>`;

        const playBtnHtml = file.category === 'video'
            ? `<button class="play-overlay-btn" onclick="openPlayer('${file._id || file.fs_id}')" title="Play Video"><i class="fa-solid fa-play"></i></button>`
            : '';

        return `
            <div class="file-card">
                <div class="card-thumb-wrap">
                    ${thumbHtml}
                    <span class="card-badge ${file.category}">${file.category}</span>
                    ${playBtnHtml}
                </div>
                <div class="card-body">
                    <h4 class="card-title" title="${escapeHtml(file.title)}">${escapeHtml(file.title)}</h4>
                    <div class="card-meta">
                        <span><i class="fa-solid fa-hard-drive"></i> ${file.size_formatted || formatSize(file.size)}</span>
                        <span><i class="fa-solid fa-folder"></i> ${escapeHtml(file.path || '/')}</span>
                    </div>
                    <div class="card-actions">
                        ${file.category === 'video' ? `<button class="btn btn-primary btn-sm" onclick="openPlayer('${file._id || file.fs_id}')"><i class="fa-solid fa-play"></i> Play</button>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="openEdit('${file._id || file.fs_id}')" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn btn-danger btn-sm" onclick="deleteFileRecord('${file._id || file.fs_id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Table View Render
    filesTableBody.innerHTML = files.map(file => {
        const thumbSmall = file.thumbnail
            ? `<img src="${file.thumbnail}" style="width: 48px; height: 32px; object-fit: cover; border-radius: 4px;">`
            : `<i class="fa-solid ${getCategoryIcon(file.category)}" style="font-size: 20px; color: var(--text-dim);"></i>`;

        return `
            <tr>
                <td>${thumbSmall}</td>
                <td><strong>${escapeHtml(file.title)}</strong></td>
                <td><span class="card-badge ${file.category}" style="position: static;">${file.category}</span></td>
                <td>${file.size_formatted || formatSize(file.size)}</td>
                <td><code>${escapeHtml(file.path || '/')}</code></td>
                <td>${new Date(file.created_at).toLocaleDateString()}</td>
                <td>
                    <div style="display: flex; gap: 6px;">
                        ${file.category === 'video' ? `<button class="btn btn-primary btn-sm" onclick="openPlayer('${file._id || file.fs_id}')"><i class="fa-solid fa-play"></i></button>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="openEdit('${file._id || file.fs_id}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-danger btn-sm" onclick="deleteFileRecord('${file._id || file.fs_id}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Render Pagination
function renderPagination(current, total) {
    if (total <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    let html = '';
    for (let i = 1; i <= total; i++) {
        html += `<button class="page-btn ${i === current ? 'active' : ''}" onclick="loadFiles(${i})">${i}</button>`;
    }
    paginationContainer.innerHTML = html;
}

// 3. Play Video Function (HLS Stream)
async function openPlayer(fileId) {
    try {
        const res = await fetch(`/api/files/${fileId}`);
        const data = await res.json();
        if (!data.success || !data.file) throw new Error('Data file tidak ditemukan');

        const file = data.file;
        activeStreamFile = file;
        modalPlayerTitle.innerText = file.title;
        playerFileSize.innerText = `Ukuran File: ${file.size_formatted || formatSize(file.size)}`;

        modalPlayer.classList.add('active');

        const streamSrc = `/api/stream/${fileId}`;

        if (Hls.isSupported()) {
            if (hlsInstance) hlsInstance.destroy();
            hlsInstance = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90
            });
            hlsInstance.loadSource(streamSrc);
            hlsInstance.attachMedia(videoElement);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                videoElement.play().catch(e => {
                    console.log('Autoplay prevented by browser:', e);
                });
            });
            hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.error('Fatal network error encountered, trying to recover');
                            hlsInstance.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.error('Fatal media error encountered, trying to recover');
                            hlsInstance.recoverMediaError();
                            break;
                        default:
                            showToast('Gagal memuat stream video. Pastikan link masih aktif.', 'error');
                            hlsInstance.destroy();
                            break;
                    }
                }
            });
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            videoElement.src = streamSrc;
            videoElement.play().catch(() => {});
        } else {
            showToast('Browser Anda tidak mendukung pemutaran HLS video stream', 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function closePlayer() {
    modalPlayer.classList.remove('active');
    videoElement.pause();
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    videoElement.src = '';
}

// 4. CRUD Update Edit File
async function openEdit(fileId) {
    try {
        const res = await fetch(`/api/files/${fileId}`);
        const data = await res.json();
        if (!data.success || !data.file) return;

        const file = data.file;
        document.getElementById('edit-file-id').value = file._id || file.fs_id;
        document.getElementById('edit-file-title').value = file.title;
        document.getElementById('edit-file-category').value = file.category;

        modalEdit.classList.add('active');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

document.getElementById('form-edit-file').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileId = document.getElementById('edit-file-id').value;
    const title = document.getElementById('edit-file-title').value;
    const category = document.getElementById('edit-file-category').value;

    try {
        const res = await fetch(`/api/files/${fileId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, category })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Metadata berhasil diperbarui!', 'success');
            modalEdit.classList.remove('active');
            loadFiles(currentPage);
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// 5. CRUD Delete File
async function deleteFileRecord(fileId) {
    if (!confirm('Apakah Anda yakin ingin menghapus metadata file ini dari database?')) return;

    try {
        const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('File berhasil dihapus dari database', 'success');
            loadFiles(currentPage);
            loadStats();
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// 6. Fetch Single Link Handler
document.getElementById('form-fetch-link').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('input-fetch-link');
    const btn = document.getElementById('btn-submit-link');
    const url = input.value.trim();

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Fetching...`;

    try {
        const res = await fetch('/api/fetch/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
            input.value = '';
            loadFiles(1);
            loadStats();
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) {
        showToast('Terjadi kesalahan: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-bolt"></i> Fetch & Save`;
    }
});

// 7. Realtime Stream Progress Fetcher (Folder & Account)
function startSSEFetchStream(streamUrl, btnElement, originalBtnHtml) {
    progressContainer.style.display = 'block';
    progressBarFill.style.width = '15%';
    progressStatusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memulai pemindaian...`;
    progressCountText.innerText = '0 File Ditemukan';
    progressLogText.innerText = 'Menghubungkan ke server Terabox...';

    btnElement.disabled = true;
    btnElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memindai...`;

    const evtSource = new EventSource(streamUrl);

    evtSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === 'start') {
                progressStatusText.innerHTML = `<i class="fa-solid fa-folder-tree fa-spin"></i> Memindai folder...`;
                progressLogText.innerText = data.message;
            } else if (data.type === 'progress') {
                const count = data.filesFound || 0;
                progressCountText.innerText = `${count} File Ditemukan`;
                progressLogText.innerText = data.message || `Folder: ${data.currentDir}`;
                // Animasikan progress bar secara dinamis
                const currentWidth = Math.min(85, 20 + count * 2);
                progressBarFill.style.width = `${currentWidth}%`;
            } else if (data.type === 'saving') {
                progressBarFill.style.width = '90%';
                progressStatusText.innerHTML = `<i class="fa-solid fa-database fa-spin"></i> Menyimpan ke MongoDB...`;
                progressLogText.innerText = data.message;
            } else if (data.type === 'done') {
                progressBarFill.style.width = '100%';
                progressStatusText.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--success);"></i> Selesai!`;
                progressCountText.innerText = `${data.count} File Tersimpan`;
                progressLogText.innerText = data.message;

                showToast(data.message, 'success');
                evtSource.close();
                btnElement.disabled = false;
                btnElement.innerHTML = originalBtnHtml;

                loadFiles(1);
                loadStats();

                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    progressBarFill.style.width = '0%';
                }, 6000);
            } else if (data.type === 'error') {
                showToast(data.message, 'error');
                progressStatusText.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: var(--danger);"></i> Gagal`;
                progressLogText.innerText = data.message;
                evtSource.close();
                btnElement.disabled = false;
                btnElement.innerHTML = originalBtnHtml;
            }
        } catch (e) {
            console.error('SSE JSON error:', e);
        }
    };

    evtSource.onerror = () => {
        evtSource.close();
        btnElement.disabled = false;
        btnElement.innerHTML = originalBtnHtml;
    };
}

// Form Fetch Folder (Realtime Progress)
document.getElementById('form-fetch-folder').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('input-fetch-folder');
    const btn = document.getElementById('btn-submit-folder');
    const folderPath = input.value.trim();
    const originalHtml = `<i class="fa-solid fa-folder-open"></i> Scan & Sync Folder`;

    const streamUrl = `/api/fetch/folder/stream?folderPath=${encodeURIComponent(folderPath)}&recursive=true`;
    startSSEFetchStream(streamUrl, btn, originalHtml);
});

// Button Fetch All Account (Realtime Progress)
document.getElementById('btn-fetch-all-account').addEventListener('click', () => {
    if (!confirm('Pindai seluruh file dari semua folder di akun Terabox Anda?')) return;
    const btn = document.getElementById('btn-fetch-all-account');
    const originalHtml = `<i class="fa-solid fa-wand-magic-sparkles"></i> Start Full Account Sync`;

    const streamUrl = `/api/fetch/account/stream`;
    startSSEFetchStream(streamUrl, btn, originalHtml);
});

// 8. Cookie Management
document.getElementById('nav-settings').addEventListener('click', () => {
    modalSettings.classList.add('active');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
    modalSettings.classList.remove('active');
});

document.getElementById('btn-cancel-settings').addEventListener('click', () => {
    modalSettings.classList.remove('active');
});

document.getElementById('form-save-cookie').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cookie = document.getElementById('input-cookie-text').value.trim();

    try {
        const res = await fetch('/api/cookie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cookie })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Cookie berhasil disimpan!', 'success');
            modalSettings.classList.remove('active');
            loadStats();
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// Helpers
function formatSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getCategoryIcon(cat) {
    switch (cat) {
        case 'video': return 'fa-file-video';
        case 'image': return 'fa-file-image';
        case 'audio': return 'fa-file-audio';
        case 'document': return 'fa-file-lines';
        default: return 'fa-file';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Event Listeners for UI
document.getElementById('btn-close-player').addEventListener('click', closePlayer);
document.getElementById('btn-close-edit').addEventListener('click', () => modalEdit.classList.remove('active'));
document.getElementById('btn-cancel-edit').addEventListener('click', () => modalEdit.classList.remove('active'));

document.getElementById('btn-copy-stream-url').addEventListener('click', () => {
    if (activeStreamFile) {
        const url = `${window.location.origin}/api/stream/${activeStreamFile._id || activeStreamFile.fs_id}`;
        navigator.clipboard.writeText(url);
        showToast('Stream URL berhasil disalin ke clipboard!', 'success');
    }
});

// Tabs Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

// View Toggle
btnViewGrid.addEventListener('click', () => {
    btnViewGrid.classList.add('active');
    btnViewTable.classList.remove('active');
    filesGridContainer.style.display = 'grid';
    filesTableContainer.style.display = 'none';
});

btnViewTable.addEventListener('click', () => {
    btnViewTable.classList.add('active');
    btnViewGrid.classList.remove('active');
    filesGridContainer.style.display = 'none';
    filesTableContainer.style.display = 'block';
});

// Filters and Search
inputSearch.addEventListener('input', () => loadFiles(1));
selectCategory.addEventListener('change', () => loadFiles(1));
selectSort.addEventListener('change', () => loadFiles(1));
document.getElementById('btn-refresh-stats').addEventListener('click', () => {
    loadStats();
    loadFiles(currentPage);
    showToast('Data berhasil disegarkan', 'info');
});

// Initialize on load
loadStats();
loadFiles(1);
