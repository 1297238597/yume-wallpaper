/* =========================================================
   YUME 梦壁纸 — front-end
   ========================================================= */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const SEARCH_ALIASES = new Map([
  ['初音未来', 'Hatsune Miku'],
  ['初音', 'Hatsune Miku'],
  ['原神', 'Genshin Impact'],
  ['蔚蓝档案', 'Blue Archive'],
  ['碧蓝档案', 'Blue Archive'],
  ['赛博朋克', 'cyberpunk'],
  ['赛博', 'cyberpunk'],
  ['猫耳', 'cat girl'],
  ['猫娘', 'cat girl'],
  ['星空', 'starry sky'],
  ['和风', 'kimono'],
  ['少女', 'girl'],
  ['风景', 'landscape'],
  ['明日方舟', 'Arknights'],
  ['崩坏', 'Honkai'],
  ['芙莉莲', 'Frieren'],
  ['间谍过家家', 'Spy x Family']
]);

const QUERY_LABELS = new Map();
for (const [label, query] of SEARCH_ALIASES) {
  const key = query.toLowerCase();
  if (!QUERY_LABELS.has(key)) QUERY_LABELS.set(key, label);
}

const SORT_VALUES = new Set(['favorites', 'date_added', 'views', 'random']);

const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.4 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M6.5 10.5 12 16l5.5-5.5M4 20h16"/></svg>';
const EYE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';

const dom = {
  root: document.documentElement,
  header: $('#siteHeader'),
  searchToggle: $('#searchToggle'),
  searchPanel: $('#searchPanel'),
  searchForm: $('#searchForm'),
  searchInput: $('#searchInput'),
  searchClear: $('#searchClear'),
  themeToggle: $('#themeToggle'),
  navItems: $$('.main-nav__item'),
  favCount: $('#favCount'),
  heroArt: $('#heroArt'),
  heroShuffle: $('#heroShuffle'),
  heroMainId: $('#heroMainId'),
  statTotal: $('#statTotal'),
  gallery: $('#gallery'),
  galleryTitle: $('#galleryTitle'),
  gallerySub: $('#gallerySub'),
  filterDock: $('#filterDock'),
  moodChips: $$('.chip'),
  sortSelect: $('#sortSelect'),
  shuffleButton: $('#shuffleButton'),
  resultLine: $('#resultLine'),
  galleryHint: $('.gallery-meta__hint'),
  skeletonGrid: $('#skeletonGrid'),
  waterfall: $('#waterfall'),
  statePanel: $('#statePanel'),
  stateTitle: $('#stateTitle'),
  stateCopy: $('#stateCopy'),
  stateAction: $('#stateAction'),
  loadState: $('#loadState'),
  loadSentinel: $('#loadSentinel'),
  sourcePill: $('#sourcePill'),
  sourceText: $('.source-pill__text'),
  backToTop: $('#backToTop'),
  lightbox: $('#lightbox'),
  lightboxPanel: $('.lightbox__panel'),
  lightboxClose: $('#lightboxClose'),
  lightboxVisual: $('#lightboxVisual'),
  lightboxImage: $('#lightboxImage'),
  lightboxShimmer: $('#lightboxShimmer'),
  lightboxAmbient: $('#lightboxAmbient'),
  lightboxDevice: $('#lightboxDevice'),
  lightboxScreen: $('#lightboxDevice .device__screen'),
  lightboxTitle: $('#lightboxTitle'),
  lightboxSub: $('#lightboxSub'),
  lightboxTags: $('#lightboxTags'),
  lightboxCounter: $('#lightboxCounter'),
  lightboxPrev: $('#lightboxPrev'),
  lightboxNext: $('#lightboxNext'),
  lightboxFavorite: $('#lightboxFavorite'),
  lightboxDownload: $('#lightboxDownload'),
  lightboxSource: $('#lightboxSource'),
  lightboxCredit: $('#lightboxCredit'),
  specResolution: $('#specResolution'),
  specRatio: $('#specRatio'),
  specSize: $('#specSize'),
  specQuality: $('#specQuality'),
  specViews: $('#specViews'),
  specFavs: $('#specFavs'),
  toastRegion: $('#toastRegion'),
  footerYear: $('#footerYear')
};

const state = {
  view: 'discover',
  mood: 'all',
  query: '',
  searchLabel: '',
  sorting: 'favorites',
  seed: '',
  page: 1,
  lastPage: 1,
  total: 0,
  items: [],
  favorites: loadFavorites(),
  loading: false,
  end: false,
  error: null,
  requestId: 0,
  heroInitialized: false,
  staleToastShown: false
};

const modal = {
  isOpen: false,
  list: [],
  index: 0,
  item: null,
  token: 0,
  previousFocus: null
};

let heroItems = [];
let heroLoading = false;
const downloadsInFlight = new Set();
const searchShortcutTarget = /^(INPUT|TEXTAREA|SELECT)$/;

let waterfall;
const numberFormatter = new Intl.NumberFormat('zh-CN');

/* =========================================================
   Boot
   ========================================================= */

function init() {
  readStateFromUrl();
  syncSortSelect();
  updateChips();
  updateNavUI();
  updateFavoriteCount();
  initTheme();
  initPhoneClock();
  initReveal();
  initHeader();
  initSearch();
  initFilters();
  initMasonryEvents();
  initLightbox();
  initInfiniteScroll();
  initBackToTop();
  checkHealth();

  dom.footerYear.textContent = String(new Date().getFullYear());
  updateGalleryHeading();
  showSkeleton();
  dom.resultLine.textContent = '正在收集心动瞬间…';
  dom.loadState.hidden = true;

  if (state.sorting === 'random') state.seed = randomSeed();
  loadPage(1, { replace: true });
}

/* =========================================================
   Utilities
   ========================================================= */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

function safeHex(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '';
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? numberFormatter.format(number) : '0';
}

function formatBytes(bytes) {
  const number = Number(bytes);
  if (!Number.isFinite(number) || number <= 0) return '—';
  if (number < 1024 * 1024) return `${Math.round(number / 1024)} KB`;
  return `${(number / 1024 / 1024).toFixed(number > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function qualityLabel(width) {
  if (width >= 7000) return '8K';
  if (width >= 3600) return '4K';
  if (width >= 2200) return '2K+';
  if (width >= 1440) return '2K';
  return '1080P';
}

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x || 1;
}

function ratioLabel(width, height) {
  const divisor = gcd(width, height);
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  if (w <= 24 && h <= 24) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}`;
}

