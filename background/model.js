// Providers are tried in this order; each one is used only if the ones before it
// fail. A provider is { id, name, isConfigured(), ask({ context, question,
// systemInstruction, timeoutMs }) -> text }. To add one, create
// background/providers/<name>.js, load it in background.js, and add it here.
const PROVIDERS = [geminiProvider, geminiLiteProvider, groqProvider];

const SYSTEM_INSTRUCTION =
  "Answer concisely, in at most about 120 words, unless the user asks for more detail.";

const MAX_ATTEMPTS = 3; // per provider
const ATTEMPT_TIMEOUT_MS = 12000;
const TOTAL_BUDGET_MS = 25000; // for the whole askModel call
const MIN_ATTEMPT_MS = 2000; // don't start an attempt with less time than this left
const COOLDOWN_MS = 60 * 1000;
const HARD_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const LONG_WAIT_SECONDS = 10; // a 429 asking us to wait longer than this isn't retried

// Sends a captured context ({ imageDataUrl } and/or { text }) plus a question to
// the first provider that succeeds. onStatus(text) receives progress messages.
// Returns { text, provider, elapsedMs }.
async function askModel(context, question, { onStatus = () => {} } = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + TOTAL_BUDGET_MS;

  const configured = PROVIDERS.filter((provider) => provider.isConfigured());
  if (configured.length === 0) {
    throw new Error("No API keys found. Add GEMINI_API_KEY or GROQ_API_KEY to config.local.js and reload the extension.");
  }

  const cooldowns = await getCooldowns();
  const failures = [];
  const candidates = [];
  for (const provider of configured) {
    const until = cooldowns[provider.id] ?? 0;
    if (until > startedAt) {
      failures.push(`${provider.name}: paused after recent failures (available again in ${formatWait(until - startedAt)})`);
    } else {
      candidates.push(provider);
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i];
    const next = candidates[i + 1];

    const result = await tryProvider(provider, { context, question, deadline, onStatus });
    if (result.text) {
      return { text: result.text, provider: provider.name, elapsedMs: Date.now() - startedAt };
    }

    failures.push(`${provider.name}: ${result.error.message}`);
    if (result.cooldownMs) await setCooldown(provider.id, Date.now() + result.cooldownMs);

    if (result.outOfTime) {
      for (const skipped of candidates.slice(i + 1)) {
        failures.push(`${skipped.name}: not tried, ran out of time (${TOTAL_BUDGET_MS / 1000}s limit)`);
      }
      break;
    }
    if (next) onStatus(`${provider.name} ${result.summary}, trying ${next.name}...`);
  }

  throw new Error(`All providers failed.\n${failures.join("\n")}`);
}

// Runs one provider with retries. Returns { text } on success, or
// { error, summary, cooldownMs, outOfTime } after its last failed attempt.
async function tryProvider(provider, { context, question, deadline, onStatus }) {
  let lastError;
  let lastClass;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      return outOfTimeResult(lastError, lastClass);
    }

    try {
      const text = await provider.ask({
        context,
        question,
        systemInstruction: SYSTEM_INSTRUCTION,
        timeoutMs: Math.min(ATTEMPT_TIMEOUT_MS, remaining),
      });
      return { text };
    } catch (err) {
      lastError = err;
      lastClass = classifyError(err);
      console.log(
        `${provider.name} attempt ${attempt + 1} failed (status ${err.status ?? "none"}): ${err.message}`
      );
      if (err.status === 401 || err.status === 403) {
        console.warn(`${provider.name} returned ${err.status}; the API key is probably wrong or lacks access.`);
      }
    }

    const allowedAttempts = lastClass.retry ? lastClass.maxAttempts : 1;
    if (attempt + 1 >= allowedAttempts) break;

    const delay = Math.max(lastClass.waitMs ?? 0, 1000 * 2 ** attempt) + Math.random() * 500;
    if (Date.now() + delay + MIN_ATTEMPT_MS > deadline) {
      return outOfTimeResult(lastError, lastClass);
    }
    onStatus(`${provider.name} ${lastClass.summary}, retrying (attempt ${attempt + 2} of ${allowedAttempts})...`);
    await sleep(delay);
  }

  return { error: lastError, summary: lastClass.summary, cooldownMs: lastClass.cooldownMs };
}

