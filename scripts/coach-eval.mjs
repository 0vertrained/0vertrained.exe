#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  callOllamaModel,
  detectImmediateSafetyQuestion,
  buildSafetyReply,
  ensureGroundedFooter,
  resolveModelStack,
  selectCoachRoute,
} from "../netlify/functions/_coach-model-router.js";

const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const casesPath = resolve(process.cwd(), "evals/coach-cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const stack = resolveModelStack(process.env);
const candidates = [stack.fast, stack.main, stack.deep, stack.fallback]
  .filter((model, index, all) => all.findIndex((item) => item.model === model.model) === index);

function systemPrompt(route) {
  return [
    "You are the unified 0VERTRAINED physique coach.",
    "The evidence packet is authoritative. Cite claims using only present IDs such as [E1].",
    "Do not invent missing numbers. Do not silently change plans. Clinician constraints are hard rules.",
    route === "deep" ? "Perform careful longitudinal analysis and state uncertainty."
      : route === "fast" ? "Answer in one to three concise sentences."
        : "Lead with a direct answer and one useful action.",
  ].join("\n");
}

function userPrompt(testCase) {
  return `Evidence packet:\n${JSON.stringify(testCase.packet, null, 2)}\n\nQuestion:\n${testCase.question}`;
}

function containsAny(text, terms = []) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(String(term).toLowerCase()));
}

function scoreAnswer(testCase, answer, grounding) {
  let score = 0;
  const checks = {};
  if (testCase.mustMention?.length) {
    checks.mustMention = testCase.mustMention.every((term) => answer.toLowerCase().includes(String(term).toLowerCase()));
    if (checks.mustMention) score += 2;
  }
  if (testCase.mustMentionAny?.length) {
    checks.mustMentionAny = containsAny(answer, testCase.mustMentionAny);
    if (checks.mustMentionAny) score += 2;
  }
  checks.forbidden = !(testCase.forbidden || []).some((term) => answer.toLowerCase().includes(String(term).toLowerCase()));
  if (checks.forbidden) score += 3;
  checks.citations = !testCase.mustCite || grounding.ids.length > 0;
  if (checks.citations) score += 3;
  return { score, max: 10, checks };
}

const routing = cases.map((testCase) => {
  const safety = detectImmediateSafetyQuestion(testCase.question);
  const selected = safety ? { route: "safety", reason: safety.reason } : selectCoachRoute(testCase.question, testCase.packet);
  return { id: testCase.id, expected: testCase.expectedRoute, actual: selected.route, pass: selected.route === testCase.expectedRoute };
});

if (!live) {
  const failed = routing.filter((row) => !row.pass);
  console.log(`Coach eval dry run: ${routing.length - failed.length}/${routing.length} routing cases passed.`);
  for (const row of failed) console.error(`  ${row.id}: expected ${row.expected}, got ${row.actual}`);
  process.exit(failed.length ? 1 : 0);
}

const apiKey = process.env.OLLAMA_API_KEY;
if (!apiKey) {
  console.error("OLLAMA_API_KEY is required for --live.");
  process.exit(1);
}

const results = [];
for (const testCase of cases) {
  const safety = detectImmediateSafetyQuestion(testCase.question);
  if (safety) {
    const deterministic = buildSafetyReply(safety, testCase.packet);
    const grounding = ensureGroundedFooter(deterministic.reply, testCase.packet.evidence, { required: false });
    results.push({ caseId: testCase.id, model: "deterministic", route: "safety", answer: grounding.reply, latencyMs: 0, ...scoreAnswer(testCase, grounding.reply, grounding) });
    continue;
  }
  const selected = selectCoachRoute(testCase.question, testCase.packet);
  for (const modelSpec of candidates) {
    const started = Date.now();
    try {
      const response = await callOllamaModel({
        apiKey,
        modelSpec,
        system: systemPrompt(selected.route),
        userContent: userPrompt(testCase),
      });
      const grounding = ensureGroundedFooter(response.reply, testCase.packet.evidence, { required: testCase.mustCite === true });
      results.push({
        caseId: testCase.id,
        suite: testCase.suite,
        model: modelSpec.model,
        route: selected.route,
        answer: grounding.reply,
        latencyMs: response.latencyMs || Date.now() - started,
        groundingStatus: grounding.status,
        ...scoreAnswer(testCase, grounding.reply, grounding),
      });
    } catch (error) {
      results.push({ caseId: testCase.id, suite: testCase.suite, model: modelSpec.model, route: selected.route, error: String(error?.message || error), score: 0, max: 10, latencyMs: Date.now() - started });
    }
  }
}

const byModel = {};
for (const row of results) {
  const current = byModel[row.model] || { model: row.model, score: 0, max: 0, runs: 0, failures: 0, latencyMs: 0 };
  current.score += row.score || 0;
  current.max += row.max || 10;
  current.runs += 1;
  current.failures += row.error ? 1 : 0;
  current.latencyMs += row.latencyMs || 0;
  byModel[row.model] = current;
}
for (const value of Object.values(byModel)) value.avgLatencyMs = Math.round(value.latencyMs / Math.max(1, value.runs));

mkdirSync(resolve(process.cwd(), "artifacts"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = resolve(process.cwd(), `artifacts/coach-eval-${stamp}.json`);
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), cases: basename(casesPath), routing, summary: Object.values(byModel), results }, null, 2));
console.log(`Wrote ${outPath}`);
console.table(Object.values(byModel).map((row) => ({ model: row.model, score: `${row.score}/${row.max}`, avgLatencyMs: row.avgLatencyMs, failures: row.failures })));
