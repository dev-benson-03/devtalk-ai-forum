import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
// @ts-ignore
import { db } from '../firebase';
import {
  PublishError,
  publishComment,
  publishForum,
  type CommentSubmission,
  type ForumSubmission,
} from '../forum/publish-client';
import { listedForumsQuery } from './forum-data';

// Types for our forum data structure
export interface Forum {
  id: string;
  title: string;
  description: string;
  question: string;
  creatorId: string;
  creatorName: string;
  createdAt: Timestamp; 
  endTime?: Timestamp;
  isActive: boolean;
  isAdminDeleted: boolean; // New field to track admin deletion
  upvotes: number;
  downvotes: number;
  commentCount: number;
  tags?: string[];
  summary: string; 
  actionRoadmap: string[]; 
  messages: string[];
}

export interface Comment {
  id: string;
  forumId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: Timestamp;
  upvotes: number;
  downvotes: number;
  parentId?: string; // for nested replies
}

export interface Vote {
  id: string;
  userId: string;
  forumId?: string;
  commentId?: string;
  type: 'upvote' | 'downvote';
  createdAt: Timestamp;
}

/** A safe error category for logs: a Firebase or publish code, never a message or payload. */
export function errorCode(error: unknown): string {
  if (error instanceof PublishError) return `publish/${error.kind}${error.status ? `-${error.status}` : ''}`;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[a-z-]+(\/[a-z0-9-]{1,64})?$/.test(code) ? code : 'unknown';
}

/** Structured browser diagnostics: operation, safe IDs, counts, codes. No content. */
export function logFirestoreError(operation: string, error: unknown, fields: Record<string, unknown> = {}) {
  console.error(`[${operation}] failed`, { ...fields, code: errorCode(error) });
}

export function useFirestore() {
  // Forum operations
  // New forums are published by the server (moderation, then an Admin SDK write)
  const createForum = async (forum: ForumSubmission): Promise<string> => {
    const started = Date.now();
    try {
      const { id } = await publishForum(forum);
      console.info('[createForum] published', { forumId: id, elapsedMs: Date.now() - started });
      return id;
    } catch (error) {
      logFirestoreError('createForum', error, { elapsedMs: Date.now() - started });
      throw error;
    }
  };

  const updateForum = async (forumId: string, updates: Partial<Forum>) => {
    try {
      const forumRef = doc(db, 'forums', forumId);
      await updateDoc(forumRef, updates);
    } catch (error) {
      logFirestoreError('updateForum', error, { forumId });
      throw error;
    }
  };

  const deleteForum = async (forumId: string) => {
    try {
      await deleteDoc(doc(db, 'forums', forumId));
    } catch (error) {
      logFirestoreError('deleteForum', error, { forumId });
      throw error;
    }
  };

  // Comment operations
  // Comments are published by the server, which also updates commentCount
  const createComment = async (comment: CommentSubmission): Promise<string> => {
    const started = Date.now();
    try {
      const { id } = await publishComment(comment);
      return id;
    } catch (error) {
      logFirestoreError('createComment', error, { forumId: comment.forumId, elapsedMs: Date.now() - started });
      throw error;
    }
  };

  // Get single forum by ID
  const getForum = useCallback(async (forumId: string): Promise<Forum | null> => {
    try {
      const forumDoc = await getDoc(doc(db, 'forums', forumId));
      if (forumDoc.exists()) {
        return { id: forumDoc.id, ...forumDoc.data() } as Forum;
      }
      return null;
    } catch (error) {
      logFirestoreError('getForum', error, { forumId });
      throw error;
    }
  }, []);

  return {
    createForum,
    updateForum,
    deleteForum,
    createComment,
    getForum,
  };
}

// Custom hook for real-time forum data
export function useForums() {
  const [forums, setForums] = useState<Forum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);



  useEffect(() => {
    // Only active, not admin-deleted forums: the rules allow no broader query
    const forumsQuery = listedForumsQuery(db);

    const unsubscribe = onSnapshot(
      forumsQuery,
      (snapshot) => {
        try {
          const now = Date.now();

          const forumsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Forum[];
     
             // Filter active forums based on flags + time
          const activeForums = forumsData.filter((forum) => {
          const isActive = forum.isActive ?? true;
          const notDeleted = !(forum.isAdminDeleted ?? false);

            // Convert Firestore Timestamp to millis if present
            const endMs =
              forum.endTime instanceof Timestamp
                ? forum.endTime.toMillis()
                : typeof forum.endTime === "string"
                ? Date.parse(forum.endTime)
                : 0;

            //const withinTime = endMs === 0 || endMs > now;
            return isActive && notDeleted;
          });

          // Sort client-side by soonest ending (optional)
          activeForums.sort(
            (a, b) =>
              (a.endTime?.toMillis?.() ?? 0) - (b.endTime?.toMillis?.() ?? 0)
          );

          

          setForums(activeForums);
          setError(null);
          setLoading(false);
        } catch (err) {
          logFirestoreError('useForums', err, { count: snapshot.size });
          setError('Failed to load forums');
          setLoading(false);
        }
      },
      (err) => {
        logFirestoreError('useForums', err);
        setError('Failed to connect to database');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  return { forums, loading, error };
}

// Custom hook for real-time comments data
export function useComments(forumId: string) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!forumId) {
      setLoading(false);
      return;
    }

    // Simplified query to avoid index requirement - filter by forumId only
    const commentsQuery = query(
      collection(db, 'comments'),
      where('forumId', '==', forumId)
    );

    const unsubscribe = onSnapshot(
      commentsQuery,
      (snapshot) => {
        try {
          const commentsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Comment[];
          
          // Sort by creation time on the client side
          const sortedComments = commentsData.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.() || new Date(0);
            const bTime = b.createdAt?.toDate?.() || new Date(0);
            return aTime.getTime() - bTime.getTime();
          });
          
          setComments(sortedComments);
          setError(null);
          setLoading(false);
        } catch (err) {
          logFirestoreError('useComments', err, { forumId, count: snapshot.size });
          setError('Failed to load comments');
          setLoading(false);
        }
      },
      (err) => {
        logFirestoreError('useComments', err, { forumId });
        setError('Failed to connect to database');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [forumId]);

  return { comments, loading, error };
}

// Custom hook for fetching a single forum
export function useForum(forumId: string) {
  const [forum, setForum] = useState<Forum | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!forumId) {
      setError("No forum ID provided");
      setLoading(false);
      return;
    }

    const fetchForum = async () => {
      try {
        setLoading(true);
        setError(null);
        const forumDoc = await getDoc(doc(db, 'forums', forumId));
        if (forumDoc.exists()) {
          const forumData = { id: forumDoc.id, ...forumDoc.data() } as Forum;
          setForum(forumData);
        } else {
          setForum(null);
          setError("Forum not found");
        }
      } catch (err) {
        logFirestoreError('useForum', err, { forumId });
        setForum(null);
        setError('Failed to load forum');
      } finally {
        setLoading(false);
      }
    };

    fetchForum();
  }, [forumId]);

  return { forum, loading, error };
}
