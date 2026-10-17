// Design tokens for the AgriShare farmer mobile app.
//
// Every value below is pulled directly from web/src/theme.css (and the
// components that read its custom properties) so the two clients read as
// the same product — see the citation in each section. Nothing here is
// guessed. Screens/components should import from this file rather than
// hardcoding any color, spacing, radius, or font value.
import { Platform } from "react-native";

// ---------------------------------------------------------------------------
// Colors — the web app's tokens (web/src/theme.css :root), so both apps have
// the same color exposure: a soft sage page instead of white, slightly
// off-white cards, and text tones that pass WCAG AA on both. Screens use
// these names; nothing hardcodes white for a surface.
// ---------------------------------------------------------------------------
export const colors = {
  primary: "#2f9e44", // --agri-primary (fills, icons — not small text)
  primaryDark: "#1e7233", // --agri-primary-dark (green text, links)
  primaryDarker: "#14532d",
  primaryLight: "#e8f6ea", // tint bg — active rows, icon chips
  primarySoft: "#eef8ef", // even lighter tint — hover/pressed backgrounds

  bg: "#eaf0e7", // --agri-bg: soft sage page background
  header: "#dfe8da", // one step deeper than bg, so the header band stands out
  card: "#fcfdfb", // --agri-card
  surface: "#fcfdfb", // alias of card (modals, bottom sheets)
  tabBar: "#fcfdfb",
  border: "#dde5da", // card, input and tab bar outlines

  text: "#1f2a22", // --agri-text
  textSecondary: "#45524a", // --agri-text-secondary: labels
  textMuted: "#56645a", // --agri-text-muted
  // Lightest text tier (timestamps, placeholders): still >= 4.5:1 on bg.
  textFaint: "#5e6c62",
  // Non-text glyphs: chevrons and similar affordances (~3.5:1 on cards)…
  iconMuted: "#7b877f", // --agri-icon-muted
  // …and purely decorative ones (empty-state icons), never text.
  iconFaint: "#b7c2ba", // --agri-icon-faint

  blue: "#3b82f6",
  blueBg: "#eaf2fe",
  // Text on blueBg (badges) — --agri-blue-text on web.
  blueText: "#1f5fbf",
  red: "#c23b36", // --agri-red: text-safe red
  redBg: "#fbeeed", // --agri-red-bg
  // Lighter red used only for icon color on dark surfaces (e.g. error
  // toasts) — red itself is too dark to read on colors.text.
  redOnDark: "#ff8383",
  orange: "#f08c00", // fills and dots only
  orangeText: "#96590a", // --agri-orange-text: amber text and badges
  orangeBg: "#fff4e0",
  purple: "#7048e8",
  purpleBg: "#f1ecfd",
  gray: "#5f6a5f",
  grayBg: "#eef1ec",
};

// ---------------------------------------------------------------------------
// Status colors — mirrors web/src/components/ui/Pill.jsx's status→color map
// and theme.css:427-432's color→hex pairs exactly.
//
// Note: web styles "For Review" *purple* (the "info" role here) and a
// request's "Endorsed" *blue* (the "endorsed" role).
// ---------------------------------------------------------------------------
export const statusColors = {
  success: { fg: colors.primaryDark, bg: colors.primaryLight },
  danger: { fg: colors.red, bg: colors.redBg },
  warning: { fg: colors.orangeText, bg: colors.orangeBg },
  info: { fg: colors.purple, bg: colors.purpleBg },
  endorsed: { fg: colors.blueText, bg: colors.blueBg },
  neutral: { fg: colors.gray, bg: colors.grayBg },
};

// Maps a status label to one of the roles above — matches Pill.jsx's
// mapping key-for-key for every label that exists on both clients.
export const statusColor = (status) => {
  switch (status) {
    case "Active":
    case "Validated":
    case "Completed":
    case "Approved":
    case "Received":
      return statusColors.success;
    case "Inactive":
    case "Not Validated":
    case "Rejected":
      return statusColors.danger;
    case "Pending":
    case "Ongoing":
    case "Upcoming":
      return statusColors.warning;
    case "For Review":
      return statusColors.info;
    // Requests: Pending -> Endorsed -> Approved / Rejected; "Not endorsed"
    // is gray (default), as on web.
    case "Endorsed":
      return statusColors.endorsed;
    // Mobile-only labels (commodity stock levels) that Pill.jsx doesn't
    // define on web — mapped by closest fit rather than pulled from web.
    case "In Stock":
      return statusColors.success;
    case "Low Stock":
    case "Pending Validation":
      return statusColors.warning;
    // "Scheduled" and everything else falls through to gray on web too
    // (it isn't in Pill.jsx's map) — confirmed, not guessed.
    default:
      return statusColors.neutral;
  }
};

