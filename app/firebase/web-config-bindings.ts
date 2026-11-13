/**
 * The verified Firebase web configuration for each deployment environment.
 *
 * A deployment's VITE_FIREBASE_* variables must match the binding for its
 * environment, so a production API key or app ID cannot pass a Preview build
 * just because the other fields name staging. Recording the binding here, in
 * reviewed code, is what makes it independent of the deployment's variables.
 *
 * - apiKeySha256: the lowercase hex SHA-256 of the web API key, computed by
 *   the owner outside any build or session (docs/architecture/staging.md).
 *   The key itself is never stored here. The fingerprint is compared with
 *   the SHA-256 of VITE_FIREBASE_API_KEY at build time; it is never derived
 *   from that variable.
 * - The other fields are the public values from the Firebase console
 *   (Project settings > General > Your apps > the web app > Config).
 *
 * null means "not recorded yet": every build that declares that environment
 * (DEVTALK_FIREBASE_ENV or VERCEL_ENV) is refused until it is filled in.
 * Never put a service-account key, OpenAI key or any other secret here.
 */
import type { FirebaseEnvironment } from "./projects";

export interface WebConfigBinding {
  apiKeySha256: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const WEB_CONFIG_BINDINGS: Readonly<Record<FirebaseEnvironment, WebConfigBinding | null>> = {
  // Project devtalk-88046, its production web app. Supplied by the owner 2026-11-11.
  production: {
    apiKeySha256: "6cb112a50721e32b8e1eab7599d1156527e28a049bca387c064d2918ee351a77",
    authDomain: "devtalk-88046.firebaseapp.com",
    projectId: "devtalk-88046",
    storageBucket: "devtalk-88046.firebasestorage.app",
    messagingSenderId: "776218080209",
    appId: "1:776218080209:web:9cdca09bfac704224766f0",
  },
  // Project devtalk-staging, web app "DevTalk Staging Web". Supplied by the owner 2026-11-11.
  staging: {
    apiKeySha256: "5103f2c8e5bfc162d1dad7c92c6703dd94e874f0e1ad06e80a8fe801b84bd1ea",
    authDomain: "devtalk-staging.firebaseapp.com",
    projectId: "devtalk-staging",
    storageBucket: "devtalk-staging.firebasestorage.app",
    messagingSenderId: "437316971319",
    appId: "1:437316971319:web:1fa17d9b45b24f03a888b2",
  },
};
