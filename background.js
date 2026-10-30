console.log("Screen Explainer service worker started");

// Open the side panel when the toolbar icon is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

chrome.commands.onCommand.addListener((command) => {
  console.log(`shortcut pressed: ${command}`);
});
