/**
 * @jest-environment node
 *
 * Guards the client/server split. React Router refuses to bundle *.server
 * modules for the browser, so Admin SDK code must only live in those files.
 */
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

const APP_DIR = join(__dirname, "..", "..");
const isTest = (path: string) => /(__tests__|\.test\.)/.test(path);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) && !isTest(path) ? [path] : [];
  });
}

const files = sourceFiles(APP_DIR).map((path) => ({
  path: relative(APP_DIR, path),
  code: readFileSync(path, "utf8"),
}));

describe("server-only imports", () => {
  it("imports firebase-admin only from *.server modules", () => {
    const offenders = files
      .filter(({ code }) => /from\s+["']firebase-admin/.test(code))
      .filter(({ path }) => !/\.server\.tsx?$/.test(path))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("has Admin SDK modules to guard", () => {
    expect(files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([join("firebase", "admin.server.ts")])
    );
  });

  it("never exposes Admin credentials through VITE_ variables", () => {
    const offenders = files
      .filter(({ code }) => /VITE_FIREBASE_ADMIN|VITE_OPENAI/.test(code))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("only takes types from *.server modules in shared files", () => {
    const offenders = files
      .filter(({ path }) => !/\.server\.tsx?$/.test(path) && !path.startsWith("api"))
      .filter(({ code }) => /^import\s+(?!type\b)[^;]*from\s+["'][^"']*\.server["']/m.test(code))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
