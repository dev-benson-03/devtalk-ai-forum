/**
 * createCommentRecord retry behaviour (the rules themselves are tested
 * against the emulator in tests/firestore-rules).
 */
const mockRunTransaction = jest.fn();
const mockGetDoc = jest.fn();
jest.mock("firebase/firestore", () => ({
  collection: jest.fn(),
  doc: jest.fn((_db: unknown, col: string, id: string) => ({ col, id })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  query: jest.fn(),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  serverTimestamp: jest.fn(() => "SERVER_TIME"),
  where: jest.fn(),
}));

import { COMMENT_ATTEMPTS, createCommentRecord } from "./forum-data";

const denied = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
const forumWith = (commentCount: unknown) => ({ exists: () => true, data: () => ({ commentCount }) });
const comment = { forumId: "f1", userId: "u1", userName: "U", content: "Hi" };

/** Runs the transaction body against a forum with the given count, then fails or commits. */
function attempt(count: number, fail: boolean) {
  mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => Promise<string>) => {
    const result = await fn({ get: async () => forumWith(count), set: jest.fn(), update: jest.fn() });
    if (fail) throw denied();
    return result;
  });
}

beforeEach(() => {
  mockRunTransaction.mockReset();
  mockGetDoc.mockReset();
});

it("retries with the next number when another comment took it first", async () => {
  attempt(0, true);
  mockGetDoc.mockResolvedValueOnce(forumWith(1));
  attempt(1, false);
  await expect(createCommentRecord({} as never, comment)).resolves.toBe("f1_2");
  expect(mockRunTransaction).toHaveBeenCalledTimes(2);
});

it("does not retry a denial when the count did not change (e.g. a closed forum)", async () => {
  attempt(3, true);
  mockGetDoc.mockResolvedValueOnce(forumWith(3));
  await expect(createCommentRecord({} as never, comment)).rejects.toMatchObject({ code: "permission-denied" });
  expect(mockRunTransaction).toHaveBeenCalledTimes(1);
});

it("gives up after a few attempts", async () => {
  for (let i = 0; i < COMMENT_ATTEMPTS; i++) {
    attempt(i, true);
    mockGetDoc.mockResolvedValueOnce(forumWith(i + 1));
  }
  await expect(createCommentRecord({} as never, comment)).rejects.toMatchObject({ code: "permission-denied" });
  expect(mockRunTransaction).toHaveBeenCalledTimes(COMMENT_ATTEMPTS);
});

it("does not retry other errors", async () => {
  mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "unavailable" }));
  await expect(createCommentRecord({} as never, comment)).rejects.toMatchObject({ code: "unavailable" });
  expect(mockGetDoc).not.toHaveBeenCalled();
});
