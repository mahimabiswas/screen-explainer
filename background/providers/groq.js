// Must be a Groq model that accepts images: https://console.groq.com/docs/vision
const GROQ_MODEL = "qwen/qwen3.8-27b";
// Groq checks max_tokens against its output-tokens-per-minute limit before
// running a request, so keep this well under the free tier's 1,000 OTPM.
const GROQ_MAX_TOKENS = 400;

const groqProvider = {
  id: "groq",
  name: "Groq",

  isConfigured() {
    return typeof GROQ_API_KEY !== "undefined" && Boolean(GROQ_API_KEY);
  },

  async ask({ context, question, systemInstruction, timeoutMs }) {
    // OpenAI-compatible chat format; images go in as data URLs unchanged.
    const content = [];
    if (context.imageDataUrl) {
      content.push({ type: "image_url", image_url: { url: context.imageDataUrl } });
    }
    if (context.text) {
      content.push({ type: "text", text: `Text from the page:\n\n${context.text}` });
    }
    content.push({ type: "text", text: question });

    const data = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: `Bearer ${GROQ_API_KEY}` },
      {
        model: GROQ_MODEL,
        max_tokens: GROQ_MAX_TOKENS,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content },
        ],
      },
      { timeoutMs }
    );

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      const reason = data.choices?.[0]?.finish_reason;
      throw new Error(`returned no answer${reason ? ` (${reason})` : ""}`);
    }
    return text;
  },
};