function outOfTimeResult(lastError, lastClass) {
  return {
    error: lastError ?? new Error("not tried, ran out of time"),
    summary: lastClass?.summary ?? "ran out of time",
    cooldownMs: lastClass?.cooldownMs ?? 0,
    outOfTime: true,
  };
}

// Decides what to do after a failed attempt:
//   retry        try the same provider again
//   maxAttempts  total attempts allowed for this kind of error
//   waitMs       minimum wait before the retry (from the provider's own hint)
//   cooldownMs   how long to skip this provider afterwards (0 = don't)
//   summary      short phrase for status messages
function classifyError(err) {
  const { status } = err;

  if (status === undefined) {
    // Network error or timeout: transient. Anything else (e.g. an empty answer) is not.
    return err.isNetworkError
      ? { retry: true, maxAttempts: MAX_ATTEMPTS, cooldownMs: COOLDOWN_MS, summary: "is not responding" }
      : { retry: false, cooldownMs: 0, summary: "gave no answer" };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { retry: true, maxAttempts: MAX_ATTEMPTS, cooldownMs: COOLDOWN_MS, summary: "is busy" };
  }
  if (status === 429) return classifyRateLimit(err.body);
  if (status === 401 || status === 403) {
    return { retry: false, cooldownMs: COOLDOWN_MS, summary: "rejected the API key" };
  }
  if (status === 404) {
    return { retry: false, cooldownMs: COOLDOWN_MS, summary: "doesn't have that model" };
  }
  // 400 and anything else: specific to this request, so don't pause the provider.
  return { retry: false, cooldownMs: 0, summary: "rejected the request" };
}

function classifyRateLimit(body = "") {
  if (/too large|reduce max_tokens/i.test(body)) {
    // This request is over a per-request limit; a smaller one may still work.
    return { retry: false, cooldownMs: 0, summary: "says the request is too large" };
  }
  if (/limit["'\s:]*0\b|per ?day|daily|\bRPD\b|\bTPD\b/i.test(body)) {
    return { retry: false, cooldownMs: HARD_QUOTA_COOLDOWN_MS, summary: "is out of quota" };
  }

  const waitSeconds = parseRetryDelaySeconds(body);
  if (waitSeconds !== undefined && waitSeconds > LONG_WAIT_SECONDS) {
    const cooldownMs = Math.min(HARD_QUOTA_COOLDOWN_MS, Math.max(COOLDOWN_MS, waitSeconds * 1000));
    return { retry: false, cooldownMs, summary: "is rate-limited" };
  }

  // Short or unknown wait: retry once.
  return {
    retry: true,
    maxAttempts: 2,
    waitMs: waitSeconds === undefined ? undefined : waitSeconds * 1000,
    cooldownMs: COOLDOWN_MS,
    summary: "is busy",
  };
}

// Reads how long the provider asks us to wait, in seconds, from a 429 body.
// Gemini: "retryDelay": "37s". Groq: "Please try again in 1m23.5s".
function parseRetryDelaySeconds(body) {
  const gemini = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (gemini) return Number(gemini[1]);

  const groq = /try again in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?/i.exec(body);
  if (groq && (groq[1] || groq[2] || groq[3])) {
    return Number(groq[1] ?? 0) * 3600 + Number(groq[2] ?? 0) * 60 + Number(groq[3] ?? 0);
  }
  return undefined;
}

// Cooldowns live in storage.session because the service worker is shut down
// when idle, which would wipe in-memory state. Shape: { [providerId]: untilMs }.
async function getCooldowns() {
  const items = await chrome.storage.session.get(STORAGE_KEYS.PROVIDER_COOLDOWNS);
  return items[STORAGE_KEYS.PROVIDER_COOLDOWNS] ?? {};
}

async function setCooldown(providerId, untilMs) {
  const cooldowns = await getCooldowns();
  cooldowns[providerId] = untilMs;
  await chrome.storage.session.set({ [STORAGE_KEYS.PROVIDER_COOLDOWNS]: cooldowns });
}

function formatWait(ms) {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
