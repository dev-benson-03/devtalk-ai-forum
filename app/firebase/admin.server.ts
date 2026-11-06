/**
 * Server-only Firebase Admin SDK access. The .server suffix makes React
 * Router fail the build if browser code ever imports this module.
 * The Admin SDK bypasses Firestore Security Rules: check authorization first.
 */
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { readAdminOptions } from "./admin-credential.server";
import { AdminConfigError, readAdminProjectId } from "./admin-project.server";

export const ADMIN_APP_NAME = "devtalk-admin";

/**
 * Returns the one Admin app, creating it on first use (safe across hot
 * reloads). The project ID is re-checked on reuse, so a cached app can never
 * serve a project other than the one configured now.
 */
export function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (!existing) return initializeApp(readAdminOptions(process.env), ADMIN_APP_NAME);
  if (existing.options.projectId !== readAdminProjectId(process.env)) {
    throw new AdminConfigError("The running Admin app targets a different project.");
  }
  return existing;
}

export const getAdminAuth = (): Auth => getAuth(getAdminApp());
export const getAdminDb = (): Firestore => getFirestore(getAdminApp());
