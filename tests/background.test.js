const { buildChapterRequestBody, callGeminiForChapter, joinPageTexts } = require('../background.js');

test('joinPageTexts joins pages with a separator and skips blanks', () => {
  expect(joinPageTexts(['Page one.', '  ', 'Page two.'])).toBe('Page one.\n\n---\n\nPage two.');
});

test('buildChapterRequestBody puts joined page text in the user content', () => {
  const body = buildChapterRequestBody(['Once upon a time.', 'The end.']);
  expect(body.contents).toEqual([{
    role: 'user',
    parts: [{ text: 'Once upon a time.\n\n---\n\nThe end.' }]
  }]);
  expect(body.system_instruction.parts[0].text).toContain('導讀');
  expect(body.generationConfig.maxOutputTokens).toBe(2200);
});

test('buildChapterRequestBody truncates very long page text', () => {
  const longPage = 'a'.repeat(30000);
  const body = buildChapterRequestBody([longPage]);
  expect(body.contents[0].parts[0].text.length).toBe(20000);
});

test('callGeminiForChapter calls Gemini endpoint and returns text', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '**章節大綱**' }] } }]
    })
  });

  const result = await callGeminiForChapter('AIza-test', ['Some chapter text.']);

  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('AIza-test'),
    expect.objectContaining({ method: 'POST' })
  );
  expect(result).toBe('**章節大綱**');
});

test('callGeminiForChapter throws on API error', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: 'Invalid API key' } })
  });

  await expect(
    callGeminiForChapter('bad-key', ['text'])
  ).rejects.toThrow('Invalid API key');
});
