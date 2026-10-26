// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditPage } from "../../src/renderer/components/EditPage";
import { RunPageHost } from "../../src/renderer/components/RunPage";
import "./setup";

function renderPage(props: Partial<Parameters<typeof EditPage>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onClose = vi.fn();
  const onSubmit = vi.fn((event) => event.preventDefault());
  render(
    <RunPageHost.Provider value={host}>
      <EditPage
        title="New customer"
        eyebrow="Customer system"
        onClose={onClose}
        busy={false}
        action="Save customer"
        onSubmit={onSubmit}
        {...props}
      >
        <input aria-label="Code" required />
      </EditPage>
    </RunPageHost.Provider>,
  );
  return { host, onClose, onSubmit };
}

describe("EditPage", () => {
  it("renders into the page host with a back link and no cancel button", () => {
    const { host } = renderPage();
    expect(host).toContainElement(screen.getByRole("heading", { name: "New customer" }));
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("goes back without saving", async () => {
    const { onClose, onSubmit } = renderPage();
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the form from the header action once the required field is filled", async () => {
    const { onSubmit } = renderPage();
    await userEvent.type(screen.getByLabelText("Code"), "CONTOSO");
    await userEvent.click(screen.getByRole("button", { name: "Save customer" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows an error and disables the action while busy or disabled", () => {
    renderPage({ busy: true, error: "Customer code is taken." });
    expect(screen.getByText("Customer code is taken.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /working/i })).toBeDisabled();
  });

  it("disables the action when told to", () => {
    renderPage({ disabled: true });
    expect(screen.getByRole("button", { name: "Save customer" })).toBeDisabled();
  });
});
