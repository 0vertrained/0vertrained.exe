// Registers ts-resolve-hooks.mjs. Use: node --experimental-strip-types --import ./scripts/ts-resolve.mjs <entry>
import { register } from "node:module";

register(new URL("./ts-resolve-hooks.mjs", import.meta.url));
