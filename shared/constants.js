// Loaded by both the service worker (importScripts) and the side panel (<script>).

const MESSAGE_TYPES = Object.freeze({
  CAPTURE: "capture",
  ASK: "ask",
  // Service worker -> side panel progress updates while an ask is running.
  ASK_STATUS: "askStatus",
});

const STORAGE_KEYS = Object.freeze({
  LATEST_CONTEXT: "latestContext",
  PROVIDER_COOLDOWNS: "providerCooldowns",
});

// Options shown in the side panel, in display order.
// Each id needs a matching entry in CAPTURERS (background/capture.js).
const CAPTURE_MODES = Object.freeze([
  { id: "screen", label: "Current screen" },
  { id: "selectedText", label: "Selected text" },
]);
