import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { assertWebConfigForDeployment } from "./app/firebase/projects";

export default defineConfig(({ mode }) => {
  // Fail the build when a Preview or Production deployment's browser Firebase
  // config names the wrong project (app/firebase/projects.ts). A no-op unless
  // DEVTALK_FIREBASE_ENV or VERCEL_ENV is set.
  assertWebConfigForDeployment({ ...loadEnv(mode, process.cwd(), ""), ...process.env });
  return {
    server: {
      host: "0.0.0.0",
    },
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  };
});
