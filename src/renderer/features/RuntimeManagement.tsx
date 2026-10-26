import { Download, ShieldCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import type { RuntimeDiagnostics } from "../../shared/models";
import { messageOf } from "../lib/format";

export function RuntimeManagement({
  diagnostics,
  onRefresh,
  onError,
}: {
  diagnostics: RuntimeDiagnostics;
  onRefresh(): void;
  onError(message: string): void;
}) {
  const [busy, setBusy] = useState(false);

  const perform = (operation: () => Promise<unknown>): void => {
    setBusy(true);
    void operation()
      .then(onRefresh)
      .catch((cause) => onError(messageOf(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="runtime-management">
      <div>
        <strong>Runtime compatibility</strong>
        <small>{diagnostics.runtimeCompatibilityMessage}</small>
        {diagnostics.windowsAuthoritative && (
          <small>Windows remains the authoritative fallback for Business Central replay.</small>
        )}
      </div>
      <div className="button-row">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => perform(() => window.bcFlow.checkRuntimeCompatibility())}
        >
          <ShieldCheck size={16} /> Check runtime
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => perform(() => window.bcFlow.installRuntimeUpdate())}
        >
          <Download size={16} /> Install approved package
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || !diagnostics.runtimeRollbackAvailable}
          onClick={() => perform(() => window.bcFlow.rollbackRuntime())}
        >
          <Undo2 size={16} /> Roll back
        </button>
      </div>
    </div>
  );
}
