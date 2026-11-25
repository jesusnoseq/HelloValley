import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

// Dev-only pages (no sign-in): /dev/characters is the M07 character gallery. The DEV check is
// replaced with `false` in production builds, so the page is never bundled there.
if (import.meta.env.DEV && window.location.pathname === "/dev/characters") {
  void import("./dev/CharacterGallery").then(({ CharacterGallery }) => render(<CharacterGallery />));
} else {
  render(<App />);
}
