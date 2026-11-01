# Netlify deploy hotfix

Netlify deploys every JavaScript or TypeScript file directly inside `netlify/functions` as a serverless function. Test filenames such as `account-recovery.test.js` are therefore invalid deploy targets because the inferred function name contains a period.

This hotfix:

- moves `account-recovery.test.js` to `netlify/tests/account-recovery.test.js`;
- updates its import to target the production function;
- adds `netlify/tests/functions-directory.test.js`, which fails if a test/spec file or another invalid deployable filename is placed directly in `netlify/functions`.

No Netlify configuration or environment-variable change is required for this fix. Redeploy the repository normally.
