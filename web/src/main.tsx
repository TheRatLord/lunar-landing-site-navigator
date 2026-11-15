import "@fontsource-variable/inter/opsz.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/shell.css";
import "./styles/viz.css";
import "./styles/content.css";
import "./styles/analyst.css";
import "./styles/evidence.css";
import "./styles/scenario.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
