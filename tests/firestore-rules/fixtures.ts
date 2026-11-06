/** Forum and user fixtures shared by the rules tests (emulator only). */
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, doc, setDoc } from "firebase/firestore";
import { asDb } from "./setup";

const HOUR = 60 * 60 * 1000;
export const future = () => Timestamp.fromMillis(Date.now() + 24 * HOUR);
export const past = () => Timestamp.fromMillis(Date.now() - HOUR);

export const forum = (fields: Record<string, unknown> = {}) => ({
  title: "React Learning Forum",
  description: "Ask anything",
  question: "What next?",
  creatorId: "alice",
  creatorName: "Alice",
  endTime: future(),
  isActive: true,
  isAdminDeleted: false,
  tags: ["Technology"],
  messages: [""],
  summary: "",
  actionRoadmap: [""],
  ...fields,
});

/** Forum documents, seeded with rules disabled. */
export const FORUMS = {
  open: () => forum(),
  closed: () => forum({ endTime: past() }),
  inactive: () => forum({ isActive: false }),
  deleted: () => forum({ isAdminDeleted: true }),
  // Shape of an older document: no visibility flags, endTime or commentCount
  legacy: () => ({ title: "Old forum", description: "d", question: "q", creatorId: "anonymous", creatorName: "Anonymous User" }),
};

export async function seedForums(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = asDb(ctx.firestore());
    for (const [id, make] of Object.entries(FORUMS)) await setDoc(doc(db, "forums", id), make());
  });
}

export function contexts(env: RulesTestEnvironment) {
  return {
    signedOut: asDb(env.unauthenticatedContext().firestore()),
    alice: asDb(env.authenticatedContext("alice", { name: "Alice" }).firestore()),
    bob: asDb(env.authenticatedContext("bob", { name: "Bob" }).firestore()),
    admin: asDb(env.authenticatedContext("root", { admin: true }).firestore()),
    // A claim that isn't exactly `true` is not admin
    fakeAdmin: asDb(env.authenticatedContext("mallory", { admin: "true" }).firestore()),
  };
}
