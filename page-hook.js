(function () {
  'use strict';

  const CHANNEL = 'lightswitch:config';
  const STATS_CHANNEL = 'lightswitch:stats';

  const THEME_KEYS = new Set([
    'theme', 'theme-preference', 'theme-mode', 'thememode', 'app-theme', 'site-theme', 'ui-theme',
    'color-theme', 'colortheme', 'color-mode', 'colormode', 'color-scheme', 'colorscheme',
    'prefers-color-scheme', 'data-theme', 'data-color-mode', 'appearance',
    'dark-mode', 'darkmode', 'is-dark', 'isdark', 'dark', 'night-mode', 'nightmode',
    'chakra-ui-color-mode', 'vitepress-theme-appearance', 'docusaurus-theme', 'next-theme',
    'md-color-scheme', 'data-md-color-scheme', 'github-color-mode', 'color-scheme-preference'
  ]);
  const KEY_HINT = /(theme|color-scheme|color-mode|appearance|dark-mode|darkmode)/i;

  let theme = 'system';
  const nativeMatchMedia = typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
  const fakeQueries = new Set();
  const nativeCache = new Map();
  const originalMedia = new WeakMap();
  const originalStorage = new Map();
  let rawLocalStorage = null;
  let rawSessionStorage = null;
  let scanTimer = 0;

  try { rawLocalStorage = window.localStorage; } catch (_) {}
  try { rawSessionStorage = window.sessionStorage; } catch (_) {}

  function isThemeKey(key) {
    if (typeof key !== 'string') return false;
    const k = key.toLowerCase();
    return THEME_KEYS.has(k) || (k.length < 40 && KEY_HINT.test(k));
  }

  function schemeResult(value, mode) {
    if (mode === 'system') return null;
    if (value.toLowerCase() === 'no-preference') return false;
    return (value.toLowerCase() === 'dark') === (mode === 'dark');
  }

  function rewriteQuery(text, mode) {
    return text.replace(/prefers-color-scheme\s*:\s*(dark|light|no-preference)/gi, (match, value) => {
      const result = schemeResult(value, mode);
      return result === null ? match : (result ? 'min-width: 0px' : 'max-width: 0px');
    });
  }

  function nativeMatches(query) {
    const key = theme + '\u0000' + query;
    let mql = nativeCache.get(key);
    if (!mql) {
      mql = nativeMatchMedia(rewriteQuery(query, theme));
      nativeCache.set(key, mql);
    }
    return mql.matches;
  }

  function patchedMatchMedia(query) {
    const q = String(query);
    if (!nativeMatchMedia) {
      return {
        media: q, matches: false, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return true; }
      };
    }
    if (theme === 'system' || !/prefers-color-scheme/i.test(q)) return nativeMatchMedia(q);

    const mql = nativeMatchMedia(rewriteQuery(q, theme));
    try {
      Object.defineProperty(mql, 'media', { configurable: true, get: () => q });
      Object.defineProperty(mql, 'matches', { configurable: true, get: () => nativeMatches(q) });
    } catch (_) {}
    fakeQueries.add(typeof WeakRef === 'function' ? new WeakRef(mql) : mql);
    return mql;
  }

  function notifyThemeChange() {
    nativeCache.clear();
    for (const ref of fakeQueries) {
      const mql = typeof WeakRef === 'function' ? ref.deref() : ref;
      if (!mql) {
        fakeQueries.delete(ref);
        continue;
      }
      let event;
      try {
        event = new MediaQueryListEvent('change', { media: mql.media, matches: mql.matches });
      } catch (_) {
        event = new Event('change');
      }
      try { mql.dispatchEvent(event); } catch (_) {}
    }
  }

  function rewriteJson(value, mode) {
    if (Array.isArray(value)) return value.map(item => rewriteJson(item, mode));
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value)) {
        const item = value[key];
        if (/^(theme|mode|colorMode|color-theme|colorTheme|appearance|scheme|colorScheme|variant)$/i.test(key)) {
          out[key] = mode;
        } else if (/^(dark|isDark|darkMode|isDarkMode|night|isNight)$/i.test(key) && typeof item === 'boolean') {
          out[key] = mode === 'dark';
        } else {
          out[key] = rewriteJson(item, mode);
        }
      }
      return out;
    }
    if (typeof value === 'string' && /^(dark|light|auto|system|default|no-preference)$/i.test(value.trim())) {
      return mode;
    }
    return value;
  }

  function desiredValue(key, raw, mode) {
    if (mode === 'system') return raw;
    if (raw === null || raw === undefined) return mode;

    const text = String(raw);
    const lower = text.trim().toLowerCase();

    if (lower === 'true' || lower === 'false' || lower === '1' || lower === '0') {
      if (/dark|night/i.test(key)) {
        const numeric = lower === '1' || lower === '0';
        return numeric ? (mode === 'dark' ? '1' : '0') : (mode === 'dark' ? 'true' : 'false');
      }
      return mode;
    }
    if (lower === 'slate' || /md-color-scheme/.test(key)) {
      return mode === 'dark' ? 'slate' : 'default';
    }
    if (/^[{[]/.test(text) || /^"(dark|light|auto|system|default)"$/i.test(text.trim())) {
      try { return JSON.stringify(rewriteJson(JSON.parse(text), mode)); } catch (_) {}
    }
    return mode;
  }

  const nativeGetItem = Storage.prototype.getItem;
  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.getItem = function (key) {
    const raw = nativeGetItem.call(this, key);
    return theme !== 'system' && isThemeKey(key) ? desiredValue(key, raw, theme) : raw;
  };

  function rememberOriginal(storage, key) {
    if (!storage || originalStorage.has(key)) return;
    try { originalStorage.set(key, nativeGetItem.call(storage, key)); }
    catch (_) { originalStorage.set(key, null); }
  }

  Storage.prototype.setItem = function (key, value) {
    if (theme === 'system' || !isThemeKey(key)) {
      return nativeSetItem.call(this, key, value);
    }
    if (this === rawLocalStorage) rememberOriginal(rawLocalStorage, key);
    return nativeSetItem.call(this, key, desiredValue(key, String(value), theme));
  };

  function installStorageProxy(name, storage) {
    if (!storage) return;
    try {
      const proxy = new Proxy(storage, {
        get(target, prop) {
          if (typeof prop === 'string' && theme !== 'system' && isThemeKey(prop)) {
            return desiredValue(prop, nativeGetItem.call(target, prop), theme);
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, prop, value) {
          if (typeof prop === 'string' && theme !== 'system' && isThemeKey(prop)) {
            if (target === rawLocalStorage) rememberOriginal(rawLocalStorage, prop);
            nativeSetItem.call(target, prop, desiredValue(prop, String(value), theme));
            return true;
          }
          return Reflect.set(target, prop, value, target);
        },
        deleteProperty(target, prop) {
          if (typeof prop === 'string' && isThemeKey(prop)) {
            nativeRemoveItem.call(target, prop);
            return true;
          }
          return Reflect.deleteProperty(target, prop);
        }
      });
      Object.defineProperty(window, name, { configurable: true, get: () => proxy });
    } catch (_) {}
  }

  installStorageProxy('localStorage', rawLocalStorage);
  installStorageProxy('sessionStorage', rawSessionStorage);

  function syncStoredValues() {
    if (!rawLocalStorage) return;
    const keys = [];
    try {
      for (let i = 0; i < rawLocalStorage.length; i++) {
        const key = rawLocalStorage.key(i);
        if (isThemeKey(key)) keys.push(key);
      }
    } catch (_) { return; }

    for (const key of keys) {
      try {
        const raw = nativeGetItem.call(rawLocalStorage, key);
        if (!originalStorage.has(key)) originalStorage.set(key, raw);
        const next = desiredValue(key, raw, theme);
        if (next !== raw) nativeSetItem.call(rawLocalStorage, key, next);
      } catch (_) {}
    }
  }

  function restoreStoredValues() {
    if (!rawLocalStorage) return;
    for (const [key, raw] of originalStorage) {
      try {
        if (raw === null) nativeRemoveItem.call(rawLocalStorage, key);
        else nativeSetItem.call(rawLocalStorage, key, raw);
      } catch (_) {}
    }
    originalStorage.clear();
  }

  function walkRules(list) {
    let rules;
    try { rules = list.cssRules; } catch (_) { return; }
    for (const rule of rules) {
      if (rule.type === 4 && rule.media) {
        let current = '';
        try { current = rule.media.mediaText; } catch (_) {}
        let original = originalMedia.get(rule);
        if (original === undefined) {
          original = current;
          if (/prefers-color-scheme/i.test(original)) originalMedia.set(rule, original);
        }
        if (originalMedia.has(rule)) {
          const next = theme === 'system' ? original : rewriteQuery(original, theme);
          if (next !== current) {
            try { rule.media.mediaText = next; } catch (_) {}
          }
        }
      }
      if (rule.cssRules) walkRules(rule);
    }
  }

  function scanStyleSheets() {
    try {
      for (const sheet of document.styleSheets) walkRules(sheet);
    } catch (_) {}
    for (const sheet of document.adoptedStyleSheets || []) walkRules(sheet);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanStyleSheets, 40);
  }

  if (typeof MutationObserver === 'function') {
    try {
      const mo = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeName === 'STYLE' || node.nodeName === 'LINK') {
              scheduleScan();
              return;
            }
          }
        }
      });
      mo.observe(document, { childList: true, subtree: true });
    } catch (_) {}
  }
  document.addEventListener('load', scheduleScan, true);
  window.addEventListener('load', scheduleScan);

  function reportStats() {
    window.postMessage({ channel: STATS_CHANNEL, stats: ['matchMedia', 'storage', 'css-media'] }, '*');
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;

    const next = data.theme === 'light' || data.theme === 'dark' ? data.theme : 'system';
    if (next === theme) {
      reportStats();
      return;
    }
    theme = next;
    notifyThemeChange();
    if (theme === 'system') restoreStoredValues();
    else syncStoredValues();
    scanStyleSheets();
    reportStats();
  });

  window.matchMedia = patchedMatchMedia;
  scheduleScan();
  reportStats();
})();
