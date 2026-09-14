const GEMINI_MODEL = 'gemini-3.6-flash';

const LEVEL_LABELS = {
  B1: 'B1（基礎）',
  B2: 'B1-B2（中階）',
  C1: 'C1（進階）',
};

function buildChapterSystemPrompt(level) {
  const label = LEVEL_LABELS[level] || LEVEL_LABELS.B2;
  return `# Role
你是一位精通第二語言習得（SLA）與英文閱讀輔助的專業導師。

# Task
讀者即將閱讀以下這段內容（可能橫跨多頁），請在他們開始細讀前，
提供一份「深入導讀」，幫助他們掌握大綱，並提前掌握可能造成閱讀
障礙的生字與文法——內容需要有足夠的細節與例子，不能只用一句話
籠統帶過。

# Constraints
1. scene／points 嚴禁劇透結局或關鍵轉折，只描述場景/主題，不描述結果。
2. vocab 與 grammar 各挑選對 ${label} 程度讀者最有幫助的 3-5 個重點，
   但每個項目都要有足夠深度：不能只給一個中文翻譯就結束。
3. 輸出雖然要有深度，但仍須保持精簡有重點，避免無意義的重複贅字，
   適合在小螢幕上快速瀏覽。

# Output Format
嚴格輸出符合 responseSchema 的 JSON，不要輸出任何 JSON 以外的文字：
- scene：1-2 句話說明這段內容的場景與主題。
- points：3-4 條字串，每條說明人物/論點，以及這段內容在整體脈絡中
  的作用（例如：是開場鋪陳、論證的轉折，還是案例佐證）。
- vocab：3-5 個項目，每個項目含 word（單字原形）、pos（詞性，例如
  "n." "adj." "v."）、zh（中文解釋，適合 ${label} 程度）、quote（引用
  原文例句或改寫成更簡單的說法，說明這個字實際上是怎麼被使用的）。
- grammar：3-5 個項目，每個項目含 frag（原文關鍵片段）、note（詳細
  說明句構或時態為何值得注意，可以怎麼拆解理解）、rewrite（更口語化
  的改寫版本）。`;
}

const CHAPTER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
    vocab: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          pos: { type: 'string' },
          zh: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['word', 'pos', 'zh', 'quote'],
      },
    },
    grammar: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          frag: { type: 'string' },
          note: { type: 'string' },
          rewrite: { type: 'string' },
        },
        required: ['frag', 'note', 'rewrite'],
      },
    },
  },
  required: ['scene', 'points', 'vocab', 'grammar'],
};

const CHAPTER_TEXT_CHAR_CAP = 20000;

function joinPageTexts(pages) {
  return pages.filter((p) => p && p.trim()).join('\n\n---\n\n');
}

function buildChapterRequestBody(pages, level) {
  const joined = joinPageTexts(pages).slice(0, CHAPTER_TEXT_CHAR_CAP);
  return {
    system_instruction: {
      parts: [{ text: buildChapterSystemPrompt(level) }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: joined }]
    }],
    generationConfig: {
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: CHAPTER_RESPONSE_SCHEMA,
    }
  };
}

// A parseable-but-partially-malformed structured response (a missing key,
// or a field of the wrong type) shouldn't crash the drawer downstream —
// coerce it into a shape renderTabBody/computeTabCounts can always handle.
function normalizeChapterResult(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  return {
    scene: typeof obj.scene === 'string' ? obj.scene : '',
    points: Array.isArray(obj.points) ? obj.points : [],
    vocab: Array.isArray(obj.vocab) ? obj.vocab : [],
    grammar: Array.isArray(obj.grammar) ? obj.grammar : [],
  };
}

async function callGeminiForChapter(apiKey, pages, level) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildChapterRequestBody(pages, level)),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'API request failed');
  }

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('內容過長，請減少擷取頁數後再試');
  }

  const rawText = candidate?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini 未回傳內容，請稍後再試');
  }

  let result;
  try {
    result = JSON.parse(rawText);
  } catch (e) {
    throw new Error('無法解析導讀結果，請重新分析');
  }

  return {
    result: normalizeChapterResult(result),
    usage: data.usageMetadata || null,
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'analyzeChapter') return false;
    const { pages, apiKey, level } = message;
    callGeminiForChapter(apiKey, pages, level)
      .then(({ result, usage }) => sendResponse({ result, usage }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    joinPageTexts,
    buildChapterRequestBody,
    callGeminiForChapter,
    buildChapterSystemPrompt,
    normalizeChapterResult,
    CHAPTER_RESPONSE_SCHEMA,
  };
}
