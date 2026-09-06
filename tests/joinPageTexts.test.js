const { joinPageTexts } = require('../lib/joinPageTexts.js');

test('joins multiple pages with a separator', () => {
  const result = joinPageTexts(['Page one text.', 'Page two text.']);
  expect(result).toBe('Page one text.\n\n---\n\nPage two text.');
});

test('skips empty or whitespace-only pages', () => {
  const result = joinPageTexts(['Page one.', '   ', '', 'Page two.']);
  expect(result).toBe('Page one.\n\n---\n\nPage two.');
});

test('returns empty string for an empty array', () => {
  expect(joinPageTexts([])).toBe('');
});
