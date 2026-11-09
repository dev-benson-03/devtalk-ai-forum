/**
 * Input adapters for the legacy-data audit. Read-only by construction:
 *
 *   - fixtureToInput: a local JSON fixture, reduced to the audited fields.
 *   - readEmulator: the Firestore EMULATOR only. assertSafeEmulatorTarget
 *     refuses before any SDK call unless FIRESTORE_EMULATOR_HOST is a
 *     loopback address and the project is a demo-* project (demo projects
 *     can never reach a real Firebase project). It uses its own named Admin
 *     app with no credentials, never the app's production setup
 *     (app/firebase/admin.server.ts), and reads with select(...) so only
 *     the audited fields leave Firestore: no titles, text, names or emails.
 *
 * Nothing here calls set, update, create, delete, batch or runTransaction.
 * Erasable TypeScript only, so Node can run it directly (cli.mjs).
 */
import type { AuditInput, DocFields } from "./audit";

/** The only fields the audit reads. Text and identity fields are never loaded. */
export const FORUM_FIELDS = ["isActive", "isAdminDeleted", "endTime", "commentCount", "moderationPolicy"] as const;
export const COMMENT_FIELDS = ["forumId", "moderationPolicy"] as const;

const pick = (data: Record<string, unknown>, fields: readonly string[]): DocFields =>
  Object.fromEntries(fields.filter((f) => f in data).map((f) => [f, data[f]]));

/** Fixture timestamps are written as { "$timestamp": "<ISO with Z>" }. */
function reviveTimestamp(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const iso = (value as { $timestamp?: unknown }).$timestamp;
  if (typeof iso !== "string" || Object.keys(value).length !== 1) return value;
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis)) throw new Error("Fixture has an invalid $timestamp");
  return { toMillis: () => millis };
}

export function fixtureToInput(fixture: unknown): AuditInput {
  const root = (fixture ?? {}) as { forums?: unknown; comments?: unknown };
  const docs = (collection: unknown, fields: readonly string[]) => {
    if (typeof collection !== "object" || collection === null || Array.isArray(collection)) {
      throw new Error("Fixture must map document IDs to objects under 'forums' and 'comments'");
    }
    return Object.entries(collection as Record<string, Record<string, unknown>>).map(([id, data]) => ({
      id,
      fields: Object.fromEntries(Object.entries(pick(data ?? {}, fields)).map(([k, v]) => [k, reviveTimestamp(v)])),
    }));
  };
  return { forums: docs(root.forums, FORUM_FIELDS), comments: docs(root.comments, COMMENT_FIELDS) };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

/**
 * Throws unless the target is unmistakably a local emulator. Called before
 * firebase-admin is even imported.
 */
export function assertSafeEmulatorTarget(env: Record<string, string | undefined>, projectId: string | undefined): {
  host: string;
  projectId: string;
} {
  const host = env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new UnsafeTargetError("FIRESTORE_EMULATOR_HOST is not set; refusing to connect anywhere");
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(host);
  if (!match || !LOOPBACK_HOSTS.has(match[1])) {
    throw new UnsafeTargetError("FIRESTORE_EMULATOR_HOST must be a loopback address with a port (e.g. 127.0.0.1:8080)");
  }
  if (!projectId || !/^demo-[a-z0-9-]{1,40}$/.test(projectId)) {
    throw new UnsafeTargetError("The project must be a demo-* project (e.g. demo-devtalk)");
  }
  return { host, projectId };
}

/**
 * Reads the audited fields from the emulator. Read-only: get() with select() only.
 *
 * The Admin SDK reads FIRESTORE_EMULATOR_HOST from process.env, so that is
 * the only environment checked here: there is no separate env argument that
 * could pass validation while the SDK connects somewhere else. The host is
 * checked again right before the client is created and before each read, so
 * a change to process.env in between fails closed.
 */
export async function readEmulator(projectId: string | undefined): Promise<AuditInput> {
  const target = assertSafeEmulatorTarget(process.env, projectId);
  const stillSafe = () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== target.host) {
      throw new UnsafeTargetError("FIRESTORE_EMULATOR_HOST changed after validation; refusing to read");
    }
  };
  const { initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  // With FIRESTORE_EMULATOR_HOST set the Firestore client sends no real
  // credentials. This also stops the auth library from probing the cloud
  // metadata server while it looks for default credentials.
  process.env.METADATA_SERVER_DETECTION = "none";
  stillSafe();
  const app = initializeApp({ projectId: target.projectId }, `legacy-audit-${process.pid}-${Date.now()}`);
  const db = getFirestore(app);
  try {
    const read = async (collection: string, fields: readonly string[]) => {
      stillSafe();
      return (await db.collection(collection).select(...fields).get()).docs.map((doc) => ({
        id: doc.id,
        fields: pick(doc.data(), fields),
      }));
    };
    return { forums: await read("forums", FORUM_FIELDS), comments: await read("comments", COMMENT_FIELDS) };
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}
