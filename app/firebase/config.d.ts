// Types for the untyped Firebase setup in config.js
import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

export declare const firebaseAuth: Auth;
export declare const db: Firestore;
declare const app: FirebaseApp;
export default app;
