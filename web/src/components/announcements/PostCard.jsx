import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, Clock, MapPin, Pin, Users } from "lucide-react";
import maoSeal from "../../assets/mao-seal.png";
import { getAnnouncementImageUrl } from "../../lib/api/announcements.js";
import { formatDate, formatPostedAt, formatTime } from "../../lib/dates.js";

// The highlighted date · time · venue row (only the parts that are filled).
function PostEventRow({ post }) {
  const parts = [
    post.date && { key: "date", icon: CalendarDays, text: formatDate(post.date), label: "Date" },
    post.time && { key: "time", icon: Clock, text: formatTime(post.time), label: "Time" },
    post.venue && { key: "venue", icon: MapPin, text: post.venue, label: "Venue" },
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className="agri-post-event">
      {parts.map(({ key, icon: Icon, text, label }) => (
        <span key={key} className="agri-post-event-part" title={label}>
          <Icon size={14} aria-hidden="true" /> <span className="visually-hidden">{label}: </span>{text}
        </span>
      ))}
    </div>
  );
}

// One announcement as a post: the "MAO Labangan" seal and name, when it was
// posted and who it's for, the bold title, the date / time / venue row, the
// details ("See more" after about 4 lines) and the photo full width.
// `menu`: the ⋯ actions (MAO Admin / forward).
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

  // "See more" only when the details are longer than the lines shown.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return undefined;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [post.details, expanded]);

  return (
    <article className={`agri-card agri-post${post.isDraft ? " draft" : ""}`} aria-label={`Post: ${post.title}`}>
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

      <h3 className="agri-post-title">{post.title}</h3>
      <PostEventRow post={post} />

      {!!post.details && (
        <>
          <div ref={textRef} className={`agri-post-body${expanded ? "" : " clamped"}`}>{post.details}</div>
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
