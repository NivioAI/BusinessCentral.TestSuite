// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import type { RunnerEvent } from "../../src/shared/models";
import "./setup";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const snapshot = {
  schemaVersion: 8,
  settings: { stepDelayMs: 500, textSize: "medium", runRetentionDays: 90 },
  customers: [{ id: id(1), code: "CONTOSO", name: "Contoso Belgium", active: true }],
  testGroups: [{ id: id(10), name: "General", system: true }],
  testPlans: [],
  testPlanRuns: [],
  environments: [],
  projects: [],
  investigations: [],
  tests: [],
  runs: [],
  parameterProfiles: [],
  mcpApprovals: [],
  diagnostics: {
    appVersion: "0.1.0",
    platform: "darwin",
    nodeVersion: "v22",
    replayExecutable: "x",
    replayAvailable: true,
    powershellAvailable: true,
    powershellExecutable: "/usr/local/bin/pwsh",
    dataDirectory: "/data",
    workspaceDirectory: "/w",
    storageRecoveredFromBackup: false,
    runtimeSource: "bundled",
    runtimeCompatibility: "compatible",
    runtimeCompatibilityMessage: "ok",
    runtimeRollbackAvailable: false,
    windowsAuthoritative: true,
  },
};

beforeEach(() => {
  localStorage.clear();
  (window as unknown as { bcFlow: unknown }).bcFlow = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "onRunnerEvent") return () => () => undefined;
        return async () => snapshot;
      },
    },
  );
});

