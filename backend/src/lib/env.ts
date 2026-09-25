import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Works from src/lib and dist/lib, regardless of the launch directory.
// Deployment secrets retain precedence; never silently replace them.
config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
  override: false,
});