function randomSeed() {
  try {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0].toString(36).slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollToGallery() {
  const top = window.scrollY + dom.gallery.getBoundingClientRect().top - 84;
  window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.sorting && state.sorting !== 'favorites') params.set('sort', state.sorting);
  const queryString = params.toString();
  const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function paletteName(item) {
  const colors = Array.isArray(item?.colors) ? item.colors : [];
  const hex = safeHex(colors[1]) || safeHex(colors[0]);
  if (!hex) return '心动瞬间';

  const rgb = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ];
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;

  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const seed = Array.from(String(item?.id || '')).reduce((total, char) => total + char.charCodeAt(0), 0);
  let options;

  if (saturation < 0.12 || lightness < 0.12 || lightness > 0.92) {
    options = ['月白静谧', '雾色诗篇', '旧梦胶片', '静谧片刻'];
  } else if (hue < 15 || hue >= 345) {
    options = ['绯色心跳', '蔷薇耳语', '草莓月光', '赤色黄昏'];
  } else if (hue < 45) {
    options = ['蜜糖晚霞', '黄昏信笺', '暖橘余晖'];
  } else if (hue < 70) {
    options = ['金色梦境', '日光微醺', '琥珀时刻'];
  } else if (hue < 155) {
    options = ['薄荷森林', '森系呼吸', '春日微光'];
  } else if (hue < 200) {
    options = ['海盐汽水', '青空气泡', '雨后天青'];
  } else if (hue < 255) {
    options = ['蓝调星夜', '深海月光', '静谧蓝调'];
  } else if (hue < 310) {
    options = ['紫藤幻境', '星夜低语', '暮色魔法'];
  } else {
    options = ['樱色梦境', '玫瑰星云', '粉黛心事'];
  }

  return options[seed % options.length];
}

function getVisibleItems() {
  return state.view === 'favorites' ? state.favorites : state.items;
}

function findItem(id) {
  return state.items.find((item) => item.id === id)
    || state.favorites.find((item) => item.id === id)
    || heroItems.find((item) => item.id === id)
    || null;
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem('yume:favorites:v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.filter((item) => {
      if (!item || !/^[a-z0-9]{6}$/.test(String(item.id)) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).map((item) => ({
      ...item,
      colors: Array.isArray(item.colors) ? item.colors.filter(safeHex) : [],
      width: Number(item.width) || 1080,
      height: Number(item.height) || 1920
    }));
  } catch {
    return [];
  }
}

function persistFavorites() {
  try {
    localStorage.setItem('yume:favorites:v1', JSON.stringify(state.favorites));
    return true;
  } catch {
    showToast('本地收藏空间已满，暂时无法保存。', 'error');
    return false;
  }
}

function isFaved(id) {
  return state.favorites.some((item) => item.id === id);
}

/* =========================================================
   Theme + reveal + header
   ========================================================= */

function initTheme() {
  const current = dom.root.dataset.theme === 'day' ? 'day' : 'night';
  applyTheme(current, false);

  dom.themeToggle.addEventListener('click', () => {
    const next = dom.root.dataset.theme === 'day' ? 'night' : 'day';
    applyTheme(next, true);
  });
}

function applyTheme(theme, persist) {
  dom.root.dataset.theme = theme;
  dom.root.style.colorScheme = theme === 'day' ? 'light' : 'dark';
  dom.themeToggle.setAttribute('aria-label', theme === 'day' ? '切换为夜间主题' : '切换为明亮主题');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'day' ? '#fbf6fa' : '#09070e');
  if (persist) {
    try {
      localStorage.setItem('yume:theme', theme);
    } catch {
      // Theme persistence is best-effort.
    }
  }
}

function initPhoneClock() {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  const update = () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const time = `${hours}:${minutes}`;
    const date = `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdays[now.getDay()]}`;

    $$('.phone__time').forEach((element) => { element.textContent = time; });
    $$('.phone__status > span:first-child').forEach((element) => { element.textContent = time; });
    $$('.phone__date').forEach((element) => { element.textContent = date; });
  };

  update();
  window.setInterval(update, 60000);
}

function initReveal() {
  const items = $$('.reveal');
  if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const index = Number(entry.target.dataset.revealIndex || 0);
      entry.target.style.transitionDelay = `${Math.min(index, 5) * 65}ms`;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
      window.setTimeout(() => {
        entry.target.style.transitionDelay = '';
      }, 1000);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });

  items.forEach((item, index) => {
    item.dataset.revealIndex = String(index);
    observer.observe(item);
  });
}

function initHeader() {
  let ticking = false;

  const update = () => {
    dom.header.classList.toggle('is-scrolled', window.scrollY > 16);
    dom.backToTop.classList.toggle('is-visible', window.scrollY > 760);
    if (dom.filterDock.offsetParent !== null) {
      const galleryTop = window.scrollY + dom.gallery.getBoundingClientRect().top;
      dom.filterDock.classList.toggle('is-stuck', window.scrollY > galleryTop + 330);
    }
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }, { passive: true });

  update();
}

/* =========================================================
   Search
   ========================================================= */

function initSearch() {
  dom.searchToggle.addEventListener('click', () => {
    if (dom.searchPanel.classList.contains('is-open')) closeSearch();
    else openSearch();
  });

  dom.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitSearch(dom.searchInput.value);
  });

  dom.searchInput.addEventListener('input', () => {
    dom.searchClear.hidden = !dom.searchInput.value.trim();
  });

  dom.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    }
  });

  dom.searchClear.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.searchClear.hidden = true;
    dom.searchInput.focus();
  });

  $$('.search-suggestions [data-search]').forEach((button) => {
    button.addEventListener('click', () => {
      dom.searchInput.value = button.textContent.trim();
      dom.searchClear.hidden = false;
      submitSearch(dom.searchInput.value, button.textContent.trim());
    });
  });

  document.addEventListener('click', (event) => {
    if (!dom.searchPanel.classList.contains('is-open')) return;
    if (dom.header.contains(event.target)) return;
    closeSearch();
  });

  document.addEventListener('keydown', (event) => {
    if (modal.isOpen) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
  });
}

function openSearch() {
  dom.searchPanel.classList.add('is-open');
  dom.header.classList.add('is-searching');
  dom.searchToggle.setAttribute('aria-expanded', 'true');
  window.setTimeout(() => dom.searchInput.focus({ preventScroll: true }), 180);
}

