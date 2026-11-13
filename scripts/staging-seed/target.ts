/**
 * Where the staging seed may write. Two targets only:
 *
 *   emulator  loopback FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST,
 *             a demo-* project, and no credential variables;
 *   staging   exactly devtalk-staging, confirmed on the command line, with
 *             DEVTALK_FIREBASE_ENV=staging, no emulator hosts, and nothing in
 *             the environment that names the production project.
 *
 * Production (devtalk-88046) is refused everywhere. Pure: no I/O, no imports,
 * so Node runs it as is. Messages name variables, never their values.
 */

export const STAGING_PROJECT = "devtalk-staging";
export const PRODUCTION_PROJECT = "devtalk-88046";
export const STAGING_SERVICE_ACCOUNT_SUFFIX = `@${STAGING_PROJECT}.iam.gserviceaccount.com`;

const EMULATOR_HOSTS = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"] as const;
const CREDENTIAL_VARIABLES = ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_ADMIN_CLIENT_EMAIL"] as const;
const PROJECT_VARIABLES = ["FIREBASE_ADMIN_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"] as const;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;

export type SeedTargetKind = "emulator" | "staging";
export type SeedTarget =
  | { kind: "emulator"; projectId: string; firestoreHost: string; authHost: string }
  | { kind: "staging"; projectId: typeof STAGING_PROJECT; credential: "service-account" | "adc" };

export class UnsafeSeedTarget extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSeedTarget";
  }
}

type Env = Record<string, string | undefined>;

/** Validates the target before anything Firebase is loaded. Throws UnsafeSeedTarget. */
export function assertSeedTarget(
  kind: string | undefined,
  env: Env,
  args: { project?: string; confirm?: string }
): SeedTarget {
  // Nothing in the environment may mention the production project, whatever the target
  const productionVariables = Object.keys(env).filter((name) => env[name]?.includes(PRODUCTION_PROJECT));
  if (productionVariables.length > 0) {
    throw new UnsafeSeedTarget(`environment variables name the production project (${productionVariables.sort().join(", ")})`);
  }
  if (args.project === PRODUCTION_PROJECT) throw new UnsafeSeedTarget("the production project is never a seed target");

  if (kind === "emulator") {
    for (const name of EMULATOR_HOSTS) {
      if (!LOOPBACK.test(env[name] ?? "")) throw new UnsafeSeedTarget(`${name} must be a loopback address with a port`);
    }
    const credentials = CREDENTIAL_VARIABLES.filter((name) => env[name]);
    if (credentials.length > 0) throw new UnsafeSeedTarget(`credential variables are set (${credentials.join(", ")})`);
    if (!args.project || !/^demo-[a-z0-9-]{1,40}$/.test(args.project)) {
      throw new UnsafeSeedTarget("the emulator target needs a demo-* --project");
    }
    return { kind, projectId: args.project, firestoreHost: env.FIRESTORE_EMULATOR_HOST!, authHost: env.FIREBASE_AUTH_EMULATOR_HOST! };
  }

  if (kind === "staging") {
    if (args.project !== STAGING_PROJECT) throw new UnsafeSeedTarget(`the staging target is only --project ${STAGING_PROJECT}`);
    if (args.confirm !== STAGING_PROJECT) throw new UnsafeSeedTarget(`staging writes need --confirm ${STAGING_PROJECT}`);
    const emulators = EMULATOR_HOSTS.filter((name) => env[name]);
    if (emulators.length > 0) throw new UnsafeSeedTarget(`emulator variables are set (${emulators.join(", ")}); unset them for staging`);
    if (env.DEVTALK_FIREBASE_ENV !== "staging") throw new UnsafeSeedTarget("DEVTALK_FIREBASE_ENV must be staging");
    if (env.VERCEL_ENV === "production") throw new UnsafeSeedTarget("VERCEL_ENV is production");
    const otherProjects = PROJECT_VARIABLES.filter((name) => env[name] && env[name] !== STAGING_PROJECT);
    if (otherProjects.length > 0) throw new UnsafeSeedTarget(`project variables name another project (${otherProjects.join(", ")})`);

    const email = env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
    const key = env.FIREBASE_ADMIN_PRIVATE_KEY?.trim();
    if (email || key) {
      if (!email || !key) throw new UnsafeSeedTarget("set both FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY, or neither");
      if (!email.toLowerCase().endsWith(STAGING_SERVICE_ACCOUNT_SUFFIX)) {
        throw new UnsafeSeedTarget("FIREBASE_ADMIN_CLIENT_EMAIL is not a devtalk-staging service account");
      }
      return { kind, projectId: STAGING_PROJECT, credential: "service-account" };
    }
    return { kind, projectId: STAGING_PROJECT, credential: "adc" };
  }

  throw new UnsafeSeedTarget('--target must be "emulator" or "staging"');
}

/** A key file named by GOOGLE_APPLICATION_CREDENTIALS must not belong to another project. */
export function assertKeyFileProject(contents: string, projectId: string): void {
  let fileProject: unknown;
  try {
    fileProject = JSON.parse(contents).project_id;
  } catch {
    throw new UnsafeSeedTarget("GOOGLE_APPLICATION_CREDENTIALS could not be read as JSON");
  }
  if (fileProject !== undefined && fileProject !== projectId) {
    throw new UnsafeSeedTarget("GOOGLE_APPLICATION_CREDENTIALS belongs to another project");
  }
}
