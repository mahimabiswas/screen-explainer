const MODEL = "gemini-3.8-flash";

// config.local.js defines GEMINI_API_KEY. It is git-ignored and never hardcoded here.
try {
  importScripts("config.local.js");
} catch (err) {
  console.error("Could not load config.local.js:", err);
}

console.log("Screen Explainer service worker started");

// Open the side panel when the toolbar icon is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log(`shortcut pressed: ${command}`);
  if (command !== "explain-screen" || !tab) return;

  // Must run before any await, while Chrome still counts this as a user gesture.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    await chrome.storage.session.set({ latestScreenshot: dataUrl });
  } catch (err) {
    console.error("Screenshot failed:", err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "ask") return;

  handleAsk(message.question)
    .then((answer) => sendResponse({ answer }))
    .catch((err) => sendResponse({ error: err.message }));

  // Keep the message channel open for the async reply.
  return true;
});

async function handleAsk(question) {
  const { latestScreenshot } = await chrome.storage.session.get("latestScreenshot");
  if (!latestScreenshot) {
    throw new Error("No screenshot yet. Press Alt+Shift+E on a page first.");
  }
  return askModel(latestScreenshot, question);
}

// Sends one image and one question to the model and returns the answer text.
// Swap the body of this function to change providers.
async function askModel(imageDataUrl, question) {
  if (typeof GEMINI_API_KEY === "undefined" || !GEMINI_API_KEY) {
    throw new Error("No API key. Define GEMINI_API_KEY in config.local.js and reload the extension.");
  }

  const base64 = imageDataUrl.replace(/^data:image\/png;base64,/, "");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: "image/png", data: base64 } },
              { text: question },
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error?.message || response.statusText;
    throw new Error(`Gemini API error (${response.status}): ${detail}`);
  }

  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) {
    const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason;
    throw new Error(`The model returned no answer${reason ? ` (${reason})` : ""}.`);
  }
  return text;
}
