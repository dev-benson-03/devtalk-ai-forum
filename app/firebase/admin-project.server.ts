/**
 * Firebase project isolation for the Admin SDK. Validation only: nothing here
 * initializes the SDK. Errors are safe to log; they never include env values.
 */

/** Projects this deployment may operate on. The capstone project is excluded. */
export const ALLOWED_ADMIN_PROJECT_IDS: readonly string[] = ["devtalk-88046"];

export const ADMIN_PROJECT_ENV = "FIREBASE_ADMIN_PROJECT_ID";

/** A sanitized Admin configuration error. Maps to HTTP 500. */
export class AdminConfigError extends Error {
  readonly code = "admin/invalid-config";
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigError";
  }
}

/** Returns the explicit, allow-listed project ID or throws AdminConfigError. */
export function readAdminProjectId(env: Partial<Record<string, string | undefined>>): string {
  const projectId = env[ADMIN_PROJECT_ENV]?.trim();
  if (!projectId) {
    throw new AdminConfigError(`${ADMIN_PROJECT_ENV} must be set.`);
  }
  if (!ALLOWED_ADMIN_PROJECT_IDS.includes(projectId)) {
    throw new AdminConfigError(`${ADMIN_PROJECT_ENV} is not an allowed project for this deployment.`);
  }
  return projectId;
}
