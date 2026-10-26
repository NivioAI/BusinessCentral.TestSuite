// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsView } from "../../src/renderer/features/SettingsView";
import type { AppSnapshot } from "../../src/shared/models";
import "./setup";

const snapshot = {
  settings: {
    stepDelayMs: 500,
    textSize: "medium",
    runRetentionDays: 90,
    notifications: {
      runFinished: true,
      investigationNeedsMe: false,
      agentApproval: false,
      scheduledPlans: true,
    },
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

function renderSettings(onNotificationsChange = vi.fn()) {
  render(
    <SettingsView
      snapshot={snapshot}
      onDataDeleted={() => undefined}
      onStepDelayChange={() => undefined}
      onTextSizeChange={() => undefined}
      onRunRetentionChange={() => undefined}
      onNotificationsChange={onNotificationsChange}
      onCustomAgentChange={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  return onNotificationsChange;
}

describe("Settings notifications", () => {
  it("shows the saved switches", () => {
    renderSettings();
    expect(screen.getByRole("checkbox", { name: /a run or plan has finished/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /an investigation needs you/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /an ai agent asks/i })).not.toBeChecked();
  });

  it("sends the full set with one switch flipped", async () => {
    const onChange = renderSettings();
    await userEvent.click(screen.getByRole("checkbox", { name: /an investigation needs you/i }));
    expect(onChange).toHaveBeenCalledWith({
      runFinished: true,
      investigationNeedsMe: true,
      agentApproval: false,
      scheduledPlans: true,
    });
    await userEvent.click(screen.getByRole("checkbox", { name: /a run or plan has finished/i }));
    expect(onChange).toHaveBeenLastCalledWith({
      runFinished: false,
      investigationNeedsMe: false,
      agentApproval: false,
      scheduledPlans: true,
    });
  });
});

describe("Settings MCP status", () => {
  const withStatus = (mcpStatus: unknown) =>
    render(
      <SettingsView
        snapshot={{ ...snapshot, mcpStatus } as unknown as AppSnapshot}
        onDataDeleted={() => undefined}
        onStepDelayChange={() => undefined}
        onTextSizeChange={() => undefined}
        onRunRetentionChange={() => undefined}
        onNotificationsChange={() => undefined}
        onCustomAgentChange={() => undefined}
        onRefresh={() => undefined}
      />,
    );

  it("lists the tools with what they may do and when they were last used", () => {
    const recent = new Date(Date.now() - 120_000).toISOString();
    withStatus({
      listening: true,
      lastCallAt: recent,
      tools: [
        { name: "list_investigations", kind: "Read", lastCallAt: recent },
        { name: "report_change", kind: "Writes change" },
        { name: "start_test", kind: "Needs approval" },
      ],
    });
    expect(screen.getByText("Ready for connections")).toBeInTheDocument();
    expect(screen.getByText(/last tool call 2m ago/i)).toBeInTheDocument();
    const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
    expect(row("list_investigations")).toHaveTextContent("Read");
    expect(row("list_investigations")).toHaveTextContent("2m ago");
    expect(row("report_change")).toHaveTextContent("Writes change");
    expect(row("report_change")).toHaveTextContent("Never");
    expect(row("start_test")).toHaveTextContent("Needs approval");
  });

  it("says when the bridge is not running or nothing has been called", () => {
    withStatus({ listening: false, tools: [] });
    expect(screen.getByText("Not running")).toBeInTheDocument();
    expect(screen.getByText(/no agent has called a tool yet/i)).toBeInTheDocument();
  });
});
