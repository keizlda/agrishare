import { useEffect, useState } from "react";

// Stand-in for real persistence until the backend exists. Without a server,
// plain useState resets to the seed data on every login/logout (each page
// component unmounts when AppLayout redirects to /login), which breaks any
// workflow that spans two sessions — e.g. FA President forwarding a request
// that MAO Admin needs to see later. Swap for API calls once the backend
// is available; callers keep the same [value, setValue] shape.
export function usePersistedState(key, initialValue) {
  const [value, setValue] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : initialValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