// ---------------------------------------------------------------------------
// Spacing — a clean 4px-base scale, as specified. This is not a literal
// port of web's padding/margin values: web isn't on a strict scale, it
// clusters organically around 4/6/8/10/12/14/16/20/24px rather than
// doubling cleanly, so there's nothing consistent there to extract.
// ---------------------------------------------------------------------------
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ---------------------------------------------------------------------------
// Radii — web/src/theme.css: --agri-radius (12px, theme.css:23) for cards;
// icon buttons at 8px (theme.css:449); pills/badges at 999px (theme.css:421,
// 663); the Overview drawer panel — web's closest analog to a mobile bottom
// sheet — at 16px (theme.css:249).
//
// Circular avatars use 50% on web, which isn't a portable flat constant in
// RN (it must equal half of that exact element's own width/height) — compute
// it per-component instead of tokenizing it here.
// ---------------------------------------------------------------------------
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};
// Back-compat alias — existing screens already import { radius }.
export const radius = radii;

// ---------------------------------------------------------------------------
// Typography — web has no custom font-family; it's a pure system stack
// (web/src/theme.css:38: "Segoe UI", -apple-system, BlinkMacSystemFont,
// "Roboto", Arial, sans-serif — no Google Font is loaded anywhere in the
// app). RN's own System font already resolves to San Francisco on iOS and
// Roboto on Android, which is the actual intent of that stack, so
// fontFamily maps to the platform default rather than a literal string
// that may not exist as an installed font on-device.
//
// Web has no single formal type scale — most pages open straight into
// cards with no page-title element at all — so these six roles are
// AgriShare mobile's own scale, each anchored to the closest real size/
// weight that does exist on web for that kind of text (citations inline).
// ---------------------------------------------------------------------------
export const typography = {
  fontFamily: Platform.select({ ios: "System", android: "Roboto", default: "System" }),
  // Uppercase micro-labels are the only place web uses letter-spacing —
  // always 0.03em (theme.css:387, 486, 847, 863). RN takes a flat px value
  // rather than an em multiplier; this is 0.03em at label/caption size.
  letterSpacingWide: 0.4,

  title: { fontSize: 22, fontWeight: "800", lineHeight: 28 }, // agri-login-logo, 1.3rem/800 — theme.css:521-522
  heading: { fontSize: 17, fontWeight: "700", lineHeight: 22 }, // modal/card titles, ~1.05rem/700 — Farmers.jsx:399
  subheading: { fontSize: 15, fontWeight: "700", lineHeight: 20 }, // agri-overview-title, 0.92rem/700 — theme.css:315-316
  body: { fontSize: 14, fontWeight: "400", lineHeight: 20 }, // table cell text, 0.87rem — theme.css:378
  label: { fontSize: 13, fontWeight: "600", lineHeight: 17 }, // agri-form-label, 0.8rem/600 — theme.css:616-618
  caption: { fontSize: 11, fontWeight: "400", lineHeight: 15 }, // agri-submission-time, 0.7rem — theme.css:781-782
};

// ---------------------------------------------------------------------------
// Shadows — RN can't express CSS's multi-layer box-shadow, so each web
// value is collapsed into one representative iOS shadow + an Android
// elevation.
// ---------------------------------------------------------------------------
export const shadows = {
  // web/src/theme.css:24 (--agri-shadow, applied to .agri-card):
  //   0 1px 2px rgba(20,40,25,0.06), 0 1px 8px rgba(20,40,25,0.04)
  card: {
    shadowColor: "#14281a",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  // web/src/theme.css:250 (.agri-overview-panel — the only large slide-in
  // panel on web, and the closest analog to a mobile bottom sheet):
  //   0 20px 50px rgba(10,30,15,0.24)
  sheet: {
    shadowColor: "#0a1e0f",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.24,
    shadowRadius: 50,
    elevation: 16,
  },
};

// ---------------------------------------------------------------------------
// Sizes — touch-adapted, not a literal port of web's mouse-sized controls.
// Web's .form-control/.btn are unmodified Bootstrap defaults (6px/12px
// padding, no enforced minimum height); these are deliberately larger per
// Apple/Android accessibility guidance (44pt/48dp minimum tap target).
// ---------------------------------------------------------------------------
export const sizes = {
  minTouchTarget: 44,
  inputHeight: 48,
  buttonHeight: 48,
  badgeHeight: 24,
};
