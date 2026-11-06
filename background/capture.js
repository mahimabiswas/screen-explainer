// Capture modes. Each capturer takes the active tab and returns the content it
// captured: { imageDataUrl } for images, { text } for text.
// To add a mode, add a capturer here and an entry in CAPTURE_MODES.
const CAPTURERS = {
  screen: captureScreen,
  selectedText: captureSelectedText,
};

// Runs the capturer for `mode` on the active tab of `windowId` and saves the
// result to storage.session, where the side panel picks it up.
async function captureContext(mode, windowId) {
  const capturer = CAPTURERS[mode];
  if (!capturer) throw new Error(`Unknown capture option: ${mode}`);

  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab) throw new Error("No active tab found in this window.");

  let content;
  try {
    content = await capturer(tab);
  } catch (err) {
    throw new Error(describeCaptureError(err));
  }

  const context = { mode, ...content, capturedAt: Date.now() };
  await chrome.storage.session.set({ [STORAGE_KEYS.LATEST_CONTEXT]: context });
  return context;
}

async function captureScreen(tab) {
  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });
  return { imageDataUrl };
}

async function captureSelectedText(tab) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.getSelection().toString(),
  });
  const text = (result?.result ?? "").trim();
  if (!text) {
    throw new Error("No text is selected. Highlight some text on the page, then choose Selected text again.");
  }
  return { text };
}

// Turns Chrome's capture and scripting errors into messages a person can act on.
function describeCaptureError(err) {
  const message = err?.message || String(err);
  if (/gallery|webstore|chromewebstore/i.test(message)) {
    return "Chrome doesn't let extensions read the Chrome Web Store.";
  }
  if (/(chrome|chrome-extension|edge|devtools|about):/i.test(message)) {
    return "Chrome doesn't let extensions read browser pages like chrome:// or other extensions' pages.";
  }
  if (/activeTab|Cannot access contents|must request permission/i.test(message)) {
    return "No access to this tab. Press Alt+Shift+E on this tab, then try again.";
  }
  if (/error page/i.test(message)) {
    return "This tab is showing an error page, so there's nothing to capture.";
  }
  return message;
}
