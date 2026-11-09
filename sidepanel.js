console.log("Side panel loaded");

const modeButtons = document.getElementById("mode-buttons");
const captureStatus = document.getElementById("capture-status");
const preview = document.getElementById("preview");
const previewMeta = document.getElementById("preview-meta");
const previewImage = document.getElementById("preview-image");
const previewText = document.getElementById("preview-text");
const previewToggle = document.getElementById("preview-toggle");
const previewLarge = document.getElementById("preview-large");
const previewLargeImage = document.getElementById("preview-large-image");

const themeSwitch = document.getElementById("theme-switch");
const conversationEl = document.getElementById("conversation");
const emptyState = document.getElementById("empty-state");
const emptyShortcut = document.getElementById("empty-shortcut");
const chatErrorDetails = document.getElementById("chat-error-details");
const chatErrorList = document.getElementById("chat-error-list");
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
// Answer times seen by this panel: { since, provider, elapsedMs }. Not stored,
// so answers from before the panel opened show their clock time instead.
const answerTimings = [];

const IS_MAC = /Mac/i.test(navigator.userAgent);

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

// ---- Theme ----

// "system" removes data-theme so the CSS follows prefers-color-scheme.
function applyTheme(choice) {
  if (choice === "light" || choice === "dark") {
    document.documentElement.dataset.theme = choice;
  } else {
    delete document.documentElement.dataset.theme;
    choice = "system";
  }
  for (const button of themeSwitch.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
  }
}

themeSwitch.addEventListener("click", (event) => {
  const choice = event.target.closest("button")?.dataset.themeChoice;
  if (!choice) return;
  applyTheme(choice);
  chrome.storage.local.set({ [STORAGE_KEYS.THEME]: choice });
});

chrome.storage.local.get(STORAGE_KEYS.THEME).then((items) => {
  applyTheme(items[STORAGE_KEYS.THEME]);
});

// ---- Capture ----

// Renders the capture chip: a thumbnail for images, the first line for text.
function showContext(context) {
  for (const button of modeButtons.querySelectorAll("button")) {
    button.classList.toggle("is-active", button.dataset.mode === context?.mode);
  }

  // Cleared (e.g. by New chat): hide the chip; the context line says "Nothing captured yet".
  if (!context) {
    preview.hidden = true;
    previewImage.removeAttribute("src");
    previewLargeImage.removeAttribute("src");
    setLargePreview(false);
    return;
  }

  const mode = modeFor(context.mode);
  const noun = mode?.noun ?? "capture";
  const label = noun.charAt(0).toUpperCase() + noun.slice(1);
  previewMeta.textContent = context.text
    ? `${label}, ${context.text.length.toLocaleString()} characters`
    : `${label}, ${formatTime(context.capturedAt)}`;

  const hasImage = Boolean(context.imageDataUrl);
  previewToggle.hidden = !hasImage;
  previewImage.hidden = !hasImage;
  lookAgainButton.hidden = !hasImage;
  if (hasImage) {
    previewImage.src = context.imageDataUrl;
    previewLargeImage.src = context.imageDataUrl;
  } else {
    setLargePreview(false);
  }

  previewText.hidden = !context.text;
  previewText.textContent = context.text ? context.text.split("\n")[0] : "";

  preview.hidden = false;
}

function setLargePreview(open) {
  previewLarge.hidden = !open;
  previewToggle.setAttribute("aria-expanded", String(open));
  previewToggle.setAttribute("aria-label", open ? "Hide larger screenshot" : "Show larger screenshot");
}

previewToggle.addEventListener("click", () => setLargePreview(previewLarge.hidden));

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
  button.dataset.mode = mode.id;
  button.addEventListener("click", () => capture(mode));
  modeButtons.append(button);
}

// "Look again" takes a fresh screenshot; it's attached to the next question.
lookAgainButton.addEventListener("click", () => capture(modeFor("screen")));

// ---- Chat rendering ----

emptyShortcut.textContent = IS_MAC
  ? "Press Option+Shift+E on any page."
  : "Press Alt+Shift+E on any page.";

function renderChat() {
  const added = renderMessages();

  emptyState.hidden = waiting || chatHistory.length > 0;

  const unanswered = chatHistory.at(-1)?.role === "user";
  chatError.hidden = waiting || !unanswered;
  // lastError is "All providers failed.\n<provider>: <reason>..." or a single line.
  const [summary, ...details] = (lastError ?? "This question hasn't been answered yet.").split("\n");
  chatErrorText.textContent = summary;
  chatErrorList.textContent = details.join("\n");
  chatErrorDetails.hidden = details.length === 0;

  renderContextLine();
  askButton.disabled = waiting;
  retryButton.disabled = waiting;
  newChatButton.disabled = waiting;

  if (added || !chatError.hidden) {
    conversationEl.scrollTop = conversationEl.scrollHeight;
  }
}

