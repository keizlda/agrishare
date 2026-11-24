import { Pin, X } from "lucide-react";
import maoSeal from "../../assets/mao-seal.png";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import { formatDate } from "../../lib/dates.js";
import { PostAudience, PostEventRow } from "./PostCard.jsx";
import { postedLine, usePostPhoto } from "./postHelpers.js";

// One post in full, opened by clicking it in the feed: the title, date /
// time / venue, all the details, the whole photo, and who can see it
// (every barangay named). Read-only; Edit, Pin and Delete stay on the ⋯ menu.
export default function PostDetailModal({ post, barangays, onClose }) {
  const photo = usePostPhoto(post.imagePath);
  useEscapeToClose(true, onClose);

  return (
    <div className="agri-modal-backdrop" onClick={onClose}>
      <div
        className="agri-card agri-modal agri-post-detail"
        style={{ "--agri-modal-width": "640px" }}
        role="dialog"
        aria-modal="true"
        aria-label={post.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">Announcement</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} autoFocus><X size={16} /></button>
        </div>

        <div className="agri-modal-body">
          <div className="agri-post-head">
            <img src={maoSeal} alt="" className="agri-post-avatar" />
            <div className="agri-post-who">
              <div className="agri-post-author-name">MAO Labangan</div>
              <div className="agri-post-meta"><time dateTime={post.postedAt}>{postedLine(post)}</time></div>
            </div>
            <div className="agri-post-flags">
              {post.isDraft && <span className="agri-pill orange">Draft</span>}
              {post.isPinned && <span className="agri-post-pinned"><Pin size={12} /> Pinned</span>}
            </div>
          </div>

          {post.forwardedAt && (
            <div className="agri-post-forwarded">Forwarded to farmers by a Farmers&apos; Association President on {formatDate(post.forwardedAt)}</div>
          )}

          <h2 className="agri-post-title agri-post-title-lg">{post.title}</h2>
          <PostEventRow post={post} />
          {!!post.body.trim() && <div className="agri-post-body">{post.body}</div>}

          {!photo.failed && (
            photo.url ? <img src={photo.url} alt="Photo in this post" className="agri-post-detail-image" onError={photo.onError} /> : <div className="agri-post-detail-image loading" aria-label="Loading photo" />
          )}

          <div className="agri-post-detail-foot">
            <PostAudience post={post} barangays={barangays} />
          </div>
        </div>
      </div>
    </div>
  );
}
