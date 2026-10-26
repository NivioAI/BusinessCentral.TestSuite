import { X } from "lucide-react";
import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose(): void;
  width?: "default" | "wide";
}

export function Modal({ title, eyebrow, children, onClose, width = "default" }: ModalProps) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <dialog open className={`modal ${width === "wide" ? "modal-wide" : ""}`} aria-label={title}>
        <header className="modal-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        {children}
      </dialog>
    </div>
  );
}
