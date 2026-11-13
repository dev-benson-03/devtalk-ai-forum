/**
 * The synthetic staging seed: a few test accounts, forums in every posting
 * state the app distinguishes, comments (including legacy date shapes) and
 * one clearly labelled synthetic cached analysis for the What's Tea modal.
 *
 * Everything is invented. Every document carries `seed: SEED_ID` and every
 * ID starts with `seed-v1-`, so apply, verify and cleanup touch only this
 * seed. Accounts use the reserved .test domain and carry only the profile
 * field the app actually saves (the Firebase Auth displayName, set at
 * signup). No administrator claim is assigned.
 *
 * Pure: no Firebase imports. Dates are plain milliseconds or deliberately
 * malformed legacy values; seed.ts turns the `{ $timestamp }` markers into
 * Firestore Timestamps. The cache key mirrors analysisCacheKey in
 * app/api/analysis-cache.server.ts; a unit test checks the two agree.
 */
import { createHash } from "node:crypto";

export const SEED_ID = "staging-seed-v1";
export const SEED_RECORD_PATH = `stagingSeed/${SEED_ID}`;
export const SYNTHETIC_LABEL = "[Synthetic seed data, not AI-generated]";

/** Mirrors app/api/analysis-cache.server.ts (checked by a unit test). */
export const ANALYSIS_VERSION = "phase3b-1";
const ANALYSIS_MODEL = "gpt-4o-mini";
const ANALYSIS_TEMPERATURE = 0.3;

export interface SeedUser {
  uid: string;
  email: string;
  displayName: string;
}

/** A Firestore Timestamp to create, in milliseconds since the epoch. */
export interface TimestampMarker {
  $timestamp: number;
}

export type SeedValue = string | number | boolean | null | TimestampMarker | SeedValue[] | { [key: string]: SeedValue };

export interface SeedDocument {
  path: string;
  data: Record<string, SeedValue>;
}

export interface SeedPlan {
  seed: typeof SEED_ID;
  users: SeedUser[];
  documents: SeedDocument[];
  counts: { users: number; forums: number; comments: number; analysisCache: number; total: number };
}

const DAY = 86_400_000;
const ts = (ms: number): TimestampMarker => ({ $timestamp: ms });

export const SEED_USERS: SeedUser[] = [
  { uid: "seed-v1-alice", email: "seed-alice@example.test", displayName: "Seed Alice" },
  { uid: "seed-v1-bob", email: "seed-bob@example.test", displayName: "Seed Bob" },
  { uid: "seed-v1-carol", email: "seed-carol@example.test", displayName: "Seed Carol" },
];
const [alice, bob, carol] = SEED_USERS;

interface ForumSpec {
  slug: string;
  title: string;
  creator: SeedUser;
  endTime?: SeedValue; // omitted = no end time
  isActive?: boolean;
  isAdminDeleted?: boolean;
  createdAt: SeedValue;
}

function forumDoc(spec: ForumSpec, commentCount: number): SeedDocument {
  const data: Record<string, SeedValue> = {
    seed: SEED_ID,
    title: `[Seed] ${spec.title}`,
    description: `Synthetic staging forum: ${spec.title.toLowerCase()}.`,
    question: "Is this synthetic forum rendered correctly?",
    creatorId: spec.creator.uid,
    creatorName: spec.creator.displayName,
    isActive: spec.isActive ?? true,
    isAdminDeleted: spec.isAdminDeleted ?? false,
    tags: ["General Discussion"],
    messages: [""],
    summary: "",
    actionRoadmap: [""],
    commentCount,
    createdAt: spec.createdAt,
    moderationPolicy: "synthetic-seed",
  };
  if (spec.endTime !== undefined) data.endTime = spec.endTime;
  return { path: `forums/seed-v1-${spec.slug}`, data };
}

interface CommentSpec {
  forum: string;
  n: number;
  author: SeedUser | null; // null = anonymous
  content: string;
  createdAt: SeedValue;
}

function commentDoc(spec: CommentSpec): SeedDocument {
  return {
    path: `comments/seed-v1-${spec.forum}-c${spec.n}`,
    data: {
      seed: SEED_ID,
      forumId: `seed-v1-${spec.forum}`,
      userId: spec.author ? spec.author.uid : "anonymous",
      userName: spec.author ? spec.author.displayName : "Anonymous User",
      content: spec.content,
      createdAt: spec.createdAt,
      upvotes: 0,
      downvotes: 0,
      moderationPolicy: "synthetic-seed",
    },
  };
}

