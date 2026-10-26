import { useEffect, useRef } from "react";
import { GO_TO_KEYS } from "../commands";
import type { View } from "../navigation";

const SEQUENCE_MS = 1200;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.getAttribute("role") === "combobox"
  );
}

export interface ShortcutHandlers {
  /** False while a dialog or the palette is open. */
  enabled: boolean;
  openPalette(): void;
  openShortcuts(): void;
  goTo(view: View): void;
  newItem(): void;
}

/** Global keyboard shortcuts. Plain keys are ignored while typing or with a modifier held. */
export function useShortcuts(handlers: ShortcutHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    let pendingG = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latest.current;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        current.openPalette();
        return;
      }
      if (!current.enabled || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (pendingG && Date.now() - pendingG < SEQUENCE_MS) {
        pendingG = 0;
        const target = GO_TO_KEYS[key];
        if (target) {
          event.preventDefault();
          current.goTo(target.view);
        }
        return;
      }
      pendingG = 0;
      if (key === "g") {
        pendingG = Date.now();
      } else if (key === "/") {
        const box = document.querySelector<HTMLInputElement>(".search-box input");
        if (box) {
          event.preventDefault();
          box.focus();
        }
      } else if (key === "n") {
        event.preventDefault();
        current.newItem();
      } else if (event.key === "?") {
        event.preventDefault();
        current.openShortcuts();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
