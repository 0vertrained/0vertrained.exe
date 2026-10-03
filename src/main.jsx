// Entry router for the strangler period: the v20 app lives at /next and the
// v19 app everywhere else. Each side is a lazy chunk, so /next never loads
// the legacy fonts, CSS, error reporting or Supabase client, and vice versa.
// A stale chunk after a deploy (the hashed file is gone) reloads the page
// once instead of leaving a blank screen.
const isNext = window.location.pathname === "/next" || window.location.pathname.startsWith("/next/");

const boot = isNext ? import("./app/main.tsx") : import("./legacy/boot.jsx");

boot.catch((error) => {
  const key = "ovt-chunk-reload";
  const failedChunk = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String(error?.message ?? error));
  if (failedChunk && !sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.reload();
    return;
  }
  sessionStorage.removeItem(key);
  throw error;
});
