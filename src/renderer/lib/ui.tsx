import { ChevronRight, LoaderCircle } from "lucide-react";
import type { EnvironmentType, RiskLevel } from "../../shared/models";
import { messageOf } from "./format";

export function PanelHeader({
  title,
  subtitle,
  action,
  onAction,
}: { title: string; subtitle: string; action?: string; onAction?(): void }) {
  return (
    <header className="panel-header">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action && onAction && (
        <button type="button" onClick={onAction}>
          {action} <ChevronRight size={15} />
        </button>
      )}
    </header>
  );
}

export function RiskPill({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`risk risk-${risk}`}>
      {risk === "read-only" ? "Read-only" : risk === "reversible" ? "Reversible" : "Destructive"}
    </span>
  );
}

export function RiskEnvironment({ type }: { type: EnvironmentType }) {
  return <span className={`environment-type type-${type}`}>{type}</span>;
}

export function ModalActions({
  onCancel,
  busy,
  action,
  icon,
  disabled,
}: {
  onCancel(): void;
  busy: boolean;
  action: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="modal-actions">
      <button className="button button-secondary" type="button" onClick={onCancel}>
        Cancel
      </button>
      <button className="button button-primary" type="submit" disabled={busy || disabled}>
        {busy ? <LoaderCircle className="spin" size={16} /> : icon}
        {action}
      </button>
    </div>
  );
}

export const initials = (value: string) =>
  value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

export const shorten = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;

export async function runSafely(setError: (error?: string) => void, action: () => Promise<void>) {
  try {
    await action();
  } catch (cause) {
    setError(messageOf(cause));
  }
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
