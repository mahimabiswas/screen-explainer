console.log("Side panel loaded");

const modeButtons = document.getElementById("mode-buttons");
const captureStatus = document.getElementById("capture-status");
const preview = document.getElementById("preview");
const previewMeta = document.getElementById("preview-meta");
const previewImage = document.getElementById("preview-image");
const previewText = document.getElementById("preview-text");
const form = document.getElementById("ask-form");
const questionInput = document.getElementById("question");
const askButton = document.getElementById("ask-button");
const answerEl = document.getElementById("answer");
const answerSource = document.getElementById("answer-source");

function setMessage(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function labelFor(modeId) {
  return CAPTURE_MODES.find((mode) => mode.id === modeId)?.label ?? modeId;
}

// Renders whatever a capturer produced: an image, text, or both.
function showContext(context) {
  if (!context) return;

  let meta = `${labelFor(context.mode)}, captured ${new Date(context.capturedAt).toLocaleTimeString()}`;
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

// Show whatever was captured before the panel opened.
chrome.storage.session.get(STORAGE_KEYS.LATEST_CONTEXT).then((items) => {
  showContext(items[STORAGE_KEYS.LATEST_CONTEXT]);
});

// Update live when a new capture is saved.
chrome.storage.onChanged.addListener((changes, areaName) => {
  const change = changes[STORAGE_KEYS.LATEST_CONTEXT];
  if (areaName === "session" && change) showContext(change.newValue);
});

// Id of the ask in progress, so status updates meant for another panel are ignored.
let currentRequestId = null;

// Fallback progress from the service worker, shown in the small grey line.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MESSAGE_TYPES.ASK_STATUS && message.requestId === currentRequestId) {
    answerSource.textContent = message.text;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;

  askButton.disabled = true;
  setMessage(answerEl, "Thinking...");
  answerSource.textContent = "";
  const requestId = crypto.randomUUID();
  currentRequestId = requestId;

  try {
    const reply = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.ASK, question, requestId });
    if (reply?.error) {
      setMessage(answerEl, `Error: ${reply.error}`, true);
      answerSource.textContent = "";
    } else if (reply?.answer) {
      setMessage(answerEl, reply.answer);
      answerSource.textContent = `Answered by ${reply.provider} in ${(reply.elapsedMs / 1000).toFixed(1)}s`;
    } else {
      setMessage(answerEl, "Error: no reply from the extension.", true);
    }
  } catch (err) {
    setMessage(answerEl, `Error: ${err.message}`, true);
  } finally {
    if (currentRequestId === requestId) currentRequestId = null;
    askButton.disabled = false;
  }
});
