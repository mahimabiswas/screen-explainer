// Loaded by both the service worker (importScripts) and the side panel (<script>).

const MESSAGE_TYPES = Object.freeze({
  CAPTURE: "capture",
  ASK: "ask",
  RETRY: "retry",
  NEW_CHAT: "newChat",
  // Service worker -> side panel progress updates while an ask is running.
  ASK_STATUS: "askStatus",
});

const STORAGE_KEYS = Object.freeze({
  LATEST_CONTEXT: "latestContext",
  PROVIDER_COOLDOWNS: "providerCooldowns",
  // Array of { role: "user"|"assistant", text, at, imageDataUrl?, pageText?,
  // capturedAt?, provider? }. See background/chat.js.
  CHAT_HISTORY: "chatHistory",
  // In chrome.storage.local (persists across browser restarts): "system" | "light" | "dark".
  THEME: "theme",
});

// Options shown in the side panel, in display order. `noun` is used in
// sentences like "Using screenshot from 10:42".
// Each id needs a matching entry in CAPTURERS (background/capture.js).
const CAPTURE_MODES = Object.freeze([
  { id: "screen", label: "Current screen", noun: "screenshot" },
  { id: "selectedText", label: "Selected text", noun: "selected text" },
]);
