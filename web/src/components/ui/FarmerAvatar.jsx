import { useState } from "react";

// A farmer's mobile-account photo (profiles.avatar_url, a long-lived signed
// URL), or their initials when there's none or the image fails to load.
// Shared by the Farmers table and the distribution form's beneficiary
// tagging (suggestions + chips); the Farmer Profile drawer and Validation
// page render their own larger versions.
export default function FarmerAvatar({ url, firstName, lastName, size = 28, className = "" }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const initials = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) };
  const classes = `agri-farmer-avatar ${className}`.trim();
  if (url && failedUrl !== url) {
    return <img className={classes} style={style} src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />;
  }
  return (
    <span className={classes} style={style} aria-hidden="true">
      {initials}
    </span>
  );
}
