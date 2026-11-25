import { createFirebaseVerifier } from "./auth/idToken";
import { readConfig } from "./config";
import { createGameServer } from "./server";

const { port, host, firebase } = readConfig();
const server = createGameServer({ verifier: createFirebaseVerifier(firebase) });
await server.listen(port, host);
console.log(`HelloValley server listening on http://${host}:${port}`);
console.log(
  `Firebase project ${firebase.projectId}` +
    (firebase.authEmulatorHost ? ` (Auth emulator at ${firebase.authEmulatorHost})` : ""),
);
