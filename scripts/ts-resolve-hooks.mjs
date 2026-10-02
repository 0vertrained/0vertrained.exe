// Node module-resolution hook for running the TypeScript source directly
// (`node --experimental-strip-types --import ./scripts/ts-resolve.mjs …`).
// The app's imports are extensionless (Vite resolves them); Node's ESM
// loader does not, so this appends .ts where such a file exists.
import { access } from "node:fs/promises";

const HAS_EXTENSION = /\.[a-z0-9]+$/i;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !HAS_EXTENSION.test(specifier) && context.parentURL?.startsWith("file:")) {
    const base = new URL(specifier, context.parentURL).href;
    for (const suffix of [".ts", ".tsx", "/index.ts"]) {
      try {
        await access(new URL(base + suffix));
        return next(base + suffix, context);
      } catch {
        // try the next suffix
      }
    }
  }
  return next(specifier, context);
}
