function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\n/g, '<br>');

  return html;
}

if (typeof module !== 'undefined') {
  module.exports = { renderMarkdown };
}
