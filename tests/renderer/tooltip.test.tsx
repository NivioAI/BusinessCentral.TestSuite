// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipLayer } from "../../src/renderer/components/TooltipLayer";
import "./setup";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  render(
    <div>
      <TooltipLayer />
      <button type="button" aria-label="Open run">
        <svg aria-hidden="true" />
      </button>
      <button type="button">Save</button>
      <span title="Full name here">Short</span>
      <button type="button" data-tip="Why disabled" disabled>
        X
      </button>
    </div>,
  );
}

const hover = (element: Element) => fireEvent.mouseOver(element);

describe("TooltipLayer", () => {
  it("shows the label of an icon-only button after a short delay", () => {
    setup();
    hover(screen.getByRole("button", { name: "Open run" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Open run");
  });

  it("does not show a tooltip for a button that already has visible text", () => {
    setup();
    hover(screen.getByRole("button", { name: "Save" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("takes over native titles so only one tooltip appears", () => {
    setup();
    const span = screen.getByText("Short");
    hover(span);
    expect(span).not.toHaveAttribute("title");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Full name here");
  });

  it("hides on mouse down and on Escape", () => {
    setup();
    const button = screen.getByRole("button", { name: "Open run" });
    hover(button);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseDown(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    hover(button);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows immediately on keyboard focus", () => {
    setup();
    fireEvent.focusIn(screen.getByRole("button", { name: "Open run" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Open run");
  });
});
