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

function saveProviderApiKey(provider, key) {
  chrome.storage.local.set({ [`${provider}ApiKey`]: key }, () => {
    const status = document.getElementById(`status-${provider}`);
    if (status) status.textContent = 'Saved ✓';
  });
}

// Gemini used a single unnamed `apiKey` field before providers existed —
// fall back to it so upgrading users don't lose an already-saved key.
function loadProviderApiKey(provider, callback) {
  chrome.storage.local.get([`${provider}ApiKey`, 'apiKey'], (result) => {
    const stored = result[`${provider}ApiKey`];
    if (stored) { callback(stored); return; }
    callback(provider === 'gemini' ? (result.apiKey || '') : '');
  });
}

function saveProvider(provider) {
  chrome.storage.local.set({ provider }, () => {});
}

function loadProvider(callback) {
  chrome.storage.local.get(['provider'], (result) => {
    callback(result.provider || 'gemini');
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
  module.exports = {
    saveApiKey, loadApiKey,
    saveProviderApiKey, loadProviderApiKey,
    saveProvider, loadProvider,
    saveDebugMode, saveDebugModeError, loadDebugSettings,
  };
} else {
  document.addEventListener('DOMContentLoaded', () => {
    const providerSelect = document.getElementById('provider');
    const geminiInput = document.getElementById('apiKey-gemini');
    const deepseekInput = document.getElementById('apiKey-deepseek');
    const geminiSaveBtn = document.getElementById('save-gemini');
    const deepseekSaveBtn = document.getElementById('save-deepseek');
    const debugModeInput = document.getElementById('debugMode');
    const debugModeErrorInput = document.getElementById('debugModeError');

    loadProvider((provider) => { providerSelect.value = provider; });
    providerSelect.addEventListener('change', (e) => saveProvider(e.target.value));

    loadProviderApiKey('gemini', (key) => { geminiInput.value = key; });
    loadProviderApiKey('deepseek', (key) => { deepseekInput.value = key; });

    geminiSaveBtn.addEventListener('click', () => {
      saveProviderApiKey('gemini', geminiInput.value.trim());
    });
    deepseekSaveBtn.addEventListener('click', () => {
      saveProviderApiKey('deepseek', deepseekInput.value.trim());
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
