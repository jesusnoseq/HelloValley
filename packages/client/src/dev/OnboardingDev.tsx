import { type PlayerProfile, randomApartmentId } from "@hellovalley/shared";
import { useState } from "react";
import { ApiError } from "../net/api";
import Onboarding, { type SubmitOnboarding } from "../ui/onboarding/Onboarding";

/**
 * Dev-only onboarding page (`/dev/onboarding`, build plan M14): the wizard without sign-in or a
 * server. Submitting draws an apartment locally; the name "Blocked" simulates a moderation
 * rejection and "Offline" a network failure. Not in production builds (see main.tsx).
 */
const fakeSubmit: SubmitOnboarding = async (request) => {
  await new Promise((r) => setTimeout(r, 400));
  if (request.name.trim() === "Blocked") throw new ApiError("name_rejected", 422);
  if (request.name.trim() === "Offline") throw new ApiError("network", null);
  const { targetLang, selfAssessment: _s, ...rest } = request;
  return { created: true, profile: { ...rest, name: rest.name.trim(), targetLangs: [targetLang], apartmentId: randomApartmentId() } as PlayerProfile };
};

export function OnboardingDev() {
  const [done, setDone] = useState<PlayerProfile | null>(null);
  if (done) {
    return (
      <pre style={{ padding: 24, font: "14px ui-monospace, monospace" }}>
        Onboarding complete; the game would open apartment {done.apartmentId}.{"\n\n"}
        {JSON.stringify(done, null, 2)}
      </pre>
    );
  }
  return <Onboarding user={{ getIdToken: async () => "dev" }} submit={fakeSubmit} onComplete={setDone} />;
}
