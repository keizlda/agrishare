// Shared style tokens for the AgriShare farmer mobile app.
// Mirrors the web app's palette (src/theme.css in ../web) so both surfaces
// read as the same product.
export const colors = {
  primary: "#2f9e44",
  primaryDark: "#1e7233",
  primaryDarker: "#14532d",
  primaryLight: "#e8f6ea",
  primarySoft: "#eef8ef",

  bg: "#f4f7f4",
  card: "#ffffff",
  border: "#e4eae4",
  text: "#1f2a24",
  textMuted: "#6b7a70",

  blue: "#3b82f6",
  blueBg: "#eaf2fe",
  red: "#e03131",
  redBg: "#fdeeee",
  orange: "#f08c00",
  orangeBg: "#fff4e0",
  purple: "#7048e8",
  purpleBg: "#f1ecfd",
  gray: "#667066",
  grayBg: "#f1f3f1",
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const spacing = (n) => n * 4;

export const statusColor = (status) => {
  switch (status) {
    case "Active":
    case "Validated":
    case "Completed":
    case "In Stock":
    case "Approved":
      return { fg: colors.primaryDark, bg: colors.primaryLight };
    case "Inactive":
    case "Not Validated":
    case "Rejected":
      return { fg: colors.red, bg: colors.redBg };
    case "Pending":
    case "Ongoing":
    case "Low Stock":
    case "Pending Validation":
      return { fg: colors.orange, bg: colors.orangeBg };
    case "Forwarded":
    case "Scheduled":
      return { fg: colors.purple, bg: colors.purpleBg };
    default:
      return { fg: colors.gray, bg: colors.grayBg };
  }
};
