const GEMINI_MODEL = 'gemini-3.6-flash';

const CHAPTER_SYSTEM_PROMPT = `# Role
你是一位精通第二語言習得（SLA）與英文閱讀輔助的專業導師。

# Task
讀者即將閱讀以下這段內容（可能橫跨多頁），請在他們開始細讀前，
提供一份「深入導讀」，幫助他們掌握大綱，並提前掌握可能造成閱讀
障礙的生字與文法——內容需要有足夠的細節與例子，不能只用一句話
籠統帶過。

# Constraints
1. 大綱部分嚴禁劇透結局或關鍵轉折，只描述場景/主題，不描述結果。
2. 生字與文法各挑選對 B1-B2 程度讀者最有幫助的 3-5 個重點，但每
   個項目都要有足夠深度：不能只給一個中文翻譯就結束。
3. 輸出雖然要有深度，但仍須保持精簡有重點，避免無意義的重複贅字，
   適合在 E-Ink 螢幕上快速瀏覽。

# Output Format（請嚴格保持以下 Markdown 格式）

**📖 章節大綱 (Outline)**
* 4-6 句話說明這段內容的場景、主題、涉及的人物或論點，以及這段
  內容在整體脈絡中的作用（例如：是開場鋪陳、論證的轉折，還是案例
  佐證）。

**📚 困難生字 (Difficult Vocabulary)**
* **[單字]**（詞性）：在此語境下的意思（附白話解釋），並引用原文
  中的例句或改寫成更簡單的說法，說明這個字實際上是怎麼被使用的。

**📝 困難文法 (Difficult Grammar)**
* \`[原文關鍵片段]\`：詳細說明句構或時態為何值得注意、可以怎麼拆解
  理解，並視情況提供一個更口語化的改寫版本幫助對照。`;

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
    generationConfig: { maxOutputTokens: 2200 }
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
