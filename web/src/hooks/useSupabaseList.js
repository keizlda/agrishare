import { useCallback, useEffect, useState } from "react";
import { friendlyError } from "../lib/friendlyError.js";

// Loads a list from Supabase and exposes setData so pages can patch local
// state immediately after a mutation instead of round-tripping a full reload.
// Every page using this hook gets the raw-error-never-shown-to-users
// guarantee for free, in one place, instead of repeating it per page.
export function useSupabaseList(fetcher) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetcher()
      .then((rows) => setData(rows))
      .catch((err) => setError(friendlyError(err, "Couldn't load this list. Please try again.")))
      .finally(() => setLoading(false));
  }, [fetcher]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, loading, error, reload };
}
