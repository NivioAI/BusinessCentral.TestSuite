import type { MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "../shared/menu-actions";

export interface MenuContext {
  appName: string;
  isMac: boolean;
  /** Reload and developer tools are for development only. */
  isDev: boolean;
  /** Ask the window to do something. */
  send(action: MenuAction): void;
  stopRun(): void;
  openDataFolder(): void;
  showAbout(): void;
}

/**
 * The application menu. It mirrors the screens and the main actions of the app, so everything
 * has a place in the menu bar and a shortcut, and it never starts a run: "Run a test" opens the
 * search, where the usual review page still stands between you and a run.
 */
export function buildMenuTemplate(context: MenuContext): MenuItemConstructorOptions[] {
  const { appName, isMac, isDev, send } = context;
  const action = (
    label: string,
    value: MenuAction,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(value) });

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { label: `About ${appName}`, click: () => context.showAbout() },
      { type: "separator" },
      action("Settings…", "go:settings", "CmdOrCtrl+,"),
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      action("Import Test…", "new:import-test", "CmdOrCtrl+Shift+I"),
      action("New Test Plan", "new:plan"),
      action("New Customer", "new:customer"),
      action("Add Environment", "new:environment"),
      action("Add Project", "new:project"),
      { type: "separator" },
      action("Export Workspace…", "workspace:export"),
      action("Import Workspace…", "workspace:import"),
      { type: "separator" },
      ...(isMac
        ? [{ role: "close" as const }]
        : [action("Settings…", "go:settings", "CmdOrCtrl+,"), { role: "quit" as const }]),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };

  const goMenu: MenuItemConstructorOptions = {
    label: "Go",
    submenu: [
      action("Search and Actions…", "palette", "CmdOrCtrl+K"),
      { type: "separator" },
      action("Dashboard", "go:dashboard", "CmdOrCtrl+1"),
      action("Test Library", "go:tests", "CmdOrCtrl+2"),
      action("Test Plans", "go:plans", "CmdOrCtrl+3"),
      action("Run History", "go:runs", "CmdOrCtrl+4"),
      action("Investigations", "go:investigations", "CmdOrCtrl+5"),
      { type: "separator" },
      action("Customers", "go:customers", "CmdOrCtrl+6"),
      action("Environments", "go:environments", "CmdOrCtrl+7"),
      action("Projects", "go:projects", "CmdOrCtrl+8"),
    ],
  };

  const runMenu: MenuItemConstructorOptions = {
    label: "Run",
    submenu: [
      action("Run a Test…", "palette", "CmdOrCtrl+Shift+R"),
      { label: "Stop Active Run", accelerator: "CmdOrCtrl+.", click: () => context.stopRun() },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      action("Larger Text", "text-size:larger", "CmdOrCtrl+Plus"),
      action("Smaller Text", "text-size:smaller", "CmdOrCtrl+-"),
      action("Default Text Size", "text-size:reset", "CmdOrCtrl+0"),
      { type: "separator" },
      { role: "togglefullscreen" },
      ...(isDev
        ? ([
            { type: "separator" },
            { role: "reload" },
            { role: "toggleDevTools" },
          ] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: isMac
      ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
      : [{ role: "minimize" }, { role: "close" }],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: "Help",
    role: "help",
    submenu: [
      action(`${appName} Help`, "go:help", "F1"),
      action("Keyboard Shortcuts", "shortcuts"),
      { type: "separator" },
      { label: "Open Data Folder", click: () => context.openDataFolder() },
      ...(isMac
        ? []
        : [
            { type: "separator" as const },
            { label: `About ${appName}`, click: () => context.showAbout() },
          ]),
    ],
  };

  return [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    goMenu,
    runMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ];
}
