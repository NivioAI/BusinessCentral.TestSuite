import {
  Activity,
  Boxes,
  CircleHelp,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  SearchCheck,
  Settings,
  TestTube2,
  Users,
} from "lucide-react";

export type View =
  | "dashboard"
  | "tests"
  | "plans"
  | "customers"
  | "environments"
  | "projects"
  | "investigations"
  | "runs"
  | "help"
  | "settings";

export type NavigationItem = { id: View; label: string; icon: typeof LayoutDashboard };

export const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Overview",
    items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Testing",
    items: [
      { id: "tests", label: "Test library", icon: TestTube2 },
      { id: "plans", label: "Test plans", icon: ClipboardList },
      { id: "runs", label: "Run history", icon: Activity },
      { id: "investigations", label: "Investigations", icon: SearchCheck },
    ],
  },
  {
    label: "Configuration",
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "environments", label: "Environments", icon: Boxes },
      { id: "projects", label: "Projects", icon: GitBranch },
    ],
  },
];

export const pageSubtitles: Record<View, string> = {
  dashboard: "What needs attention and what is ready to run.",
  tests: "Reusable flows per customer. Replay them visibly.",
  plans: "Ordered sets of tests for one environment. Stops at the first failure.",
  runs: "Every replay with its evidence, kept locally.",
  customers: "Customers and their test groups.",
  environments: "Business Central targets, credentials and companies.",
  projects: "The AL code behind each environment, linked to tests.",
  investigations: "Failed runs handed to a coding agent, from plan to verified fix.",
  help: "How NIVIO Test Suite works.",
  settings: "How NIVIO Test Suite behaves on this device.",
};

export const navigation: NavigationItem[] = [
  ...navigationGroups.flatMap((group) => group.items),
  { id: "help", label: "Help", icon: CircleHelp },
  { id: "settings", label: "Settings", icon: Settings },
];
