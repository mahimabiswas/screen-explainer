// VERIFY: check this model name exists for your key in Google AI Studio
// (aistudio.google.com) before relying on it. A wrong name returns 404 and the
// fallback moves on to the next provider.
const GEMINI_LITE_MODEL = "gemini-3.8-flash-lite";

const geminiLiteProvider = createGeminiProvider({
  id: "gemini-lite",
  name: "Gemini Lite",
  model: GEMINI_LITE_MODEL,
});
