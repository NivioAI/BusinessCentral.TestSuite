import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

interface SideSheetProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  closeLabel?: string;
  children: ReactNode;
  onClose(): void;
}

export function SideSheet({
  title,
  subtitle,
  eyebrow = "Execution history",
  closeLabel = "Close execution history",
  children,
  onClose,
}: SideSheetProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <dialog open className="side-sheet" aria-label={title}>
        <header className="side-sheet-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="side-sheet-body">{children}</div>
      </dialog>
    </div>
  );
}
