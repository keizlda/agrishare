import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./theme.css";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";

// A focused number input still steals scroll-wheel to inc/dec its value even
// with the spinner arrows hidden (theme.css) — blur it first so a wheel event
// over the page just scrolls, and never quietly edits whatever field has focus.
document.addEventListener(
  "wheel",
  () => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === "number") el.blur();
  },
  { passive: true },
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
