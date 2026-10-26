// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpView } from "../../src/renderer/features/HelpView";
import "./setup";

describe("HelpView", () => {
  it("states that the app is provided as is", () => {
    render(<HelpView />);
    expect(screen.getByText("Provided as is")).toBeInTheDocument();
    expect(screen.getByText(/without warranty of any kind/)).toBeInTheDocument();
    expect(screen.getByText(/NIVIO BV is not\s+responsible/)).toBeInTheDocument();
  });
});
