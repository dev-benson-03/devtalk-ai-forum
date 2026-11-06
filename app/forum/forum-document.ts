/**
 * The document the create-forum page writes to `forums`. Its shape is what
 * firestore.rules accepts for a new forum (see the rules tests).
 */
import { Timestamp } from "firebase/firestore";
import { authorIdentity, type AuthorUser } from "./author-identity";

export interface ForumForm {
  title: string;
  description: string;
  question: string;
  category: string;
  /** Hours, fractional allowed (the form offers 5 minutes to 1 week). */
  timeLimit: number;
}

export function buildForumDocument(
  form: ForumForm,
  user: AuthorUser | null,
  anonymousPreference: string | null,
  now = new Date()
) {
  const endTime = new Date(now);
  endTime.setMinutes(endTime.getMinutes() + form.timeLimit * 60);
  const creator = authorIdentity(user, anonymousPreference);
  return {
    title: form.title,
    description: form.description,
    question: form.question,
    creatorId: creator.id,
    creatorName: creator.name,
    endTime: Timestamp.fromDate(endTime),
    isActive: true,
    isAdminDeleted: false,
    tags: form.category ? [form.category] : [],
    messages: [""],
    summary: "",
    actionRoadmap: [""],
  };
}
