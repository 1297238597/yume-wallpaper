import http from 'node:http';
import net from 'node:net';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, '.cache');
const THUMB_DIR = path.join(CACHE_DIR, 'thumbs');
const PREVIEW_DIR = path.join(CACHE_DIR, 'previews');
const TMP_DIR = path.join(CACHE_DIR, 'tmp');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = (process.env.WALLHAVEN_BASE || 'https://wallhaven.clbug.com/api/v1').replace(/\/+$/, '');
const API_KEY = process.env.WALLHAVEN_API_KEY || '';
const SEARCH_EXCLUSIONS = process.env.SEARCH_EXCLUSIONS ?? '-suggestive';

const USER_AGENT = 'YUME-Wallpaper/1.0 (+local gallery; contact: website owner)';
const SEARCH_TTL = 3 * 60 * 1000;
const SEARCH_STALE_TTL = 12 * 60 * 60 * 1000;
const DETAIL_TTL = 30 * 60 * 1000;
const IMAGE_META_TTL = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2500;
const ALLOWED_SORTS = new Set(['date_added', 'relevance', 'random', 'views', 'favorites', 'toplist']);
const PORTRAIT_RATIOS = '9x16,9x18,9x19.5,9x20,9x21,10x16,10x21,3x4,2x3';
const THUMB_WIDTHS = new Set([360, 480, 640, 720, 960, 1200, 1440]);
const ALLOWED_IMAGE_HOSTS = new Set(
  (process.env.ALLOWED_IMAGE_HOSTS || 'wallhaven.cc,wallhaven.clbug.com')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
);

let sharp = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch (error) {
  console.warn('[YUME] sharp 未安装，缩略图将回退到原图。运行 pnpm install 可获得最佳性能。');
}

await mkdir(THUMB_DIR, { recursive: true });
await mkdir(PREVIEW_DIR, { recursive: true });
await mkdir(TMP_DIR, { recursive: true });

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const searchCache = new Map();
const detailCache = new Map();
const imageMeta = new Map();
const inflightSearch = new Map();
const inflightThumbs = new Map();
const inflightPreviews = new Map();

function safeExternalUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeMirrorUrl(value) {
  const safe = safeExternalUrl(value);
  if (!safe) return '';
  try {
    const url = new URL(safe);
    if (UPSTREAM.includes('wallhaven.clbug.com')) {
      if (url.hostname === 'wallhaven.cc') url.hostname = 'wallhaven.clbug.com';
      if (url.hostname === 'w.wallhaven.cc') url.hostname = 'w.wallhaven.clbug.com';
      if (url.hostname === 'th.wallhaven.cc') url.hostname = 'th.wallhaven.clbug.com';
    }
    return url.toString();
  } catch {
    return '';
  }
}

function normalizePreviewUrl(value) {
  const normalized = normalizeMirrorUrl(value);
  if (!normalized || !isAllowedImageUrl(normalized)) return '';
  return normalized;
}

function isAllowedImageUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    for (const allowed of ALLOWED_IMAGE_HOSTS) {
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function cleanQuery(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cacheSet(map, key, value, max = MAX_CACHE_ENTRIES) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function apiHeaders(accept = 'application/json') {
  const headers = {
    Accept: accept,
    'User-Agent': USER_AGENT
  };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

async function fetchJson(url, timeout = 18000) {
  let response;
  try {
    response = await fetch(url, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    throw new HttpError(502, '壁纸服务暂时无法连接，请稍后再试。', 'UPSTREAM_UNREACHABLE');
  }

  if (!response.ok) {
    const status = response.status === 429 ? 429 : 502;
    const message = response.status === 429
      ? '壁纸服务请求过于频繁，请稍后再试。'
      : `壁纸服务返回了 ${response.status}。`;
    throw new HttpError(status, message, response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR');
  }

  try {
    return await response.json();
  } catch {
    throw new HttpError(502, '壁纸服务返回了无法识别的数据。', 'BAD_UPSTREAM_DATA');
  }
}

async function fetchImage(url) {
  if (!isAllowedImageUrl(url)) {
    throw new HttpError(400, '图片来源不在允许范围内。', 'IMAGE_HOST_BLOCKED');
  }

  let response;
  try {
    response = await fetch(url, {
      headers: apiHeaders('image/*,image/webp,image/apng,*/*;q=0.8'),
      redirect: 'follow',
      signal: AbortSignal.timeout(60000)
    });
  } catch {
    throw new HttpError(502, '原图加载超时，请稍后再试。', 'IMAGE_UNREACHABLE');
  }

  if (!response.ok) {
    throw new HttpError(502, '原图暂时无法加载。', 'IMAGE_ERROR');
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.startsWith('image/')) {
    throw new HttpError(502, '图片来源返回了非图片内容。', 'IMAGE_INVALID');
  }

  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > 48 * 1024 * 1024) {
    throw new HttpError(413, '这张原图过大，暂时无法处理。', 'IMAGE_TOO_LARGE');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 48 * 1024 * 1024) {
    throw new HttpError(413, '这张原图过大，暂时无法处理。', 'IMAGE_TOO_LARGE');
  }

  return {
    buffer,
    contentType: contentType || 'image/jpeg',
    contentLength: buffer.byteLength
  };
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').toLowerCase();
  if (!/^[a-z0-9]{6}$/.test(id)) return null;

  const width = Number(item.dimension_x) || 0;
  const height = Number(item.dimension_y) || 0;
  if (width < 300 || height < 300) return null;

  const colors = Array.isArray(item.colors)
    ? item.colors.filter((color) => /^#[0-9a-f]{6}$/i.test(String(color))).slice(0, 6)
    : [];

  const pageUrl = normalizeMirrorUrl(item.url) || `https://wallhaven.cc/w/${id}`;
  const source = safeExternalUrl(item.source);
  const preview = normalizePreviewUrl(item.thumbs?.original || item.thumbs?.small);
  const full = normalizeMirrorUrl(item.path);

  if (isAllowedImageUrl(full)) {
    const existing = imageMeta.get(id) || {};
    cacheSet(imageMeta, id, {
      ...existing,
      id,
      full,
      preview: preview || existing.preview,
      width,
      height,
      fileType: String(item.file_type || 'image/jpeg'),
      fileSize: Number(item.file_size) || 0,
      colors,
      pageUrl,
      source,
      viewedAt: Date.now()
    });
  }

  return {
    id,
    width,
    height,
    resolution: `${width}×${height}`,
    ratio: Number(item.ratio) || Number((width / height).toFixed(3)),
    fileSize: Number(item.file_size) || 0,
    fileType: String(item.file_type || 'image/jpeg'),
    colors,
    views: Number(item.views) || 0,
    favorites: Number(item.favorites) || 0,
    createdAt: String(item.created_at || ''),
    pageUrl,
    source,
    preview: preview ? `/api/preview/${id}` : '',
    thumb: `/api/thumb/${id}?w=720`
  };
}

function buildSearchUrl({ page, sorting, query, seed }) {
  const url = new URL(`${UPSTREAM}/search`);
  const resolvedSorting = ALLOWED_SORTS.has(sorting)
    ? sorting
    : (query ? 'relevance' : 'favorites');

  url.searchParams.set('categories', '010');
  url.searchParams.set('purity', '100');
  url.searchParams.set('sorting', resolvedSorting);
  url.searchParams.set('order', 'desc');
  url.searchParams.set('ratios', PORTRAIT_RATIOS);
  url.searchParams.set('atleast', '1080x1920');
  url.searchParams.set('page', String(page));

  const searchQuery = [query, SEARCH_EXCLUSIONS].filter(Boolean).join(' ').trim();
  if (searchQuery) url.searchParams.set('q', searchQuery);
  if (resolvedSorting === 'toplist') url.searchParams.set('topRange', '1M');
  if (resolvedSorting === 'random' || seed) url.searchParams.set('seed', seed || crypto.randomBytes(4).toString('hex'));
  if (API_KEY) url.searchParams.set('apikey', API_KEY);

  return url;
}

function normalizeSearchPayload(payload, { page, sorting, seed }) {
  const rawItems = Array.isArray(payload?.data) ? payload.data : [];
  const items = [];
  const seen = new Set();

  for (const rawItem of rawItems) {
    const item = normalizeItem(rawItem);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  const meta = payload?.meta || {};
  return {
    items,
    meta: {
      page: Number(meta.current_page) || page,
      lastPage: Number(meta.last_page) || 1,
      total: Number(meta.total) || items.length,
      perPage: Number(meta.per_page) || 24,
      query: cleanQuery(meta.query),
      sorting,
      seed: seed || ''
    }
  };
}

async function getSearch({ page, sorting, query, seed }) {
  const key = JSON.stringify({ page, sorting, query, seed });
  const now = Date.now();
  const cached = searchCache.get(key);

  if (cached && now - cached.at < SEARCH_TTL) return cached.value;
  if (inflightSearch.has(key)) return inflightSearch.get(key);

  const task = (async () => {
    try {
      const payload = await fetchJson(buildSearchUrl({ page, sorting, query, seed }));
      const value = normalizeSearchPayload(payload, { page, sorting, seed });
      cacheSet(searchCache, key, { at: Date.now(), value });
      return value;
    } catch (error) {
      if (cached && Date.now() - cached.at < SEARCH_STALE_TTL) {
        return { ...cached.value, stale: true };
      }
      throw error;
    } finally {
      inflightSearch.delete(key);
    }
  })();

  inflightSearch.set(key, task);
  return task;
}

async function getImageMeta(id, { detail = false } = {}) {
  if (!/^[a-z0-9]{6}$/.test(id)) {
    throw new HttpError(400, '无效的壁纸编号。', 'INVALID_ID');
  }

  const cached = imageMeta.get(id);
  if (cached && Date.now() - cached.viewedAt < IMAGE_META_TTL) {
    if (!detail || cached.hasDetail) return cached;
  }

  const detailCached = detailCache.get(id);
  if (detailCached && Date.now() - detailCached.at < DETAIL_TTL) return detailCached.value;

  const payload = await fetchJson(`${UPSTREAM}/w/${id}`, 20000);
  const raw = payload?.data;
  if (!raw) throw new HttpError(404, '没有找到这张壁纸。', 'NOT_FOUND');

  const normalized = normalizeItem(raw);
  const full = normalizeMirrorUrl(raw.path);
  if (!normalized || !isAllowedImageUrl(full)) {
    throw new HttpError(502, '壁纸信息不完整，暂时无法加载。', 'BAD_WALLPAPER_DATA');
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
        .filter((tag) => typeof tag === 'string' && tag.trim())
        .map((tag) => tag.trim().slice(0, 40))
        .slice(0, 12)
    : [];

  const value = {
    ...imageMeta.get(id),
    ...normalized,
    full,
    fileType: String(raw.file_type || 'image/jpeg'),
    fileSize: Number(raw.file_size) || 0,
    tags,
    uploader: String(raw.uploader?.username || '').slice(0, 40),
    source: safeExternalUrl(raw.source),
    pageUrl: normalizeMirrorUrl(raw.url) || `https://wallhaven.cc/w/${id}`,
    hasDetail: true
  };

  cacheSet(imageMeta, id, { ...value, viewedAt: Date.now() }, MAX_CACHE_ENTRIES);
  cacheSet(detailCache, id, { at: Date.now(), value }, 600);
  return value;
}

async function resolveThumb(id, width) {
  const safeWidth = THUMB_WIDTHS.has(width) ? width : 720;
  const filename = `${id}-${safeWidth}.webp`;
  const filePath = path.join(THUMB_DIR, filename);
  const key = `${id}-${safeWidth}`;

  try {
    const info = await stat(filePath);
    if (info.size > 0) return filePath;
  } catch {
    // Cache miss.
  }

  if (inflightThumbs.has(key)) return inflightThumbs.get(key);

  const task = (async () => {
    const meta = await getImageMeta(id);
    const image = await fetchImage(meta.full);
    const tempPath = path.join(TMP_DIR, `${filename}.${crypto.randomBytes(4).toString('hex')}.tmp`);

    try {
      if (sharp) {
        await sharp(image.buffer, { failOn: 'none', limitInputPixels: 268402689 })
          .rotate()
          .resize({ width: safeWidth, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toFile(tempPath);
        await rename(tempPath, filePath);
      } else {
        await writeFile(filePath, image.buffer);
      }
    } finally {
      await unlink(tempPath).catch(() => {});
    }

    return filePath;
  })();

  inflightThumbs.set(key, task);
  try {
    return await task;
  } finally {
    inflightThumbs.delete(key);
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendText(res, status, message) {
  const body = Buffer.from(message);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendBuffer(res, buffer, contentType, cacheControl = 'public, max-age=86400') {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buffer);
}

async function resolvePreview(id) {
  const filename = `${id}.jpg`;
  const filePath = path.join(PREVIEW_DIR, filename);

  try {
    const info = await stat(filePath);
    if (info.size > 0) return filePath;
  } catch {
    // Cache miss.
  }

  if (inflightPreviews.has(id)) return inflightPreviews.get(id);

  const task = (async () => {
    const cachedMeta = imageMeta.get(id);
    const meta = cachedMeta?.preview ? cachedMeta : await getImageMeta(id, { detail: true });
    if (!meta.preview) {
      throw new HttpError(404, '这张壁纸暂时没有可用预览。', 'PREVIEW_MISSING');
    }

    const image = await fetchImage(meta.preview);
    const tempPath = path.join(TMP_DIR, `${filename}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    await writeFile(tempPath, image.buffer);
    await rename(tempPath, filePath);
    return filePath;
  })();

  inflightPreviews.set(id, task);
  try {
    return await task;
  } finally {
    inflightPreviews.delete(id);
  }
}

async function servePreview(req, res, id) {
  const filePath = await resolvePreview(id);
  const info = await stat(filePath);
  const etag = `"preview-${id}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=2592000, immutable' });
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': info.size,
    ETag: etag,
    'Cache-Control': 'public, max-age=2592000, immutable',
    'X-Content-Type-Options': 'nosniff'
  });
  createReadStream(filePath).pipe(res);
}

async function serveThumb(req, res, id, width) {
  if (!sharp) {
    const meta = await getImageMeta(id);
    const image = await fetchImage(meta.full);
    sendBuffer(res, image.buffer, image.contentType, 'public, max-age=86400');
    return;
  }

  const actualWidth = THUMB_WIDTHS.has(width) ? width : 720;
  let filePath;
  try {
    filePath = await resolveThumb(id, actualWidth);
  } catch (error) {
    console.warn(`[YUME] 缩略图生成失败 ${id}@${actualWidth}，回退到预览图：${error.message}`);
    await servePreview(req, res, id);
    return;
  }

  const etag = `"thumb-${id}-${actualWidth}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=2592000, immutable' });
    res.end();
    return;
  }

  const info = await stat(filePath);
  res.writeHead(200, {
    'Content-Type': 'image/webp',
    'Content-Length': info.size,
    ETag: etag,
    'Cache-Control': 'public, max-age=2592000, immutable',
    'X-Content-Type-Options': 'nosniff'
  });
  createReadStream(filePath).pipe(res);
}

async function serveDownload(res, id) {
  const meta = await getImageMeta(id);
  let upstream;
  try {
    upstream = await fetch(meta.full, {
      headers: apiHeaders('image/*'),
      redirect: 'follow',
      signal: AbortSignal.timeout(120000)
    });
  } catch {
    throw new HttpError(502, '原图下载超时，请稍后再试。', 'DOWNLOAD_TIMEOUT');
  }

  if (!upstream.ok || !upstream.body) {
    throw new HttpError(502, '原图暂时无法下载。', 'DOWNLOAD_ERROR');
  }

  const extension = /png/i.test(meta.fileType) ? 'png' : /webp/i.test(meta.fileType) ? 'webp' : 'jpg';
  const contentType = upstream.headers.get('content-type') || meta.fileType || 'image/jpeg';
  const contentLength = upstream.headers.get('content-length');
  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="YUME-${id}.${extension}"`,
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff'
  };
  if (contentLength) headers['Content-Length'] = contentLength;

  res.writeHead(200, headers);
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  const publicPrefix = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : `${PUBLIC_DIR}${path.sep}`;

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(publicPrefix)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    sendText(res, 404, 'Not Found');
    return;
  }

  if (!info.isFile()) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  const isHtml = extension === '.html';
  const isAsset = ['.css', '.js', '.mjs'].includes(extension);

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    ...(isHtml ? { 'Content-Security-Policy': HTML_CSP } : {}),
    'Content-Type': contentType,
    'Content-Length': info.size,
    'Cache-Control': isHtml || isAsset ? 'no-cache' : 'public, max-age=604800'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = requestUrl;

  if (pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      source: 'Wallhaven',
      upstream: new URL(UPSTREAM).host,
      safeMode: 'SFW only',
      thumbnailEngine: sharp ? 'sharp/webp' : 'original',
      cacheEntries: searchCache.size,
      uptimeSeconds: Math.round(process.uptime())
    });
    return;
  }

  if (pathname === '/api/wallpapers') {
    const page = clampInt(requestUrl.searchParams.get('page'), 1, 1000, 1);
    const query = cleanQuery(requestUrl.searchParams.get('q'));
    const requestedSort = String(requestUrl.searchParams.get('sorting') || '').trim();
    const sorting = ALLOWED_SORTS.has(requestedSort)
      ? requestedSort
      : (query ? 'relevance' : 'favorites');
    const seed = String(requestUrl.searchParams.get('seed') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);

    const result = await getSearch({ page, sorting, query, seed });
    sendJson(res, 200, result);
    return;
  }

  const detailMatch = pathname.match(/^\/api\/wallpaper\/([a-z0-9]{6})$/);
  if (detailMatch) {
    const meta = await getImageMeta(detailMatch[1], { detail: true });
    sendJson(res, 200, {
      item: {
        id: meta.id,
        width: meta.width,
        height: meta.height,
        resolution: `${meta.width}×${meta.height}`,
        ratio: Number((meta.width / meta.height).toFixed(3)),
        fileSize: meta.fileSize,
        fileType: meta.fileType,
        colors: meta.colors,
        views: meta.views,
        favorites: meta.favorites,
        createdAt: meta.createdAt,
        pageUrl: meta.pageUrl,
        source: meta.source,
        tags: meta.tags || [],
        uploader: meta.uploader || ''
      }
    });
    return;
  }

  const previewMatch = pathname.match(/^\/api\/preview\/([a-z0-9]{6})$/);
  if (previewMatch) {
    await servePreview(req, res, previewMatch[1]);
    return;
  }

  const thumbMatch = pathname.match(/^\/api\/thumb\/([a-z0-9]{6})$/);
  if (thumbMatch) {
    const width = clampInt(requestUrl.searchParams.get('w'), 240, 1600, 720);
    await serveThumb(req, res, thumbMatch[1], width);
    return;
  }

  const downloadMatch = pathname.match(/^\/api\/download\/([a-z0-9]{6})$/);
  if (downloadMatch) {
    await serveDownload(res, downloadMatch[1]);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
    return;
  }

  await serveStatic(req, res, pathname);
}

async function findAvailablePort(startPort) {
  if (process.env.PORT) return startPort;

  for (let port = startPort; port < startPort + 20; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(port, HOST);
    });
    if (free) return port;
  }

  return startPort;
}

const ACTIVE_PORT = await findAvailablePort(PORT);

const server = http.createServer((req, res) => {
  const started = Date.now();
  const requestPath = (req.url || '').split('?')[0];

  res.on('finish', () => {
    const duration = Date.now() - started;
    if (requestPath.startsWith('/api/') || res.statusCode >= 400) {
      console.log(`${new Date().toISOString()} ${req.method} ${requestPath} ${res.statusCode} ${duration}ms`);
    }
  });

  handleRequest(req, res).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof HttpError ? error.message : '服务器开小差了，请稍后再试。';

    if (!(error instanceof HttpError)) {
      console.error('[YUME] Unhandled error:', error);
    }

    if (!res.headersSent) {
      sendJson(res, status, { error: { code, message } });
    } else {
      res.destroy();
    }
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[YUME] 端口 ${ACTIVE_PORT} 已被占用。请设置 PORT 环境变量后重试。`);
  } else {
    console.error('[YUME] Server error:', error);
  }
  process.exitCode = 1;
});

server.listen(ACTIVE_PORT, HOST, () => {
  console.log('');
  console.log('  ✦  YUME 梦壁纸  ✦');
  console.log(`  本地地址   http://${HOST}:${ACTIVE_PORT}`);
  console.log(`  壁纸来源   ${new URL(UPSTREAM).host} · Wallhaven SFW`);
  console.log(`  缩略图引擎 ${sharp ? 'sharp → WebP' : '未安装 sharp（原图回退）'}`);
  if (ACTIVE_PORT !== PORT) console.log(`  端口提示   ${PORT} 已被占用，已自动切换。`);
  console.log('');
});

function shutdown() {
  console.log('\n[YUME] 正在关闭服务…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