function closeSearch() {
  dom.searchPanel.classList.remove('is-open');
  dom.header.classList.remove('is-searching');
  dom.searchToggle.setAttribute('aria-expanded', 'false');
  dom.searchInput.blur();
}

function submitSearch(rawValue, labelValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    clearSearch(true);
    closeSearch();
    return;
  }

  const mapped = SEARCH_ALIASES.get(raw.toLowerCase()) || SEARCH_ALIASES.get(raw) || raw;
  state.query = mapped.slice(0, 80);
  state.searchLabel = String(labelValue || raw).slice(0, 40);
  state.mood = 'search';
  dom.searchInput.value = raw;
  dom.searchClear.hidden = false;
  updateChips();
  closeSearch();
  ensureDiscoverView();
  resetGallery({ scroll: true });
}

function clearSearch(scroll = false) {
  state.query = '';
  state.searchLabel = '';
  state.mood = 'all';
  dom.searchInput.value = '';
  dom.searchClear.hidden = true;
  updateChips();
  syncUrl();
  if (state.view === 'discover') resetGallery({ scroll });
}

function ensureDiscoverView() {
  if (state.view === 'discover') return;
  state.view = 'discover';
  updateNavUI();
  dom.filterDock.hidden = false;
}

/* =========================================================
   Filters
   ========================================================= */

function initFilters() {
  dom.moodChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      state.mood = chip.dataset.mood || 'all';
      state.query = chip.dataset.query || '';
      state.searchLabel = state.query ? chip.textContent.trim() : '';
      state.sorting = SORT_VALUES.has(dom.sortSelect.value) ? dom.sortSelect.value : state.sorting;
      updateChips();
      ensureDiscoverView();
      resetGallery({ scroll: true });
    });
  });

  dom.sortSelect.addEventListener('change', () => {
    state.sorting = SORT_VALUES.has(dom.sortSelect.value) ? dom.sortSelect.value : 'favorites';
    state.seed = state.sorting === 'random' ? randomSeed() : '';
    ensureDiscoverView();
    resetGallery({ scroll: true });
  });

  dom.shuffleButton.addEventListener('click', shuffleGallery);
  dom.heroShuffle.addEventListener('click', refreshHero);
}

function updateChips() {
  let hasActive = false;
  dom.moodChips.forEach((chip) => {
    const active = state.mood !== 'search' && chip.dataset.mood === state.mood;
    chip.classList.toggle('is-active', active);
    if (active) hasActive = true;
  });

  if (!hasActive && state.mood !== 'search') {
    const allChip = dom.moodChips.find((chip) => chip.dataset.mood === 'all');
    allChip?.classList.add('is-active');
  }

  const sortValue = SORT_VALUES.has(state.sorting) ? state.sorting : 'favorites';
  dom.sortSelect.value = sortValue;
}

function syncSortSelect() {
  dom.sortSelect.value = SORT_VALUES.has(state.sorting) ? state.sorting : 'favorites';
}

function shuffleGallery() {
  ensureDiscoverView();
  dom.shuffleButton.classList.add('is-spinning');
  window.setTimeout(() => dom.shuffleButton.classList.remove('is-spinning'), 760);
  state.sorting = 'random';
  state.seed = randomSeed();
  dom.sortSelect.value = 'random';
  showToast('已为你打乱梦境顺序');
  resetGallery({ scroll: true });
}

/* =========================================================
   Gallery data
   ========================================================= */

async function loadPage(page, { replace = false } = {}) {
  if (state.view !== 'discover' || state.loading) return;
  if (!replace && state.end) return;

  const requestId = ++state.requestId;
  state.loading = true;
  state.error = null;
  dom.waterfall.setAttribute('aria-busy', 'true');

  if (replace) {
    state.items = [];
    state.page = 1;
    state.end = false;
    waterfall.clear();
    dom.statePanel.hidden = true;
    showSkeleton();
    dom.loadState.hidden = true;
    dom.resultLine.textContent = '正在收集心动瞬间…';
  } else {
    renderLoadState('loading', '正在收集更多心动瞬间…');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 32000);

  try {
    const params = new URLSearchParams({
      page: String(page),
      sorting: state.sorting
    });
    if (state.query) params.set('q', state.query);
    if (state.seed) params.set('seed', state.seed);

    const response = await fetch(`/api/wallpapers?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      let message = '壁纸服务暂时没有回应，请稍后再试。';
      try {
        const errorBody = await response.json();
        if (errorBody?.error?.message) message = errorBody.error.message;
      } catch {
        // Keep the friendly fallback message.
      }
      throw new Error(message);
    }

    const data = await response.json();
    if (requestId !== state.requestId) return;

    const incoming = Array.isArray(data.items) ? data.items : [];
    const meta = data.meta || {};

    state.page = Number(meta.page) || page;
    state.lastPage = Number(meta.lastPage) || 1;
    state.total = Number(meta.total) || state.total;
    if (meta.seed) state.seed = meta.seed;

    if (replace) {
      state.items = incoming;
      waterfall.setItems(incoming);
    } else {
      const existing = new Set(state.items.map((item) => item.id));
      const fresh = incoming.filter((item) => item && !existing.has(item.id));
      state.items.push(...fresh);
      if (fresh.length) waterfall.appendItems(fresh);
    }

    const complete = !incoming.length
      || state.page >= state.lastPage
      || (state.total > 0 && state.items.length >= state.total);

    state.end = complete;
    dom.skeletonGrid.hidden = true;
    dom.statePanel.hidden = true;
    dom.statTotal.textContent = formatNumber(state.total || state.items.length);
    setSourceState('online');
    updateGalleryHeading();
    renderResultLine();

    if (!state.heroInitialized && state.items.length) {
      applyHero(state.items.slice(0, 3));
      state.heroInitialized = true;
    }

    if (!state.items.length) {
      showState('empty');
      dom.loadState.hidden = true;
    } else if (state.end) {
      renderLoadState('end');
    } else {
      renderLoadState('idle');
    }

    if (data.stale && !state.staleToastShown) {
      state.staleToastShown = true;
      showToast('网络略有波动，先为你展示缓存中的梦境。');
    }

    window.setTimeout(maybeLoadMore, 320);
  } catch (error) {
    if (requestId !== state.requestId) return;

    const message = error?.name === 'AbortError'
      ? '请求超时了，请检查网络后重试。'
      : (error?.message || '壁纸加载失败，请稍后再试。');

    state.error = error;
    dom.skeletonGrid.hidden = true;
    setSourceState('offline');
    dom.loadState.hidden = page === 1;

    if (replace || page === 1) {
      waterfall.clear();
      showState('error', message);
      dom.resultLine.textContent = '暂时没有连接到梦境频道';
    } else {
      renderLoadState('error', message);
      showToast(message, 'error');
    }
  } finally {
    window.clearTimeout(timeout);
    if (requestId === state.requestId) {
      state.loading = false;
      dom.waterfall.setAttribute('aria-busy', 'false');
    }
  }
}

function renderResultLine() {
  if (state.view === 'favorites') {
    const count = state.favorites.length;
    dom.resultLine.innerHTML = `已收藏 <b>${formatNumber(count)}</b> 张心动壁纸 · 保存在当前浏览器`;
    return;
  }

  const label = state.query
    ? `“${escapeHtml(state.searchLabel || state.query)}” · `
    : '';
  dom.resultLine.innerHTML = `${label}共 <b>${formatNumber(state.total)}</b> 张竖屏壁纸 · 已展示 <b>${formatNumber(state.items.length)}</b> 张`;
}

function renderLoadState(mode, message = '') {
  dom.loadState.className = 'load-state';

  if (mode === 'loading') {
    dom.loadState.hidden = false;
    dom.loadState.innerHTML = `<span class="loader" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
    return;
  }

  if (mode === 'end') {
    dom.loadState.hidden = false;
    dom.loadState.classList.add('is-done');
    dom.loadState.innerHTML = `<span class="load-hint">今天的梦境看到这里啦 · 共 ${formatNumber(state.items.length)} 张</span>`;
    return;
  }

  if (mode === 'error') {
    dom.loadState.hidden = false;
    dom.loadState.classList.add('is-error');
    dom.loadState.innerHTML = `<span>${escapeHtml(message)}</span><button class="load-retry" type="button" data-load-retry>重试</button>`;
    return;
  }

  if (mode === 'idle') {
    dom.loadState.hidden = false;
    dom.loadState.innerHTML = '<span class="load-hint">继续向下滚动，走进更深的梦境</span>';
    return;
  }

  dom.loadState.hidden = true;
  dom.loadState.innerHTML = '';
}

function showSkeleton() {
  dom.skeletonGrid.hidden = false;
}

function setSourceState(status) {
  dom.sourcePill.dataset.state = status;
  if (status === 'online') {
    dom.sourceText.textContent = 'Wallhaven · 在线';
  } else if (status === 'offline') {
    dom.sourceText.textContent = '梦境频道 · 重连中';
  }
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Health check failed');
    const data = await response.json();
    dom.sourcePill.title = `数据来源：${data.source} · ${data.safeMode}`;
    if (dom.sourcePill.dataset.state !== 'offline') setSourceState('online');
  } catch {
    setSourceState('offline');
  }
}

