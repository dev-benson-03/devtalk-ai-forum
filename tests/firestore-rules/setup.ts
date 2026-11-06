/**
 * Shared Firestore emulator setup for rules tests. Uses a demo-* project, so
 * no credentials are needed and nothing can reach a real Firebase project.
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { setLogLevel, type Firestore } from "firebase/firestore";
import { readFileSync } from "fs";
import { join } from "path";

export const PROJECT_ID = "demo-devtalk";

// Denied writes are expected in these tests; keep the SDK from logging each one
setLogLevel("silent");

export function startRulesEnv(): Promise<RulesTestEnvironment> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Run these tests with `npm run test:rules` (starts the Firestore emulator).");
  }
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(join(__dirname, "..", "..", "firestore.rules"), "utf8") },
  });
}

/** The rules-unit-testing contexts return a Firestore usable with the modular API. */
export const asDb = (firestore: unknown) => firestore as Firestore;
