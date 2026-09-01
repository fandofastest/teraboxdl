// TeraCloud Public Video Stream & Swipe Navigation Controller
let publicVideos = [];
let currentVideoIndex = -1;
let currentPublicPage = 1;
let totalPublicPages = 1;
let publicHls = null;

// Touch / Swipe Tracking Variables
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

// DOM
const publicVideoGrid = document.getElementById('public-video-grid');
const publicPagination = document.getElementById('public-pagination');
const publicSearch = document.getElementById('public-search');
const publicSort = document.getElementById('public-sort');

const playerOverlay = document.getElementById('player-overlay');
const playerStage = document.getElementById('player-stage');
const publicVideoElement = document.getElementById('public-video-element');
const currentVideoTitle = document.getElementById('current-video-title');
const currentVideoMeta = document.getElementById('current-video-meta');

const btnClosePlayer = document.getElementById('btn-close-player');
const btnPrevVideo = document.getElementById('btn-prev-video');
const btnNextVideo = document.getElementById('btn-next-video');
const btnCopyPublicLink = document.getElementById('btn-copy-public-link');

// Toast
function showToast(msg) {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #10b981; margin-right: 8px;"></i> ${msg}`;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// 1. Fetch Public Videos
async function loadPublicVideos(page = 1) {
    currentPublicPage = page;
    const search = publicSearch.value.trim();
    const sort = publicSort.value;

    try {
        const url = `/api/files?page=${page}&limit=24&search=${encodeURIComponent(search)}&category=video&sort=${sort}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            publicVideos = data.files || [];
            totalPublicPages = data.totalPages || 1;
            renderPublicGrid(publicVideos);
            renderPublicPagination(data.page, totalPublicPages);
        }
    } catch (e) {
        console.error('Error loading public videos:', e);
    }
}

// 2. Render Public Grid
function renderPublicGrid(videos) {
    if (!videos || videos.length === 0) {
        publicVideoGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 80px 20px; color: var(--text-muted);">
                <i class="fa-solid fa-film" style="font-size: 52px; margin-bottom: 16px; color: var(--text-dim);"></i>
                <h3 style="color: #fff; font-size: 18px;">Belum Ada Video Tersedia</h3>
                <p style="font-size: 14px; margin-top: 6px;">Video akan muncul di sini setelah diindeks.</p>
            </div>
        `;
        return;
    }

    publicVideoGrid.innerHTML = videos.map((video, idx) => {
        const thumb = video.thumbnail 
            ? `<img src="${video.thumbnail}" alt="${escapeHtml(video.title)}" loading="lazy" onerror="this.src='/thumb_fallback.png'">`
            : `<div style="position: absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:36px; color:#64748b;"><i class="fa-solid fa-play"></i></div>`;

        return `
            <div class="video-card" onclick="openPublicPlayer(${idx})">
                <div class="video-thumb">
                    ${thumb}
                    <div class="play-hover-btn"><i class="fa-solid fa-play"></i></div>
                    <div class="video-duration">${video.size_formatted || 'HD'}</div>
                </div>
                <div class="video-info">
                    <h4 class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h4>
                    <div class="video-meta">
                        <span><i class="fa-solid fa-hard-drive"></i> ${video.size_formatted || ''}</span>
                        <span><i class="fa-solid fa-calendar"></i> ${new Date(video.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 3. Render Public Smart Pagination
function renderPublicPagination(current, total) {
    if (total <= 1) {
        publicPagination.innerHTML = '';
        return;
    }

    let html = '';
    if (current > 1) {
        html += `<button class="page-btn" onclick="loadPublicVideos(${current - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;
    } else {
        html += `<button class="page-btn disabled" disabled><i class="fa-solid fa-chevron-left"></i></button>`;
    }

    const pages = [];
    if (total <= 7) {
        for (let i = 1; i <= total; i++) pages.push(i);
    } else {
        if (current <= 4) {
            pages.push(1, 2, 3, 4, 5, '...', total);
        } else if (current >= total - 3) {
            pages.push(1, '...', total - 4, total - 3, total - 2, total - 1, total);
        } else {
            pages.push(1, '...', current - 1, current, current + 1, '...', total);
        }
    }

    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="page-ellipsis">...</span>`;
        } else {
            html += `<button class="page-btn ${p === current ? 'active' : ''}" onclick="loadPublicVideos(${p})">${p}</button>`;
        }
    });

    if (current < total) {
        html += `<button class="page-btn" onclick="loadPublicVideos(${current + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;
    } else {
        html += `<button class="page-btn disabled" disabled><i class="fa-solid fa-chevron-right"></i></button>`;
    }

    publicPagination.innerHTML = html;
}

// 4. Open Public Video Player
function openPublicPlayer(index) {
    if (!publicVideos || index < 0 || index >= publicVideos.length) return;

    currentVideoIndex = index;
    const video = publicVideos[index];

    currentVideoTitle.innerText = video.title;
    currentVideoMeta.innerText = `${index + 1} dari ${publicVideos.length} Video`;

    playerOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    playStream(video._id || video.fs_id);
}

function playStream(fileId) {
    const streamSrc = `/api/stream/${fileId}`;

    if (Hls.isSupported()) {
        if (publicHls) publicHls.destroy();
        publicHls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 90
        });
        publicHls.loadSource(streamSrc);
        publicHls.attachMedia(publicVideoElement);
        publicHls.on(Hls.Events.MANIFEST_PARSED, () => {
            publicVideoElement.play().catch(e => console.log('Autoplay prevented:', e));
        });
        publicHls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        publicHls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        publicHls.recoverMediaError();
                        break;
                    default:
                        publicHls.destroy();
                        break;
                }
            }
        });
    } else if (publicVideoElement.canPlayType('application/vnd.apple.mpegurl')) {
        publicVideoElement.src = streamSrc;
        publicVideoElement.play().catch(() => {});
    }
}

