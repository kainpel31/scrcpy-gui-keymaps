import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import OverlayApp from "./OverlayApp";
import { I18nProvider } from "./i18n";
import "./index.css";

const isOverlayWindow =
  new URLSearchParams(window.location.search).get("overlay") === "1";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlayWindow ? (
      <OverlayApp />
    ) : (
      <I18nProvider>
        <App />
      </I18nProvider>
    )}
  </React.StrictMode>
);
