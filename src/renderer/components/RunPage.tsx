import { ChevronLeft } from "lucide-react";
import { type ReactNode, createContext, useContext } from "react";
import { createPortal } from "react-dom";

export const RunPageHost = createContext<HTMLElement | null>(null);

/** Shows a run as a page in the work area, with a back link, instead of a modal. */
export function RunPage({
  title,
  subtitle,
  status,
  actions,
  onBack,
  compact,
  inline,
  children,
}: {
  title: string;
  subtitle: string;
  status?: ReactNode;
  actions?: ReactNode;
  onBack(): void;
  /** Edit forms: about half the work area, sections stacked. */
  compact?: boolean;
  /** Render in place instead of in the work-area host (used by list pages). */
  inline?: boolean;
  children: ReactNode;
}) {
  const host = useContext(RunPageHost);
  if (!host && !inline) return null;
  const page = (
    <section className={`run-page${compact ? " run-page-compact" : ""}`} aria-label={title}>
      <button type="button" className="crumb-link" onClick={onBack}>
        <ChevronLeft size={15} /> Back
      </button>
      <header className="detail-header">
        <div className="detail-title">
          <h1>{title}</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        {status}
        {actions}
      </header>
      <div className="detail-sections">{children}</div>
    </section>
  );
  return inline || !host ? page : createPortal(page, host);
}

export function DetailSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="detail-section-body">{children}</div>
    </section>
  );
}
