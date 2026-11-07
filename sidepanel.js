console.log("Side panel loaded");

const modeButtons = document.getElementById("mode-buttons");
const captureStatus = document.getElementById("capture-status");
const preview = document.getElementById("preview");
const previewMeta = document.getElementById("preview-meta");
const previewImage = document.getElementById("preview-image");
const previewText = document.getElementById("preview-text");

const messagesEl = document.getElementById("messages");
const newChatButton = document.getElementById("new-chat");
const chatError = document.getElementById("chat-error");
const chatErrorText = document.getElementById("chat-error-text");
const retryButton = document.getElementById("retry");
const chatStatus = document.getElementById("chat-status");
const contextLine = document.getElementById("context-line");
const lookAgainButton = document.getElementById("look-again");
const form = document.getElementById("ask-form");
const questionInput = document.getElementById("question");
const askButton = document.getElementById("ask-button");

// Mirrors of storage.session, kept current by storage.onChanged.
let chatHistory = [];
let latestContext = null;

// Panel-only state for the request in progress.
let waiting = false;
let lastError = null;
// Id of the request in progress, so status updates meant for another panel are ignored.
let currentRequestId = null;

function setMessage(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function modeFor(modeId) {
  return CAPTURE_MODES.find((mode) => mode.id === modeId);
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---- Capture ----

// Renders whatever a capturer produced: an image, text, or both.
function showContext(context) {
  if (!context) return;

  let meta = `${modeFor(context.mode)?.label ?? context.mode}, captured ${new Date(context.capturedAt).toLocaleTimeString()}`;
  if (context.text) meta += `, ${context.text.length.toLocaleString()} characters`;
  previewMeta.textContent = meta;

  previewImage.hidden = !context.imageDataUrl;
  if (context.imageDataUrl) previewImage.src = context.imageDataUrl;

  previewText.hidden = !context.text;
  previewText.textContent = context.text ?? "";

  preview.hidden = false;
}

function setModeButtonsDisabled(disabled) {
  for (const button of modeButtons.querySelectorAll("button")) {
    button.disabled = disabled;
  }
  lookAgainButton.disabled = disabled;
}

async function capture(mode) {
  setModeButtonsDisabled(true);
  setMessage(captureStatus, `Capturing ${mode.label.toLowerCase()}...`);

  try {
    const { id: windowId } = await chrome.windows.getCurrent();
    const reply = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.CAPTURE,
      mode: mode.id,
      windowId,
    });
    if (reply?.error) {
      setMessage(captureStatus, `Error: ${reply.error}`, true);
    } else {
      // The preview itself updates through storage.onChanged below.
      setMessage(captureStatus, "");
    }
  } catch (err) {
    setMessage(captureStatus, `Error: ${err.message}`, true);
  } finally {
    setModeButtonsDisabled(false);
  }
}

for (const mode of CAPTURE_MODES) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = mode.label;
  button.addEventListener("click", () => capture(mode));
  modeButtons.append(button);
}

// "Look again" takes a fresh screenshot; it's attached to the next question.
lookAgainButton.addEventListener("click", () => capture(modeFor("screen")));

// ---- Chat rendering ----

function renderChat() {
  messagesEl.replaceChildren(...chatHistory.map(renderTurn));
  if (waiting) {
    messagesEl.append(renderBubble("assistant", "Thinking...", ""));
  }

  const unanswered = chatHistory.at(-1)?.role === "user";
  chatError.hidden = waiting || !unanswered;
  chatErrorText.textContent = lastError
    ? `Error: ${lastError}`
    : "This question hasn't been answered yet.";

  renderContextLine();
  askButton.disabled = waiting;
  retryButton.disabled = waiting;
  newChatButton.disabled = waiting;

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderTurn(turn) {
  if (turn.role === "assistant") {
    return renderBubble("assistant", turn.text, `Answered by ${turn.provider}`);
  }
  let meta = "";
  if (turn.pageText) {
    meta = `With selected text from ${formatTime(turn.capturedAt)}`;
  } else if (turn.capturedAt) {
    meta = `With screenshot from ${formatTime(turn.capturedAt)}`;
  }
  return renderBubble("user", turn.text, meta);
}

function renderBubble(role, text, meta) {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;

  const body = document.createElement("div");
  body.className = "message-text";
  body.textContent = text;
  bubble.append(body);

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.textContent = meta;
    bubble.append(metaEl);
  }
  return bubble;
}

// "Using screenshot from 10:42", plus a note if it hasn't been sent yet.
function renderContextLine() {
  if (!latestContext) {
    contextLine.textContent = "Nothing captured yet.";
    return;
  }
  const noun = modeFor(latestContext.mode)?.noun ?? "capture";
  const sent = chatHistory.some((turn) => turn.capturedAt === latestContext.capturedAt);
  contextLine.textContent =
    `Using ${noun} from ${formatTime(latestContext.capturedAt)}` +
    (sent ? "" : " (sent with your next question)");
}

// ---- Chat actions ----

// Sends ASK or RETRY and tracks its progress. The user turn and the answer
// arrive through storage.onChanged; only errors and timing come back here.
async function sendChatRequest(type, payload = {}) {
  const requestId = crypto.randomUUID();
  currentRequestId = requestId;
  waiting = true;
  lastError = null;
  chatStatus.textContent = "";
  renderChat();

  try {
    const reply = await chrome.runtime.sendMessage({ type, requestId, ...payload });
    if (reply?.error) {
      lastError = reply.error;
      chatStatus.textContent = "";
    } else if (reply?.discarded) {
      chatStatus.textContent = "";
    } else {
      chatStatus.textContent = `Answered by ${reply.provider} in ${(reply.elapsedMs / 1000).toFixed(1)}s`;
    }
  } catch (err) {
    lastError = err.message;
    chatStatus.textContent = "";
  } finally {
    if (currentRequestId === requestId) currentRequestId = null;
    waiting = false;
    renderChat();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question || waiting) return;
  questionInput.value = "";
  sendChatRequest(MESSAGE_TYPES.ASK, { question });
});

retryButton.addEventListener("click", () => sendChatRequest(MESSAGE_TYPES.RETRY));

newChatButton.addEventListener("click", async () => {
  lastError = null;
  chatStatus.textContent = "";
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.NEW_CHAT });
  } catch (err) {
    lastError = err.message;
    renderChat();
  }
});

// Fallback progress from the service worker, shown in the small grey line.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MESSAGE_TYPES.ASK_STATUS && message.requestId === currentRequestId) {
    chatStatus.textContent = message.text;
  }
});

// ---- Storage sync ----

// Load what's already there when the panel opens.
chrome.storage.session
  .get([STORAGE_KEYS.LATEST_CONTEXT, STORAGE_KEYS.CHAT_HISTORY])
  .then((items) => {
    latestContext = items[STORAGE_KEYS.LATEST_CONTEXT] ?? null;
    chatHistory = items[STORAGE_KEYS.CHAT_HISTORY] ?? [];
    showContext(latestContext);
    renderChat();
  });

// Update live when the service worker saves a capture or a chat turn.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") return;

  const contextChange = changes[STORAGE_KEYS.LATEST_CONTEXT];
  if (contextChange) {
    latestContext = contextChange.newValue ?? null;
    showContext(latestContext);
  }
  const historyChange = changes[STORAGE_KEYS.CHAT_HISTORY];
  if (historyChange) chatHistory = historyChange.newValue ?? [];

  if (contextChange || historyChange) renderChat();
});
