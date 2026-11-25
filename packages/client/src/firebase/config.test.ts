import { describe, expect, it } from "vitest";
import { aiCloudEnabled, DEMO_PROJECT_ID, readFirebaseConfig } from "./config";

describe("readFirebaseConfig", () => {
  it("defaults to the demo project on the emulators (firebase.json ports)", () => {
    const config = readFirebaseConfig({});
    expect(config.options.projectId).toBe(DEMO_PROJECT_ID);
    expect(config.options.apiKey).toBe("demo-api-key");
    expect(config.emulators).toEqual({
      auth: "http://127.0.0.1:9099",
      firestore: { host: "127.0.0.1", port: 8080 },
      storage: { host: "127.0.0.1", port: 9199 },
    });
  });

  it("uses the real services for a real project", () => {
    const config = readFirebaseConfig({
      VITE_FIREBASE_PROJECT_ID: "hellovalley-prod",
      VITE_FIREBASE_API_KEY: "key",
      VITE_FIREBASE_APP_ID: "1:2:web:3",
    });
    expect(config.emulators).toBeNull();
    expect(config.options).toMatchObject({
      projectId: "hellovalley-prod",
      apiKey: "key",
      authDomain: "hellovalley-prod.firebaseapp.com",
      appId: "1:2:web:3",
    });
  });

  it("can point a real project at the emulators and override hosts", () => {
    const config = readFirebaseConfig({
      VITE_FIREBASE_PROJECT_ID: "hellovalley-dev",
      VITE_FIREBASE_EMULATORS: "true",
      VITE_FIRESTORE_EMULATOR_HOST: "localhost:8181",
    });
    expect(config.emulators?.firestore).toEqual({ host: "localhost", port: 8181 });
  });
});

describe("aiCloudEnabled", () => {
  it("is off for the demo project and without an API key", () => {
    expect(aiCloudEnabled(readFirebaseConfig({}).options)).toBe(false);
    expect(aiCloudEnabled({ projectId: "hellovalley-dev" })).toBe(false);
    expect(aiCloudEnabled(readFirebaseConfig({ VITE_FIREBASE_PROJECT_ID: "hellovalley-dev", VITE_FIREBASE_API_KEY: "k" }).options)).toBe(true);
  });
});
