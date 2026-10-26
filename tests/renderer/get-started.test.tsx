// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetStarted, getStartedSteps } from "../../src/renderer/features/GetStarted";
import type { AppSnapshot } from "../../src/shared/models";
import "./setup";

const make = (partial: Partial<Record<keyof AppSnapshot, unknown[]>> = {}) =>
  ({ customers: [], environments: [], tests: [], runs: [], ...partial }) as unknown as AppSnapshot;

beforeEach(() => localStorage.clear());

describe("getStartedSteps", () => {
  it("marks steps done from the data and ignores archived items", () => {
    const steps = getStartedSteps(
      make({
        customers: [{ name: "Contoso" }, { name: "Old", archivedAt: "x" }],
        environments: [{ archivedAt: "x" }],
      }),
      { navigate: () => undefined, run: () => undefined },
    );
    expect(steps.map((step) => step.done)).toEqual([true, false, false, false]);
    expect(steps[0].description).toBe("Contoso");
  });
});

describe("GetStarted", () => {
  it("highlights only the first open step and sends you there", async () => {
    const onNavigate = vi.fn();
    render(
      <GetStarted
        snapshot={make({ customers: [{ name: "Contoso" }] })}
        onNavigate={onNavigate}
        onRun={() => undefined}
      />,
    );
    expect(screen.getByText(/1 of 4 done/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /add|import|run/i })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Add environment" }));
    expect(onNavigate).toHaveBeenCalledWith("environments");
  });

  it("runs the first test in the last step", async () => {
    const onRun = vi.fn();
    const test = { id: "t1" };
    render(
      <GetStarted
        snapshot={make({
          customers: [{ name: "C" }],
          environments: [{}],
          tests: [test],
        })}
        onNavigate={() => undefined}
        onRun={onRun}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Run a test" }));
    expect(onRun).toHaveBeenCalledWith(test);
  });

  it("disappears once a run exists", () => {
    const { container } = render(
      <GetStarted
        snapshot={make({ customers: [{}], environments: [{}], tests: [{}], runs: [{}] })}
        onNavigate={() => undefined}
        onRun={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("can be dismissed and stays dismissed", async () => {
    const view = render(
      <GetStarted snapshot={make()} onNavigate={() => undefined} onRun={() => undefined} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
    const again = render(
      <GetStarted snapshot={make()} onNavigate={() => undefined} onRun={() => undefined} />,
    );
    expect(again.container).toBeEmptyDOMElement();
  });
});
