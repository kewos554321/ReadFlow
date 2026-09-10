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

// Debug mode: lets content.js run the whole Chapter Guide drawer flow
// against canned data instead of a real book / real Gemini call (see
// the "── Debug mode ──" comment in content.js). Checkboxes save
// immediately on change, unlike the API key field — there's nothing to
// type or confirm, so a separate Save step would only add friction.
function saveDebugMode(enabled) {
  chrome.storage.local.set({ debugMode: enabled });
}

function saveDebugModeError(enabled) {
  chrome.storage.local.set({ debugModeError: enabled });
}

function loadDebugSettings(callback) {
  chrome.storage.local.get(['debugMode', 'debugModeError'], (result) => {
    callback({ debugMode: !!result.debugMode, debugModeError: !!result.debugModeError });
  });
}

if (typeof module !== 'undefined') {
  module.exports = { saveApiKey, loadApiKey, saveDebugMode, saveDebugModeError, loadDebugSettings };
} else {
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('apiKey');
    const saveBtn = document.getElementById('save');
    const debugModeInput = document.getElementById('debugMode');
    const debugModeErrorInput = document.getElementById('debugModeError');

    loadApiKey((key) => { input.value = key; });

    saveBtn.addEventListener('click', () => {
      saveApiKey(input.value.trim());
    });

    loadDebugSettings(({ debugMode, debugModeError }) => {
      debugModeInput.checked = debugMode;
      debugModeErrorInput.checked = debugModeError;
      debugModeErrorInput.disabled = !debugMode;
    });

    debugModeInput.addEventListener('change', (e) => {
      saveDebugMode(e.target.checked);
      debugModeErrorInput.disabled = !e.target.checked;
      if (!e.target.checked && debugModeErrorInput.checked) {
        debugModeErrorInput.checked = false;
        saveDebugModeError(false);
      }
    });

    debugModeErrorInput.addEventListener('change', (e) => {
      saveDebugModeError(e.target.checked);
    });
  });
}
