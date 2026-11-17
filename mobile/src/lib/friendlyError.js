// Never show a raw database/library error to a farmer — this decides what's
// safe to display and logs the real error for whoever's debugging. Same
// rules as the web app (web/src/lib/friendlyError.js):
// shown as written are messages our own code throws (`new Error("…")`) and
// messages our database functions raise (SQLSTATE P0001, e.g. "Enter a
// quantity greater than 0."); everything else is translated or replaced
// by `fallback`.
export const OFFLINE_MESSAGE = "No internet connection. Please try again.";
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please log in again.";

const NETWORK = /Network request failed|Failed to fetch|fetch failed|NetworkError|Load failed|timed out|Failed to send a request/i;

export function isNetworkError(err) {
  if (!err) return false;
  if (err.name === "AuthRetryableFetchError" || err.name === "FunctionsFetchError") return true;
  return NETWORK.test(`${err.message ?? ""} ${err.details ?? ""}`);
}

export function isSessionError(err) {
  if (!err) return false;
  if (err.code === "PGRST301" || err.code === "PGRST303" || err.status === 401) return true;
  return /JWT expired|invalid JWT|Invalid Refresh Token|refresh_token_not_found|session_not_found|Auth session missing/i.test(err.message ?? "");
}

// AuthContext registers a check that signs the farmer out (with
// SESSION_EXPIRED_MESSAGE on Login) when the session turns out to be gone.
let sessionCheck = null;
export function setSessionCheck(fn) {
  sessionCheck = fn;
}

export function friendlyError(err, fallback = "Something went wrong. Please try again.") {
  if (!err) return fallback;
  const text = toMessage(err, fallback);
  // Expected, handled problems (no connection, a deactivated account, a rule
  // our database explains) are logged quietly for debugging; only an error
  // that falls through to the generic message is logged as an error.
  if (text === fallback) console.error(err);
  else console.info("Handled:", err?.message ?? err);
  return text;
}

function toMessage(err, fallback) {
  const message = err.message || "";
  const code = err.code;

  if (isNetworkError(err)) return OFFLINE_MESSAGE;
  if (isSessionError(err)) {
    sessionCheck?.();
    return SESSION_EXPIRED_MESSAGE;
  }
  if (err.status === 429 || code === "over_request_rate_limit" || /rate limit/i.test(message)) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (code === "P0001" && message) return message;
  if (code === "23505" || /duplicate key value/i.test(message)) return "That record already exists.";
  if (code === "PGRST116" || /no rows|0 rows/i.test(message)) return "That item is no longer available.";
  if (code === "42501" || /permission denied|row-level security/i.test(message)) {
    sessionCheck?.();
    return "You don't have permission to do that.";
  }
  if (err.name === "StorageApiError" || err.name === "StorageUnknownError") {
    if (String(err.statusCode ?? err.status) === "413" || /maximum allowed size|too large/i.test(message)) return "The photo is too large. Please take it again.";
    if (/mime type|not supported|invalid file type/i.test(message)) return "Only photos (JPG or PNG) can be uploaded.";
    return "The photo couldn't be uploaded. Please try again.";
  }
  if (err.name === "Error" && !code && !err.status && message) return message;
  return fallback;
}
