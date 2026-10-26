import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 350;

/** Text for a hovered or focused element: data-tip, a moved title, or an icon-only button's label. */
function tipFor(target: EventTarget | null): { element: HTMLElement; text: string } | undefined {
  if (!(target instanceof Element)) return undefined;
  const element = target.closest<HTMLElement>("[data-tip],[title],button[aria-label]");
  if (!element) return undefined;
  const title = element.getAttribute("title");
  if (title) {
    // Replace the native tooltip so only one appears.
    element.setAttribute("data-tip", title);
    if (!element.hasAttribute("aria-label") && !element.textContent?.trim()) {
      element.setAttribute("aria-label", title);
    }
    element.removeAttribute("title");
  }
  const explicit = element.getAttribute("data-tip");
  if (explicit) return { element, text: explicit };
  if (element.tagName === "BUTTON" && !element.textContent?.trim()) {
    const label = element.getAttribute("aria-label");
    if (label) return { element, text: label };
  }
  return undefined;
}

/**
 * One tooltip for the whole app. Elements opt in with data-tip; native titles and the
 * labels of icon-only buttons are picked up automatically. Shown on hover and keyboard focus.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect }>();
  const [placed, setPlaced] = useState<{ left: number; top: number }>();
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<HTMLElement | undefined>(undefined);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = undefined;
      setTip(undefined);
      setPlaced(undefined);
    };
    const show = (event: Event, immediate: boolean) => {
      const found = tipFor(event.target);
      if (!found) {
        if (current.current) hide();
        return;
      }
      if (found.element === current.current) return;
      hide();
      current.current = found.element;
      const reveal = () =>
        setTip({ text: found.text, rect: found.element.getBoundingClientRect() });
      if (immediate) reveal();
      else timer.current = window.setTimeout(reveal, SHOW_DELAY_MS);
    };
    const onOver = (event: Event) => show(event, false);
    const onFocus = (event: Event) => show(event, true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("mouseleave", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("mousedown", hide);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      hide();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("mouseleave", hide);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  useEffect(() => {
    if (!tip || !bubble.current) return;
    const size = bubble.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, tip.rect.left + tip.rect.width / 2 - size.width / 2),
      window.innerWidth - size.width - margin,
    );
    const below = tip.rect.bottom + 6;
    const top =
      below + size.height > window.innerHeight - margin ? tip.rect.top - size.height - 6 : below;
    setPlaced({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      className="tooltip"
      style={{
        left: placed?.left ?? 0,
        top: placed?.top ?? 0,
        visibility: placed ? "visible" : "hidden",
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
