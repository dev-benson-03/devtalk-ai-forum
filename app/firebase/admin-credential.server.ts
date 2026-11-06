import { applicationDefault, cert, type AppOptions } from "firebase-admin/app";

// Server-only env vars. Never prefix these with VITE_.
export const ADMIN_ENV = {
  projectId: "FIREBASE_ADMIN_PROJECT_ID",
  clientEmail: "FIREBASE_ADMIN_CLIENT_EMAIL",
  privateKey: "FIREBASE_ADMIN_PRIVATE_KEY",
} as const;

type AdminEnv = Partial<Record<string, string | undefined>>;

/**
 * Builds Admin SDK options from env. With a client email and private key set
 * (Vercel), it uses those; otherwise Application Default Credentials (local).
 * Errors name the missing variables only, never their values.
 */
export function readAdminOptions(env: AdminEnv): AppOptions {
  const projectId = env[ADMIN_ENV.projectId]?.trim() || undefined;
  const clientEmail = env[ADMIN_ENV.clientEmail]?.trim();
  const privateKey = env[ADMIN_ENV.privateKey]?.trim();

  if (!clientEmail && !privateKey) {
    return { credential: applicationDefault(), projectId };
  }

  const missing = [
    !projectId && ADMIN_ENV.projectId,
    !clientEmail && ADMIN_ENV.clientEmail,
    !privateKey && ADMIN_ENV.privateKey,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing Firebase Admin environment variables: ${missing.join(", ")}.`);
  }

  // Vercel stores multi-line values with literal "\n"; restore real newlines
  const key = privateKey!.replace(/\\n/g, "\n");
  return {
    credential: cert({ projectId, clientEmail, privateKey: key }),
    projectId,
  };
}
