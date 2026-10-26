import { type FormEvent, type ReactNode, useId } from "react";
import { InlineError } from "./Field";
import { RunPage } from "./RunPage";

/** Create/edit screen: a compact page with Cancel and Save in the header, no popup. */
export function EditPage({
  title,
  eyebrow,
  onClose,
  busy,
  action,
  icon,
  disabled,
  error,
  onSubmit,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose(): void;
  busy: boolean;
  action: string;
  icon?: ReactNode;
  disabled?: boolean;
  error?: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  children: ReactNode;
}) {
  const formId = useId();
  return (
    <RunPage
      title={title}
      subtitle={eyebrow}
      onBack={onClose}
      actions={
        <button
          type="submit"
          form={formId}
          className="button button-primary"
          disabled={busy || disabled}
        >
          {icon}
          {busy ? "Working…" : action}
        </button>
      }
    >
      <form id={formId} className="edit-page-form" onSubmit={onSubmit}>
        {error && <InlineError text={error} />}
        {children}
      </form>
    </RunPage>
  );
}
