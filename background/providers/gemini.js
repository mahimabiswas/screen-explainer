const GEMINI_MODEL = "gemini-3.8-flash";

// Builds a provider for any Gemini model. Used here and by gemini-lite.js.
function createGeminiProvider({ id, name, model, supportsImages = true }) {
  return {
    id,
    name,
    supportsImages,

    isConfigured() {
      return typeof GEMINI_API_KEY !== "undefined" && Boolean(GEMINI_API_KEY);
    },

    async ask({ history, systemInstruction, timeoutMs }) {
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { "x-goog-api-key": GEMINI_API_KEY },
        {
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: history.map(toGeminiContent),
        },
        { timeoutMs }
      );

      const text = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();
      if (!text) {
        const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason;
        throw new Error(`returned no answer${reason ? ` (${reason})` : ""}`);
      }
      return text;
    },
  };
}

const geminiProvider = createGeminiProvider({ id: "gemini", name: "Gemini", model: GEMINI_MODEL });

// Chat turn -> Gemini content. Gemini calls the assistant role "model".
function toGeminiContent(turn) {
  if (turn.role === "assistant") {
    return { role: "model", parts: [{ text: turn.text }] };
  }
  const parts = [];
  if (turn.imageDataUrl) {
    const { mimeType, base64 } = parseDataUrl(turn.imageDataUrl);
    parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }
  if (turn.pageText) {
    parts.push({ text: `Text from the page:\n\n${turn.pageText}` });
  }
  parts.push({ text: turn.text });
  return { role: "user", parts };
}

// "data:image/png;base64,AAAA" -> { mimeType: "image/png", base64: "AAAA" }
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("captured image is not a base64 data URL");
  return { mimeType: match[1], base64: match[2] };
}
