import { createFirebaseVerifier } from "./auth/idToken";
import { readConfig } from "./config";
import { adminApp } from "./firebase/admin";
import { firestoreLayoutStoreFor } from "./apartments/layoutStore";
import { firestoreProfileStoreFor } from "./profiles/profileStore";
import { createGameServer } from "./server";

const { port, host, firebase } = readConfig();
const server = createGameServer({
  verifier: createFirebaseVerifier(firebase),
  profiles: firestoreProfileStoreFor(adminApp(firebase)),
  layouts: firestoreLayoutStoreFor(adminApp(firebase)),
});
await server.listen(port, host);
console.log(`HelloValley server listening on http://${host}:${port}`);
console.log(
  `Firebase project ${firebase.projectId}` +
    (firebase.authEmulatorHost ? ` (Auth emulator at ${firebase.authEmulatorHost})` : "") +
    (firebase.firestoreEmulatorHost ? ` (Firestore emulator at ${firebase.firestoreEmulatorHost})` : ""),
);
