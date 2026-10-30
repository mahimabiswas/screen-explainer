console.log("Side panel loaded");

const img = document.getElementById("screenshot");

function showScreenshot(dataUrl) {
  if (!dataUrl) return;
  img.src = dataUrl;
  img.hidden = false;
}

// Show whatever was captured before the panel opened.
chrome.storage.session.get("latestScreenshot").then(({ latestScreenshot }) => {
  showScreenshot(latestScreenshot);
});

// Update live when a new screenshot is saved.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes.latestScreenshot) {
    showScreenshot(changes.latestScreenshot.newValue);
  }
});
