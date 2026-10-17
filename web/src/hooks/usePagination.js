import { useCallback, useEffect, useMemo, useState } from "react";

// The state is the index of the first row on screen rather than a page
// number, so when the page size changes (the window is resized and
// useFitPageSize fits more or fewer rows) the page shown is the one that
// still contains that row.
export function usePagination(items, pageSize) {
  const [firstIndex, setFirstIndex] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.floor(firstIndex / pageSize) + 1, totalPages);

  // Clamp back to the last valid page when a filter shrinks the result set
  // out from under the current page (e.g. searching while on page 3).
  useEffect(() => {
    if (firstIndex >= totalPages * pageSize) setFirstIndex((totalPages - 1) * pageSize);
  }, [firstIndex, totalPages, pageSize]);

  const setPage = useCallback((p) => setFirstIndex((Math.max(1, p) - 1) * pageSize), [pageSize]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return { page, setPage, totalPages, pageItems };
}
