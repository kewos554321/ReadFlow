const {
  saveApiKey, loadApiKey,
  saveProviderApiKey, loadProviderApiKey,
  saveProvider, loadProvider,
} = require('../popup.js');

global.chrome = {
  storage: {
    local: {
      set: jest.fn((obj, cb) => cb && cb()),
      get: jest.fn((keys, cb) => cb({ apiKey: 'test-key-123' })),
    },
  },
};

test('saveApiKey stores key in chrome.storage.local', () => {
  saveApiKey('sk-ant-test');
  expect(chrome.storage.local.set).toHaveBeenCalledWith(
    { apiKey: 'sk-ant-test' },
    expect.any(Function)
  );
});

test('loadApiKey retrieves key from chrome.storage.local', (done) => {
  loadApiKey((key) => {
    expect(key).toBe('test-key-123');
    done();
  });
});

describe('saveProviderApiKey', () => {
  test('stores the Gemini key under geminiApiKey', () => {
    saveProviderApiKey('gemini', 'AIza-test');
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { geminiApiKey: 'AIza-test' },
      expect.any(Function)
    );
  });

  test('stores the DeepSeek key under deepseekApiKey', () => {
    saveProviderApiKey('deepseek', 'sk-test');
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { deepseekApiKey: 'sk-test' },
      expect.any(Function)
    );
  });
});

describe('loadProviderApiKey', () => {
  test('returns the stored geminiApiKey when present', (done) => {
    chrome.storage.local.get = jest.fn((keys, cb) => cb({ geminiApiKey: 'AIza-new', apiKey: 'AIza-legacy' }));
    loadProviderApiKey('gemini', (key) => {
      expect(key).toBe('AIza-new');
      done();
    });
  });

  test('falls back to the legacy apiKey field for Gemini when geminiApiKey is unset', (done) => {
    chrome.storage.local.get = jest.fn((keys, cb) => cb({ apiKey: 'AIza-legacy' }));
    loadProviderApiKey('gemini', (key) => {
      expect(key).toBe('AIza-legacy');
      done();
    });
  });

  test('returns empty string for DeepSeek when deepseekApiKey is unset (no legacy fallback)', (done) => {
    chrome.storage.local.get = jest.fn((keys, cb) => cb({ apiKey: 'AIza-legacy' }));
    loadProviderApiKey('deepseek', (key) => {
      expect(key).toBe('');
      done();
    });
  });
});

describe('provider selection', () => {
  test('saveProvider stores the chosen provider', () => {
    chrome.storage.local.set = jest.fn((obj, cb) => cb && cb());
    saveProvider('deepseek');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ provider: 'deepseek' }, expect.any(Function));
  });

  test('loadProvider defaults to gemini when nothing stored', (done) => {
    chrome.storage.local.get = jest.fn((keys, cb) => cb({}));
    loadProvider((provider) => {
      expect(provider).toBe('gemini');
      done();
    });
  });

  test('loadProvider returns the stored provider', (done) => {
    chrome.storage.local.get = jest.fn((keys, cb) => cb({ provider: 'deepseek' }));
    loadProvider((provider) => {
      expect(provider).toBe('deepseek');
      done();
    });
  });
});
