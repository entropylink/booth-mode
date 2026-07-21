import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n";
import "./styles.css";

// Ask the browser to keep our IndexedDB — the ONLY copy of the money event log
// and catalog — from being evicted under storage pressure. Best-effort: harmless
// where unsupported, and a no-op once already granted.
void navigator.storage?.persist?.();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
