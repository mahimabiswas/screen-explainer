// The conversation, stored in storage.session as a provider-neutral array:
//   { role: "user" | "assistant", text, at }
//   user turns may also have:
//     imageDataUrl  screenshot sent with this turn; removed after the first successful answer
//     pageText      selected text sent with this turn
//     capturedAt    when the attached capture was taken (kept after the image is removed)
//   assistant turns also have:
//     provider      name of the provider that answered
// Each provider converts this to its own format in background/providers/.

// Bumped by New chat, so an answer that arrives after the chat was cleared is dropped.
let chatGeneration = 0;

async function getChatHistory() {
  const items = await chrome.storage.session.get(STORAGE_KEYS.CHAT_HISTORY);
  return items[STORAGE_KEYS.CHAT_HISTORY] ?? [];
}

async function saveChatHistory(history) {
  await chrome.storage.session.set({ [STORAGE_KEYS.CHAT_HISTORY]: history });
}

async function clearChat() {
  chatGeneration++;
  await chrome.storage.session.remove(STORAGE_KEYS.CHAT_HISTORY);
}

// Adds a user turn and gets an answer. If the previous question never got an
// answer, the new one replaces it so turns keep alternating user/assistant.
async function askInChat(question, onStatus) {
  const history = await getChatHistory();
  if (history.at(-1)?.role === "user") history.pop();

  const pending = await getPendingContext(history);
  history.push({
    role: "user",
    text: question,
    at: Date.now(),
    ...(pending ? attachmentFrom(pending) : {}),
  });
  await saveChatHistory(history);

  return answerLatestTurn(history, onStatus);
}

// Re-sends the last user turn after a failure.
async function retryInChat(onStatus) {
  const history = await getChatHistory();
  if (history.at(-1)?.role !== "user") {
    throw new Error("There's no unanswered question to retry.");
  }
  return answerLatestTurn(history, onStatus);
}

// Asks the model about the history (which ends with a user turn). On success,
// stores the answer and removes images from history. On failure, throws and
// leaves the user turn in place so it can be retried.
async function answerLatestTurn(history, onStatus) {
  const generation = chatGeneration;
  const { text, provider, elapsedMs } = await askModel(history, { onStatus });
  if (generation !== chatGeneration) return { provider, elapsedMs, discarded: true };

  const updated = history.map(withoutImage);
  updated.push({ role: "assistant", text, provider, at: Date.now() });
  await saveChatHistory(updated);
  return { provider, elapsedMs };
}

// The latest capture, if no turn in this chat has used it yet.
async function getPendingContext(history) {
  const items = await chrome.storage.session.get(STORAGE_KEYS.LATEST_CONTEXT);
  const context = items[STORAGE_KEYS.LATEST_CONTEXT];
  if (!context) return null;
  return history.some((turn) => turn.capturedAt === context.capturedAt) ? null : context;
}

function attachmentFrom(context) {
  const attachment = { capturedAt: context.capturedAt };
  if (context.imageDataUrl) attachment.imageDataUrl = context.imageDataUrl;
  if (context.text) attachment.pageText = context.text;
  return attachment;
}

function withoutImage(turn) {
  const copy = { ...turn };
  delete copy.imageDataUrl;
  return copy;
}
