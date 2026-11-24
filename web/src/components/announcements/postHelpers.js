import { useEffect, useState } from "react";
import { getAnnouncementImageUrl } from "../../lib/api/announcements.js";
import { formatPostedOn } from "../../lib/dates.js";

// "Posted Nov 24, 2026 · 3:15 PM" (or "Not posted yet" for a draft).
export function postedLine(post) {
  return post.isDraft ? "Not posted yet" : `Posted ${formatPostedOn(post.postedAt)}`;
}

// The signed URL of a post's photo (null while it loads or with no photo).
export function usePostPhoto(path) {
  const [photo, setPhoto] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (path) getAnnouncementImageUrl(path).then((u) => !cancelled && setPhoto(u)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);
  return path ? photo : null;
}
