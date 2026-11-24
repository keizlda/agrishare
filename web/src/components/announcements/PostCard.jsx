import { useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, Clock, MapPin, Pin, Users } from "lucide-react";
import maoSeal from "../../assets/mao-seal.png";
import { barangayNames } from "../../lib/api/announcements.js";
import { formatDate, formatTime } from "../../lib/dates.js";
import { postedLine, usePostPhoto } from "./postHelpers.js";

// Up to this many barangay names on a card; the rest as "+2 more".
const CARD_BARANGAYS = 3;

// The highlighted date · time · venue row (only the parts that are filled).
export function PostEventRow({ post }) {
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

// "Farmers / Farmers' Association Presidents · Langapod, Bagalupa" (or
// "· All barangays"). `limit`: how many barangay names before "+N more".
export function PostAudience({ post, barangays, limit = Infinity }) {
  const names = barangayNames(post, barangays);
  const where = post.allBarangays ? "All barangays" : names.length > limit ? `${names.slice(0, limit).join(", ")} +${names.length - limit} more` : names.join(", ");
  return (
    <div className="agri-post-audience-line" title={post.allBarangays ? undefined : names.join(", ")}>
      <Users size={13} aria-hidden="true" />
      <span><span className="visually-hidden">Who can see this: </span>{post.audienceLabel} · {where}</span>
    </div>
  );
}

// One announcement in the feed: the "MAO Labangan" seal and name, when it
// was posted, the bold title, the date / time / venue row, the details
// ("See more" after about 4 lines), the photo, and who can see it.
// Clicking anywhere on it opens the post in full (`onOpen`); `menu`: the
// ⋯ actions (MAO Admin: Edit, Pin / Unpin, Delete; FA President: forward).
export default function PostCard({ post, barangays, menu, onOpen, isNew = false }) {
  const [overflows, setOverflows] = useState(false);
  const photo = usePostPhoto(post.imagePath);
  const textRef = useRef(null);

  // "See more" only when the details are longer than the lines shown.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return undefined;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [post.body]);

  function onKeyDown(e) {
    // Only the card itself (not the ⋯ button or a menu item inside it).
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(post);
    }
  }

  return (
    <article
      className={`agri-card agri-post agri-post-clickable${post.isDraft ? " draft" : ""}${isNew ? " agri-post-new" : ""}`}
      data-post-id={post.id}
      aria-label={`Post: ${post.title}`}
      tabIndex={0}
      onClick={() => onOpen(post)}
      onKeyDown={onKeyDown}
    >
      <header className="agri-post-head">
        <img src={maoSeal} alt="" className="agri-post-avatar" />
        <div className="agri-post-who">
          <div className="agri-post-author-name">MAO Labangan</div>
          <div className="agri-post-meta">
            <time dateTime={post.postedAt}>{postedLine(post)}</time>
          </div>
        </div>
        <div className="agri-post-flags">
          {post.isDraft && <span className="agri-pill orange">Draft</span>}
          {post.isPinned && (
            <span className="agri-post-pinned"><Pin size={12} /> Pinned</span>
          )}
          {/* The ⋯ menu acts on the post without opening it. */}
          {menu && <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{menu}</span>}
        </div>
      </header>

      {post.forwardedAt && (
        <div className="agri-post-forwarded">Forwarded to farmers by a Farmers&apos; Association President on {formatDate(post.forwardedAt)}</div>
      )}

      <h3 className="agri-post-title">{post.title}</h3>
      <PostEventRow post={post} />

      {!!post.body.trim() && (
        <>
          <div ref={textRef} className="agri-post-body clamped">{post.body}</div>
          {overflows && (
            <button
              type="button"
              className="agri-post-more"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(post);
              }}
            >
              See more
            </button>
          )}
        </>
      )}

      {!photo.failed && (
        photo.url ? <img src={photo.url} alt="Photo in this post" className="agri-post-image" onError={photo.onError} /> : <div className="agri-post-image loading" aria-label="Loading photo" />
      )}

      <footer className="agri-post-foot">
        <PostAudience post={post} barangays={barangays} limit={CARD_BARANGAYS} />
      </footer>
    </article>
  );
}
