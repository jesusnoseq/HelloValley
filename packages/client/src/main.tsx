import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

// Dev-only pages (no sign-in): /dev/characters is the M07 character gallery and /dev/diorama the
// M09 renderer test scene. The DEV check is replaced with `false` in production builds, so the
// pages are never bundled there.
const path = window.location.pathname;
if (import.meta.env.DEV && path === "/dev/characters") {
  void import("./dev/CharacterGallery").then(({ CharacterGallery }) => render(<CharacterGallery />));
} else if (import.meta.env.DEV && path === "/dev/diorama") {
  void import("./dev/DioramaSandbox").then(({ DioramaSandbox }) => render(<DioramaSandbox />));
} else {
  render(<App />);
}