function maybeLoadMore() {
  if (state.view !== 'discover' || state.loading || state.end || state.error || !state.items.length) return;
  if (window.scrollY < 320) return;
  const rect = dom.loadSentinel.getBoundingClientRect();
  if (rect.top < window.innerHeight + 900) {
    loadPage(state.page + 1);
  }
}

function initInfiniteScroll() {
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) maybeLoadMore();
    }, { rootMargin: '900px 0px' });
    observer.observe(dom.loadSentinel);
  }

  dom.loadState.addEventListener('click', (event) => {
    if (event.target.closest('[data-load-retry]')) {
      loadPage(state.page + 1);
    }
  });
}

/* =========================================================
   View switching
   ========================================================= */

function initMasonryEvents() {
  dom.navItems.forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  dom.stateAction.addEventListener('click', () => {
    const action = dom.stateAction.dataset.action;
    if (action === 'discover') {
      setView('discover', true);
      return;
    }
    if (action === 'retry') {
      if (state.view === 'favorites') renderFavoritesView();
      else resetGallery({ scroll: false });
      return;
    }
    state.query = '';
    state.searchLabel = '';
    state.mood = 'all';
    dom.searchInput.value = '';
    dom.searchClear.hidden = true;
    updateChips();
    syncUrl();
    if (state.view === 'favorites') setView('discover', true);
    else resetGallery({ scroll: false });
  });

  dom.waterfall.addEventListener('click', (event) => {
    const card = event.target.closest('.wall-card');
    if (!card) return;
    const id = card.dataset.id;
    const favoriteButton = event.target.closest('.card-favorite');
    const downloadButton = event.target.closest('.card-download');

    if (favoriteButton) {
      event.stopPropagation();
      const item = findItem(id);
      if (item) toggleFavorite(item, favoriteButton);
      return;
    }

    if (downloadButton) {
      event.stopPropagation();
      const item = findItem(id);
      if (item) downloadItem(item, downloadButton);
      return;
    }

    const item = findItem(id);
    if (item) openLightbox(item, getVisibleItems());
  });

  dom.waterfall.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('.card-favorite, .card-download')) return;
    const card = event.target.closest('.wall-card');
    if (!card || event.target !== card) return;
    event.preventDefault();
    const item = findItem(card.dataset.id);
    if (item) openLightbox(item, getVisibleItems());
  });
}

function setView(view, scroll = false) {
  if (view !== 'discover' && view !== 'favorites') return;
  if (state.view === view) {
    if (scroll) scrollToGallery();
    return;
  }

  if (modal.isOpen) closeLightbox();
  state.view = view;
  updateNavUI();

  if (view === 'favorites') {
    state.requestId += 1;
    state.loading = false;
    dom.filterDock.hidden = true;
    dom.skeletonGrid.hidden = true;
    dom.statePanel.hidden = true;
    dom.loadState.hidden = true;
    dom.resultLine.textContent = '';
    renderFavoritesView();
  } else {
    dom.filterDock.hidden = false;
    updateGalleryHeading();
    resetGallery({ scroll: false });
  }

  if (scroll) scrollToGallery();
}

