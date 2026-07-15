/**
 * Entry point for the React renderer process.
 * Mounts the root component into the DOM and wires global providers.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
console.log("Starting POS Desktop Renderer Process...");
import "./i18n";
console.log("i18n initialized.");
import { store } from "./store/store";
import { App } from "./App";
import "./styles/global.css";
console.log("Global styles loaded.");

const rootElement = document.getElementById("root");
console.log("Root element found.", rootElement);

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
