(function () {
  'use strict';

  const CHANNEL = 'lightswitch:config';
  const STATS_CHANNEL = 'lightswitch:stats';
  const VALID_MODES = new Set(['website', 'system', 'light', 'dark']);

  const ATTRS = [
    { name: 'data-theme', light: 'light', dark: 'dark', eager: true },
    { name: 'data-color-mode', light: 'light', dark: 'dark', eager: true },
    { name: 'data-color-scheme', light: 'light', dark: 'dark', eager: true },
    { name: 'data-bs-theme', light: 'light', dark: 'dark', eager: true },
    { name: 'data-theme-mode', light: 'light', dark: 'dark', eager: true },
    { name: 'data-appearance', light: 'light', dark: 'dark', eager: true },
    { name: 'data-prefers-color-scheme', light: 'light', dark: 'dark', eager: true },
    { name: 'data-mode', light: 'light', dark: 'dark', eager: false },
    { name: 'data-scheme', light: 'light', dark: 'dark', eager: false },
    { name: 'data-dark-mode', light: 'false', dark: 'true', eager: false },
    { name: 'data-md-color-scheme', light: 'default', dark: 'slate', eager: false }
  ];

  const DARK_CLASSES = [
    'dark', 'dark-mode', 'darkmode', 'dark-theme', 'theme-dark', 'is-dark', 'mode-dark',
    'night', 'night-mode', 'nightmode', 'ui-dark', 'darkMode', 'dark-active',
    'has-dark-mode', 'bp4-dark', 'bp3-dark', 'pf-v5-theme-dark', 'pf-theme-dark', 'theme--dark'
  ];
  const LIGHT_CLASSES = [
    'light', 'light-mode', 'lightmode', 'light-theme', 'theme-light', 'is-light', 'mode-light',
    'day-mode', 'theme--light', 'bp4-light'
  ];

  const ATTR_FILTER = ['class', 'style', 'content', 'name'].concat(ATTRS.map(def => def.name));

  let globalMode = 'website';
  let overrides = {};
  let theme = 'system';
  let systemDark = false;
  let applying = false;

  const strategies = new Set();
  const originalClasses = new Map();
  const TOUCHED_CLASSES = new Set(DARK_CLASSES.concat(LIGHT_CLASSES, ['light', 'dark']));
  const attrChanges = new Map();
  const metaChanges = new Map();
  const inlineChanges = new Map();
  const observed = new WeakSet();

  function normalizeMode(value) {
    if (value === 'default') return 'website';
    return VALID_MODES.has(value) ? value : 'website';
  }

  function currentHost() {
    try { return location.hostname || ''; } catch (_) { return ''; }
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function activeMode() {
    const host = currentHost();
    if (host && hasOwn(overrides, host)) return normalizeMode(overrides[host]);
    return normalizeMode(globalMode);
  }

  function computeTheme() {
    const mode = activeMode();
    if (mode === 'website') return 'system';
    if (mode === 'system') return systemDark ? 'dark' : 'light';
    return mode;
  }

  function broadcastConfig() {
    window.postMessage({ channel: CHANNEL, theme }, '*');
  }

  function snapshotClasses(el) {
    if (!originalClasses.has(el)) originalClasses.set(el, new Set(el.classList));
  }

  function setAttribute(el, name, value, tag) {
    if (el.getAttribute(name) === value) return;
    let changes = attrChanges.get(el);
    if (!changes) {
      changes = new Map();
      attrChanges.set(el, changes);
    }
    if (!changes.has(name)) changes.set(name, el.getAttribute(name));
    el.setAttribute(name, value);
    strategies.add(tag);
  }

  function setMeta(meta, value) {
    if (meta.getAttribute('content') === value) return;
    if (!metaChanges.has(meta)) metaChanges.set(meta, meta.getAttribute('content'));
    meta.setAttribute('content', value);
    strategies.add('meta');
  }

  function apply() {
    const html = document.documentElement;
    if (!html) return;
    const targets = [html, document.body].filter(Boolean);
    const removeClasses = theme === 'light' ? DARK_CLASSES : LIGHT_CLASSES;
    const addClass = theme === 'light' ? 'light' : 'dark';

    strategies.add('class');
    strategies.add('data-attr');
    strategies.add('color-scheme');

    for (const el of targets) {
      snapshotClasses(el);
      for (const cls of removeClasses) {
        if (el.classList.contains(cls)) el.classList.remove(cls);
      }
      if (el === html && !el.classList.contains(addClass)) el.classList.add(addClass);
    }

    for (const def of ATTRS) {
      const value = def[theme];
      for (const el of targets) {
        const exists = el.getAttribute(def.name) !== null;
        if (el === html ? !(def.eager || exists) : !exists) continue;
        setAttribute(el, def.name, value, 'data-attr');
      }
    }

    for (const meta of document.querySelectorAll('meta')) {
      const name = (meta.getAttribute('name') || '').toLowerCase();
      if (name === 'color-scheme' || name === 'supported-color-schemes') {
        setMeta(meta, theme === 'dark' ? 'only dark' : 'only light');
      }
    }

    for (const el of targets) {
      const prop = 'color-scheme';
      if (el.style.getPropertyValue(prop) === theme && el.style.getPropertyPriority(prop) === 'important') continue;
      if (!inlineChanges.has(el)) {
        inlineChanges.set(el, {
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop)
        });
      }
      el.style.setProperty(prop, theme, 'important');
      strategies.add('color-scheme');
    }
  }

  function restore() {
    for (const [el, original] of originalClasses) {
      for (const cls of TOUCHED_CLASSES) {
        if (original.has(cls)) el.classList.add(cls);
        else el.classList.remove(cls);
      }
    }
    for (const [el, changes] of attrChanges) {
      for (const [name, value] of changes) {
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
      }
    }
    for (const [el, value] of metaChanges) {
      if (value === null) el.removeAttribute('content');
      else el.setAttribute('content', value);
    }
    for (const [el, original] of inlineChanges) {
      if (original.value === '') el.style.removeProperty('color-scheme');
      else el.style.setProperty('color-scheme', original.value, original.priority);
    }
    originalClasses.clear();
    attrChanges.clear();
    metaChanges.clear();
    inlineChanges.clear();
    strategies.clear();
  }

  const observer = new MutationObserver(() => {
    if (theme === 'system') return;
    sync();
  });

  function observeTargets() {
    const html = document.documentElement;
    if (html && !observed.has(html)) {
      observer.observe(html, { attributes: true, attributeFilter: ATTR_FILTER, childList: true });
      observed.add(html);
    }
    if (document.body && !observed.has(document.body)) {
      observer.observe(document.body, { attributes: true, attributeFilter: ATTR_FILTER });
      observed.add(document.body);
    }
    if (document.head && !observed.has(document.head)) {
      observer.observe(document.head, {
        attributes: true, attributeFilter: ATTR_FILTER, childList: true, subtree: true
      });
      observed.add(document.head);
    }
  }

  function sync() {
    if (applying) return;
    applying = true;
    try {
      observeTargets();
      if (theme !== 'system') apply();
    } finally {
      applying = false;
    }
  }

  function setTheme(next) {
    const value = next === 'light' || next === 'dark' ? next : 'system';
    if (value === theme) {
      broadcastConfig();
      return;
    }
    if (theme !== 'system' && value === 'system') restore();
    theme = value;
    strategies.clear();
    if (value !== 'system') sync();
    broadcastConfig();
  }

  function readStorage(area, keys) {
    return new Promise(resolve => {
      try { chrome.storage[area].get(keys, data => resolve(data || {})); }
      catch (_) { resolve({}); }
    });
  }

  function refresh() {
    Promise.all([
      readStorage('sync', { theme: 'website' }),
      readStorage('local', { siteOverrides: {} })
    ]).then(([syncData, localData]) => {
      globalMode = normalizeMode(syncData.theme);
      overrides = localData.siteOverrides || {};
      setTheme(computeTheme());
    });
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== STATS_CHANNEL || !Array.isArray(data.stats)) return;
    if (typeof data.systemDark === 'boolean') {
      const changed = data.systemDark !== systemDark;
      systemDark = data.systemDark;
      if (changed && activeMode() === 'system') setTheme(computeTheme());
    }
    if (theme === 'system') return;
    for (const name of data.stats) strategies.add(name);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'lightswitch:status' || window !== window.top) return;
    const host = currentHost();
    sendResponse({
      mode: activeMode(),
      theme,
      host,
      globalMode,
      override: hasOwn(overrides, host) ? normalizeMode(overrides[host]) : '',
      strategies: Array.from(strategies)
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' && changes.theme) || (area === 'local' && changes.siteOverrides)) refresh();
  });

  try {
    const systemMql = window.matchMedia('(prefers-color-scheme: dark)');
    systemDark = systemMql.matches;
    const onSystemChange = event => {
      systemDark = event.matches;
      if (activeMode() === 'system') setTheme(computeTheme());
    };
    if (systemMql.addEventListener) systemMql.addEventListener('change', onSystemChange);
    else systemMql.addListener(onSystemChange);
  } catch (_) {}

  observeTargets();
  broadcastConfig();
  refresh();
  document.addEventListener('DOMContentLoaded', sync);
  window.addEventListener('load', sync);
})();
