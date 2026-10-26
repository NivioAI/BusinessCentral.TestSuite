import type { View } from "./navigation";

export type CommandGroup =
  | "Actions"
  | "Go to"
  | "Tests"
  | "Plans"
  | "Customers"
  | "Environments"
  | "Projects"
  | "Investigations"
  | "Runs";

export const GROUP_ORDER: CommandGroup[] = [
  "Actions",
  "Go to",
  "Tests",
  "Plans",
  "Investigations",
  "Projects",
  "Environments",
  "Customers",
  "Runs",
];

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: CommandGroup;
  /** Extra words that should find this command. */
  keywords?: string;
  /** Shown as key caps, for example ["G", "L"]. */
  keys?: string[];
  run(): void;
}

/** After G, the next key goes to this screen. */
export const GO_TO_KEYS: Record<string, { view: View; label: string }> = {
  d: { view: "dashboard", label: "Dashboard" },
  l: { view: "tests", label: "Test library" },
  p: { view: "plans", label: "Test plans" },
  r: { view: "runs", label: "Run history" },
  i: { view: "investigations", label: "Investigations" },
  c: { view: "customers", label: "Customers" },
  e: { view: "environments", label: "Environments" },
  j: { view: "projects", label: "Projects" },
  s: { view: "settings", label: "Settings" },
  h: { view: "help", label: "Help" },
};

export const goToKeys = (view: View): string[] | undefined => {
  const found = Object.entries(GO_TO_KEYS).find(([, value]) => value.view === view);
  return found ? ["G", found[0].toUpperCase()] : undefined;
};

export const SHORTCUT_LIST: Array<{ keys: string[]; label: string }> = [
  { keys: ["⌘/Ctrl", "K"], label: "Search and actions" },
  { keys: ["/"], label: "Focus the search box of the current screen" },
  { keys: ["N"], label: "New item on the current screen" },
  { keys: ["?"], label: "Show this overview" },
  ...Object.entries(GO_TO_KEYS).map(([key, value]) => ({
    keys: ["G", key.toUpperCase()],
    label: `Go to ${value.label}`,
  })),
];

const MAX_RESULTS = 30;

/** Every word of the query must appear in the title, subtitle or keywords. */
export function searchCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return GROUP_ORDER.flatMap((group) =>
      commands.filter((command) => command.group === group).slice(0, group === "Actions" ? 8 : 10),
    );
  }
  const scored = commands
    .map((command) => {
      const title = command.title.toLowerCase();
      const haystack = `${title} ${command.subtitle ?? ""} ${command.keywords ?? ""}`.toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return undefined;
      const titleHits = words.filter((word) => title.includes(word)).length;
      const starts = words.some((word) => title.startsWith(word)) ? 1 : 0;
      return { command, score: titleHits * 2 + starts };
    })
    .filter((entry): entry is { command: Command; score: number } => Boolean(entry));
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      GROUP_ORDER.indexOf(a.command.group) - GROUP_ORDER.indexOf(b.command.group),
  );
  return scored.slice(0, MAX_RESULTS).map((entry) => entry.command);
}
