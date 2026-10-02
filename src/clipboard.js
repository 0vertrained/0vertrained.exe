// src/clipboard.js
// V12.1 · Best-effort clipboard copy with a graceful fallback. Returns true
// when the async clipboard write succeeded; callers show an inline textarea
// otherwise. Extracted from TodayTab.jsx because MoreTab.jsx was calling it
// WITHOUT any import — a latent ReferenceError on the "copy coach memory" and
// "copy beta note" paths that ESLint's no-undef caught on its first run.
export async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to manual-copy fallback */ }
  return false;
}
