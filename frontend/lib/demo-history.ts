import type { Activity } from "@/lib/api";

const key = "lingualens.demo-history";

export function getDemoHistory(): Activity[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(value)) return value.filter((row): row is Activity =>
      row && typeof row.id === "string" && typeof row.name === "string" &&
      ["ambiguity", "recursion", "movement", "phonology"].includes(row.dimension) &&
      row.status === "Viewed" && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
    ).slice(0, 12);
  } catch {
    // A browser can disable storage.
  }
  return [];
}

export function recordDemoView(row: Activity) {
  try {
    localStorage.setItem(key, JSON.stringify([row, ...getDemoHistory()].slice(0, 12)));
  } catch {
    // The example remains usable without browser storage.
  }
}
