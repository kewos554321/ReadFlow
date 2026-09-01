const { extractContext, isBlockElement } = require('../lib/extractContext.js');

test('returns null when no text is selected', () => {
  window.getSelection = jest.fn(() => ({
    toString: () => '',
    rangeCount: 0,
  }));
  expect(extractContext()).toBeNull();
});

test('extracts selectedText from window.getSelection', () => {
  document.body.innerHTML = '<p>He was an ephemeral figure in history.</p>';
  const p = document.querySelector('p');

  window.getSelection = jest.fn(() => ({
    toString: () => 'ephemeral',
    rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: p.firstChild }),
  }));

  const result = extractContext();
  expect(result.selectedText).toBe('ephemeral');
});

test('extracts surrounding paragraph from block ancestor', () => {
  document.body.innerHTML = '<p>He was an ephemeral figure in history.</p>';
  const p = document.querySelector('p');

  window.getSelection = jest.fn(() => ({
    toString: () => 'ephemeral',
    rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: p.firstChild }),
  }));

  const result = extractContext();
  expect(result.surroundingParagraph).toContain('ephemeral figure in history');
});

test('isBlockElement returns true for P, DIV, SECTION', () => {
  expect(isBlockElement({ tagName: 'P' })).toBe(true);
  expect(isBlockElement({ tagName: 'DIV' })).toBe(true);
  expect(isBlockElement({ tagName: 'SECTION' })).toBe(true);
});

test('isBlockElement returns false for A, EM', () => {
  expect(isBlockElement({ tagName: 'A' })).toBe(false);
  expect(isBlockElement({ tagName: 'EM' })).toBe(false);
});