/** The analysis-cache document ID the server will look up for this forum and these comments. */
export function seedCacheKey(forum: SeedDocument, comments: SeedDocument[]): string {
  const forumId = forum.path.split("/")[1];
  const tags = forum.data.tags as string[];
  const context = {
    title: forum.data.title as string,
    description: forum.data.description as string,
    question: forum.data.question as string,
    category: tags[0] ?? "",
  };
  // The server sorts by createdAt; seeded cache comments use Timestamps and short text,
  // so the selection is all of them in time order
  const ordered = comments
    .filter((c) => c.data.forumId === forumId)
    .map((c) => ({ id: c.path.split("/")[1], content: c.data.content as string, at: (c.data.createdAt as TimestampMarker).$timestamp }))
    .sort((a, b) => a.at - b.at);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        version: ANALYSIS_VERSION,
        model: ANALYSIS_MODEL,
        temperature: ANALYSIS_TEMPERATURE,
        forumId,
        context,
        comments: ordered.map((c) => [c.id, "", c.content]),
      })
    )
    .digest("hex");
  return `${forumId}_${digest}`;
}

/** The complete seed relative to `nowMs` (open forums stay open for 30 days). */
export function planSeed(nowMs: number): SeedPlan {
  const commentSpecs: CommentSpec[] = [
    { forum: "open", n: 1, author: alice, content: "Synthetic comment one: the forum list renders.", createdAt: ts(nowMs - 3 * 3_600_000) },
    { forum: "open", n: 2, author: bob, content: "Synthetic comment two: replies show the author name.", createdAt: ts(nowMs - 2 * 3_600_000) },
    { forum: "open", n: 3, author: null, content: "Synthetic comment three: anonymous display.", createdAt: ts(nowMs - 3_600_000) },
    { forum: "no-end-time", n: 1, author: carol, content: "Synthetic comment on a forum with no end time.", createdAt: ts(nowMs - DAY) },
    { forum: "expired", n: 1, author: bob, content: "Synthetic comment posted before the forum closed.", createdAt: ts(nowMs - 3 * DAY) },
    { forum: "hidden", n: 1, author: alice, content: "Synthetic comment on a hidden forum.", createdAt: ts(nowMs - DAY) },
    { forum: "legacy-dates", n: 1, author: bob, content: "Synthetic legacy comment with a string date.", createdAt: "2025-03-14T09:26:00Z" },
    { forum: "legacy-dates", n: 2, author: carol, content: "Synthetic legacy comment with a number date.", createdAt: 1_710_000_000_000 },
    { forum: "legacy-dates", n: 3, author: alice, content: "Synthetic legacy comment with no date.", createdAt: null },
  ];
  const countFor = (slug: string) => commentSpecs.filter((c) => c.forum === slug).length;

  const forumSpecs: ForumSpec[] = [
    { slug: "open", title: "Open forum", creator: alice, endTime: ts(nowMs + 30 * DAY), createdAt: ts(nowMs - 4 * 3_600_000) },
    { slug: "no-end-time", title: "Open forum with no end time", creator: bob, createdAt: ts(nowMs - 2 * DAY) },
    { slug: "expired", title: "Expired forum", creator: bob, endTime: ts(nowMs - 2 * DAY), createdAt: ts(nowMs - 9 * DAY) },
    { slug: "hidden", title: "Hidden forum (creator Alice)", creator: alice, isActive: false, endTime: ts(nowMs + 30 * DAY), createdAt: ts(nowMs - 2 * DAY) },
    { slug: "admin-deleted", title: "Admin-deleted forum (creator Bob)", creator: bob, isAdminDeleted: true, endTime: ts(nowMs + 30 * DAY), createdAt: ts(nowMs - 2 * DAY) },
    { slug: "legacy-dates", title: "Legacy string end time", creator: carol, endTime: "2026-12-31T23:59:00Z", createdAt: "2025-03-01T08:00:00Z" },
    { slug: "legacy-null-end", title: "Legacy null end time", creator: carol, endTime: null, createdAt: 1_709_000_000_000 },
    { slug: "legacy-number-end", title: "Legacy number end time", creator: alice, endTime: nowMs + 30 * DAY, createdAt: { seconds: 1 } },
  ];

  const forums = forumSpecs.map((spec) => forumDoc(spec, countFor(spec.slug)));
  const comments = commentSpecs.map(commentDoc);
  const openForum = forums[0];
  const cache: SeedDocument = {
    path: `analysisCache/${seedCacheKey(openForum, comments)}`,
    data: {
      seed: SEED_ID,
      synthetic: true,
      forumId: "seed-v1-open",
      version: ANALYSIS_VERSION,
      model: "synthetic-seed (no AI call)",
      summary: `${SYNTHETIC_LABEL} Participants checked that the open forum, author names and anonymous comments display correctly.`,
      actionRoadmap: [
        `${SYNTHETIC_LABEL} Confirm the forum list shows the open forum.`,
        `${SYNTHETIC_LABEL} Confirm comment authors are shown.`,
        `${SYNTHETIC_LABEL} Confirm this text is labelled synthetic.`,
      ],
      totalMessages: 3,
      uniqueAuthors: 2,
      createdAt: ts(nowMs),
      expireAt: ts(nowMs + 90 * DAY),
    },
  };

  const documents = [...forums, ...comments, cache];
  return {
    seed: SEED_ID,
    users: SEED_USERS,
    documents,
    counts: {
      users: SEED_USERS.length,
      forums: forums.length,
      comments: comments.length,
      analysisCache: 1,
      total: SEED_USERS.length + documents.length,
    },
  };
}