describe("App navigation", () => {
  it("renders the dashboard and moves between screens", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^customers/i }));
    expect(await screen.findByRole("heading", { name: "Customers" })).toBeInTheDocument();
  });

  it("refuses to leave an edit page and shows why, then allows it after going back", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(screen.getByRole("button", { name: /^environments/i }));
    await userEvent.click((await screen.findAllByRole("button", { name: /add environment/i }))[0]);
    expect(await screen.findByRole("heading", { name: "Add environment" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^test library/i }));
    expect(
      await screen.findByText(/save or cancel your changes before you open another menu/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add environment" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await userEvent.click(screen.getByRole("button", { name: /^test library/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Test library" })).toBeInTheDocument(),
    );
  });

  it("asks for a customer first when there is none", async () => {
    (window as unknown as { bcFlow: unknown }).bcFlow = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "onRunnerEvent") return () => () => undefined;
          return async () => ({ ...snapshot, customers: [] });
        },
      },
    );
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(screen.getByRole("button", { name: /^environments/i }));
    await userEvent.click((await screen.findAllByRole("button", { name: /add environment/i }))[0]);
    expect(await screen.findByText(/no customers yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save environment" })).toBeDisabled();
  });

  it("opens the search palette with Ctrl+K and goes to a screen from it", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox", { name: /search tests/i });
    await userEvent.type(box, "customers");
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Customers" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /search and actions/i })).toBeNull();
  });

  it("goes to a screen with the G shortcut and starts a new item with N", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.keyboard("gc");
    expect(await screen.findByRole("heading", { name: "Customers" })).toBeInTheDocument();
    await userEvent.keyboard("n");
    expect(await screen.findByRole("heading", { name: /new customer/i })).toBeInTheDocument();
  });

  it("does not leave an edit page through the palette either", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.keyboard("gc");
    await userEvent.keyboard("n");
    await screen.findByRole("heading", { name: /new customer/i });
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(await screen.findByRole("combobox", { name: /search tests/i }), "import");
    await userEvent.keyboard("{Enter}");
    expect(
      await screen.findByText(/save or cancel your changes before you open another menu/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /new customer/i })).toBeInTheDocument();
  });

  it("shows only the investigation page, not the run page under it, and brings the run back", async () => {
    const failedRun = {
      id: "run-1",
      testId: "BC-1",
      testName: "Smoke",
      testDefinitionId: "t1",
      environmentId: "e1",
      environmentName: "Sandbox",
      customerCode: "C",
      status: "FAILED",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1000,
      parameters: {},
      versionHash: "v",
      resultDirectory: "/r",
      error: "boom",
      log: [],
      progress: [],
      steps: [],
    };
    const data = {
      ...snapshot,
      runs: [failedRun],
      environments: [
        {
          id: "e1",
          customerId: "c1",
          name: "Sandbox",
          company: "CRONUS",
          type: "sandbox",
          authentication: "Windows",
          hasCredential: true,
          active: true,
        },
      ],
      tests: [
        {
          id: "t1",
          testId: "BC-1",
          name: "Smoke",
          risk: "read-only",
          groupId: "g",
          allowedEnvironmentTypes: ["sandbox"],
          parameters: [],
          projectIds: [],
          tags: [],
        },
      ],
      projects: [{ id: "p1", environmentId: "e1", name: "Warehouse AL", agent: "claude-code" }],
    };
    (window as unknown as { bcFlow: unknown }).bcFlow = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "onRunnerEvent") return () => () => undefined;
          return async () => data;
        },
      },
    );
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(
      await screen.findByRole("combobox", { name: /search tests/i }),
      "run failed",
    );
    await userEvent.click(await screen.findByRole("option", { name: /run · failed/i }));
    expect(await screen.findByRole("heading", { name: /smoke/i })).toBeInTheDocument();
    const evidence = () => screen.queryAllByText("Evidence");
    expect(screen.getAllByRole("button", { name: /create investigation/i })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /create investigation/i }));
    expect(
      await screen.findByRole("heading", { name: "Create investigation" }),
    ).toBeInTheDocument();
    // Only the new page is on screen: the run page is gone, so there is no second heading.
    expect(screen.queryByRole("heading", { name: /smoke/i })).toBeNull();
    expect(evidence()).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByRole("heading", { name: /smoke/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create investigation" })).toBeNull();
  });

  describe("menu actions", () => {
    const saveSettings = vi.fn();
    let emit: (event: RunnerEvent) => void = () => undefined;

    function mount(extra: Record<string, unknown> = {}) {
      saveSettings.mockReset();
      saveSettings.mockResolvedValue(snapshot);
      (window as unknown as { bcFlow: unknown }).bcFlow = new Proxy(
        {},
        {
          get: (_target, key) => {
            if (key === "onRunnerEvent") {
              return (callback: (event: RunnerEvent) => void) => {
                emit = callback;
                return () => undefined;
              };
            }
            if (key === "saveSettings") return saveSettings;
            return async () => ({ ...snapshot, ...extra });
          },
        },
      );
      render(<App />);
    }

    it("goes to a screen, opens the search and starts a new item from the menu", async () => {
      mount();
      await screen.findByRole("heading", { name: "Dashboard" });
      act(() => emit({ type: "menu-action", action: "go:customers" }));
      expect(await screen.findByRole("heading", { name: "Customers" })).toBeInTheDocument();
      act(() => emit({ type: "menu-action", action: "palette" }));
      expect(await screen.findByRole("combobox", { name: /search tests/i })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      act(() => emit({ type: "menu-action", action: "new:customer" }));
      expect(await screen.findByRole("heading", { name: /new customer/i })).toBeInTheDocument();
    });

    it("ignores an action it does not know", async () => {
      mount();
      await screen.findByRole("heading", { name: "Dashboard" });
      act(() => emit({ type: "menu-action", action: "go:nowhere" }));
      act(() => emit({ type: "menu-action", action: "delete-everything" }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it("changes the text size one step at a time and back", async () => {
      mount();
      await screen.findByRole("heading", { name: "Dashboard" });
      act(() => emit({ type: "menu-action", action: "text-size:larger" }));
      await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
      expect(saveSettings.mock.calls[0][0].textSize).toBe("large");
      act(() => emit({ type: "menu-action", action: "text-size:smaller" }));
      await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2));
      expect(saveSettings.mock.calls[1][0].textSize).toBe("small");
      act(() => emit({ type: "menu-action", action: "text-size:reset" }));
      await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(3));
      expect(saveSettings.mock.calls[2][0].textSize).toBe("medium");
    });

    it("does not leave an edit page through the menu", async () => {
      mount();
      await screen.findByRole("heading", { name: "Dashboard" });
      act(() => emit({ type: "menu-action", action: "new:customer" }));
      await screen.findByRole("heading", { name: /new customer/i });
      act(() => emit({ type: "menu-action", action: "go:settings" }));
      expect(
        await screen.findByText(/save or cancel your changes before you open another menu/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /new customer/i })).toBeInTheDocument();
    });
  });
});
