console.log("Side panel loaded");

const img = document.getElementById("screenshot");
const form = document.getElementById("ask-form");
const questionInput = document.getElementById("question");
const askButton = document.getElementById("ask-button");
const answerEl = document.getElementById("answer");

function showScreenshot(dataUrl) {
  if (!dataUrl) return;
  img.src = dataUrl;
  img.hidden = false;
}

function showAnswer(text, isError = false) {
  answerEl.textContent = text;
  answerEl.classList.toggle("error", isError);
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;

  askButton.disabled = true;
  showAnswer("Thinking...");

  try {
    const reply = await chrome.runtime.sendMessage({ type: "ask", question });
    if (reply?.error) {
      showAnswer(`Error: ${reply.error}`, true);
    } else {
      showAnswer(reply?.answer ?? "Error: no reply from the extension.", !reply?.answer);
    }
  } catch (err) {
    showAnswer(`Error: ${err.message}`, true);
  } finally {
    askButton.disabled = false;
  }
});
