(function () {
  'use strict';

  const LABELS = {
    system: '跟随系统',
    light: '亮色',
    dark: '暗色',
    'class': '主题类名',
    'data-attr': '主题属性',
    'meta': 'meta 声明',
    'color-scheme': 'color-scheme',
    'matchMedia': '媒体查询',
    'storage': '站点存储',
    'css-media': '样式表媒体规则'
  };

  function normalize(value) {
    if (value === 'default') return 'system';
    return ['system', 'light', 'dark'].indexOf(value) === -1 ? 'system' : value;
  }

  function getStorage(area, keys) {
    return new Promise(resolve => {
      try { chrome.storage[area].get(keys, data => resolve(data || {})); }
      catch (_) { resolve({}); }
    });
  }

  function getActiveTab() {
    return new Promise(resolve => {
      try { chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs && tabs[0])); }
      catch (_) { resolve(null); }
    });
  }

  function getStatus(tabId) {
    return new Promise(resolve => {
      try {
        chrome.tabs.sendMessage(tabId, { type: 'lightswitch:status' }, response => {
          resolve(chrome.runtime.lastError ? null : response);
        });
      } catch (_) { resolve(null); }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const radios = document.querySelectorAll('input[name="theme"]');
    const select = document.getElementById('site-select');
    const hostEl = document.getElementById('host');
    const statusEl = document.getElementById('status');

    const tab = await getActiveTab();
    let host = '';
    try {
      const url = new URL(tab.url);
      if (['http:', 'https:', 'file:'].indexOf(url.protocol) !== -1) {
        host = url.hostname || '本地文件';
      }
    } catch (_) {}

    hostEl.textContent = host || '不可用';
    hostEl.title = host;
    select.disabled = !host;

    const [syncData, localData] = await Promise.all([
      getStorage('sync', { theme: 'system' }),
      getStorage('local', { siteOverrides: {} })
    ]);
    const globalTheme = normalize(syncData.theme);
    const overrides = localData.siteOverrides || {};

    const radio = document.querySelector(`input[value="${globalTheme}"]`);
    if (radio) radio.checked = true;
    if (host) select.value = hasOwn(overrides, host) ? normalize(overrides[host]) : '';

    function hasOwn(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    }

    async function updateStatus() {
      if (!tab || tab.id === undefined) {
        statusEl.textContent = '此页面不受扩展控制';
        return;
      }
      const response = await getStatus(tab.id);
      if (!response) {
        statusEl.textContent = '此页面不受扩展控制';
        return;
      }
      if (response.theme === 'system') {
        statusEl.textContent = '当前站点未干预（跟随系统）';
        return;
      }
      const list = (response.strategies || []).map(name => LABELS[name] || name);
      statusEl.textContent = `强制${LABELS[response.theme]} · 已启用 ${list.length} 类兼容策略` +
        (list.length ? `：${list.join('、')}` : '');
    }

    radios.forEach(radio => {
      radio.addEventListener('change', event => {
        chrome.storage.sync.set({ theme: event.target.value });
        setTimeout(updateStatus, 200);
      });
    });

    select.addEventListener('change', () => {
      if (!host) return;
      const next = Object.assign({}, overrides);
      if (select.value) next[host] = select.value;
      else delete next[host];
      chrome.storage.local.set({ siteOverrides: next });
      setTimeout(updateStatus, 200);
    });

    updateStatus();
  });
})();
