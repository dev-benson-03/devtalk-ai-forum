/**
 * Centralized Firebase configuration
 * This ensures consistent configuration across all Firebase usage
 */

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { readFirebaseConfig } from "./env";

// Static import.meta.env references so Vite inlines them in client and SSR builds
const firebaseConfig = readFirebaseConfig({
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
});

// Initialize Firebase with singleton pattern
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Export Firebase services
export const firebaseAuth = getAuth(app);
export const db = getFirestore(app);

export default app;
