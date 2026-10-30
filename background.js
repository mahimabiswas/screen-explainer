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
