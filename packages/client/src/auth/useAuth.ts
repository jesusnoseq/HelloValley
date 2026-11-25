import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "../firebase/app";

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: User };

/** Tracks the Firebase Auth user. Google sign-in is the only provider (GDD §9.3). */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(
    () => onAuthStateChanged(auth, (user) => setState(user ? { status: "signedIn", user } : { status: "signedOut" })),
    [],
  );
  return state;
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(auth, provider);
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}

/** A readable message for the sign-in errors players can actually hit. */
export function signInErrorMessage(err: unknown): string | null {
  const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return null;
    case "auth/popup-blocked":
      return "The sign-in window was blocked. Allow pop-ups for this site and try again.";
    case "auth/network-request-failed":
      return "Could not reach the sign-in service. Check your connection (or start the emulators).";
    default:
      return "Sign-in failed. Please try again.";
  }
}
