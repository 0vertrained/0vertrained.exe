import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { historicalReplay, printSummary, REPLAY_BASELINE as baseline } from "../evals/historical-replay.mjs";

// The last ios commit before the five fixes. Load its real source from Git,
// separate from the working tree, including all transitive local imports.
const root = fileURLToPath(new URL("../", import.meta.url));
async function engines(dir) {
  const load = name => import(pathToFileURL(join(dir, "src", name + ".js")).href);
  const [strength, logging, fuel, workload, recovery, shared, coaching] = await Promise.all([
    "progressionEngine", "workoutLogging", "adaptiveTDEE", "wearableWorkoutLoad",
    "recovery/verdictResolver", "sharedCall", "coachingCalibration",
  ].map(load));
  return { strength, logging, fuel, workload, recovery, shared, coaching };
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, json: { type: "boolean" }, through: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("npm run replay:algorithms -- [--input athlete_data.json] [--through YYYY-MM-DD] [--json]\nWithout --input the replay uses a synthetic example. All processing is local.");
    return;
  }
  const input = values.input ? JSON.parse(readFileSync(resolve(values.input), "utf8")) : (await import("../evals/replay-example.mjs")).exampleHistory();
  try {
    execFileSync("git", ["cat-file", "-e", baseline + "^{commit}"], {cwd: root, stdio: "ignore"});
  } catch {
    throw new Error("Replay needs the pre-change ios commit " + baseline + ". Fetch that commit in this checkout and retry.");
  }
  const cache = mkdtempSync(join(tmpdir(), "ovt-replay-"));
  try {
    const dir = join(cache, "baseline");
    mkdirSync(dir);
    const archive = join(cache, "source.tar");
    execFileSync("git", ["archive", "--format=tar", "--output=" + archive, baseline, "src"], {cwd:root});
    execFileSync("tar", ["-xf", archive, "-C", dir]);
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    // Vite accepts the extensionless relative imports in both revisions.
    registerHooks({ resolve(id, ctx, next) {
      try { return next(id, ctx); } catch (error) {
        if (!["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(error.code) || !id.startsWith(".")) throw error;
        return next(id + ".js", ctx);
      }
    } });
    const [oldEngine, newEngine] = await Promise.all([engines(dir), engines(root)]);
    const report = historicalReplay(input, oldEngine, newEngine, {through:values.through});
    report.baseline = baseline;
    report.input = values.input ? "local export" : "synthetic example";
    console.log(values.json ? JSON.stringify(report, null, 2) : printSummary(report));
  } finally {
    rmSync(cache, {recursive:true, force:true});
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
