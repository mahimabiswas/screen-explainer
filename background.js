// config.local.js defines GEMINI_API_KEY. It is git-ignored and never hardcoded here.
try {
  importScripts("config.local.js");
} catch (err) {
  console.error("Could not load config.local.js:", err);
}

importScripts(
  "shared/constants.js",
  "background/capture.js",
  "background/http.js",
  "background/providers/gemini.js",
  "background/providers/gemini-lite.js",
  "background/providers/groq.js",
  "background/model.js"
);

console.log("Screen Explainer service worker started");

// Open the side panel when the toolbar icon is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// The shortcut only opens the panel; capturing happens when an option is chosen there.
chrome.commands.onCommand.addListener((command, tab) => {
  console.log(`shortcut pressed: ${command}`);
  if (command !== "explain-screen" || !tab) return;

  // Must run before any await, while Chrome still counts this as a user gesture.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});

const MESSAGE_HANDLERS = {
  [MESSAGE_TYPES.CAPTURE]: async ({ mode, windowId }) => {
    await captureContext(mode, windowId);
    return {};
  },
  [MESSAGE_TYPES.ASK]: async ({ question, requestId }) => {
    const onStatus = (text) => {
      // Ignore the error when no side panel is open to receive it.
      chrome.runtime
        .sendMessage({ type: MESSAGE_TYPES.ASK_STATUS, requestId, text })
        .catch(() => {});
    };
    const { text, provider, elapsedMs } = await handleAsk(question, onStatus);
    return { answer: text, provider, elapsedMs };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message?.type];
  if (!handler) return;

  handler(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));

  // Keep the message channel open for the async reply.
  return true;
});

async function handleAsk(question, onStatus) {
  const { [STORAGE_KEYS.LATEST_CONTEXT]: context } = await chrome.storage.session.get(
    STORAGE_KEYS.LATEST_CONTEXT
  );
  if (!context) {
    throw new Error("Nothing captured yet. Choose an option above first.");
  }
  return askModel(context, question, { onStatus });
}
