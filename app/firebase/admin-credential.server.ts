import { readFileSync } from "fs";
import { applicationDefault, cert, type AppOptions } from "firebase-admin/app";
import {
  AdminConfigError,
  ADMIN_PROJECT_ENV,
  assertAdcProject,
  assertServiceAccountProject,
  readAdminProjectId,
} from "./admin-project.server";

// Server-only env vars. Never prefix these with VITE_.
export const ADMIN_ENV = {
  projectId: ADMIN_PROJECT_ENV,
  clientEmail: "FIREBASE_ADMIN_CLIENT_EMAIL",
  privateKey: "FIREBASE_ADMIN_PRIVATE_KEY",
} as const;

type AdminEnv = Partial<Record<string, string | undefined>>;

const readUtf8 = (path: string) => readFileSync(path, "utf8");

/**
 * Builds Admin SDK options from env, always pinned to the validated project.
 * With a client email and private key set (Vercel), it uses those; otherwise
 * Application Default Credentials (local). Errors are AdminConfigError and
 * name variables only, never their values.
 */
export function readAdminOptions(env: AdminEnv, readFile = readUtf8): AppOptions {
  const projectId = readAdminProjectId(env);
  const clientEmail = env[ADMIN_ENV.clientEmail]?.trim();
  const privateKey = env[ADMIN_ENV.privateKey]?.trim();

  if (!clientEmail && !privateKey) {
    assertAdcProject(env, projectId, readFile);
    return { credential: applicationDefault(), projectId };
  }

  const missing = [
    !clientEmail && ADMIN_ENV.clientEmail,
    !privateKey && ADMIN_ENV.privateKey,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new AdminConfigError(`Missing Firebase Admin environment variables: ${missing.join(", ")}.`);
  }
  assertServiceAccountProject(clientEmail!, projectId);

  // Vercel stores multi-line values with literal "\n"; restore real newlines
  const key = privateKey!.replace(/\\n/g, "\n");
  return {
    credential: cert({ projectId, clientEmail, privateKey: key }),
    projectId,
  };
}
