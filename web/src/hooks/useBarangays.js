import { useEffect, useState } from "react";
import { listEntries } from "../lib/api/lists.js";

// The barangays list (Settings → Lists), loaded once by the page that uses
// it; empty until it arrives.
export function useBarangays() {
  const [barangays, setBarangays] = useState([]);
  useEffect(() => {
    let cancelled = false;
    listEntries("barangays").then((list) => !cancelled && setBarangays(list)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return barangays;
}
