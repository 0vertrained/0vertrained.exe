// eslint.config.js
// V12.1 · First static analysis in the repo. The 1000+ vitest tests cover the
// logic; ESLint covers the class of bug tests structurally miss — stale hook
// closures (react-hooks/exhaustive-deps), undefined references, accidental
// shadowing of the wrong scope. Wired into the quality gate: rule *errors*
// fail the gate; exhaustive-deps is a warning so it informs without blocking
// (several effects here intentionally run on a subset of deps, documented
// inline where so).
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },

  // ── App source (browser, JSX) ─────────────────────────────────────────────
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      // __APP_VERSION__ is a compile-time constant injected by the Vite /
      // Vitest `define` (single-sourced from package.json — see appMeta.js).
      globals: { ...globals.browser, ...globals.es2024, __APP_VERSION__: "readonly" },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "warn",
      // React-Compiler-era strictness from react-hooks v6. All flagged sites
      // predate this config, work, and are covered by the test suite; blanket
      // refactoring them in a hardening release is more regression risk than
      // the patterns themselves. Kept visible as warnings so new code gets
      // nudged; rules-of-hooks (actual crash class) stays an error.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      // JSX component usage isn't visible to core no-unused-vars without the
      // full react plugin; keep the rule for real dead code but allow the
      // `_`-prefix escape hatch and don't flag caught-error bindings.
      "no-unused-vars": ["error", {
        args: "none",
        caughtErrors: "none",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
      // This codebase leans on `try {} catch {}` for storage/JSON tolerance —
      // deliberate and commented at most sites.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ── Test files (vitest, jsdom) ────────────────────────────────────────────
  {
    files: ["src/__tests__/**/*.{js,jsx}", "src/test/**/*.{js,jsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
    },
  },

  // ── v20 TypeScript ────────────────────────────────────────────────────────
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ["src/**/*.{ts,tsx}"] })),
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2024, __APP_VERSION__: "readonly" },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },

  // ── Domain purity: pure, deterministic, framework-free ─────────────────────
  // The domain never reads the wall clock (callers pass todayKey / explicit
  // timestamps), so no test can become a date bomb. Imports outside
  // src/domain are blocked by src/domain/purity.test.ts.
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": ["error", { patterns: ["react", "react-dom", "react/*", "@supabase/*"] }],
      "no-restricted-syntax": ["error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Domain code must not read the clock; pass todayKey or a timestamp in." },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Domain code must not read the clock; pass todayKey or a timestamp in." },
        { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: "Domain code must be deterministic; pass a seed in." },
      ],
    },
  },

  // ── Serverless functions + scripts (Node) ─────────────────────────────────
  {
    files: ["netlify/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ── Service worker ────────────────────────────────────────────────────────
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
    rules: { ...js.configs.recommended.rules },
  },
];
