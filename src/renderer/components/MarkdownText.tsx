import type { ReactNode } from "react";

/**
 * A small, safe markdown view for text an agent wrote: headings, paragraphs, lists, quotes and
 * code. It builds React elements only, never HTML, and links stay plain text, so nothing in the
 * text can run or navigate.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "rule" };

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", language: fence[1], text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? undefined : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: string[] = [(bullet ?? numbered)?.[1] ?? ""];
      while (index + 1 < lines.length) {
        const next = ordered ? NUMBERED.exec(lines[index + 1]) : BULLET.exec(lines[index + 1]);
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const quote: string[] = [line.replace(/^\s*>\s?/, "")];
      while (index + 1 < lines.length && /^\s*>\s?/.test(lines[index + 1])) {
        index += 1;
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
      }
      blocks.push({ kind: "quote", text: quote.join(" ") });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Inline code, bold and italics. Everything else, including link syntax, stays text. */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![*\w])\*([^*\s][^*]*)\*(?![*\w])/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) nodes.push(<code key={key++}>{match[1]}</code>);
    else if (match[2] !== undefined) nodes.push(<strong key={key++}>{match[2]}</strong>);
    else nodes.push(<em key={key++}>{match[3]}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MarkdownText({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "heading":
            return block.level <= 2 ? (
              <h4 key={key}>{renderInline(block.text)}</h4>
            ) : (
              <h5 key={key}>{renderInline(block.text)}</h5>
            );
          case "paragraph":
            return <p key={key}>{renderInline(block.text)}</p>;
          case "quote":
            return <blockquote key={key}>{renderInline(block.text)}</blockquote>;
          case "rule":
            return <hr key={key} />;
          case "code":
            return (
              <pre key={key} className="markdown-code">
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const items = block.items.map((item, itemIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static list built from text
              <li key={itemIndex}>{renderInline(item)}</li>
            ));
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
        }
      })}
    </div>
  );
}
