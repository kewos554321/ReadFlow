const {
  clampPageCount, clampVocabCap, computeTabCounts, maskApiKey, escapeHtml, buildWordRegex, buildFragRegex,
  collectTextNodes, findAllMatchRanges, wrapTextRanges,
  providerLabel, pickApiKeyForProvider,
} = require('../content.js');

describe('providerLabel', () => {
  test('labels gemini', () => {
    expect(providerLabel('gemini')).toBe('Gemini');
  });
  test('labels deepseek', () => {
    expect(providerLabel('deepseek')).toBe('DeepSeek');
  });
});

describe('pickApiKeyForProvider', () => {
  test('returns the geminiApiKey when present', () => {
    expect(pickApiKeyForProvider('gemini', { geminiApiKey: 'AIza-new', apiKey: 'AIza-legacy' })).toBe('AIza-new');
  });

  test('falls back to the legacy apiKey field for gemini when geminiApiKey is unset', () => {
    expect(pickApiKeyForProvider('gemini', { apiKey: 'AIza-legacy' })).toBe('AIza-legacy');
  });

  test('returns the deepseekApiKey when present', () => {
    expect(pickApiKeyForProvider('deepseek', { deepseekApiKey: 'sk-test' })).toBe('sk-test');
  });

  test('returns empty string for deepseek when unset, with no legacy fallback', () => {
    expect(pickApiKeyForProvider('deepseek', { apiKey: 'AIza-legacy' })).toBe('');
  });
});

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

