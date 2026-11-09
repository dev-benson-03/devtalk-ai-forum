/**
 * Opens the Firestore EMULATOR for the visibility rehearsal, and nothing else.
 *
 * The target is validated from process.env, the environment the Admin SDK
 * itself reads, before firebase-admin is loaded: a loopback
 * FIRESTORE_EMULATOR_HOST with a port and a demo-* project, with no
 * credential variables set. `guard()` re-checks the host and must be called
 * before every database operation, so a change after validation fails
 * closed. A named Admin app is used, never the app's production setup
 * (app/firebase/admin.server.ts), and metadata-server detection is off.
 *
 * The validator is passed in (assertSafeEmulatorTarget from the legacy
 * audit) so these modules keep type-only imports and Node can run them as is.
 */
import type { Firestore, FieldValue } from "firebase-admin/firestore";

export const CREDENTIAL_VARIABLES = ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_ADMIN_CLIENT_EMAIL"] as const;

export type AssertSafeTarget = (env: Record<string, string | undefined>, projectId: string | undefined) => { host: string; projectId: string };

export interface EmulatorStore {
  db: Firestore;
  deleteField: () => FieldValue;
  target: { host: string; projectId: string };
  /** Throws unless FIRESTORE_EMULATOR_HOST is still the validated host. Call before every operation. */
  guard: () => void;
  close: () => Promise<void>;
}

export class UnsafeRehearsalTarget extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeRehearsalTarget";
  }
}

export async function openEmulatorStore(projectId: string | undefined, assertSafe: AssertSafeTarget): Promise<EmulatorStore> {
  const present = CREDENTIAL_VARIABLES.filter((name) => process.env[name]);
  if (present.length > 0) throw new UnsafeRehearsalTarget(`credential variables are set (${present.join(", ")})`);
  const target = assertSafe(process.env, projectId);
  const guard = () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== target.host) {
      throw new UnsafeRehearsalTarget("FIRESTORE_EMULATOR_HOST changed after validation");
    }
  };
  const { initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  process.env.METADATA_SERVER_DETECTION = "none";
  guard();
  const app = initializeApp({ projectId: target.projectId }, `visibility-rehearsal-${process.pid}-${Date.now()}`);
  const db = getFirestore(app);
  return {
    db,
    deleteField: () => FieldValue.delete(),
    target,
    guard,
    close: async () => {
      await db.terminate();
      await deleteApp(app);
    },
  };
}
