function saveApiKey(key) {
  chrome.storage.local.set({ apiKey: key }, () => {
    const status = document.getElementById('status');
    if (status) status.textContent = 'Saved ✓';
  });
}

function loadApiKey(callback) {
  chrome.storage.local.get(['apiKey'], (result) => {
    callback(result.apiKey || '');
  });
}

if (typeof module !== 'undefined') {
  module.exports = { saveApiKey, loadApiKey };
} else {
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('apiKey');
    const saveBtn = document.getElementById('save');

    loadApiKey((key) => { input.value = key; });

    saveBtn.addEventListener('click', () => {
      saveApiKey(input.value.trim());
    });
  });
}
