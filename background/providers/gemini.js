const GEMINI_MODEL = "gemini-3.8-flash";

// Builds a provider for any Gemini model. Used here and by gemini-lite.js.
function createGeminiProvider({ id, name, model }) {
  return {
    id,
    name,

    isConfigured() {
      return typeof GEMINI_API_KEY !== "undefined" && Boolean(GEMINI_API_KEY);
    },

    async ask({ context, question, systemInstruction, timeoutMs }) {
      const parts = [];
      if (context.imageDataUrl) {
        const { mimeType, base64 } = parseDataUrl(context.imageDataUrl);
        parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
      }
      if (context.text) {
        parts.push({ text: `Text from the page:\n\n${context.text}` });
      }
      parts.push({ text: question });

      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { "x-goog-api-key": GEMINI_API_KEY },
        {
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts }],
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

// "data:image/png;base64,AAAA" -> { mimeType: "image/png", base64: "AAAA" }
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("captured image is not a base64 data URL");
  return { mimeType: match[1], base64: match[2] };
}
