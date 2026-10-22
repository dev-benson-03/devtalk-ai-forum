// Firebase web config keys and the Vite env variables that supply them
const FIREBASE_ENV_VARS = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
} as const;

type ConfigKey = keyof typeof FIREBASE_ENV_VARS;
export type FirebaseEnvVar = (typeof FIREBASE_ENV_VARS)[ConfigKey];
export type FirebaseWebConfig = Record<ConfigKey, string>;

/**
 * Builds the Firebase web config from env values, throwing if any are missing.
 * The error names the missing variables only, never their values.
 */
export function readFirebaseConfig(
  env: Partial<Record<FirebaseEnvVar, string | undefined>>
): FirebaseWebConfig {
  const entries = Object.entries(FIREBASE_ENV_VARS) as [ConfigKey, FirebaseEnvVar][];
  const missing = entries
    .filter(([, name]) => !env[name]?.trim())
    .map(([, name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env.local and fill them in."
    );
  }

  return Object.fromEntries(
    entries.map(([key, name]) => [key, env[name]!.trim()])
  ) as FirebaseWebConfig;
}
