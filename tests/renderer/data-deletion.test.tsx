// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataDeletionSection } from "../../src/renderer/features/SettingsView";
import type { AppSnapshot } from "../../src/shared/models";
import "./setup";

const snapshot = {
  runs: [{}, {}],
  investigations: [{}],
  testPlans: [{}],
  tests: [{}, {}, {}],
  projects: [{}],
  environments: [{ hasCredential: true }],
  mcpApprovals: [],
} as unknown as AppSnapshot;

const deleteData = vi.fn();

beforeEach(() => {
  deleteData.mockReset();
  deleteData.mockResolvedValue({
    snapshot,
    result: { runs: 2, investigations: 1, plans: 0, tests: 0, projects: 0 },
  });
  (window as unknown as { bcFlow: unknown }).bcFlow = { deleteData };
});

const box = (name: RegExp) => screen.getByRole("checkbox", { name });

describe("DataDeletionSection", () => {
  it("starts with nothing selected and the delete action disabled", () => {
    render(<DataDeletionSection snapshot={snapshot} onDeleted={() => undefined} />);
    expect(screen.getByRole("button", { name: /delete selected data/i })).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
  });

  it("locks in what a selection depends on", async () => {
    render(<DataDeletionSection snapshot={snapshot} onDeleted={() => undefined} />);
    await userEvent.click(box(/^test library/i));
    for (const name of [/^run history and evidence/i, /^investigations/i, /^test plans/i]) {
      expect(box(name)).toBeChecked();
      expect(box(name)).toBeDisabled();
    }
    expect(box(/^projects/i)).not.toBeChecked();
    expect(screen.getAllByText(/included because the selection depends on it/i)).toHaveLength(3);
  });

  it("asks for confirmation inline and can be cancelled without deleting", async () => {
    render(<DataDeletionSection snapshot={snapshot} onDeleted={() => undefined} />);
    await userEvent.click(box(/^saved passwords/i));
    await userEvent.click(screen.getByRole("button", { name: /delete selected data/i }));
    expect(screen.getByText(/permanently deletes from this device/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(deleteData).not.toHaveBeenCalled();
    expect(screen.queryByText(/permanently deletes from this device/i)).toBeNull();
  });

  it("sends the dependency-closed categories and reports the result", async () => {
    const onDeleted = vi.fn();
    render(<DataDeletionSection snapshot={snapshot} onDeleted={onDeleted} />);
    await userEvent.click(box(/^run history and evidence/i));
    await userEvent.click(screen.getByRole("button", { name: /delete selected data/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete permanently/i }));
    await waitFor(() => expect(deleteData).toHaveBeenCalledWith(["runs", "investigations"]));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(snapshot));
    expect(await screen.findByText(/deleted 2 runs, 1 investigations/i)).toBeInTheDocument();
  });

  it("shows an error from the main process and stays usable", async () => {
    deleteData.mockRejectedValueOnce(new Error("Wait until the active test run has finished."));
    render(<DataDeletionSection snapshot={snapshot} onDeleted={() => undefined} />);
    await userEvent.click(box(/^investigations/i));
    await userEvent.click(screen.getByRole("button", { name: /delete selected data/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete permanently/i }));
    expect(await screen.findByText(/active test run has finished/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete selected data/i })).toBeEnabled();
  });
});
