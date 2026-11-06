/**
 * Firestore Security Rules tests. They run against the local Firestore
 * emulator only (demo project, no credentials): `npm run test:rules`.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests/firestore-rules"],
  moduleNameMapper: { "^~/(.*)$": "<rootDir>/app/$1" },
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }] },
  testTimeout: 30000,
  // All files share one emulator database and clear it between tests
  maxWorkers: 1,
};