describe('clampVocabCap', () => {
  test('clamps below the minimum up to 5', () => {
    expect(clampVocabCap(0)).toBe(5);
  });
  test('clamps above the maximum down to 30', () => {
    expect(clampVocabCap(100)).toBe(30);
  });
  test('passes through values already in range', () => {
    expect(clampVocabCap(15)).toBe(15);
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

// Gemini gives vocab words in their dictionary/base form ("boat"), but the
// actual book text often contains an inflected form ("boats", "walked",
// "walking") — a strict \bword\b match silently fails to highlight those
// (no word boundary exists between "t" and "s" in "boats"), so 畫記 looks
// like it does nothing even though this is the right frame.
describe('buildWordRegex', () => {
  test('matches the exact base word', () => {
    expect('The boat left.'.match(buildWordRegex('boat'))).toEqual(['boat']);
  });

  test('matches a plural -s form and captures the full inflected word', () => {
    const regex = buildWordRegex('boat');
    expect(regex.test('The boats left.')).toBe(true);
    regex.lastIndex = 0;
    expect('The boats left.'.match(regex)).toEqual(['boats']);
  });

  test('matches an -es plural form', () => {
    const regex = buildWordRegex('watch');
    expect('She watches the door.'.match(regex)).toEqual(['watches']);
  });

  test('matches -ed and -ing verb inflections', () => {
    expect('He walked home.'.match(buildWordRegex('walk'))).toEqual(['walked']);
    expect('He is walking home.'.match(buildWordRegex('walk'))).toEqual(['walking']);
  });

  test('is case-insensitive', () => {
    expect('Boats left the harbour.'.match(buildWordRegex('boat'))).toEqual(['Boats']);
  });

  test('does not match the word as a substring of an unrelated longer word', () => {
    expect('the boathouse door'.match(buildWordRegex('boat'))).toBeNull();
  });

  test('escapes regex-special characters in the word', () => {
    expect(() => buildWordRegex('a.b*c')).not.toThrow();
    expect('literal a.b*c here'.match(buildWordRegex('a.b*c'))).toEqual(['a.b*c']);
  });
});

// A grammar frag is a multi-word phrase quoted from the original text, not
// a dictionary word — buildFragRegex tolerates the whitespace differences
// that come from a page reflowing a quoted phrase across a line wrap, but
// still requires the literal words themselves to match.
describe('buildFragRegex', () => {
  test('matches the exact phrase', () => {
    expect('their ropes slack in the water'.match(buildFragRegex('ropes slack in the water'))).toEqual(['ropes slack in the water']);
  });

  test('tolerates a line-wrap inserting different whitespace between words', () => {
    const pageText = 'their ropes slack\n   in the water, still.';
    const regex = buildFragRegex('ropes slack in the water');
    expect(regex.test(pageText)).toBe(true);
  });

  test('is case-insensitive', () => {
    expect('Ropes Slack in the water.'.match(buildFragRegex('ropes slack in the water'))).toEqual(['Ropes Slack in the water']);
  });

  test('does not match when a word in the phrase is missing from the text', () => {
    expect('ropes taut in the water'.match(buildFragRegex('ropes slack in the water'))).toBeNull();
  });

  // Gemini's own grammar prompt (background.js) allows quoting a long
  // sentence's key part while skipping its middle with "..." — confirmed
  // live against a real book: "Through a broad multiplicity of historical
  // examples, they show how institutional developments... have had
  // enormous consequences." never appears verbatim in the source (the
  // actual sentence has "sometimes based on very accidental
  // circumstances," in the gap) — a strict contiguous match can never
  // find that, no matter how well node-splitting is handled, since whole
  // words are genuinely missing from the frag, not just whitespace.
  test('treats a literal "..." in the frag as a gap that can contain other text', () => {
    const source = 'they show how institutional developments, sometimes based on very accidental circumstances, have had enormous consequences.';
    const regex = buildFragRegex('institutional developments... have had enormous consequences');
    expect(regex.test(source)).toBe(true);
  });

  test('also treats a real ellipsis character (…) as a gap', () => {
    const source = 'the start of it and then, after a long detour, the end of it';
    const regex = buildFragRegex('start of it … end of it');
    expect(regex.test(source)).toBe(true);
  });

  test('an elided frag still requires each side to match literally', () => {
    const source = 'the start of it and then the finish of it';
    const regex = buildFragRegex('start of it ... end of it');
    expect(regex.test(source)).toBe(false);
  });

  test('a frag with no ellipsis is unaffected (no wildcard inserted)', () => {
    expect('ropes slack in the water'.match(buildFragRegex('ropes slack in the water'))).toEqual(['ropes slack in the water']);
  });

  test('escapes regex-special characters in the phrase', () => {
    expect(() => buildFragRegex('a (b) c')).not.toThrow();
    expect('literal a (b) c here'.match(buildFragRegex('a (b) c'))).toEqual(['a (b) c']);
  });
});

// Play Books (and similar paginated readers) commonly wrap each word/line in
// its own element for layout control, which splits what looks like one run
// of text into many DOM text nodes. A single vocab word usually still fits
// inside one such node, but a multi-word grammar frag almost never does —
// that's exactly why grammar 畫記 silently did nothing while vocab worked:
// the old code tested/split each text node independently, so a match that
// spans a node boundary was never found. These three functions replace that
// per-node approach with "search the whole page's text as one string, then
// map the match back onto however many nodes it actually spans."
function textNodesOf(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

describe('collectTextNodes', () => {
  test('returns text nodes in document order across nested elements', () => {
    document.body.innerHTML = '<p>a<span>b</span>c</p><p>d</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.textContent)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('findAllMatchRanges', () => {
  test('finds every non-overlapping match in the text', () => {
    const ranges = findAllMatchRanges(buildWordRegex('boat'), 'the boat and another boat');
    expect(ranges).toEqual([
      { start: 4, end: 8 },
      { start: 21, end: 25 },
    ]);
  });

  test('returns an empty array when there is no match', () => {
    expect(findAllMatchRanges(buildWordRegex('boat'), 'no such word here')).toEqual([]);
  });
});

describe('wrapTextRanges', () => {
  function wrap(text) {
    const span = document.createElement('span');
    span.className = 'hit';
    span.textContent = text;
    return span;
  }

  test('wraps a range fully contained in one text node', () => {
    document.body.innerHTML = '<p>hello world</p>';
    wrapTextRanges(textNodesOf(document.body), [{ start: 6, end: 11 }], wrap);
    expect(document.body.querySelector('p').innerHTML).toBe('hello <span class="hit">world</span>');
  });

  test('wraps a range that spans two sibling text nodes, one wrapper per original node', () => {
    document.body.innerHTML = '<span>man</span><span>made institutions</span> here';
    const nodes = textNodesOf(document.body);
    const full = nodes.map((n) => n.textContent).join('');
    const start = full.indexOf('manmade');
    wrapTextRanges(nodes, [{ start, end: start + 'manmade institutions'.length }], wrap);
    expect(document.body.textContent).toBe('manmade institutions here');
    expect(document.body.querySelectorAll('span.hit').length).toBe(2);
  });

  test('wraps a range that starts and ends partway through different nodes, leaving the rest as plain text', () => {
    document.body.innerHTML = '<span>prefix manmade</span><span> institutions suffix</span>';
    const nodes = textNodesOf(document.body);
    const full = nodes.map((n) => n.textContent).join('');
    const start = full.indexOf('manmade');
    const end = start + 'manmade institutions'.length;
    wrapTextRanges(nodes, [{ start, end }], wrap);
    expect(document.body.textContent).toBe('prefix manmade institutions suffix');
    const marked = Array.from(document.body.querySelectorAll('span.hit')).map((s) => s.textContent).join('');
    expect(marked).toBe('manmade institutions');
  });

  test('wraps two separate matches inside the same single text node in one pass', () => {
    document.body.innerHTML = '<p>a boat and another boat sail</p>';
    const nodes = textNodesOf(document.body);
    const full = nodes.map((n) => n.textContent).join('');
    const ranges = findAllMatchRanges(buildWordRegex('boat'), full);
    wrapTextRanges(nodes, ranges, wrap);
    expect(document.body.querySelectorAll('span.hit').length).toBe(2);
    expect(document.body.textContent).toBe('a boat and another boat sail');
  });

  test('does nothing when given an empty ranges list', () => {
    document.body.innerHTML = '<p>hello world</p>';
    wrapTextRanges(textNodesOf(document.body), [], wrap);
    expect(document.body.querySelector('p').innerHTML).toBe('hello world');
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
