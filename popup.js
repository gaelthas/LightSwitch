document.addEventListener('DOMContentLoaded', () => {
  const radios = document.querySelectorAll('input[name="theme"]');

  // Load existing preference
  chrome.storage.sync.get('theme', (data) => {
    const theme = data.theme || 'default';
    const radioToSelect = document.querySelector(`input[value="${theme}"]`);
    if (radioToSelect) {
      radioToSelect.checked = true;
    }
  });

  // Save selection on change
  radios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const selectedTheme = e.target.value;
      chrome.storage.sync.set({ theme: selectedTheme });
    });
  });
});
