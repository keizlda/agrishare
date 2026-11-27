import { useRef, useState } from "react";
import Toast from "../components/ui/Toast";
import { hideAnnouncement, unhideAnnouncement } from "../lib/api/announcements";

// Pinned first, then newest (listAnnouncements' order) — where an undone
// post goes back.
function inOrder(list) {
  return [...list].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || String(b.postedAt).localeCompare(String(a.postedAt)));
}

// "Delete" on an announcement: it leaves this farmer's list right away (the
// post stays for everyone else), with "Announcement deleted · Undo" for a
// few seconds. setPosts is the screen's list setter; toast is the bar to
// render on the screen (bottom: lift it above the tab bar).
export function useDeleteAnnouncement(setPosts, farmerId, { bottom } = {}) {
  const [notice, setNotice] = useState(null); // { id, message, tone, post? }
  const pending = useRef(new Map()); // post id -> the delete request still on its way

  const restore = (post) => setPosts((prev) => (prev ? inOrder([...prev.filter((x) => x.id !== post.id), post]) : prev));
  const remove = (post) => setPosts((prev) => (prev ? prev.filter((x) => x.id !== post.id) : prev));
  const failed = (message) => setNotice({ id: Date.now(), message, tone: "error" });

  function deletePost(post) {
    if (!farmerId) return;
    remove(post);
    setNotice({ id: Date.now(), message: "Announcement deleted.", tone: "success", post });
    const request = hideAnnouncement(post.id, farmerId)
      .then(() => true)
      .catch(() => {
        restore(post);
        failed("Couldn't delete the announcement. Please try again.");
        return false;
      });
    pending.current.set(post.id, request);
  }

  async function undo() {
    const post = notice?.post;
    if (!post) return;
    setNotice(null);
    restore(post);
    // After the delete itself has gone through (or the undo could land first).
    const deleted = await (pending.current.get(post.id) ?? Promise.resolve(true));
    pending.current.delete(post.id);
    if (!deleted) return;
    try {
      await unhideAnnouncement(post.id, farmerId);
    } catch {
      remove(post);
      failed("Couldn't bring the announcement back. Please try again.");
    }
  }

  const toast = (
    <Toast
      key={notice?.id ?? "none"}
      visible={!!notice}
      message={notice?.message ?? ""}
      tone={notice?.tone}
      action={notice?.post ? { label: "Undo", onPress: undo } : undefined}
      onDone={() => setNotice(null)}
      bottom={bottom}
    />
  );
  return { deletePost, toast };
}
