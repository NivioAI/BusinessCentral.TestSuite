export const DATA_CATEGORIES = [
  "runs",
  "investigations",
  "plans",
  "tests",
  "projects",
  "credentials",
  "approvals",
] as const;

export type DataCategory = (typeof DATA_CATEGORIES)[number];

/** Deleting a category also deletes everything that cannot exist without it. */
const REQUIRES: Record<DataCategory, DataCategory[]> = {
  runs: ["investigations"],
  investigations: [],
  plans: [],
  tests: ["plans", "runs", "investigations"],
  projects: ["investigations"],
  credentials: [],
  approvals: [],
};

export function withDependencies(selected: readonly DataCategory[]): DataCategory[] {
  const result = new Set<DataCategory>(selected);
  for (const category of selected) for (const extra of REQUIRES[category]) result.add(extra);
  for (const category of [...result]) for (const extra of REQUIRES[category]) result.add(extra);
  return DATA_CATEGORIES.filter((category) => result.has(category));
}

export interface DataDeletionResult {
  runs: number;
  investigations: number;
  plans: number;
  tests: number;
  projects: number;
}
