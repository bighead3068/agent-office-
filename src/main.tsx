import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentOfficeApp } from "./ui/AgentOfficeApp";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AgentOfficeApp />
    </StrictMode>,
  );
}
