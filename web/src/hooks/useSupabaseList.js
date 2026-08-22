import { useCallback, useEffect, useState } from "react";

// Loads a list from Supabase and exposes setData so pages can patch local
// state immediately after a mutation instead of round-tripping a full reload.
export function useSupabaseList(fetcher) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetcher()
      .then((rows) => setData(rows))
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
  }, [fetcher]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, loading, error, reload };
}
