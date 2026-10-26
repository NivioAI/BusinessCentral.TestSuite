import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { buildMenuTemplate } from "../src/main/app-menu";
import { MENU_ACTIONS, isMenuAction, screenOfAction } from "../src/shared/menu-actions";

function build(options: { isMac?: boolean; isDev?: boolean } = {}) {
  const send = vi.fn();
  const stopRun = vi.fn();
  const openDataFolder = vi.fn();
  const showAbout = vi.fn();
  const template = buildMenuTemplate({
    appName: "NIVIO Test Suite",
    isMac: options.isMac ?? true,
    isDev: options.isDev ?? false,
    send,
    stopRun,
    openDataFolder,
    showAbout,
  });
  return { template, send, stopRun, openDataFolder, showAbout };
}

const items = (menu: MenuItemConstructorOptions | undefined) =>
  (menu?.submenu as MenuItemConstructorOptions[] | undefined) ?? [];
const menuNamed = (template: MenuItemConstructorOptions[], label: string) =>
  template.find((entry) => entry.label === label);
const flat = (template: MenuItemConstructorOptions[]) => template.flatMap((entry) => items(entry));
const labelled = (template: MenuItemConstructorOptions[], label: string) =>
  flat(template).find((item) => item.label === label);

describe("application menu", () => {
  it("starts with the app menu on macOS, named after the app, with About, Settings and Quit", () => {
    const { template } = build({ isMac: true });
    expect(template[0].label).toBe("NIVIO Test Suite");
    const labels = items(template[0]).map((item) => item.label ?? item.role);
    expect(labels).toContain("About NIVIO Test Suite");
    expect(labels).toContain("Settings…");
    expect(labels).toContain("quit");
    expect(template.map((entry) => entry.label)).toEqual([
      "NIVIO Test Suite",
      "File",
      "Edit",
      "Go",
      "Run",
      "View",
      "Window",
      "Help",
    ]);
  });

  it("has no app menu elsewhere: Quit and Settings move to File, About to Help", () => {
    const { template } = build({ isMac: false });
    expect(template.map((entry) => entry.label)).toEqual([
      "File",
      "Edit",
      "Go",
      "Run",
      "View",
      "Window",
      "Help",
    ]);
    const file = items(menuNamed(template, "File")).map((item) => item.label ?? item.role);
    expect(file).toContain("Settings…");
    expect(file).toContain("quit");
    expect(items(menuNamed(template, "Help")).map((item) => item.label)).toContain(
      "About NIVIO Test Suite",
    );
  });

  it("sends only actions the window understands, and every action has a menu item or a shortcut", () => {
    const { template, send } = build();
    for (const item of flat(template)) {
      if (
        item.label &&
        item.click &&
        !["Stop Active Run", "Open Data Folder"].includes(item.label) &&
        !item.label.startsWith("About")
      ) {
        (item.click as () => void)();
      }
    }
    const sent = send.mock.calls.map((call) => call[0]);
    expect(sent.length).toBeGreaterThan(15);
    for (const action of sent) expect(isMenuAction(action)).toBe(true);
    // Every action except the ones that only the keyboard reaches is available from the menu.
    expect(new Set(sent)).toEqual(new Set(MENU_ACTIONS));
  });

  it("gives each screen a number shortcut, and no shortcut is used twice", () => {
    for (const isMac of [true, false]) {
      const accelerators = flat(build({ isMac }).template)
        .map((item) => item.accelerator)
        .filter((value): value is string => Boolean(value))
        .map(String);
      expect(new Set(accelerators).size).toBe(accelerators.length);
    }
    const { template } = build();
    expect(labelled(template, "Dashboard")?.accelerator).toBe("CmdOrCtrl+1");
    expect(labelled(template, "Projects")?.accelerator).toBe("CmdOrCtrl+8");
    expect(labelled(template, "Search and Actions…")?.accelerator).toBe("CmdOrCtrl+K");
    expect(labelled(template, "Settings…")?.accelerator).toBe("CmdOrCtrl+,");
  });

  it("opens the search for Run a Test, so a run still goes through its review page", () => {
    const { template, send } = build();
    (labelled(template, "Run a Test…")?.click as () => void)();
    expect(send).toHaveBeenCalledWith("palette");
  });

  it("stops the active run, opens the data folder and shows About through their own handlers", () => {
    const { template, stopRun, openDataFolder, showAbout, send } = build();
    (labelled(template, "Stop Active Run")?.click as () => void)();
    (labelled(template, "Open Data Folder")?.click as () => void)();
    (labelled(template, "About NIVIO Test Suite")?.click as () => void)();
    expect(stopRun).toHaveBeenCalledTimes(1);
    expect(openDataFolder).toHaveBeenCalledTimes(1);
    expect(showAbout).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("offers reload and developer tools only in development", () => {
    const roles = (isDev: boolean) =>
      items(menuNamed(build({ isDev }).template, "View")).map((item) => item.role);
    expect(roles(true)).toEqual(expect.arrayContaining(["reload", "toggleDevTools"]));
    expect(roles(false)).not.toContain("reload");
    expect(roles(false)).not.toContain("toggleDevTools");
    expect(roles(false)).toContain("togglefullscreen");
  });

  it("has the standard editing commands so copy and paste work in every field", () => {
    const roles = items(menuNamed(build().template, "Edit")).map((item) => item.role);
    expect(roles).toEqual(
      expect.arrayContaining(["undo", "redo", "cut", "copy", "paste", "selectAll"]),
    );
  });
});

describe("menu actions", () => {
  it("recognises only the known actions", () => {
    expect(isMenuAction("go:settings")).toBe(true);
    for (const bad of ["go:nowhere", "", "palette ", 42, undefined, null, "rm -rf"]) {
      expect(isMenuAction(bad)).toBe(false);
    }
  });

  it("names the screen of a go action", () => {
    expect(screenOfAction("go:environments")).toBe("environments");
    expect(screenOfAction("palette")).toBeUndefined();
    expect(screenOfAction("new:plan")).toBeUndefined();
  });
});
