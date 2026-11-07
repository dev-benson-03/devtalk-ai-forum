/**
 * The choices and limits of the create-forum and comment forms. Shared by
 * the pages and by the server, which accepts nothing outside them.
 */

export const FORUM_CATEGORIES = [
  "Technology",
  "Programming",
  "Career Advice",
  "Education",
  "AI/Machine Learning",
  "Web Development",
  "Mobile Development",
  "General Discussion",
  "Other",
] as const;

/** Time-limit options in hours (5 minutes to 1 week). */
export const FORUM_TIME_LIMITS = [
  { hours: 0.083, label: "5 minutes" },
  { hours: 0.25, label: "15 minutes" },
  { hours: 0.5, label: "30 minutes" },
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "24 hours (1 day)" },
  { hours: 48, label: "48 hours (2 days)" },
  { hours: 72, label: "72 hours (3 days)" },
  { hours: 168, label: "1 week" },
] as const;

/** Maximum characters per field (the same limits as firestore.rules had). */
export const TEXT_LIMITS = {
  title: 200,
  description: 2_000,
  question: 1_000,
  content: 5_000,
  displayName: 256,
} as const;

export const ANONYMOUS_NAME = "Anonymous User";
