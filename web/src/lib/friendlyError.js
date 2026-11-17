// Never show a raw database/PostgREST/library error to a user — this is the
// one place that decides what's safe to display, and always logs the real
// error to the console so it's still visible to whoever's debugging.
//
// Shown as written: messages our own code throws (`new Error("…")`, e.g.
// "This request was already updated by someone else…") and messages our
// database functions raise (SQLSTATE P0001, e.g. "Program name is
// required."). Everything else — supabase-js/PostgREST/Auth/Storage errors,
// JavaScript TypeErrors — is translated or replaced by `fallback`.
export const OFFLINE_MESSAGE = "No internet connection. Please try again.";
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please log in again.";

const NETWORK = /Failed to fetch|fetch failed|NetworkError|Network request failed|Load failed|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|Failed to send a request/i;

export function isNetworkError(err) {
  if (!err) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err.name === "AuthRetryableFetchError" || err.name === "FunctionsFetchError") return true;
  return NETWORK.test(`${err.message ?? ""} ${err.details ?? ""}`);
}

// The signed-in session is gone or no longer accepted (expired, revoked, or
// cleared in another tab). AuthContext listens for "agri:session-check" and
// sends the user to Login with SESSION_EXPIRED_MESSAGE when that's the case.
export function isSessionError(err) {
  if (!err) return false;
  if (err.code === "PGRST301" || err.code === "PGRST303" || err.status === 401) return true;
  return /JWT expired|invalid JWT|Invalid Refresh Token|refresh_token_not_found|session_not_found|Auth session missing/i.test(err.message ?? "");
}

function requestSessionCheck() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("agri:session-check"));
}

export function friendlyError(err, fallback = "Something went wrong. Please try again.") {
  if (!err) return fallback;
  const text = toMessage(err, fallback);
  // Expected, handled problems (no connection, a wrong password, a rule our
  // database explains) are logged quietly for debugging; only an error that
  // falls through to the generic message is logged as an error.
  if (text === fallback) console.error(err);
  else console.info("Handled:", err?.message ?? err);
  return text;
}

function toMessage(err, fallback) {
  const message = err.message || "";
  const code = err.code;

  if (isNetworkError(err)) return OFFLINE_MESSAGE;
  if (isSessionError(err)) {
    requestSessionCheck();
    return SESSION_EXPIRED_MESSAGE;
  }
  if (err.status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || /rate limit/i.test(message)) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }

  // Raised on purpose by our own database functions — already plain English.
  if (code === "P0001" && message) return message;

  if (code === "23505" || /duplicate key value/i.test(message)) return "That record already exists.";
  if (code === "23503" || /foreign key constraint/i.test(message)) return "This can't be completed because other records still depend on it.";
  if (code === "23514" || /violates check constraint/i.test(message)) return "One of the values entered isn't valid.";
  if (code === "PGRST116" || /no rows|0 rows/i.test(message)) return "That record couldn't be found — it may have already been changed or removed.";
  if (code === "42501" || /permission denied|row-level security/i.test(message)) {
    // A missing session looks like a permission error to the database.
    requestSessionCheck();
    return "You don't have permission to do that.";
  }

  // Storage (uploads).
  if (err.name === "StorageApiError" || err.name === "StorageUnknownError") {
    if (String(err.statusCode ?? err.status) === "413" || /maximum allowed size|too large/i.test(message)) return "The image is too large. Choose one under 5 MB.";
    if (/mime type|not supported|invalid file type/i.test(message)) return "Only image files (JPG, PNG, WebP or GIF) can be uploaded.";
    return "The image couldn't be uploaded. Please try again.";
  }

  // Our own messages: a plain Error with no code/status from a library.
  if (err.name === "Error" && !code && !err.status && message) return message;
  return fallback;
}
