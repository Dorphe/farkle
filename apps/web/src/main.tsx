import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App.tsx";
import "@/styles/tokens.css";
import "@/styles/app.css";

const host = document.getElementById("root");
if (!host) throw new Error("Missing #root element");

createRoot(host).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
