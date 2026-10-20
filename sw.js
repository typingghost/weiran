// 未然网页版的离线缓存。页面先走网络、断网用缓存；音频第一次播放时在后台整段存下来，之后断网也能听。
// 苹果的 Safari 播放音频时会按 Range 分段请求，所以从缓存回放时要自己切出 206 片段。
const VERSION = 'fb5de0fcaa82';
const SHELL = 'weiran-shell-' + VERSION;
const AUDIO = 'weiran-audio-v1';
const SHELL_FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const AUDIO_FILES = ["audio/intro.m4a", "audio/vol1.m4a", "audio/vol2.m4a", "audio/vol3.m4a", "audio/vol4.m4a", "audio/vol5.m4a"];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('weiran-shell-') && k !== SHELL).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});

const pending = new Set();

function cacheWholeAudio(url) {
  if (pending.has(url)) return;
  pending.add(url);
  fetch(url, { cache: 'no-store' })
    .then((r) => (r.ok && r.status === 200 ? caches.open(AUDIO).then((c) => c.put(url, r)) : null))
    .catch(() => {})
    .finally(() => pending.delete(url));
}

async function rangeFromCache(request, cached) {
  const range = request.headers.get('range');
  if (!range) return cached;
  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const size = buf.byteLength;
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
  if (m && !m[1] && m[2]) { start = size - parseInt(m[2], 10); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.endsWith('.m4a')) {
    const key = new URL(path, self.location.href).href;
    event.respondWith(caches.open(AUDIO).then((c) => c.match(key)).then((cached) => {
      if (cached) return rangeFromCache(event.request, cached);
      cacheWholeAudio(key);
      return fetch(event.request);
    }));
    return;
  }
  // 页面和图标：先走网络拿最新的，断网再用缓存
  event.respondWith(fetch(event.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(event.request, copy)); }
    return r;
  }).catch(() => caches.match(event.request).then((r) => r || caches.match('index.html'))));
});

// 页面可以要求一次性把六期都存下来（"全部下载以便离线"）
self.addEventListener('message', (event) => {
  if (event.data === 'cache-all-audio') {
    AUDIO_FILES.forEach((p) => cacheWholeAudio(new URL(p, self.location.href).href));
  }
});
