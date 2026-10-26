// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "../../src/renderer/features/SettingsView";
import type { AppSnapshot, CustomAgentSettings } from "../../src/shared/models";
import "./setup";

const chooseAgentExecutable = vi.fn();

beforeEach(() => {
  chooseAgentExecutable.mockReset();
  (window as unknown as { bcFlow: unknown }).bcFlow = { chooseAgentExecutable };
});

function snapshot(customAgent?: CustomAgentSettings) {
  return {
    settings: {
      stepDelayMs: 500,
      textSize: "medium",
      runRetentionDays: 90,
      notifications: {
        runFinished: true,
        investigationNeedsMe: true,
        agentApproval: false,
        scheduledPlans: true,
      },
      customAgent,
    },
    runs: [],
    investigations: [],
    testPlans: [],
    tests: [],
    projects: [],
    environments: [],
    mcpApprovals: [],
    diagnostics: {
      replayAvailable: true,
      runtimeCompatibility: "compatible",
      runtimeSource: "bundled",
      powershellAvailable: true,
      nodeVersion: "v22",
      dataDirectory: "/data",
      storageRecoveredFromBackup: false,
      runtimeCompatibilityMessage: "ok",
      runtimeRollbackAvailable: false,
      windowsAuthoritative: true,
    },
  } as unknown as AppSnapshot;
}

function renderSettings(saved?: CustomAgentSettings) {
  const onChange = vi.fn();
  render(
    <SettingsView
      snapshot={snapshot(saved)}
      onDataDeleted={() => undefined}
      onStepDelayChange={() => undefined}
      onTextSizeChange={() => undefined}
      onRunRetentionChange={() => undefined}
      onNotificationsChange={() => undefined}
      onCustomAgentChange={onChange}
      onRefresh={() => undefined}
    />,
  );
  return onChange;
}

describe("Settings: your own agent", () => {
  it("starts empty, with Save disabled until a program is chosen", () => {
    renderSettings();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save agent" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByText(/cannot limit this program/i)).toBeInTheDocument();
  });

  it("takes the program from the file picker and the arguments one per line", async () => {
    chooseAgentExecutable.mockResolvedValue("/usr/local/bin/my-agent");
    const onChange = renderSettings();
    await userEvent.click(screen.getByRole("button", { name: /choose/i }));
    expect(await screen.findByText("/usr/local/bin/my-agent")).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText(/^arguments/i),
      "--print{Enter}  --no-color  {Enter}",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save agent" }));
    expect(onChange).toHaveBeenCalledWith({
      executable: "/usr/local/bin/my-agent",
      args: ["--print", "--no-color"],
    });
  });

  it("keeps the picker value when the dialog is cancelled", async () => {
    chooseAgentExecutable.mockResolvedValue(undefined);
    renderSettings({ executable: "/bin/agent", args: [] });
    await userEvent.click(screen.getByRole("button", { name: /choose/i }));
    expect(screen.getByText("/bin/agent")).toBeInTheDocument();
  });

  it("shows the saved agent, only enables Save after a change, and can remove it", async () => {
    const onChange = renderSettings({ executable: "/bin/agent", args: ["-q"] });
    expect(screen.getByText("/bin/agent")).toBeInTheDocument();
    expect(screen.getByLabelText(/^arguments/i)).toHaveValue("-q");
    expect(screen.getByRole("button", { name: "Save agent" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^arguments/i), "{Enter}-v");
    expect(screen.getByRole("button", { name: "Save agent" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });
});
