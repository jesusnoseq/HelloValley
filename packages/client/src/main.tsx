import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

// Dev-only pages (no sign-in): /dev/characters is the M07 character gallery, /dev/diorama the
// M09 renderer test scene, /dev/buildings the M10 building gallery, /dev/town the M11 town
// (overview, walkability grid, A* paths) and /dev/play the M13 player controller and
// interiors, /dev/onboarding the M14 wizard with a fake server, /dev/speech the M19 speech bubbles. The DEV check is replaced
// with `false` in production builds, so the pages are never bundled there.
const path = window.location.pathname;
if (import.meta.env.DEV && path === "/dev/characters") {
  void import("./dev/CharacterGallery").then(({ CharacterGallery }) => render(<CharacterGallery />));
} else if (import.meta.env.DEV && path === "/dev/buildings") {
  void import("./dev/BuildingGallery").then(({ BuildingGallery }) => render(<BuildingGallery />));
} else if (import.meta.env.DEV && path === "/dev/town") {
  void import("./dev/TownView").then(({ TownView }) => render(<TownView />));
} else if (import.meta.env.DEV && path === "/dev/play") {
  void import("./dev/PlayView").then(({ PlayView }) => render(<PlayView />));
} else if (import.meta.env.DEV && path === "/dev/onboarding") {
  void import("./dev/OnboardingDev").then(({ OnboardingDev }) => render(<OnboardingDev />));
} else if (import.meta.env.DEV && path === "/dev/speech") {
  void import("./dev/SpeechGallery").then(({ SpeechGallery }) => render(<SpeechGallery />));
} else if (import.meta.env.DEV && path === "/dev/diorama") {
  void import("./dev/DioramaSandbox").then(({ DioramaSandbox }) => render(<DioramaSandbox />));
} else {
  render(<App />);
}
