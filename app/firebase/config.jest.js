// Jest stand-in for config.js: Jest can't parse import.meta, so tests load
// this instead (see moduleNameMapper). Uses fake values for a demo project.
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { readFirebaseConfig } from "./env";

const firebaseConfig = readFirebaseConfig({
  VITE_FIREBASE_API_KEY: "test-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "demo-devtalk-test.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "demo-devtalk-test",
  VITE_FIREBASE_STORAGE_BUCKET: "demo-devtalk-test.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
});

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const firebaseAuth = getAuth(app);
export const db = getFirestore(app);

export default app;
