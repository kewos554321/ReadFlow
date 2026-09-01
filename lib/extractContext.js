const BLOCK_TAGS = ['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'TD'];

function isBlockElement(el) {
  return BLOCK_TAGS.includes(el.tagName);
}

function extractContext() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  if (!selectedText || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  let node = range.commonAncestorContainer;

  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
  while (node && !isBlockElement(node)) node = node.parentNode;

  const surroundingParagraph = node
    ? (node.innerText || node.textContent || '').trim().slice(0, 500)
    : selectedText;

  return { selectedText, surroundingParagraph };
}

if (typeof module !== 'undefined') {
  module.exports = { extractContext, isBlockElement };
}
