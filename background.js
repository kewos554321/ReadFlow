const GEMINI_MODEL = 'gemini-3.6-flash';

const CHAPTER_SYSTEM_PROMPT = `# Role
你是一位精通第二語言習得（SLA）與英文閱讀輔助的專業導師。

# Task
讀者即將閱讀以下這段內容（可能橫跨多頁），請在他們開始細讀前，
提供一份「導讀」，幫助他們掌握大綱並提前認識可能造成閱讀障礙的
生字與文法。

# Constraints
1. 大綱部分嚴禁劇透結局或關鍵轉折，只描述場景/主題，不描述結果。
2. 生字與文法各挑選對 B1-B2 程度讀者最有幫助的重點，不需窮舉。
3. 輸出必須簡潔，適合在 E-Ink 螢幕上快速瀏覽。

# Output Format（請嚴格保持以下 Markdown 格式）

**📖 章節大綱 (Outline)**
* 2-4 句話說明這段內容的場景、主題或涉及的人物/事件範圍。

**📚 困難生字 (Difficult Vocabulary)**
* **[單字]**：在此語境下的意思（附白話解釋）。

**📝 困難文法 (Difficult Grammar)**
* \`[原文片段]\`：說明句構或時態為何值得注意。`;

const CHAPTER_TEXT_CHAR_CAP = 20000;

function joinPageTexts(pages) {
  return pages.filter((p) => p && p.trim()).join('\n\n---\n\n');
}

function buildChapterRequestBody(pages) {
  const joined = joinPageTexts(pages).slice(0, CHAPTER_TEXT_CHAR_CAP);
  return {
    system_instruction: {
      parts: [{ text: CHAPTER_SYSTEM_PROMPT }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: joined }]
    }],
    generationConfig: { maxOutputTokens: 1500 }
  };
}

async function callGeminiForChapter(apiKey, pages) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildChapterRequestBody(pages)),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'API request failed');
  }
  return data.candidates[0].content.parts[0].text;
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'analyzeChapter') return false;
    const { pages, apiKey } = message;
    callGeminiForChapter(apiKey, pages)
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { joinPageTexts, buildChapterRequestBody, callGeminiForChapter };
}