function closePublicPlayer() {
    playerOverlay.classList.remove('active');
    document.body.style.overflow = 'auto';
    publicVideoElement.pause();
    if (publicHls) {
        publicHls.destroy();
        publicHls = null;
    }
    publicVideoElement.src = '';
}

// 5. Swipe & Next / Prev Navigation
function nextVideo() {
    if (currentVideoIndex < publicVideos.length - 1) {
        animateSwipeTransition('left');
        openPublicPlayer(currentVideoIndex + 1);
    } else {
        showToast('Sudah di video terakhir');
    }
}

function prevVideo() {
    if (currentVideoIndex > 0) {
        animateSwipeTransition('right');
        openPublicPlayer(currentVideoIndex - 1);
    } else {
        showToast('Sudah di video pertama');
    }
}

function animateSwipeTransition(direction) {
    const offset = direction === 'left' ? '-40px' : '40px';
    publicVideoElement.style.transform = `translateX(${offset})`;
    publicVideoElement.style.opacity = '0.5';
    setTimeout(() => {
        publicVideoElement.style.transform = 'translateX(0)';
        publicVideoElement.style.opacity = '1';
    }, 200);
}

// Touch Gesture Listeners (Swipe Support)
playerStage.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

playerStage.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipeGesture();
}, { passive: true });

function handleSwipeGesture() {
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // Pastikan swipe horizontal lebih dominan daripada scroll vertikal
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 45) {
        if (diffX < 0) {
            // Swipe ke Kiri -> Video Selanjutnya
            nextVideo();
        } else {
            // Swipe ke Kanan -> Video Sebelumnya
            prevVideo();
        }
    }
}

// Keyboard Navigation (Arrow Left, Right, Esc)
window.addEventListener('keydown', (e) => {
    if (!playerOverlay.classList.contains('active')) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextVideo();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        prevVideo();
    } else if (e.key === 'Escape') {
        closePublicPlayer();
    }
});

// UI Listeners
btnClosePlayer.addEventListener('click', closePublicPlayer);
btnNextVideo.addEventListener('click', nextVideo);
btnPrevVideo.addEventListener('click', prevVideo);

btnCopyPublicLink.addEventListener('click', () => {
    if (currentVideoIndex >= 0 && publicVideos[currentVideoIndex]) {
        const vid = publicVideos[currentVideoIndex];
        const streamUrl = `${window.location.origin}/api/stream/${vid._id || vid.fs_id}`;
        navigator.clipboard.writeText(streamUrl).then(() => {
            showToast('Link video berhasil disalin!');
        }).catch(() => {
            prompt('Salin link video:', streamUrl);
        });
    }
});

publicSearch.addEventListener('input', () => loadPublicVideos(1));
publicSort.addEventListener('change', () => loadPublicVideos(1));

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Start
loadPublicVideos(1);
