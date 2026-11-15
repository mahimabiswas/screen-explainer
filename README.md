# Screen Explainer

A Chrome extension that explains what's on your screen. Press a shortcut, capture the page or some selected text, and ask about it in a side panel.

## Demo

https://github.com/user-attachments/assets/35462c9f-7675-4083-add6-d5d4e4bc35bd

## Features

- **Alt+Shift+E** (Option+Shift+E on a Mac) opens a side panel next to the page
- Capture the **current screen** or your **selected text**, and use **Look again** for a fresh screenshot mid-conversation
- Multi-turn chat with formatted answers (lists, code, tables, links) and a copy button
- Falls back from Gemini to Gemini Lite to Groq when a model is busy, rate-limited or down
- Light and dark themes, keyboard friendly

## Quick start

You need Chrome 116 or newer and at least one free API key: [Gemini](https://aistudio.google.com/app/apikey) or [Groq](https://console.groq.com/keys). With both, it can fall back from one to the other.

1. Clone the repo:
   ```bash
   git clone https://github.com/mahimabiswas/screen-explainer.git
   ```
2. In the project folder, next to `manifest.json`, create `config.local.js`:
   ```js
   const GEMINI_API_KEY = "your-gemini-key";
   const GROQ_API_KEY = "your-groq-key"; // use "" if you only have one key
   ```
   It's git-ignored, so your keys stay local.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the project folder.
4. Pin the extension. If Alt+Shift+E doesn't work, set the shortcut at `chrome://extensions/shortcuts`.
5. On any web page, press the shortcut, choose **Current screen** or **Selected text**, and ask a question.

After changing the code or your keys, click reload on the extension's card in `chrome://extensions`.

## How it works

```
side panel  ──capture / ask──▶  service worker
    ▲                             ├─ capture.js   screenshot or selected text
    │                             ├─ chat.js      conversation history
    │                             └─ model.js     retries + fallback
    │                                  ├─ providers/gemini.js
    │                                  ├─ providers/gemini-lite.js
    │                                  └─ providers/groq.js
    └──────── chrome.storage.session (capture + chat) ◀──┘
```

The service worker does the work: capturing, keeping the conversation, and calling the models. The side panel just shows what's in storage and sends requests. Captures and chat history live in `chrome.storage.session`, so the panel always reloads the right state, even if it was closed during a request.

## Engineering decisions

**Opening the panel from a shortcut.** Chrome only lets you open the side panel as a direct result of a user action. Anything after an `await` no longer counts. So the shortcut handler opens the panel first, synchronously, and capturing happens later when you pick an option in the panel.

**Storage instead of messages for captures.** My first instinct was to send the screenshot to the panel with `runtime.sendMessage`. The catch is that on the first press, the panel is still loading when the screenshot is ready, so there's no one listening and the message is lost. Now the worker saves the capture to `storage.session` and the panel reads it whenever it's ready.

**Fallback that knows which errors are worth retrying.** Version one simply tried Gemini, then Groq. Then I hit a run where both failed at once: Gemini returned 503 (overloaded) and Groq returned 429 (request too large). Retrying would never fix the second one.
- **The Groq error:** Groq checks `max_tokens` against its per-minute limit before running a request. I hadn't set it, so Groq assumed a huge answer. Setting `max_tokens: 400` and asking for short answers fixed it.
- **Classifying errors:** server errors and timeouts get up to 3 retries with increasing waits. Bad keys, missing models and exhausted quotas skip straight to the next provider.
- **Pausing broken providers:** a failing provider is paused for a minute, or an hour if its quota is gone. The pause times live in `storage.session`, because Chrome shuts down idle service workers and a variable would be lost.
- **Retired models:** my original model, `gemini-2.5-flash`, started returning 404 partway through the project. Model names now live in one constant per provider, and a 404 just moves on to the next provider.

**One history format for every provider.** Gemini and Groq want differently shaped requests (`model` vs `assistant` roles, different image formats). The conversation is stored in my own simple format, and each provider converts it right before sending. That's what lets Gemini answer one question and Groq the next in the same chat.

**Rendering answers safely.** Answers came through as raw Markdown, so I wrote a small renderer that builds page elements directly instead of using `innerHTML`. Any HTML the model sends shows up as plain text, and only `http(s)` links are clickable.

**Least privilege.** I used `activeTab` instead of access to every site. The cost is that the extension can only read a tab after you press the shortcut or click the icon on it. Switching tabs means pressing it again. I think that trade-off is worth it.

## Privacy

- Captures and chats stay in your browser's session storage. They're cleared by **New chat**, a reload, or closing the browser.
- Questions and captures go directly from your browser to Gemini or Groq, using your own key. There's no server in between.
- Screenshots can include sensitive things, so avoid capturing passwords, banking pages or private messages.

## Limitations and next steps

- API keys live in a file. A settings page would make setup easier.
- Screenshots are sent at full size; shrinking them would make requests faster and cheaper.
- Two timeouts on the first provider can use up the 25-second budget before the fallbacks get a turn.
- One conversation is shared across all windows.
- No streaming and no automated tests yet.
- Planned: capturing a selected area of the screen, voice input, and a Chrome Web Store release.
