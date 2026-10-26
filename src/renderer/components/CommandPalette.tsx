import {
  Activity,
  ArrowRight,
  ClipboardList,
  FlaskConical,
  GitBranch,
  Play,
  SearchCheck,
  Server,
  Users,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type Command, type CommandGroup, SHORTCUT_LIST, searchCommands } from "../commands";

const GROUP_ICON: Record<CommandGroup, ReactNode> = {
  Actions: <Play size={15} />,
  "Go to": <ArrowRight size={15} />,
  Tests: <FlaskConical size={15} />,
  Plans: <ClipboardList size={15} />,
  Customers: <Users size={15} />,
  Environments: <Server size={15} />,
  Projects: <GitBranch size={15} />,
  Investigations: <SearchCheck size={15} />,
  Runs: <Activity size={15} />,
};

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="palette-keys">
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  );
}

/**
 * Search and actions (⌘K). Choosing an entry opens the screen or the review page for the
 * action; it never starts a run by itself.
 */
export function CommandPalette({
  mode,
  commands,
  onClose,
}: {
  mode: "search" | "shortcuts" | undefined;
  commands: Command[];
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => searchCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (mode) {
      setQuery("");
      setActive(0);
    }
  }, [mode]);

  useEffect(() => {
    if (mode === "search") input.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode === "search") {
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [mode, active, listId]);

  if (!mode) return null;

  const choose = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (mode === "search" && event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (mode === "search" && event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
    } else if (mode === "search" && event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    }
  };

  let lastGroup: CommandGroup | undefined;
  return createPortal(
    <div
      className="palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "search" ? "Search and actions" : "Keyboard shortcuts"}
        onKeyDown={onKeyDown}
      >
        {mode === "search" ? (
          <>
            <div className="palette-input">
              <input
                ref={input}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
                aria-label="Search tests, plans, screens and actions"
                placeholder="Search tests, plans, screens and actions…"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <ul id={listId} role="listbox" className="palette-list">
              {results.length === 0 && <li className="palette-empty">No results</li>}
              {results.map((command, index) => {
                const heading = command.group !== lastGroup ? command.group : undefined;
                lastGroup = command.group;
                return (
                  <li key={command.id} role="presentation">
                    {heading && <div className="palette-group">{heading}</div>}
                    <div
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      data-active={index === active}
                      className="palette-item"
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(command)}
                    >
                      <span className="logo-chip logo-chip-small" aria-hidden="true">
                        {GROUP_ICON[command.group]}
                      </span>
                      <span className="palette-text">
                        <strong>{command.title}</strong>
                        {command.subtitle && <small>{command.subtitle}</small>}
                      </span>
                      {command.keys && <Keys keys={command.keys} />}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="palette-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> move
              </span>
              <span>
                <kbd>↵</kbd> open
              </span>
              <span>
                <kbd>?</kbd> all shortcuts
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="palette-input">
              <strong>Keyboard shortcuts</strong>
              <kbd>Esc</kbd>
            </div>
            <ul className="palette-list">
              {SHORTCUT_LIST.map((entry) => (
                <li key={entry.label} className="palette-item palette-static">
                  <span className="palette-text">
                    <strong>{entry.label}</strong>
                  </span>
                  <Keys keys={entry.keys} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
