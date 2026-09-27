import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";

const MENU_WIDTH = 170;
const ITEM_HEIGHT = 37;
const MENU_PADDING = 8;

// Shared "⋯" row action menu for every table's Actions column. Renders the
// dropdown in a portal at a fixed position computed from the button's own
// rect, so it's never clipped by a scrolling table (Farmers/Commodities/
// Announcements all scroll their table body on desktop) and always lands
// next to the button regardless of where the row sits in the table.
//
// `actions`: array of { key, label, icon, danger?, onClick } | false | null
// — falsy entries are dropped, so callers can inline role checks
// (`isMAO && { key: "delete", ... }`). Returns null (no button at all) once
// filtered down to zero actions.
export default function RowActionsMenu({ actions, label = "Row actions" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const visible = (actions || []).filter(Boolean);

  useEscapeToClose(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    // A menu anchored with position:fixed doesn't track the button if the
    // table scrolls under it, so just close it rather than let it drift.
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  if (visible.length === 0) return null;

  function toggle(e) {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current.getBoundingClientRect();
    const menuHeight = visible.length * ITEM_HEIGHT + MENU_PADDING;
    const openUpward = rect.bottom + menuHeight + 6 > window.innerHeight;
    setPos({
      top: openUpward ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
    });
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="agri-icon-btn"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <MoreHorizontal size={16} />
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            className="agri-row-menu"
            role="menu"
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            onClick={(e) => e.stopPropagation()}
          >
            {visible.map((a) => (
              <button
                key={a.key}
                type="button"
                role="menuitem"
                className={`agri-row-menu-item${a.danger ? " danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
              >
                <a.icon size={14} /> {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
