import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A labelled form field. The label is a real <label>, so the control inside it is named for
 * assistive technology and clicking the text focuses it. A field that holds several controls
 * (a list of checkboxes, a button next to a value) is a named group instead.
 */
export function Field({
  label,
  hint,
  group = false,
  children,
}: { label: string; hint?: string; group?: boolean; children: ReactNode }) {
  if (group) {
    return (
      <fieldset className="field">
        <legend>{label}</legend>
        {children}
        {hint && <small>{hint}</small>}
      </fieldset>
    );
  }
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child passed in
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function InlineError({ text }: { text: string }) {
  return (
    <div className="inline-error">
      <AlertTriangle size={17} />
      <span>{text}</span>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  onAction,
}: { icon: LucideIcon; title: string; text: string; action?: string; onAction?(): void }) {
  return (
    <div className="empty-state">
      <div>
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button type="button" className="button button-secondary" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