function updateNavUI() {
  dom.navItems.forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function updateGalleryHeading() {
  if (state.view === 'favorites') {
    dom.galleryTitle.textContent = '我的心动收藏';
    dom.gallerySub.textContent = '只属于你的梦境合集，安放在当前浏览器里。';
    document.title = '我的心动收藏 · YUME 梦壁纸';
    return;
  }

  if (state.query) {
    const label = state.searchLabel || state.query;
    const shortLabel = label.length > 18 ? `${label.slice(0, 18)}…` : label;
    dom.galleryTitle.textContent = `“${shortLabel}” 的梦境`;
    dom.gallerySub.textContent = '在 Wallhaven 的竖屏画作中，为你筛出这些心动瞬间。';
    document.title = `“${shortLabel}” · YUME 梦壁纸`;
  } else {
    dom.galleryTitle.textContent = '今日心动画廊';
    dom.gallerySub.textContent = '每一张，都值得成为你的下一张锁屏。';
    document.title = 'YUME 梦壁纸 · 二次元手机壁纸画廊';
  }
}

function resetGallery({ scroll = false } = {}) {
  if (state.view !== 'discover') return;

  state.requestId += 1;
  state.loading = false;
  state.items = [];
  state.page = 1;
  state.lastPage = 1;
  state.end = false;
  state.error = null;
  state.seed = state.sorting === 'random' ? randomSeed() : '';
  syncUrl();

  waterfall.clear();
  dom.statePanel.hidden = true;
  dom.skeletonGrid.hidden = false;
  dom.loadState.hidden = true;
  dom.resultLine.textContent = '正在收集心动瞬间…';
  updateGalleryHeading();

  loadPage(1, { replace: true });
  if (scroll) scrollToGallery();
}

/* =========================================================
   Favorites
   ========================================================= */

function toggleFavorite(item, sourceButton = null) {
  if (!item) return;

  const index = state.favorites.findIndex((favorite) => favorite.id === item.id);
  let favorited;

  if (index >= 0) {
    state.favorites.splice(index, 1);
    favorited = false;
    showToast('已从收藏中移除这张梦境。');
  } else {
    state.favorites.unshift({
      ...item,
      colors: Array.isArray(item.colors) ? item.colors : []
    });
    favorited = true;
    showToast(`已收藏「${paletteName(item)}」到心动清单。`);
  }

  persistFavorites();
  updateFavoriteCount();
  updateFavoriteButtons(item.id, favorited, sourceButton);

  if (modal.isOpen && modal.item?.id === item.id) syncModalFavorite();

  if (state.view === 'favorites') {
    if (!favorited) {
      waterfall.removeCard(item.id, () => {
        renderFavoriteSummary();
        if (!state.favorites.length) {
          showState('empty-favorites');
          dom.resultLine.textContent = '还没有收藏，去发现第一张心动吧';
        }
      });
    } else {
      renderFavoriteSummary();
    }
  }

  return favorited;
}

function updateFavoriteButtons(id, favorited, sourceButton) {
  $$(`.card-favorite[data-fav-id="${id}"]`).forEach((button) => {
    button.classList.toggle('is-faved', favorited);
    button.setAttribute('aria-pressed', String(favorited));
    button.setAttribute('aria-label', favorited ? '取消收藏这张壁纸' : '收藏这张壁纸');

    if (button === sourceButton && favorited) {
      button.classList.remove('is-popping');
      void button.offsetWidth;
      button.classList.add('is-popping');
    }
  });
}

function updateFavoriteCount() {
  const count = state.favorites.length;
  dom.favCount.textContent = String(count);
  dom.favCount.hidden = count === 0;
}

function renderFavoritesView() {
  dom.filterDock.hidden = true;
  dom.skeletonGrid.hidden = true;
  dom.loadState.hidden = true;
  dom.statePanel.hidden = true;
  updateGalleryHeading();
  waterfall.clear();
  waterfall.setItems(state.favorites);
  renderFavoriteSummary();

  if (!state.favorites.length) {
    showState('empty-favorites');
  }
}

function renderFavoriteSummary() {
  const count = state.favorites.length;
  dom.gallerySub.textContent = count
    ? `共 ${formatNumber(count)} 张心动壁纸，保存在当前浏览器里。`
    : '只属于你的梦境合集，安放在当前浏览器里。';
  renderResultLine();
}

/* =========================================================
   Hero
   ========================================================= */

function applyHero(items) {
  if (!Array.isArray(items) || !items.length) return;
  heroItems = items.slice(0, 3);

  [0, 1, 2].forEach((slotIndex) => {
    const slot = document.querySelector(`[data-hero-slot="${slotIndex}"]`);
    if (!slot) return;
    const item = heroItems[slotIndex % heroItems.length];
    if (!item) return;

    slot.dataset.id = item.id;
    slot.setAttribute('aria-label', `查看精选壁纸：${paletteName(item)}`);
    slot.disabled = false;

    const image = $('img', slot);
    const screen = $('.phone__screen', slot);
    const source = `/api/thumb/${item.id}?w=720`;

    if (image.dataset.heroId === item.id && image.getAttribute('src')) return;

    image.dataset.heroId = item.id;
    image.classList.remove('is-loaded');
    screen?.classList.remove('is-loaded');
    if (screen) {
      screen.style.backgroundImage = `url("/api/preview/${item.id}")`;
      screen.style.backgroundSize = 'cover';
      screen.style.backgroundPosition = 'center';

      const previewProbe = new Image();
      const revealPreview = () => {
        if (image.dataset.heroId === item.id) screen.classList.add('is-loaded');
      };
      previewProbe.addEventListener('load', revealPreview, { once: true });
      previewProbe.addEventListener('error', revealPreview, { once: true });
      previewProbe.src = `/api/preview/${item.id}`;
    }

    const showImage = () => {
      if (image.dataset.heroId !== item.id) return;
      image.classList.add('is-loaded');
      screen?.classList.add('is-loaded');
    };

    image.addEventListener('load', showImage, { once: true });
    image.addEventListener('error', () => {
      screen?.classList.add('is-loaded');
    }, { once: true });

    image.src = source;
    image.alt = `${paletteName(item)} · 二次元手机壁纸`;

    if (image.complete && image.naturalWidth > 0) showImage();
  });

  dom.heroMainId.textContent = `NO.${heroItems[0].id.toUpperCase()} · YUME SELECT`;
}

async function refreshHero() {
  if (heroLoading) return;
  heroLoading = true;
  dom.heroShuffle.disabled = true;
  dom.heroArt.classList.add('is-refreshing');

  try {
    const params = new URLSearchParams({
      page: '1',
      sorting: 'random',
      seed: randomSeed()
    });
    if (state.query) params.set('q', state.query);

    const response = await fetch(`/api/wallpapers?${params.toString()}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('暂时无法获取新的灵感');
    const data = await response.json();
    if (!data.items?.length) throw new Error('暂时没有新的灵感');

    applyHero(data.items.slice(0, 3));
    state.heroInitialized = true;
    showToast('换了一批新的心动灵感。');
  } catch (error) {
    showToast(error.message || '灵感暂时迷路了，请稍后再试。', 'error');
  } finally {
    heroLoading = false;
    dom.heroShuffle.disabled = false;
    window.setTimeout(() => dom.heroArt.classList.remove('is-refreshing'), 280);
  }
}

/* =========================================================
   Cards
   ========================================================= */

function createCard(item, index) {
  const card = document.createElement('article');
  const title = paletteName(item);
  const favorited = isFaved(item.id);
  const background = safeHex(item.colors?.[1]) || safeHex(item.colors?.[0]) || '';
  const ratio = clamp((Number(item.width) || 1080) / (Number(item.height) || 1920), 0.56, 1.2);

  card.className = 'wall-card is-new';
  card.dataset.id = item.id;
  card.dataset.ratio = String(ratio);
  card.tabIndex = 0;
  card.style.setProperty('--card-index', String(index % 12));
  card.setAttribute('aria-label', `查看壁纸：${title}，${item.resolution || '竖屏高清'}`);

  card.innerHTML = `
    <div class="wall-card__inner">
      <div class="wall-card__media">
        <img src="/api/preview/${item.id}" alt="${escapeHtml(title)} · 二次元手机壁纸" loading="lazy" decoding="async">
        <span class="card-badge"><span class="card-badge__dot"></span>${qualityLabel(Number(item.width) || 1080)}</span>
        <button class="card-favorite${favorited ? ' is-faved' : ''}" type="button" data-fav-id="${item.id}" aria-label="${favorited ? '取消收藏这张壁纸' : '收藏这张壁纸'}" aria-pressed="${String(favorited)}">
          ${HEART_ICON}
        </button>
        <span class="card-view">${EYE_ICON}<span>查看大图</span></span>
      </div>
      <div class="wall-card__meta">
        <div class="wall-card__text">
          <h3 class="wall-card__title">${escapeHtml(title)}</h3>
          <p class="wall-card__sub">NO.${item.id.toUpperCase()} · ${escapeHtml(item.resolution || '')}</p>
        </div>
        <button class="card-download" type="button" aria-label="下载原图" title="下载原图">
          ${DOWNLOAD_ICON}
        </button>
      </div>
    </div>
  `;

  const media = $('.wall-card__media', card);
  if (background) media.style.backgroundColor = background;

  const image = $('img', card);
  let triedFallback = false;
  const markLoaded = () => {
    image.classList.add('is-loaded');
    screenMediaLoaded(media);
  };

  image.addEventListener('load', markLoaded);
  image.addEventListener('error', () => {
    if (!triedFallback) {
      triedFallback = true;
      image.src = `/api/thumb/${item.id}?w=480`;
      return;
    }
    media.classList.add('is-error');
    image.classList.add('is-loaded');
  });

  if (image.complete && image.naturalWidth > 0) markLoaded();

  return card;
}

function screenMediaLoaded(media) {
  media.classList.remove('is-error');
}

/* =========================================================
   Waterfall
   ========================================================= */

class Waterfall {
  constructor(root) {
    this.root = root;
    this.cards = [];
    this.lastWidth = 0;
    this.resizeFrame = 0;

    if ('ResizeObserver' in window) {
      this.observer = new ResizeObserver(() => {
        if (this.root.clientWidth === this.lastWidth) return;
        this.scheduleLayout();
      });
      this.observer.observe(this.root);
    }

    window.addEventListener('resize', () => this.scheduleLayout(), { passive: true });
  }

  scheduleLayout() {
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      this.layout();
    });
  }

  clear() {
    this.cards = [];
    this.lastWidth = 0;
    this.root.innerHTML = '';
    this.root.style.height = '0px';
  }

  setItems(items) {
    this.clear();
    this.appendItems(items);
  }

  appendItems(items) {
    if (!Array.isArray(items) || !items.length) {
      this.layout();
      return;
    }

    const fragment = document.createDocumentFragment();
    const newCards = items.map((item, index) => {
      const card = createCard(item, index);
      fragment.appendChild(card);
      return card;
    });

    this.root.appendChild(fragment);
    this.cards.push(...newCards);
    this.layout();

    requestAnimationFrame(() => {
      newCards.forEach((card, index) => {
        card.classList.remove('is-new');
        const inner = $('.wall-card__inner', card);
        if (inner) {
          inner.style.transitionDelay = `${Math.min(index, 8) * 28}ms`;
          window.setTimeout(() => {
            inner.style.transitionDelay = '';
          }, 1000);
        }
        card.classList.add('is-in');
      });
    });
  }

  removeCard(id, done) {
    const card = this.cards.find((item) => item.dataset.id === id);
    if (!card) {
      done?.();
      return;
    }

    card.classList.add('is-removing');
    window.setTimeout(() => {
      card.remove();
      this.cards = this.cards.filter((item) => item !== card);
      this.layout();
      done?.();
    }, prefersReducedMotion() ? 0 : 260);
  }

  layout() {
    const width = this.root.clientWidth;
    if (!width || !this.cards.length) {
      this.lastWidth = width;
      if (!this.cards.length) this.root.style.height = '0px';
      return;
    }

    const columns = width < 540 ? 2 : width < 840 ? 3 : width < 1160 ? 4 : 5;
    const gap = width < 540 ? 12 : 18;
    const metaHeight = width < 540 ? 52 : 58;
    const cardWidth = Math.floor(((width - gap * (columns - 1)) / columns) * 100) / 100;
    const columnHeights = new Array(columns).fill(0);

    for (const card of this.cards) {
      const ratio = clamp(Number(card.dataset.ratio) || 0.68, 0.56, 1.2);
      const mediaHeight = Math.round(cardWidth / ratio);
      const cardHeight = mediaHeight + metaHeight;
      let column = 0;

      for (let index = 1; index < columnHeights.length; index += 1) {
        if (columnHeights[index] < columnHeights[column]) column = index;
      }

      const left = Math.round(column * (cardWidth + gap) * 100) / 100;
      const top = Math.round(columnHeights[column] * 100) / 100;

      card.style.width = `${cardWidth}px`;
      card.style.height = `${cardHeight}px`;
      card.style.transform = `translate3d(${left}px, ${top}px, 0)`;

      const media = $('.wall-card__media', card);
      const meta = $('.wall-card__meta', card);
      if (media) media.style.height = `${mediaHeight}px`;
      if (meta) meta.style.height = `${metaHeight}px`;

      columnHeights[column] += cardHeight + gap;
    }

    this.lastWidth = width;
    this.root.style.height = `${Math.max(0, Math.max(...columnHeights) - gap)}px`;
  }
}

/* =========================================================
   State panel
   ========================================================= */

function showState(mode, errorMessage = '') {
  dom.statePanel.hidden = false;
  dom.stateAction.dataset.action = 'retry';

  if (mode === 'empty-favorites') {
    dom.stateTitle.textContent = '还没有收藏的心动';
    dom.stateCopy.textContent = '遇到喜欢的壁纸时，点亮右上角的小爱心，就能把它留在这里。';
    dom.stateAction.textContent = '去发现壁纸';
    dom.stateAction.dataset.action = 'discover';
    return;
  }

  if (mode === 'error') {
    dom.stateTitle.textContent = '梦境频道暂时断开了';
    dom.stateCopy.textContent = `${errorMessage || '连接壁纸服务时遇到了一点问题。'} 网络恢复后，再试一次吧。`;
    dom.stateAction.textContent = '重新连接';
    dom.stateAction.dataset.action = 'retry';
    return;
  }

  dom.stateTitle.textContent = '没有找到这幅梦境';
  dom.stateCopy.textContent = '换个关键词试试，或者回到今日推荐看看。';
  dom.stateAction.textContent = '回到今日推荐';
  dom.stateAction.dataset.action = 'reset';
}

/* =========================================================
   Lightbox
   ========================================================= */

function initLightbox() {
  dom.lightboxClose.addEventListener('click', closeLightbox);
  dom.lightbox.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-lightbox]')) closeLightbox();
  });

  dom.lightboxPrev.addEventListener('click', () => moveLightbox(-1));
  dom.lightboxNext.addEventListener('click', () => moveLightbox(1));

  dom.lightboxFavorite.addEventListener('click', () => {
    if (modal.item) toggleFavorite(modal.item, dom.lightboxFavorite);
  });

  dom.lightboxDownload.addEventListener('click', () => {
    if (modal.item) downloadItem(modal.item, dom.lightboxDownload);
  });

  dom.heroArt.addEventListener('click', (event) => {
    const slot = event.target.closest('[data-hero-slot]');
    if (!slot) return;
    const item = heroItems.find((heroItem) => heroItem.id === slot.dataset.id);
    if (item) openLightbox(item, heroItems);
  });

  document.addEventListener('keydown', (event) => {
    if (modal.isOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveLightbox(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveLightbox(1);
      } else if (event.key === 'Tab') {
        trapFocus(event);
      }
      return;
    }

    if (event.key === 'Escape' && dom.searchPanel.classList.contains('is-open')) {
      closeSearch();
    }
  });
}

function openLightbox(item, list) {
  if (!item) return;

  const sourceList = (Array.isArray(list) && list.length ? list : [item]).filter((entry) => entry?.id);
  const index = sourceList.findIndex((entry) => entry.id === item.id);

  modal.isOpen = true;
  modal.list = sourceList;
  modal.index = index >= 0 ? index : 0;
  modal.item = sourceList[modal.index];
  modal.previousFocus = document.activeElement;

  dom.lightbox.classList.add('is-open');
  dom.lightbox.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-locked');
  closeSearch();

  updateLightbox(modal.item);
  window.setTimeout(() => dom.lightboxClose.focus({ preventScroll: true }), 80);
}

function closeLightbox() {
  if (!modal.isOpen) return;

  modal.isOpen = false;
  modal.token += 1;
  dom.lightbox.classList.remove('is-open');
  dom.lightbox.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-locked');

  const previousFocus = modal.previousFocus;
  modal.previousFocus = null;

  window.setTimeout(() => {
    if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
      previousFocus.focus({ preventScroll: true });
    }
  }, 30);
}

function moveLightbox(direction) {
  if (!modal.isOpen || modal.list.length <= 1) return;
  modal.index = (modal.index + direction + modal.list.length) % modal.list.length;
  modal.item = modal.list[modal.index];
  updateLightbox(modal.item);
}

function updateLightbox(item) {
  if (!item) return;

  const title = paletteName(item);
  const width = Number(item.width) || 1080;
  const height = Number(item.height) || 1920;

  dom.lightboxTitle.textContent = title;
  dom.lightboxSub.textContent = `Anime Illustration · NO.${item.id.toUpperCase()}`;
  dom.specResolution.textContent = `${width} × ${height}`;
  dom.specRatio.textContent = ratioLabel(width, height);
  dom.specSize.textContent = formatBytes(item.fileSize);
  dom.specQuality.textContent = qualityLabel(width);
  dom.specViews.textContent = formatNumber(item.views);
  dom.specFavs.textContent = formatNumber(item.favorites);
  dom.lightboxCounter.textContent = `${String(modal.index + 1).padStart(2, '0')} / ${String(modal.list.length).padStart(2, '0')}`;
  dom.lightboxPrev.disabled = modal.list.length <= 1;
  dom.lightboxNext.disabled = modal.list.length <= 1;

  dom.lightboxDevice.style.setProperty('--device-ratio', String(clamp(width / height, 0.46, 0.82)));
  dom.lightboxAmbient.style.backgroundImage = `url("/api/preview/${item.id}")`;
  dom.lightboxScreen.style.backgroundImage = `url("/api/preview/${item.id}")`;
  dom.lightboxTags.innerHTML = '<span class="tag-skeleton"></span><span class="tag-skeleton"></span><span class="tag-skeleton"></span>';

  const previewToken = modal.token + 1;
  const previewProbe = new Image();
  previewProbe.addEventListener('load', () => {
    if (previewToken === modal.token) dom.lightboxShimmer.classList.add('is-hidden');
  }, { once: true });
  previewProbe.addEventListener('error', () => {
    if (previewToken === modal.token) dom.lightboxShimmer.classList.add('is-hidden');
  }, { once: true });
  previewProbe.src = `/api/preview/${item.id}`;
  dom.lightboxCredit.textContent = '作品来自 Wallhaven 社区，版权归原作者所有。';
  dom.lightboxFavorite.classList.toggle('is-faved', isFaved(item.id));
  dom.lightboxFavorite.setAttribute('aria-pressed', String(isFaved(item.id)));
  dom.lightboxFavorite.setAttribute('aria-label', isFaved(item.id) ? '取消收藏这张壁纸' : '收藏这张壁纸');

  const source = safeExternalUrl(item.source) || safeExternalUrl(item.pageUrl);
  if (source) {
    dom.lightboxSource.href = source;
    dom.lightboxSource.querySelector('b').textContent = item.source ? '前往作品来源' : '前往 Wallhaven 页面';
  } else {
    dom.lightboxSource.href = '#';
    dom.lightboxSource.querySelector('b').textContent = '暂无外部来源';
  }

  const image = dom.lightboxImage;
  const token = ++modal.token;
  const imageSource = `/api/thumb/${item.id}?w=960`;
  image.classList.remove('is-loaded');
  dom.lightboxShimmer.classList.remove('is-hidden');

  const reveal = () => {
    if (token !== modal.token) return;
    image.classList.add('is-loaded');
    dom.lightboxShimmer.classList.add('is-hidden');
  };

  const fail = () => {
    if (token !== modal.token) return;
    dom.lightboxShimmer.classList.add('is-hidden');
  };

  image.addEventListener('load', reveal, { once: true });
  image.addEventListener('error', fail, { once: true });
  image.alt = `${title} · 二次元手机壁纸`;
  image.src = imageSource;
  if (image.complete && image.naturalWidth > 0) reveal();

  loadWallpaperDetail(item.id, token);
}

async function loadWallpaperDetail(id, token) {
  try {
    const response = await fetch(`/api/wallpaper/${id}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Detail request failed');
    const data = await response.json();
    if (token !== modal.token || !modal.isOpen || modal.item?.id !== id) return;

    const detail = data.item || {};
    const tags = Array.isArray(detail.tags) ? detail.tags : [];
    dom.lightboxTags.innerHTML = (tags.length ? tags.slice(0, 8) : ['anime', 'mobile wallpaper'])
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join('');

    if (detail.source && safeExternalUrl(detail.source)) {
      dom.lightboxSource.href = detail.source;
      dom.lightboxSource.querySelector('b').textContent = '前往作品来源';
    }

    if (detail.uploader) {
      dom.lightboxCredit.textContent = `作品来自 Wallhaven 社区 · 上传者 @${detail.uploader}，版权归原作者所有。`;
    }

    if (detail.views) dom.specViews.textContent = formatNumber(detail.views);
    if (detail.favorites) dom.specFavs.textContent = formatNumber(detail.favorites);
    if (detail.fileSize) dom.specSize.textContent = formatBytes(detail.fileSize);

    Object.assign(modal.item, detail);
  } catch {
    if (token !== modal.token) return;
    dom.lightboxTags.innerHTML = ['anime', 'illustration'].map((tag) => `<span class="tag">${tag}</span>`).join('');
  }
}

function trapFocus(event) {
  const focusable = $$('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', dom.lightboxPanel)
    .filter((element) => element.offsetParent !== null && !element.hasAttribute('hidden'));

  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncModalFavorite() {
  if (!modal.item) return;
  const favorited = isFaved(modal.item.id);
  dom.lightboxFavorite.classList.toggle('is-faved', favorited);
  dom.lightboxFavorite.setAttribute('aria-pressed', String(favorited));
  dom.lightboxFavorite.setAttribute('aria-label', favorited ? '取消收藏这张壁纸' : '收藏这张壁纸');
}

/* =========================================================
   Download + toast
   ========================================================= */

async function downloadItem(item, trigger) {
  if (!item || downloadsInFlight.has(item.id)) return;
  downloadsInFlight.add(item.id);

  const previousLabel = trigger?.getAttribute('aria-label');
  if (trigger) {
    trigger.classList.add('is-downloading');
    trigger.setAttribute('aria-busy', 'true');
    trigger.setAttribute('aria-label', '正在获取原图');
  }

  showToast('正在获取高清原图，请稍候…');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(`/api/download/${item.id}`, { signal: controller.signal });
    if (!response.ok) {
      let message = '原图下载失败了，请稍后再试。';
      try {
        const errorBody = await response.json();
        if (errorBody?.error?.message) message = errorBody.error.message;
      } catch {
        // Keep fallback.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('原图文件为空，请稍后再试。');

    const extension = /png/i.test(item.fileType || '') ? 'png' : /webp/i.test(item.fileType || '') ? 'webp' : 'jpg';
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `YUME-${item.id}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    showToast('原图已开始下载，去把它设为锁屏吧。');
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? '下载超时了，这张原图可能比较大，请稍后再试。'
      : (error.message || '下载失败了，请稍后再试。');
    showToast(message, 'error');
  } finally {
    window.clearTimeout(timeout);
    downloadsInFlight.delete(item.id);
    if (trigger) {
      trigger.classList.remove('is-downloading');
      trigger.removeAttribute('aria-busy');
      if (previousLabel) trigger.setAttribute('aria-label', previousLabel);
    }
  }
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' toast--error' : ''}`;
  toast.innerHTML = type === 'error'
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v5M12 16.5v.1"/></svg><span>${escapeHtml(message)}</span>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg><span>${escapeHtml(message)}</span>`;

  dom.toastRegion.appendChild(toast);
  const existing = $$('.toast', dom.toastRegion);
  if (existing.length > 3) existing[0].remove();

  window.setTimeout(() => {
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* =========================================================
   Misc
   ========================================================= */

function initBackToTop() {
  dom.backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}

function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const query = String(params.get('q') || '').trim().slice(0, 80);
  const sort = String(params.get('sort') || '').trim();

  if (SORT_VALUES.has(sort)) state.sorting = sort;

  if (query) {
    state.query = query;
    state.searchLabel = QUERY_LABELS.get(query.toLowerCase()) || query;
    state.mood = 'search';

    const matchingChip = dom.moodChips.find((chip) => chip.dataset.query === query);
    if (matchingChip) {
      state.mood = matchingChip.dataset.mood;
      state.searchLabel = matchingChip.textContent.trim();
    }

    dom.searchInput.value = state.searchLabel;
    dom.searchClear.hidden = false;
  }
}

window.addEventListener('online', () => {
  showToast('网络恢复了，继续探索梦境吧。');
  setSourceState('online');
});

window.addEventListener('offline', () => {
  setSourceState('offline');
  showToast('网络连接断开了，恢复后会自动重连。', 'error');
});

waterfall = new Waterfall(dom.waterfall);
init();
