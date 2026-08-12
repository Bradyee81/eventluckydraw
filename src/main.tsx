import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";
import { ControlApp } from "./control/ControlApp";
import { OutputApp } from "./output/OutputApp";

const label = getCurrentWindow().label;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>{label === "output" ? <OutputApp /> : <ControlApp />}</StrictMode>
);
