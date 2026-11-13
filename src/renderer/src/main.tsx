import React from "react";
import { createRoot } from "react-dom/client";
import { ApplicationShell } from "./ApplicationShell";
import { WorkspaceHost } from "./WorkspaceContext";
import "./style.css";
import "./reviews.css";
import "./workspace.css";
import "./themes.css";
import { applyTheme, readTheme } from "./themes";
applyTheme(readTheme());
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceHost>
      <ApplicationShell />
    </WorkspaceHost>
  </React.StrictMode>,
);
