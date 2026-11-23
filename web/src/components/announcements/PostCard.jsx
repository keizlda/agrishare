import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pin, Users } from "lucide-react";
import maoSeal from "../../assets/mao-seal.png";
import { getAnnouncementImageUrl } from "../../lib/api/announcements.js";
import { formatDate, formatPostedAt } from "../../lib/dates.js";

// One announcement as a simple post: the "MAO Labangan" seal and name, when
// it was posted and who it's for, the text ("See more" after about 5 lines)
// and the photo full width. `menu`: the ⋯ actions (MAO Admin / forward).
export default function PostCard({ post, menu }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [photo, setPhoto] = useState(null);
  const textRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (post.imagePath) getAnnouncementImageUrl(post.imagePath).then((u) => !cancelled && setPhoto(u)).catch(() => {});
    else setPhoto(null);
    return () => {
      cancelled = true;
    };
  }, [post.imagePath]);

  // "See more" only when the text is longer than the 5 lines shown.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return undefined;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [post.body, expanded]);

  return (
    <article className={`agri-card agri-post${post.isDraft ? " draft" : ""}`} aria-label={`Post: ${post.firstLine}`}>
      <header className="agri-post-head">
        <img src={maoSeal} alt="" className="agri-post-avatar" />
        <div className="agri-post-who">
          <div className="agri-post-author-name">MAO Labangan</div>
          <div className="agri-post-meta">
            <time dateTime={post.postedAt} title={formatDate(post.postedAt)}>{post.isDraft ? "Not posted yet" : formatPostedAt(post.postedAt)}</time>
            <span aria-hidden="true"> · </span>
            <span className="agri-post-aud"><Users size={12} /> {post.audienceLabel}</span>
          </div>
        </div>
        <div className="agri-post-flags">
          {post.isDraft && <span className="agri-pill orange">Draft</span>}
          {post.isPinned && (
            <span className="agri-post-pinned"><Pin size={12} /> Pinned</span>
          )}
          {menu}
        </div>
      </header>

      {post.forwardedAt && (
        <div className="agri-post-forwarded">Forwarded to all farmers by the Farmers&apos; Association President on {formatDate(post.forwardedAt)}</div>
      )}

      {!!post.body.trim() && (
        <>
          <div ref={textRef} className={`agri-post-body${expanded ? "" : " clamped"}`}>{post.body}</div>
          {!expanded && overflows && (
            <button type="button" className="agri-post-more" onClick={() => setExpanded(true)}>See more</button>
          )}
        </>
      )}

      {post.imagePath && (
        photo ? <img src={photo} alt="Photo in this post" className="agri-post-image" /> : <div className="agri-post-image loading" aria-label="Loading photo" />
      )}
    </article>
  );
}
