// Firebase, initialised at RUNTIME from config the user pastes into the app —
// not from build-time env vars. Francis creates a free Firebase project, copies
// the config object the console gives him, and pastes it into Sync settings; no
// rebuild. See docs/firebase-setup.md.
//
// Everything here is lazy: the firebase SDK is dynamically imported only when
// sync is actually used, so the offline standalone edition (plan.md §9) never
// pays for a dependency it doesn't touch. With no config saved, the app runs
// exactly as before — sync is strictly opt-in.

import type { FirebaseApp } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

const CONFIG_KEY = "booth-mode.firebaseConfig";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const REQUIRED: (keyof FirebaseConfig)[] = ["apiKey", "authDomain", "projectId", "appId"];

export function getFirebaseConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as FirebaseConfig;
    if (REQUIRED.every((k) => typeof cfg[k] === "string" && cfg[k])) return cfg;
    return null;
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return getFirebaseConfig() !== null;
}

/** Validate + save a pasted config. Returns an error message, or null on success. */
export function saveFirebaseConfig(input: string): string | null {
  let cfg: FirebaseConfig;
  try {
    // Accept either JSON or a loose JS object literal the console shows.
    cfg = parseLooseConfig(input);
  } catch {
    return "No pude leer la config. Pega el objeto que te da la consola de Firebase.";
  }
  const missing = REQUIRED.filter((k) => !cfg[k]);
  if (missing.length) return `Faltan campos: ${missing.join(", ")}`;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  cached = null; // force re-init with the new project
  return null;
}

export function clearFirebaseConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
  cached = null;
}

/** The Firebase console shows `const firebaseConfig = { apiKey: "…", … };`. */
function parseLooseConfig(input: string): FirebaseConfig {
  const trimmed = input.trim();
  // Pull out the {...} body if they pasted the whole assignment.
  const brace = trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  try {
    return JSON.parse(brace) as FirebaseConfig;
  } catch {
    // Loose object: quote keys, allow trailing commas/single quotes.
    const normalized = brace
      .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(normalized) as FirebaseConfig;
  }
}

interface FirebaseBundle {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let cached: FirebaseBundle | null = null;

/** Lazily import + initialise Firebase from the saved config. */
export async function getFirebase(): Promise<FirebaseBundle> {
  if (cached) return cached;
  const cfg = getFirebaseConfig();
  if (!cfg) throw new Error("Firebase no está configurado.");

  const [{ initializeApp, getApps }, { getAuth }, { getFirestore }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
    import("firebase/firestore"),
  ]);

  const app = getApps()[0] ?? initializeApp(cfg);
  cached = { app, auth: getAuth(app), db: getFirestore(app) };
  return cached;
}

export type { User };
