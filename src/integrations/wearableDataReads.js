import { supabase } from "../supabaseClient";
import { isDemoMode } from "../demoData";

// Dashboards share a query only while it is pending, for one athlete and one
// date window. Dropping that athlete's map detaches all pre-sync reads at once.
export function createWearableDataReads(fetchRows, demoRows) {
  const owners = new Map();
  return {
    async load(days = 14) {
      if (isDemoMode()) return demoRows();
      try {
        const { data } = await supabase.auth.getSession();
        const owner = data?.session?.user?.id;
        if (!owner) return {};
        if (!owners.has(owner)) owners.set(owner, new Map());
        const windows = owners.get(owner);
        if (windows.has(days)) return windows.get(days);
        const task = fetchRows(days, owner).finally(() => {
          windows.delete(days);
          if (!windows.size && owners.get(owner) === windows) owners.delete(owner);
        });
        windows.set(days, task);
        return task;
      } catch {
        return {};
      }
    },
    invalidate(owner) { owners.delete(owner); },
  };
}
