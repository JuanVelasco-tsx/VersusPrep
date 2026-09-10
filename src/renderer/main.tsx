import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./global.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("No se encontro el elemento #root en index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
