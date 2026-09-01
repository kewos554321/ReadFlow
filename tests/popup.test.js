const { saveApiKey, loadApiKey } = require('../popup.js');

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
