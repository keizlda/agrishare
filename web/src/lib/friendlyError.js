// Never show a raw database/PostgREST error to a user — this is the one
// place that decides what's safe to display, and always logs the real
// error to the console so it's still visible to whoever's debugging.
//
// Errors thrown deliberately by our own code (form validation, the
// Edge Function's "Login ID X is already used by Y" messages, etc.) are
// already written for the UI and have no PostgREST `code` — those pass
// through unchanged. Only messages that look like a raw Postgres/PostgREST
// failure get translated.
export function friendlyError(err, fallback = "Something went wrong. Please try again.") {
  if (!err) return fallback;
  console.error(err);

  const message = err.message || "";
  const code = err.code;
  const looksRaw = /constraint|column ".*" |relation ".*" |syntax error|violates|duplicate key|SQLSTATE/i.test(message);
  if (!code && !looksRaw) return message || fallback;

  if (code === "23505" || /duplicate key value/i.test(message)) return "That record already exists.";
  if (code === "23503" || /foreign key constraint/i.test(message)) return "This can't be completed because other records still depend on it.";
  if (code === "23514" || /violates check constraint/i.test(message)) return "One of the values entered isn't valid.";
  if (code === "PGRST116" || /no rows/i.test(message)) return "That record couldn't be found — it may have already been changed or removed.";
  if (/JWT|not authenticated|permission denied|row-level security/i.test(message)) return "You don't have permission to do that.";
  if (/network|fetch/i.test(message)) return "Couldn't reach the server. Check your connection and try again.";
  return fallback;
}
