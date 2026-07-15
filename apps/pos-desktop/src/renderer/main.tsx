/**
 * Entry point for the React renderer process.
 * Mounts the root component into the DOM and wires global providers.
 *
 * ⚠ Side-effect imports (polyfills) must come FIRST — before React, Redux,
 * or any domain module — so that globalThis stubs (Buffer, process, etc.)
 * are in place before the Prisma runtime or PGlite initialise.
 */
import "./dev/buffer-polyfill";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import "./i18n";
import { store } from "./store/store";
import { App } from "./App";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    'Root element not found. Ensure index.html contains <div id="root"></div>.'
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>
);
