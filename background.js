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
  "background/model.js",
  "background/chat.js"
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
  [MESSAGE_TYPES.ASK]: ({ question, requestId }) => askInChat(question, statusSender(requestId)),
  [MESSAGE_TYPES.RETRY]: ({ requestId }) => retryInChat(statusSender(requestId)),
  [MESSAGE_TYPES.NEW_CHAT]: async () => {
    await clearChat();
    return {};
  },
};

// Progress updates for the side panel that sent requestId.
function statusSender(requestId) {
  return (text) => {
    // Ignore the error when no side panel is open to receive it.
    chrome.runtime
      .sendMessage({ type: MESSAGE_TYPES.ASK_STATUS, requestId, text })
      .catch(() => {});
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message?.type];
  if (!handler) return;

  handler(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));

  // Keep the message channel open for the async reply.
  return true;
});
