const { buildMessages, callClaudeApi } = require('../background.js');

test('buildMessages formats selected text and context correctly', () => {
  const messages = buildMessages('ephemeral', 'He was an ephemeral figure in history.');
  expect(messages).toEqual([{
    role: 'user',
    content: 'Selected text: "ephemeral"\n\nSurrounding context:\nHe was an ephemeral figure in history.'
  }]);
});

test('callClaudeApi calls Anthropic endpoint with correct headers', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ text: '**Result**' }] })
  });

  const result = await callClaudeApi('sk-ant-test', 'ephemeral', 'He was an ephemeral figure.');

  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.anthropic.com/v1/messages',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-api-key': 'sk-ant-test',
        'anthropic-version': '2023-06-01',
      })
    })
  );
  expect(result).toBe('**Result**');
});

test('callClaudeApi throws on API error', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: 'Invalid API key' } })
  });

  await expect(
    callClaudeApi('bad-key', 'word', 'context')
  ).rejects.toThrow('Invalid API key');
});
