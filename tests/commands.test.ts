import { describe, expect, it, vi } from "vitest";
import { type Command, GO_TO_KEYS, goToKeys, searchCommands } from "../src/renderer/commands";

const cmd = (id: string, title: string, group: Command["group"], extra: Partial<Command> = {}) =>
  ({ id, title, group, run: vi.fn(), ...extra }) as Command;

const commands = [
  cmd("a1", "Import test", "Actions", { keywords: "yaml" }),
  cmd("a2", "New test plan", "Actions"),
  cmd("g1", "Test library", "Go to"),
  cmd("t1", "BC-001 · Post purchase invoice", "Tests", { subtitle: "Run · Contoso" }),
  cmd("t2", "BC-002 · Create sales order", "Tests", { subtitle: "Run · Fabrikam" }),
  cmd("r1", "BC-001 · Post purchase invoice", "Runs", { subtitle: "Run · failed" }),
];

describe("searchCommands", () => {
  it("shows actions and screens first when the query is empty", () => {
    const ids = searchCommands(commands, "").map((item) => item.id);
    expect(ids.slice(0, 2)).toEqual(["a1", "a2"]);
    expect(ids).toContain("g1");
  });

  it("requires every word and matches title, subtitle and keywords", () => {
    expect(searchCommands(commands, "yaml").map((item) => item.id)).toEqual(["a1"]);
    expect(searchCommands(commands, "contoso").map((item) => item.id)).toEqual(["t1"]);
    expect(searchCommands(commands, "bc-001 failed").map((item) => item.id)).toEqual(["r1"]);
    expect(searchCommands(commands, "zzz")).toEqual([]);
  });

  it("ranks title matches and prefixes above others, then by group", () => {
    const ids = searchCommands(commands, "test").map((item) => item.id);
    expect(ids[0]).toBe("g1");
    expect(ids.slice(0, 3)).toEqual(["g1", "a1", "a2"]);
    expect(searchCommands(commands, "BC-001").map((item) => item.group)).toEqual(["Tests", "Runs"]);
  });

  it("is case-insensitive and limits the result count", () => {
    expect(searchCommands(commands, "IMPORT")[0].id).toBe("a1");
    const many = Array.from({ length: 100 }, (_, index) =>
      cmd(`x${index}`, `Item ${index}`, "Tests"),
    );
    expect(searchCommands(many, "item")).toHaveLength(30);
  });
});

describe("go-to keys", () => {
  it("gives every screen one unique key and a key cap hint", () => {
    const views = Object.values(GO_TO_KEYS).map((item) => item.view);
    expect(new Set(views).size).toBe(views.length);
    expect(goToKeys("tests")).toEqual(["G", "L"]);
    expect(goToKeys("dashboard")).toEqual(["G", "D"]);
  });
});
