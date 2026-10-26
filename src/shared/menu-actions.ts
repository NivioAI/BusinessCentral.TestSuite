/** What a menu item asks the window to do. The main process only ever sends these. */
export const MENU_ACTIONS = [
  "go:dashboard",
  "go:tests",
  "go:plans",
  "go:runs",
  "go:investigations",
  "go:customers",
  "go:environments",
  "go:projects",
  "go:settings",
  "go:help",
  "palette",
  "shortcuts",
  "new:import-test",
  "new:plan",
  "new:customer",
  "new:environment",
  "new:project",
  "workspace:export",
  "workspace:import",
  "text-size:larger",
  "text-size:smaller",
  "text-size:reset",
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

export const isMenuAction = (value: unknown): value is MenuAction =>
  typeof value === "string" && (MENU_ACTIONS as readonly string[]).includes(value);

/** The screen a "go:" action opens, as the name the window uses for it. */
export const screenOfAction = (action: MenuAction): string | undefined =>
  action.startsWith("go:") ? action.slice(3) : undefined;
