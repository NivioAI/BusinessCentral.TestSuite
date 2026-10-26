// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "../../src/renderer/components/Select";
import "./setup";

function Harness({
  onChange = () => undefined,
  required = false,
  disabled = false,
}: { onChange?: (value: string) => void; required?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState("b");
  return (
    <form>
      <Select
        aria-label="Letter"
        value={value}
        required={required}
        disabled={disabled}
        onChange={(event) => {
          setValue(event.target.value);
          onChange(event.target.value);
        }}
      >
        <option value="a">Alpha</option>
        <option value="b">Bravo</option>
        <option value="c" disabled>
          Charlie
        </option>
        <option value="d">Delta</option>
      </Select>
    </form>
  );
}

describe("Select", () => {
  it("shows the label of the current value and opens a listbox on click", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Letter" });
    expect(trigger).toHaveTextContent("Bravo");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: "Bravo" })).toHaveAttribute("aria-selected", "true");
  });

  it("raises a native-shaped change event and closes when an option is chosen", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: "Delta" }));
    expect(onChange).toHaveBeenCalledWith("d");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox")).toHaveTextContent("Delta");
  });

  it("does not select a disabled option or re-raise the current value", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: "Charlie" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("option", { name: "Bravo" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("works with the keyboard: arrows skip disabled options, Enter selects, Escape closes", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("d");

    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("jumps to an option by typing its first letter", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("combobox").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("a");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("closes when clicking outside", async () => {
    render(
      <div>
        <Harness />
        <button type="button">Elsewhere</button>
      </div>,
    );
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps form validation for required selects and ignores a disabled one", async () => {
    const { container, rerender } = render(<Harness required />);
    expect(container.querySelector("input.select-validity")).toBeRequired();
    rerender(<Harness disabled />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
    await userEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

function LongList({ onChange }: { onChange: (value: string) => void }) {
  const names = [
    "Sandbox Contoso",
    "Sandbox Fabrikam",
    "Sales UAT",
    "Salesforce test",
    "Warehouse UAT",
    "Finance UAT",
    "Docker local",
    "Docker CI",
    "Demo",
    "Training",
  ];
  const [value, setValue] = useState(names[0]);
  return (
    <Select
      aria-label="Environment"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange(event.target.value);
      }}
    >
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </Select>
  );
}

describe("Select with search", () => {
  it("offers no search for a short list", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("filters a long list as you type and selects the first match with Enter", async () => {
    const onChange = vi.fn();
    render(<LongList onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    const box = screen.getByRole("searchbox");
    expect(box).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(10);
    await userEvent.type(box, "uat");
    expect(screen.getAllByRole("option").map((item) => item.textContent)).toEqual([
      "Sales UAT",
      "Warehouse UAT",
      "Finance UAT",
    ]);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("Warehouse UAT");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("says when nothing matches and starts fresh next time", async () => {
    render(<LongList onChange={() => undefined} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(10);
  });
});
