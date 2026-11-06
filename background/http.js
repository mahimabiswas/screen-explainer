const DEFAULT_TIMEOUT_MS = 30000;

// POSTs JSON and returns the parsed JSON response. On failure throws an Error
// with a readable message plus:
//   .status          HTTP status, or undefined for network errors and timeouts
//   .body            raw response body text ("" if none)
//   .isNetworkError  true for network errors and timeouts
async function postJson(url, headers, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message =
      err.name === "TimeoutError"
        ? `no response after ${Math.round(timeoutMs / 100) / 10} seconds`
        : `network error: ${err.message}`;
    throw httpError(message, { isNetworkError: true });
  }

  const text = await response.text().catch(() => "");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON body; the raw text is still kept on errors.
  }

  if (!response.ok) {
    const detail = data.error?.message || response.statusText;
    throw httpError(`HTTP ${response.status}: ${detail}`, { status: response.status, body: text });
  }
  return data;
}

function httpError(message, { status, body = "", isNetworkError = false } = {}) {
  const err = new Error(message);
  err.status = status;
  err.body = body;
  err.isNetworkError = isNetworkError;
  return err;
}
