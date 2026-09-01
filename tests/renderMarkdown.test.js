const { renderMarkdown } = require('../lib/renderMarkdown.js');

test('renders bold text', () => {
  expect(renderMarkdown('**hello**')).toContain('<strong>hello</strong>');
});

test('renders inline code', () => {
  expect(renderMarkdown('`some code`')).toContain('<code>some code</code>');
});

test('renders italic text', () => {
  expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
});

test('renders bullet list items', () => {
  const result = renderMarkdown('* item one\n* item two');
  expect(result).toContain('<li>item one</li>');
  expect(result).toContain('<li>item two</li>');
});

test('escapes HTML to prevent XSS', () => {
  const result = renderMarkdown('<script>alert(1)</script>');
  expect(result).not.toContain('<script>');
  expect(result).toContain('&lt;script&gt;');
});