// Adds new turns and removes stale ones without rebuilding the rest, so the
// aria-live region only announces what's new and only new turns fade in.
// Returns true if anything was added.
function renderMessages() {
  const wanted = chatHistory.map((turn) => ({ key: turnKey(turn), turn }));
  if (waiting) wanted.push({ key: "pending", turn: null });
  const wantedKeys = new Set(wanted.map((item) => item.key));

  const existing = new Map();
  for (const el of [...messagesEl.children]) {
    if (wantedKeys.has(el.dataset.key)) existing.set(el.dataset.key, el);
    else el.remove();
  }

  let added = false;
  let previous = null;
  for (const { key, turn } of wanted) {
    let el = existing.get(key);
    if (el) {
      if (turn?.role === "assistant") updateMeta(el, answerMeta(turn));
    } else {
      el = turn ? renderTurn(turn) : renderBubble("assistant pending", "Thinking...", "");
      el.dataset.key = key;
      el.classList.add("is-new");
      if (previous) previous.after(el);
      else messagesEl.prepend(el);
      added = true;
    }
    previous = el;
  }
  return added;
}

function turnKey(turn) {
  return `${turn.role}-${turn.at}`;
}

function renderTurn(turn) {
  if (turn.role === "assistant") {
    return renderBubble("assistant", turn.text, answerMeta(turn));
  }
  let meta = "";
  if (turn.pageText) {
    meta = `With selected text from ${formatTime(turn.capturedAt)}`;
  } else if (turn.capturedAt) {
    meta = `With screenshot from ${formatTime(turn.capturedAt)}`;
  }
  return renderBubble("user", turn.text, meta);
}

// "Answered by Groq, 2.1s" if this panel timed it, otherwise "Answered by Groq, 14:32".
function answerMeta(turn) {
  const timing = answerTimings.findLast(
    (t) => t.provider === turn.provider && t.since <= turn.at
  );
  const when = timing ? `${(timing.elapsedMs / 1000).toFixed(1)}s` : formatTime(turn.at);
  return `Answered by ${turn.provider}, ${when}`;
}

function updateMeta(el, text) {
  const metaEl = el.querySelector(".meta");
  if (metaEl && metaEl.textContent !== text) metaEl.textContent = text;
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

// Under the capture chip: empty state, or a note if the capture hasn't been sent yet.
function renderContextLine() {
  if (!latestContext) {
    contextLine.textContent = "Nothing captured yet";
    return;
  }
  const sent = chatHistory.some((turn) => turn.capturedAt === latestContext.capturedAt);
  contextLine.textContent = sent ? "" : "Sent with your next question";
}

// ---- Chat actions ----

// Sends ASK or RETRY and tracks its progress. The user turn and the answer
// arrive through storage.onChanged; only errors and timing come back here.
async function sendChatRequest(type, payload = {}) {
  const requestId = crypto.randomUUID();
  const since = Date.now();
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
      // The time goes on the answer's meta line; the status line is empty when idle.
      answerTimings.push({ since, provider: reply.provider, elapsedMs: reply.elapsedMs });
      chatStatus.textContent = "";
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
  resizeQuestionInput();
  sendChatRequest(MESSAGE_TYPES.ASK, { question });
});

// Enter sends; Shift+Enter inserts a newline. Ignored while an IME is composing.
questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

// Grow with the text; CSS max-height caps it at about 5 lines.
function resizeQuestionInput() {
  questionInput.style.height = "auto";
  questionInput.style.height = `${questionInput.scrollHeight + 2}px`;
}

questionInput.addEventListener("input", resizeQuestionInput);

retryButton.addEventListener("click", () => sendChatRequest(MESSAGE_TYPES.RETRY));

newChatButton.addEventListener("click", async () => {
  lastError = null;
  chatStatus.textContent = "";
  setMessage(captureStatus, "");
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.NEW_CHAT });
  } catch (err) {
    lastError = err.message;
    renderChat();
  }
});

// Fallback progress from the service worker, shown in the status line.
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
  // Keep the theme in sync when it's changed in another window's panel.
  if (areaName === "local" && changes[STORAGE_KEYS.THEME]) {
    applyTheme(changes[STORAGE_KEYS.THEME].newValue);
  }
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
