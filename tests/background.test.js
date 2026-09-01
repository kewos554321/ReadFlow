const { buildRequestBody, callGeminiApi } = require('../background.js');

test('buildRequestBody formats selected text and context correctly', () => {
  const body = buildRequestBody('ephemeral', 'He was an ephemeral figure in history.');
  expect(body.contents).toEqual([{
    role: 'user',
    parts: [{ text: 'Selected text: "ephemeral"\n\nSurrounding context:\nHe was an ephemeral figure in history.' }]
  }]);
  expect(body.system_instruction.parts[0].text).toContain('SLA');
});

test('callGeminiApi calls Gemini endpoint with API key in URL', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '**Result**' }] } }]
    })
  });

  const result = await callGeminiApi('AIza-test', 'ephemeral', 'He was an ephemeral figure.');

  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('AIza-test'),
    expect.objectContaining({ method: 'POST' })
  );
  expect(result).toBe('**Result**');
});

test('callGeminiApi throws on API error', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: 'Invalid API key' } })
  });

  await expect(
    callGeminiApi('bad-key', 'word', 'context')
  ).rejects.toThrow('Invalid API key');
});
