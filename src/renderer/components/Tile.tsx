import type { ReactNode } from "react";

/** A tile: logo chip left, one name line, at most two sub lines, status top right. */
export function Tile({
  logo,
  title,
  line1,
  line2,
  status,
  actions,
}: {
  logo: ReactNode;
  title: string;
  line1?: ReactNode;
  line2?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <article className="tile">
      <span className="logo-chip" aria-hidden="true">
        {logo}
      </span>
      <div className="tile-text">
        <div className="tile-name" title={title}>
          {title}
        </div>
        {line1 && <div className="tile-line">{line1}</div>}
        {line2 && <div className="tile-line tile-line-quiet">{line2}</div>}
      </div>
      {status && <span className="tile-status">{status}</span>}
      {actions && <div className="tile-actions">{actions}</div>}
    </article>
  );
}
