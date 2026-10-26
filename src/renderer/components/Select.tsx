import { Check, ChevronDown, Search } from "lucide-react";
import {
  Children,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface SelectOption {
  value: string;
  label: ReactNode;
  disabled: boolean;
  group?: string;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function collect(children: ReactNode, group?: string): SelectOption[] {
  const options: SelectOption[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    const element = child as ReactElement<{
      value?: string | number;
      disabled?: boolean;
      label?: string;
      children?: ReactNode;
    }>;
    if (element.type === Fragment) {
      options.push(...collect(element.props.children, group));
    } else if (element.type === "optgroup") {
      options.push(...collect(element.props.children, element.props.label));
    } else if (element.type === "option") {
      options.push({
        value: String(element.props.value ?? textOf(element.props.children)),
        label: element.props.children,
        disabled: Boolean(element.props.disabled),
        group,
      });
    }
  }
  return options;
}

/** Same shape as the event a native select raises, so call sites need no change. */
export interface SelectChange {
  target: { value: string };
}

interface SelectProps {
  value: string | number;
  onChange(event: SelectChange): void;
  children: ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  title?: string;
  "aria-label"?: string;
}

/** Lists longer than this get a search field. */
const SEARCH_THRESHOLD = 8;

/** NIVIO dropdown: a listbox that follows the design tokens instead of the OS widget. */
export function Select({
  value,
  onChange,
  children,
  required,
  disabled,
  className,
  id,
  title,
  "aria-label": ariaLabel,
}: SelectProps) {
  const options = useMemo(() => collect(children), [children]);
  const current = String(value);
  const selectedIndex = options.findIndex((option) => option.value === current);
  const searchable = options.length > SEARCH_THRESHOLD;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    above: boolean;
  }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  /** What the list shows: every option, or the ones matching the search. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !needle || textOf(option.label).toLowerCase().includes(needle));
  }, [options, query]);

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const height = Math.min(280, options.length * 36 + 8) + (searchable ? 44 : 0);
    const above = rect.bottom + height > window.innerHeight - 8 && rect.top > height;
    setPosition({
      left: rect.left,
      top: above ? rect.top - 4 : rect.bottom + 4,
      width: Math.max(rect.width, 180),
      above,
    });
  }, [options.length, searchable]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // The list mounts once it has a position, so focus the filter then.
  const placed = Boolean(position);
  useEffect(() => {
    if (open && searchable && placed) search.current?.focus();
  }, [open, searchable, placed]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || list.current?.contains(target)) return;
      setOpen(false);
    };
    const reposition = (event: Event) => {
      if (list.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  const firstEnabled = (items: typeof visible) => {
    const found = items.findIndex(({ option }) => !option.disabled);
    return found >= 0 ? found : 0;
  };

  const openList = () => {
    setQuery("");
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };

  const choose = (position: number) => {
    const entry = visible[position];
    if (!entry || entry.option.disabled) return;
    setOpen(false);
    trigger.current?.focus();
    if (entry.option.value !== current) onChange({ target: { value: entry.option.value } });
  };

  const move = (from: number, step: 1 | -1) => {
    let next = from;
    for (let count = 0; count < visible.length; count += 1) {
      next = (next + step + visible.length) % visible.length;
      if (!visible[next]?.option.disabled) return next;
    }
    return from;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, fromSearch: boolean) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => move(index, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => move(index, -1));
    } else if (event.key === "Enter" || (event.key === " " && !fromSearch)) {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (!fromSearch && event.key === "Home") {
      event.preventDefault();
      setActive(move(-1, 1));
    } else if (!fromSearch && event.key === "End") {
      event.preventDefault();
      setActive(move(0, -1));
    } else if (!fromSearch && !searchable && event.key.length === 1) {
      const needle = event.key.toLowerCase();
      const starts = ({ option }: (typeof visible)[number]) =>
        !option.disabled && textOf(option.label).toLowerCase().startsWith(needle);
      const next = visible.findIndex((entry, index) => index > active && starts(entry));
      const target = next >= 0 ? next : visible.findIndex(starts);
      if (target >= 0) setActive(target);
    }
  };

  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={`select-trigger${className ? ` ${className}` : ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !searchable ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-required={required}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => onKeyDown(event, false)}
      >
        <span className="select-value">{selected?.label ?? "\u00a0"}</span>
        <ChevronDown size={15} aria-hidden="true" className="select-chevron" />
      </button>
      {required && (
        <input
          className="select-validity"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={current}
          onChange={() => undefined}
        />
      )}
      {open &&
        position &&
        createPortal(
          <div
            ref={list}
            className={`select-list${position.above ? " select-list-above" : ""}`}
            style={{ left: position.left, top: position.top, minWidth: position.width }}
          >
            {searchable && (
              <div className="select-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={search}
                  type="text"
                  role="searchbox"
                  aria-label="Filter options"
                  aria-controls={listId}
                  aria-activedescendant={visible.length ? `${listId}-${active}` : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Type to filter"
                  value={query}
                  onChange={(event) => {
                    const next = event.target.value;
                    setQuery(next);
                    const needle = next.trim().toLowerCase();
                    const matches = options
                      .map((option, index) => ({ option, index }))
                      .filter(
                        ({ option }) =>
                          !needle || textOf(option.label).toLowerCase().includes(needle),
                      );
                    setActive(firstEnabled(matches));
                  }}
                  onKeyDown={(event) => onKeyDown(event, true)}
                />
              </div>
            )}
            <ul id={listId} role="listbox" tabIndex={-1} className="select-options">
              {visible.length === 0 && <li className="select-empty">No matches</li>}
              {visible.map(({ option, index }, position) => {
                const heading =
                  option.group && option.group !== lastGroup && !query ? option.group : undefined;
                lastGroup = option.group;
                return (
                  <Fragment key={`${option.value}-${index}`}>
                    {heading && <li className="select-group">{heading}</li>}
                    <li
                      id={`${listId}-${position}`}
                      role="option"
                      aria-selected={index === selectedIndex}
                      aria-disabled={option.disabled || undefined}
                      data-active={position === active}
                      className="select-option"
                      onMouseEnter={() => !option.disabled && setActive(position)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(position)}
                    >
                      <span>{option.label}</span>
                      {index === selectedIndex && <Check size={14} aria-hidden="true" />}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
