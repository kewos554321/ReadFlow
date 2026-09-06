function joinPageTexts(pages) {
  return pages.filter((p) => p && p.trim()).join('\n\n---\n\n');
}

if (typeof module !== 'undefined') {
  module.exports = { joinPageTexts };
}
