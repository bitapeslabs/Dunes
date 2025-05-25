// esbuild.config.mjs
import { build } from "esbuild";
import { dotenvRun } from "@dotenv-run/esbuild";
import dotenv from "dotenv";
import fs from "fs";

const env = dotenv.parse(fs.readFileSync(".env"));

// Manually clean up any weird Windows variables
const sanitizedEnv = Object.fromEntries(
  Object.entries(env).filter(
    ([key]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) // Only allow valid JS identifiers
  )
);

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  define: Object.fromEntries(
    Object.entries(sanitizedEnv).map(([key, val]) => [
      `process.env.${key}`,
      JSON.stringify(val),
    ])
  ),
});
