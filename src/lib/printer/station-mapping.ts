/**
 * Map menu category name → prep station. Used by ticket-builder to split a
 * transaction's items between kitchen and bar tickets.
 *
 * Categories adalah seed-data driven (11 fixed); jika Owner nambah category
 * baru, update map ini. Tidak ada DB schema field — Mahakan single-outlet,
 * 11 cat seed-locked, hardcoded sufficient. (Schema field tracked sebagai
 * Phase 3 polish kalau Owner butuh per-outlet flexibility.)
 */
export type Station = "kitchen" | "bar";

const CATEGORY_NAME_TO_STATION: Record<string, Station> = {
  // Food → kitchen
  Ricebowl: "kitchen",
  Bakmie: "kitchen",
  Sweets: "kitchen",
  Bites: "kitchen",
  // Drink → bar
  "Coffee Based": "bar",
  "Non-Coffee": "bar",
  "Tea Based": "bar",
  Frappe: "bar",
  Mocktail: "bar",
  "Manual Brew": "bar",
  "Ice Cream": "bar",
};

export function categoryToStation(categoryName: string): Station | null {
  return CATEGORY_NAME_TO_STATION[categoryName.trim()] ?? null;
}

/** Returns the full known map — used by tests to assert seed coverage. */
export function knownCategories(): string[] {
  return Object.keys(CATEGORY_NAME_TO_STATION);
}
