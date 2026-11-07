/**
 * Browser Firestore queries whose shape firestore.rules depends on. They take
 * the Firestore instance as a parameter so the rules tests run the same code
 * against the emulator. (Forums and comments are created by the server:
 * app/api/publish.server.ts.)
 */
import { collection, query, where, type Firestore } from "firebase/firestore";

/**
 * Forums shown on the list page. Rules are not filters: a query is allowed
 * only if every possible result is readable, so the restriction to active,
 * not admin-deleted forums has to be in the query itself. Equality filters
 * only, so no composite index is needed; the page sorts by endTime itself.
 */
export const listedForumsQuery = (db: Firestore) =>
  query(collection(db, "forums"), where("isActive", "==", true), where("isAdminDeleted", "==", false));
