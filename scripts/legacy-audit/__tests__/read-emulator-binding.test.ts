/**
 * @jest-environment node
 *
 * readEmulator re-checks FIRESTORE_EMULATOR_HOST after validation, so an
 * ambient change between the check and the reads fails closed. The Admin SDK
 * is mocked: nothing here opens a connection.
 */
import { readEmulator, UnsafeTargetError } from "../sources";

const collection = jest.fn();
jest.mock("firebase-admin/app", () => ({
  // Simulates something changing the environment after validation
  initializeApp: jest.fn(() => {
    process.env.FIRESTORE_EMULATOR_HOST = "firestore.googleapis.com:443";
    return {};
  }),
  deleteApp: jest.fn(async () => undefined),
}));
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({ collection, terminate: jest.fn(async () => undefined) })),
}));

const saved = process.env.FIRESTORE_EMULATOR_HOST;
afterEach(() => {
  if (saved === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
  else process.env.FIRESTORE_EMULATOR_HOST = saved;
});

it("refuses to read when the emulator host changes after validation", async () => {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  await expect(readEmulator("demo-devtalk")).rejects.toBeInstanceOf(UnsafeTargetError);
  expect(collection).not.toHaveBeenCalled();
});
