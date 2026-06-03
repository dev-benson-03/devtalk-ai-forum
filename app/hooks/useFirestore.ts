import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
// @ts-ignore
import { db } from '../firebase';

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

export function useFirestore() {
  // Forum operations
  const createForum = async (forumData: Omit<Forum, 'id' | 'createdAt' | 'upvotes' | 'downvotes' | 'commentCount'>) => {
    console.log("[createForum] Attempting to add forum:", forumData);
    try {
      const docRef = await addDoc(collection(db, 'forums'), forumData);
      console.log("[createForum] Forum created with ID:", docRef.id);
      return docRef.id;
    } catch (error) {
      console.error("[createForum] Error adding forum:", error);
      throw error;
    }
  };

  const updateForum = async (forumId: string, updates: Partial<Forum>) => {
    try {
      const forumRef = doc(db, 'forums', forumId);
      await updateDoc(forumRef, updates);
    } catch (error) {
      console.error('Error updating forum:', error);
      throw error;
    }
  };

  const deleteForum = async (forumId: string) => {
    try {
      await deleteDoc(doc(db, 'forums', forumId));
    } catch (error) {
      console.error('Error deleting forum:', error);
      throw error;
    }
  };

  // Comment operations
  const createComment = async (commentData: Omit<Comment, 'id' | 'createdAt' | 'upvotes' | 'downvotes'>) => {
    try {
      const docRef = await addDoc(collection(db, 'comments'), {
        ...commentData,
        createdAt: serverTimestamp(),
        upvotes: 0,
        downvotes: 0,
      });
      
      // Update comment count in forum
      const forumRef = doc(db, 'forums', commentData.forumId);
      await updateDoc(forumRef, {
        commentCount: increment(1)
      });
      
      return docRef.id;
    } catch (error) {
      console.error('Error creating comment:', error);
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
      console.error('Error fetching forum:', error);
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
    // Simplified query to avoid index requirement
    const forumsQuery = query(
      collection(db, 'forums'),
      orderBy("endTime", "desc"));
    

    const unsubscribe = onSnapshot(
      forumsQuery,
      (snapshot) => {
        try {
          const now = Date.now();

          const forumsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Forum[];
          console.log(forumsData);
     
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
          console.error('Error processing forums data:', err);
          setError('Failed to load forums');
          setLoading(false);
        }
      },
      (err) => {
        console.error('Error fetching forums:', err);
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
          console.error('Error processing comments data:', err);
          setError('Failed to load comments');
          setLoading(false);
        }
      },
      (err) => {
        console.error('Error fetching comments:', err);
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
        console.error('Error fetching forum:', err);
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
