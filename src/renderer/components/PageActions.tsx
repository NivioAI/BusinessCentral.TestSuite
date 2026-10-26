import { type ReactNode, createContext, useContext } from "react";
import { createPortal } from "react-dom";

export const PageActionsHost = createContext<HTMLElement | null>(null);

/** Renders page-level actions in the page header, next to the title. */
export function PageActions({ children }: { children: ReactNode }) {
  const host = useContext(PageActionsHost);
  return host ? createPortal(children, host) : null;
}
