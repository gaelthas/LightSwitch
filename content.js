(function() {
  let currentTheme = 'default';
  const CLASS_NAME = 'dark';
  const html = document.documentElement;

  function applyTheme(theme) {
    const oldTheme = currentTheme;
    currentTheme = theme;
    
    // If switching to default, we remove our forced class and stop observing
    if (theme === 'default') {
      observer.disconnect();
      if (oldTheme === 'dark') {
        html.classList.remove(CLASS_NAME);
      }
      html.style.removeProperty('color-scheme');
      return;
    }

    // For non-default themes, we apply the change and start/keep observing
    if (theme === 'dark') {
      html.classList.add(CLASS_NAME);
      html.style.setProperty('color-scheme', 'dark', 'important');
    } else if (theme === 'light') {
      html.classList.remove(CLASS_NAME);
      html.style.setProperty('color-scheme', 'light', 'important');
    }

    // Ensure we are observing
    observer.observe(html, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  const observer = new MutationObserver(() => {
    if (currentTheme === 'default') return;

    // Temporarily disconnect to avoid infinite loop
    observer.disconnect();

    if (currentTheme === 'dark' && !html.classList.contains(CLASS_NAME)) {
      html.classList.add(CLASS_NAME);
    } else if (currentTheme === 'light' && html.classList.contains(CLASS_NAME)) {
      html.classList.remove(CLASS_NAME);
    }

    // Re-apply color-scheme if it was removed
    const expectedScheme = currentTheme === 'dark' ? 'dark' : 'light';
    if (html.style.getPropertyValue('color-scheme') !== expectedScheme) {
      html.style.setProperty('color-scheme', expectedScheme, 'important');
    }

    observer.observe(html, { attributes: true, attributeFilter: ['class', 'style'] });
  });

  // Initial load
  chrome.storage.sync.get('theme', (data) => {
    const theme = data.theme || 'default';
    if (theme !== 'default') {
      applyTheme(theme);
    }
  });

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.theme) {
      applyTheme(changes.theme.newValue);
    }
  });
})();
