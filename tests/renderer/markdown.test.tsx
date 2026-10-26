// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownText, parseMarkdown } from "../../src/renderer/components/MarkdownText";
import "./setup";

describe("parseMarkdown", () => {
  it("reads headings, paragraphs and joins wrapped lines", () => {
    expect(parseMarkdown("## Analysis\n\nFirst line\nsecond line\n\n### Risks")).toEqual([
      { kind: "heading", level: 2, text: "Analysis" },
      { kind: "paragraph", text: "First line second line" },
      { kind: "heading", level: 3, text: "Risks" },
    ]);
  });

  it("reads bullet and numbered lists, and a quote", () => {
    expect(parseMarkdown("- one\n- two\n\n1. a\n2) b\n\n> note\n> more")).toEqual([
      { kind: "list", ordered: false, items: ["one", "two"] },
      { kind: "list", ordered: true, items: ["a", "b"] },
      { kind: "quote", text: "note more" },
    ]);
  });

  it("keeps fenced code verbatim and tolerates a missing closing fence", () => {
    expect(parseMarkdown("```al\nCVCSetup.Get();\n  exit;\n```")).toEqual([
      { kind: "code", language: "al", text: "CVCSetup.Get();\n  exit;" },
    ]);
    expect(parseMarkdown("```\nopen")).toEqual([{ kind: "code", language: "", text: "open" }]);
  });

  it("handles rules, windows line endings and empty input", () => {
    expect(parseMarkdown("a\r\n\r\n---\r\n\r\nb")).toEqual([
      { kind: "paragraph", text: "a" },
      { kind: "rule" },
      { kind: "paragraph", text: "b" },
    ]);
    expect(parseMarkdown("")).toEqual([]);
  });
});

describe("MarkdownText", () => {
  it("renders structure and inline formatting as elements", () => {
    const { container } = render(
      <MarkdownText
        source={"## Analysis\n\nUse `Get()` and **never** push, *please*.\n\n- a\n- b"}
      />,
    );
    expect(screen.getByRole("heading", { name: "Analysis" })).toBeInTheDocument();
    expect(container.querySelector("code")?.textContent).toBe("Get()");
    expect(container.querySelector("strong")?.textContent).toBe("never");
    expect(container.querySelector("em")?.textContent).toBe("please");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("never turns text into HTML, links or scripts", () => {
    const { container } = render(
      <MarkdownText
        source={
          '<img src=x onerror="alert(1)"> [click](javascript:alert(1)) <script>boom()</script>'
        }
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("[click](javascript:alert(1))");
    expect(container.textContent).toContain("<script>boom()</script>");
  });

  it("shows code blocks without interpreting their content", () => {
    const { container } = render(<MarkdownText source={"```\n**not bold** <b>x</b>\n```"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("**not bold** <b>x</b>");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });
});
