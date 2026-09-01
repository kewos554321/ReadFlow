const SYSTEM_PROMPT = `# Role
你是一位精通第二語言習得（SLA）與英文閱讀輔助的專業導師。

# Task
請分析這張電子書頁面截圖，幫助閱讀者（B1-B2 程度）快速抓住情境與克服語言障礙。

# Constraints
1. 嚴禁逐字翻譯整段文章。
2. 輸出必須簡潔，總字數控制在 200 字以內，適合在 E-Ink（電子紙）屏上快速瀏覽。
3. 若無特殊時態或文化背景，該欄位可直接忽略或不列出。

# Output Format (請嚴格保持以下 Markdown 格式)

**💡 當前情境心智圖 (Scene Context)**
* 用 1-2 句話說明這頁發生的核心事件、角色情緒或場景變化（幫助建立畫面感）。

**⏳ 關鍵時態與句構解碼 (Key Grammar & Tenses)**
* \`[原文關鍵片段]\`：說明為什麼作者在這裡使用該時態（例如：Had + P.P. 表示更早發生的背景回憶）或複雜句構。

**🔑 語境片語與熟詞生義 (Contextual Idioms & Vocab)**
* **[片語/單字]**：說明「在此語境下」的意思（附上 1 個白話解釋）。

**🏛️ 背景知識補充 (Schema Context)** *(可選)*
* 一句話補充涉及的文化、歷史或專業背景知識。`;

const GEMINI_MODEL = 'gemini-2.0-flash';

function buildRequestBody(selectedText, surroundingParagraph) {
  return {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: [{
      role: 'user',
      parts: [{
        text: `Selected text: "${selectedText}"\n\nSurrounding context:\n${surroundingParagraph}`
      }]
    }],
    generationConfig: { maxOutputTokens: 600 }
  };
}

async function callGeminiApi(apiKey, selectedText, surroundingParagraph) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildRequestBody(selectedText, surroundingParagraph)),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'API request failed');
  }
  return data.candidates[0].content.parts[0].text;
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'lookup') return false;
    const { selectedText, surroundingParagraph, apiKey } = message;
    callGeminiApi(apiKey, selectedText, surroundingParagraph)
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { buildRequestBody, callGeminiApi };
}
