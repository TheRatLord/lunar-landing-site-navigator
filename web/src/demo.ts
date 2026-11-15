const DEMO_PATH = /^\/demo\/?$/;
const CLEARED = ["lunarnav.scenario.draft", "lunarnav.alternatives", "lunarnav.compare"];
const SEARCH_KEY = "lunarnav.plan-search.v2";

if (typeof window !== "undefined" && DEMO_PATH.test(window.location.pathname)) {
  try {
    for (const key of CLEARED) localStorage.removeItem(key);
    const search: unknown = JSON.parse(localStorage.getItem(SEARCH_KEY) ?? "{}");
    if (search && typeof search === "object" && !Array.isArray(search)) {
      delete (search as Record<string, unknown>)["draft"];
      localStorage.setItem(SEARCH_KEY, JSON.stringify(search));
    } else localStorage.removeItem(SEARCH_KEY);
  } catch {
  }
  window.history.replaceState(null, "", "/overview");
}
