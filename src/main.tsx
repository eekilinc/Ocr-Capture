import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { TranslationProvider } from "./i18n/TranslationContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TranslationProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </TranslationProvider>
  </React.StrictMode>,
);