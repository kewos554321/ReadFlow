const { clampPageCount, computeTabCounts, maskApiKey, escapeHtml } = require('../content.js');

describe('clampPageCount', () => {
  test('clamps below the minimum up to 1', () => {
    expect(clampPageCount(-5)).toBe(1);
  });
  test('clamps above the maximum down to 100', () => {
    expect(clampPageCount(500)).toBe(100);
  });
  test('passes through values already in range', () => {
    expect(clampPageCount(25)).toBe(25);
  });
});

describe('computeTabCounts', () => {
  test('counts points, vocab, and grammar entries', () => {
    const result = {
      points: ['a', 'b', 'c'],
      vocab: [{ word: 'x' }, { word: 'y' }],
      grammar: [{ frag: 'z' }],
    };
    expect(computeTabCounts(result)).toEqual({ outline: 3, vocab: 2, grammar: 1 });
  });

  // background.js's callGeminiForChapter now normalizes a malformed structured
  // result before it ever reaches content.js, but this documents why
  // onCaptureFinished's sendMessage callback still wraps computeTabCounts /
  // renderDrawerResult in a try/catch as defense in depth: a result missing
  // an expected array field throws here rather than rendering nothing.
  test('throws on a malformed result missing an expected array field', () => {
    expect(() => computeTabCounts({ points: ['a'], vocab: [] })).toThrow();
  });
});

describe('maskApiKey', () => {
  test('masks the middle of a normal-length key', () => {
    expect(maskApiKey('AIzaSyABCDEF4f2c')).toBe('AIza····4f2c');
  });
  test('returns an empty string for no key', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(undefined)).toBe('');
  });
  test('returns very short keys unmasked', () => {
    expect(maskApiKey('short')).toBe('short');
  });
});

describe('escapeHtml', () => {
  test('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });
  test('passes through plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});
