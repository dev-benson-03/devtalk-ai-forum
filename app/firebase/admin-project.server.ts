/**
 * Firebase project isolation for the Admin SDK. Validation only: nothing here
 * initializes the SDK. Errors are safe to log; they never include env values.
 */

import {
  assertProjectForDeployment,
  assertWebProjectMatchesAdmin,
  FirebaseProjectError,
  knownProjectIds,
} from "./projects";

/**
 * Projects this app may operate on (production, plus staging once it exists).
 * The capstone project is excluded. Which one a deployment may use is decided
 * by assertProjectForDeployment (projects.ts).
 */
export const ALLOWED_ADMIN_PROJECT_IDS: readonly string[] = knownProjectIds();

export const ADMIN_PROJECT_ENV = "FIREBASE_ADMIN_PROJECT_ID";

/** A sanitized Admin configuration error. Maps to HTTP 500. */
export class AdminConfigError extends Error {
  readonly code = "admin/invalid-config";
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigError";
  }
}

/**
 * Returns the explicit project ID or throws AdminConfigError. It must be the
 * deployment's project when the deployment declares an environment, one of
 * ours otherwise, and the browser config's project when that is visible.
 */
export function readAdminProjectId(env: Partial<Record<string, string | undefined>>): string {
  const projectId = env[ADMIN_PROJECT_ENV]?.trim();
  if (!projectId) {
    throw new AdminConfigError(`${ADMIN_PROJECT_ENV} must be set.`);
  }
  try {
    assertProjectForDeployment(env, ADMIN_PROJECT_ENV, projectId);
    assertWebProjectMatchesAdmin(env, projectId);
  } catch (error) {
    if (error instanceof FirebaseProjectError) throw new AdminConfigError(error.message);
    throw error;
  }
  return projectId;
}

/** Rejects a service account that belongs to a different project. */
export function assertServiceAccountProject(clientEmail: string, projectId: string): void {
  if (!clientEmail.toLowerCase().endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
    throw new AdminConfigError("The Admin service account does not belong to the configured project.");
  }
}

const ADC_PROJECT_ENVS = ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"] as const;

/**
 * Rejects ADC settings that point at another project: the Google Cloud
 * project env vars, or a service-account key file named by
 * GOOGLE_APPLICATION_CREDENTIALS. Gcloud user logins and federated
 * (external_account) files carry no project and are allowed.
 */
export function assertAdcProject(
  env: Partial<Record<string, string | undefined>>,
  projectId: string,
  readFile: (path: string) => string
): void {
  for (const name of ADC_PROJECT_ENVS) {
    const value = env[name]?.trim();
    if (value && value !== projectId) {
      throw new AdminConfigError(`${name} does not match ${ADMIN_PROJECT_ENV}.`);
    }
  }

  const keyFile = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!keyFile) return;
  let fileProject: unknown;
  try {
    fileProject = JSON.parse(readFile(keyFile)).project_id;
  } catch {
    throw new AdminConfigError("GOOGLE_APPLICATION_CREDENTIALS could not be read as JSON.");
  }
  if (fileProject !== undefined && fileProject !== projectId) {
    throw new AdminConfigError("GOOGLE_APPLICATION_CREDENTIALS belongs to a different project.");
  }
}
