import { useEffect, useState } from "react";
import { getAnnouncementImageUrl } from "../../lib/api/announcements.js";
import { formatPostedOn } from "../../lib/dates.js";

// "Posted Nov 24, 2026 · 3:15 PM" (or "Not posted yet" for a draft).
export function postedLine(post) {
  return post.isDraft ? "Not posted yet" : `Posted ${formatPostedOn(post.postedAt)}`;
}

// A post's photo: { url, failed, onError }. url is null while the signed
// link loads; failed once the link or the image itself can't be loaded, so
// the post hides the photo area instead of leaving an empty space.
export function usePostPhoto(path) {
  const [state, setState] = useState({ path: null, url: null, failed: false });
  useEffect(() => {
    let cancelled = false;
    if (path) {
      getAnnouncementImageUrl(path)
        .then((url) => !cancelled && setState({ path, url, failed: !url }))
        .catch(() => !cancelled && setState({ path, url: null, failed: true }));
    }
    return () => {
      cancelled = true;
    };
  }, [path]);
  const current = state.path === path ? state : { url: null, failed: false };
  return {
    url: path ? current.url : null,
    failed: !path || current.failed,
    onError: () => setState((s) => ({ ...s, failed: true })),
  };
}
