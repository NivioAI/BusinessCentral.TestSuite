// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Command } from "../../src/renderer/commands";
import { CommandPalette } from "../../src/renderer/components/CommandPalette";
import { useShortcuts } from "../../src/renderer/lib/useShortcuts";
import "./setup";

function makeCommands(run = vi.fn(), other = vi.fn()): Command[] {
  return [
    { id: "a", title: "Import test", group: "Actions", run },
    {
      id: "t",
      title: "BC-001 · Post invoice",
      subtitle: "Run · Contoso",
      group: "Tests",
      run: other,
    },
  ];
}

describe("CommandPalette", () => {
  it("renders nothing while closed", () => {
    render(<CommandPalette mode={undefined} commands={makeCommands()} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filters while typing and runs the highlighted entry on Enter after closing", async () => {
    const run = vi.fn();
    const other = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette mode="search" commands={makeCommands(run, other)} onClose={onClose} />);
    const box = screen.getByRole("combobox");
    expect(box).toHaveFocus();
    await userEvent.type(box, "post");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("moves with the arrow keys and runs a clicked entry", async () => {
    const run = vi.fn();
    const other = vi.fn();
    render(
      <CommandPalette
        mode="search"
        commands={makeCommands(run, other)}
        onClose={() => undefined}
      />,
    );
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(other).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("option", { name: /import test/i }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and says when nothing matches", async () => {
    const onClose = vi.fn();
    render(<CommandPalette mode="search" commands={makeCommands()} onClose={onClose} />);
    await userEvent.type(screen.getByRole("combobox"), "qqq");
    expect(screen.getByText("No results")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("lists the shortcuts in shortcuts mode without a search box", () => {
    render(<CommandPalette mode="shortcuts" commands={[]} onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Go to Test library")).toBeInTheDocument();
  });
});

function Shortcuts({ log, enabled = true }: { log: string[]; enabled?: boolean }) {
  const [typing, setTyping] = useState("");
  useShortcuts({
    enabled,
    openPalette: () => log.push("palette"),
    openShortcuts: () => log.push("shortcuts"),
    goTo: (view) => log.push(`go:${view}`),
    newItem: () => log.push("new"),
  });
  return (
    <div>
      <div className="search-box">
        <input
          aria-label="Search"
          value={typing}
          onChange={(event) => setTyping(event.target.value)}
        />
      </div>
    </div>
  );
}

describe("useShortcuts", () => {
  it("opens the palette with Ctrl+K and Cmd+K from anywhere", () => {
    const log: string[] = [];
    render(<Shortcuts log={log} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(log).toEqual(["palette", "palette"]);
  });

  it("goes to a screen with G then a letter, and ignores a stray second key", () => {
    const log: string[] = [];
    render(<Shortcuts log={log} />);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "l" });
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: "l" });
    expect(log).toEqual(["go:tests"]);
  });

  it("handles N and ? and focuses the search box with /", () => {
    const log: string[] = [];
    render(<Shortcuts log={log} />);
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "?" });
    fireEvent.keyDown(window, { key: "/" });
    expect(log).toEqual(["new", "shortcuts"]);
    expect(screen.getByLabelText("Search")).toHaveFocus();
  });

  it("does nothing for plain keys while typing, with a modifier, or when disabled", async () => {
    const log: string[] = [];
    const { rerender } = render(<Shortcuts log={log} />);
    await userEvent.type(screen.getByLabelText("Search"), "ng?");
    fireEvent.keyDown(window, { key: "n", altKey: true });
    expect(log).toEqual([]);
    screen.getByLabelText("Search").blur();
    rerender(<Shortcuts log={log} enabled={false} />);
    fireEvent.keyDown(window, { key: "n" });
    expect(log).toEqual([]);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(log).toEqual(["palette"]);
  });
});
