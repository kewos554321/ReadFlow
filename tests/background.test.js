const {
  buildChapterRequestBody,
  callGeminiForChapter,
  joinPageTexts,
  buildChapterSystemPrompt,
  normalizeChapterResult,
} = require('../background.js');

test('joinPageTexts joins pages with a separator and skips blanks', () => {
  expect(joinPageTexts(['Page one.', '  ', 'Page two.'])).toBe('Page one.\n\n---\n\nPage two.');
});

test('buildChapterRequestBody puts joined page text in the user content', () => {
  const body = buildChapterRequestBody(['Once upon a time.', 'The end.'], 'B2');
  expect(body.contents).toEqual([{
    role: 'user',
    parts: [{ text: 'Once upon a time.\n\n---\n\nThe end.' }]
  }]);
  expect(body.system_instruction.parts[0].text).toContain('導讀');
  expect(body.generationConfig.maxOutputTokens).toBe(4096);
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseSchema).toBeDefined();
});

test('buildChapterRequestBody truncates very long page text', () => {
  const longPage = 'a'.repeat(30000);
  const body = buildChapterRequestBody([longPage], 'B2');
  expect(body.contents[0].parts[0].text.length).toBe(20000);
});

test('buildChapterSystemPrompt interpolates the requested level', () => {
  expect(buildChapterSystemPrompt('C1')).toContain('C1（進階）');
  expect(buildChapterSystemPrompt('B1')).toContain('B1（基礎）');
  expect(buildChapterSystemPrompt(undefined)).toContain('B1-B2（中階）');
});

test('callGeminiForChapter calls Gemini endpoint and returns parsed JSON with usage', async () => {
  const fakeResult = { scene: '場景', points: ['重點一'], vocab: [], grammar: [] };
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(fakeResult) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 }
    })
  });

  const result = await callGeminiForChapter('AIza-test', ['Some chapter text.'], 'B2');

  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('AIza-test'),
    expect.objectContaining({ method: 'POST' })
  );
  expect(result.result).toEqual(fakeResult);
  expect(result.usage).toEqual({ promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 });
});

test('callGeminiForChapter throws on API error', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: 'Invalid API key' } })
  });

  await expect(
    callGeminiForChapter('bad-key', ['text'], 'B2')
  ).rejects.toThrow('Invalid API key');
});

test('callGeminiForChapter throws a friendly error when the model returns invalid JSON', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'not json' }] } }],
      usageMetadata: null,
    })
  });

  await expect(
    callGeminiForChapter('AIza-test', ['text'], 'B2')
  ).rejects.toThrow('無法解析導讀結果');
});

test('callGeminiForChapter throws a friendly error when candidates is empty (e.g. a safety block)', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: [], usageMetadata: null })
  });

  await expect(
    callGeminiForChapter('AIza-test', ['text'], 'B2')
  ).rejects.toThrow('Gemini 未回傳內容');
});

test('callGeminiForChapter throws a friendly error when candidates is missing entirely', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ usageMetadata: null })
  });

  await expect(
    callGeminiForChapter('AIza-test', ['text'], 'B2')
  ).rejects.toThrow('Gemini 未回傳內容');
});

test('callGeminiForChapter throws a distinct, actionable error when Gemini truncates on MAX_TOKENS', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"scene":' }] } }],
      usageMetadata: null,
    })
  });

  await expect(
    callGeminiForChapter('AIza-test', ['text'], 'B2')
  ).rejects.toThrow('內容過長');
});

test('callGeminiForChapter normalizes a parseable-but-malformed result instead of crashing downstream', async () => {
  // scene has the wrong type, points is missing, vocab/grammar are present.
  const malformed = { scene: 123, vocab: [{ word: 'x' }], grammar: 'not-an-array' };
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(malformed) }] } }],
      usageMetadata: null,
    })
  });

  const { result } = await callGeminiForChapter('AIza-test', ['text'], 'B2');
  expect(result).toEqual({
    scene: '',
    points: [],
    vocab: [{ word: 'x' }],
    grammar: [],
  });
});

describe('normalizeChapterResult', () => {
  test('passes through an already well-formed result', () => {
    const good = { scene: 's', points: ['a'], vocab: [{ word: 'x' }], grammar: [{ frag: 'y' }] };
    expect(normalizeChapterResult(good)).toEqual(good);
  });

  test('coerces missing/wrong-typed fields to safe defaults', () => {
    expect(normalizeChapterResult({})).toEqual({ scene: '', points: [], vocab: [], grammar: [] });
    expect(normalizeChapterResult({ scene: null, points: 'x', vocab: {}, grammar: 5 }))
      .toEqual({ scene: '', points: [], vocab: [], grammar: [] });
  });

  test('handles a completely non-object input', () => {
    expect(normalizeChapterResult(null)).toEqual({ scene: '', points: [], vocab: [], grammar: [] });
    expect(normalizeChapterResult('oops')).toEqual({ scene: '', points: [], vocab: [], grammar: [] });
  });
});
