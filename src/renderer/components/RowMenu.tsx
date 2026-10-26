import { type LucideIcon, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type RowMenuItem = {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  onSelect(): void;
};

/** The "···" menu that holds the secondary actions of a row or tile. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="row-menu" ref={rootRef}>
      <button
        type="button"
        className="row-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="row-menu-list" role="menu">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                role="menuitem"
                key={item.label}
                className={item.danger ? "row-menu-danger" : undefined}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {Icon && <Icon size={15} />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
