/**
 * Server-only Firebase Admin SDK access. The .server suffix makes React
 * Router fail the build if browser code ever imports this module.
 * The Admin SDK bypasses Firestore Security Rules: check authorization first.
 */
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { readAdminOptions } from "./admin-credential.server";

export const ADMIN_APP_NAME = "devtalk-admin";

/** Returns the one Admin app, creating it on first use (safe across hot reloads). */
export function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  return existing ?? initializeApp(readAdminOptions(process.env), ADMIN_APP_NAME);
}

export const getAdminAuth = (): Auth => getAuth(getAdminApp());
export const getAdminDb = (): Firestore => getFirestore(getAdminApp());
