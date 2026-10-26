import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Gauge,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { AppSnapshot, EnvironmentInput, EnvironmentType } from "../../shared/models";
import { EmptyState, Field, InlineError } from "../components/Field";
import { PageActions } from "../components/PageActions";
import { RowMenu, type RowMenuItem } from "../components/RowMenu";
import { DetailSection, RunPage } from "../components/RunPage";
import { Select } from "../components/Select";
import { Tile } from "../components/Tile";
import { ViewSwitch, useViewMode } from "../components/ViewSwitch";
import { messageOf } from "../lib/format";
import { agentLabel } from "./ProjectsView";

export function Environments({
  snapshot,
  onAdd,
  onEdit,
  onDelete,
  onForgetSession,
  onArchive,
}: {
  snapshot: AppSnapshot;
  onAdd(): void;
  onEdit(environment: AppSnapshot["environments"][number]): void;
  onDelete(environment: AppSnapshot["environments"][number]): void;
  onForgetSession(id: string): void;
  onArchive(environment: AppSnapshot["environments"][number]): void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useViewMode("environments");
  const [connectionResults, setConnectionResults] = useState<
    Record<string, { ok: boolean; latencyMs: number; message: string }>
  >({});
  const environments = snapshot.environments.filter(
    (environment) =>
      Boolean(environment.archivedAt) === showArchived &&
      `${environment.name} ${environment.company} ${snapshot.customers.find((item) => item.id === environment.customerId)?.name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const credentialReady = (environment: AppSnapshot["environments"][number]) =>
    environment.hasCredential || environment.authentication === "Windows";
  const typeLabel = (type: EnvironmentType) =>
    type === "uat" ? "UAT" : `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  const typeClass = (type: EnvironmentType) =>
    type === "production" ? "pill-err" : type === "uat" ? "pill-warn" : "pill-neutral";
  const connectionNote = (id: string) => {
    const result = connectionResults[id];
    return result
      ? `${result.ok ? "Reachable" : "Unavailable"} · ${result.latencyMs} ms`
      : undefined;
  };
  const menuItems = (environment: AppSnapshot["environments"][number]): RowMenuItem[] => [
    { label: "Edit", icon: Pencil, onSelect: () => onEdit(environment) },
    {
      label: "Test connection",
      icon: Gauge,
      onSelect: () =>
        void window.bcFlow
          .checkEnvironment(environment.id)
          .then((result) =>
            setConnectionResults((current) => ({ ...current, [environment.id]: result })),
          ),
    },
    ...(environment.hasRememberedSession
      ? [
          {
            label: "Forget Microsoft session",
            icon: ShieldCheck,
            onSelect: () => onForgetSession(environment.id),
          },
        ]
      : []),
    {
      label: environment.archivedAt ? "Restore" : "Archive",
      icon: environment.archivedAt ? ArchiveRestore : Archive,
      onSelect: () => onArchive(environment),
    },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(environment) },
  ];
  const statusLabel = (environment: AppSnapshot["environments"][number]) =>
    credentialReady(environment) ? (
      <span className="pill pill-ok">Ready</span>
    ) : (
      <span className="pill pill-warn">Credential missing</span>
    );
  return (
    <>
      <PageActions>
        {!showArchived && (
          <button type="button" className="button button-primary" onClick={onAdd}>
            <Plus size={16} /> Add environment
          </button>
        )}
      </PageActions>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search environments…"
          />
        </div>
        <button
          type="button"
          className="icon-button icon-toggle"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((current) => !current)}
          aria-label={showArchived ? "Active environments" : "Archived environments"}
        >
          <ArchiveRestore size={16} />
        </button>
        <span className="filter-spacer" />
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
      </div>
      {environments.length ? (
        viewMode === "list" ? (
          <table className="plain-table">
            <thead>
              <tr>
                <th scope="col">Environment</th>
                <th scope="col">Company</th>
                <th scope="col">Type</th>
                <th scope="col">Authentication</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {environments.map((environment) => {
                const customer = snapshot.customers.find(
                  (item) => item.id === environment.customerId,
                );
                return (
                  <tr key={environment.id}>
                    <td className="primary-cell">
                      <span className="cell-with-chip">
                        <span className="logo-chip logo-chip-small" aria-hidden="true">
                          <Server size={15} />
                        </span>
                        <span>
                          <button
                            type="button"
                            className="cell-link"
                            onClick={() => onEdit(environment)}
                          >
                            {environment.name}
                          </button>
                          <small className="cell-sub">{customer?.name}</small>
                        </span>
                      </span>
                    </td>
                    <td>{environment.company}</td>
                    <td>
                      <span className={`pill ${typeClass(environment.type)}`}>
                        {typeLabel(environment.type)}
                      </span>
                    </td>
                    <td>
                      {environment.authentication}
                      {connectionNote(environment.id) && (
                        <small className="cell-sub">{connectionNote(environment.id)}</small>
                      )}
                    </td>
                    <td>{statusLabel(environment)}</td>
                    <td className="numeric">
                      <RowMenu
                        label={`Actions for ${environment.name}`}
                        items={menuItems(environment)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="tile-grid">
            {environments.map((environment) => {
              const customer = snapshot.customers.find(
                (item) => item.id === environment.customerId,
              );
              return (
                <Tile
                  key={environment.id}
                  logo={<Server size={22} />}
                  title={environment.name}
                  line1={`${customer?.name ?? ""} · ${environment.company}`}
                  line2={`${typeLabel(environment.type)} · ${environment.authentication}${connectionNote(environment.id) ? ` · ${connectionNote(environment.id)}` : ""}`}
                  status={statusLabel(environment)}
                  actions={
                    <>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onEdit(environment)}
                        aria-label="Open environment"
                      >
                        <ChevronRight size={16} />
                      </button>
                      <RowMenu
                        label={`Actions for ${environment.name}`}
                        items={menuItems(environment)}
                      />
                    </>
                  }
                />
              );
            })}
          </div>
        )
      ) : (
        <EmptyState
          icon={Server}
          title={showArchived ? "No archived environments" : "No environments"}
          text={
            showArchived
              ? "Archived environments appear here."
              : "Add a customer sandbox or UAT environment to run tests."
          }
          action={showArchived ? undefined : "Add environment"}
          onAction={onAdd}
        />
      )}
    </>
  );
}

export function EnvironmentModal({
  snapshot,
  environment,
  onClose,
  onSaved,
  onOpenProject,
  onNewCustomer,
}: {
  snapshot: AppSnapshot;
  environment?: AppSnapshot["environments"][number];
  onClose(): void;
  onSaved(snapshot: AppSnapshot): void;
  onOpenProject(target: { projectId?: string; environmentId: string }): void;
  onNewCustomer(): void;
}) {
  const existingCustomer = snapshot.customers.find(
    (customer) => customer.id === environment?.customerId,
  );
  const [saving, setSaving] = useState(false);
  const customers = snapshot.customers.filter(
    (customer) => !customer.archivedAt || customer.id === environment?.customerId,
  );
  const initialCustomer = existingCustomer ?? customers[0];
  const [form, setForm] = useState<EnvironmentInput>({
    id: environment?.id,
    customerId: initialCustomer?.id,
    customerCode: initialCustomer?.code ?? "",
    customerName: initialCustomer?.name ?? "",
    tenantId: environment?.tenantId ?? "",
    name: environment?.name ?? "Sandbox",
    company: environment?.company ?? "",
    type: environment?.type ?? "sandbox",
    baseUrl: environment?.baseUrl ?? "https://businesscentral.dynamics.com/",
    authentication: environment?.authentication ?? "AAD",
    username: environment?.username ?? "",
    password: "",
  });
  const [error, setError] = useState<string>();
  const [connection, setConnection] = useState<{ ok: boolean; message: string }>();
  const update = <K extends keyof EnvironmentInput>(key: K, value: EnvironmentInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  return (
    <RunPage
      title={environment ? environment.name : "Add environment"}
      subtitle={
        environment
          ? `${existingCustomer?.name ?? "Customer"} · Business Central`
          : "New Business Central target"
      }
      status={
        environment ? (
          environment.hasCredential || environment.authentication === "Windows" ? (
            <span className="pill pill-ok">Ready</span>
          ) : (
            <span className="pill pill-warn">Credential missing</span>
          )
        ) : undefined
      }
      actions={
        <>
          {environment && (
            <button
              type="button"
              className="icon-button"
              onClick={() =>
                void window.bcFlow
                  .checkEnvironment(environment.id)
                  .then((result) =>
                    setConnection({
                      ok: result.ok,
                      message: `${result.ok ? "Reachable" : "Unavailable"} · ${result.latencyMs} ms`,
                    }),
                  )
                  .catch((cause) => setConnection({ ok: false, message: messageOf(cause) }))
              }
              aria-label="Test connection"
            >
              <Gauge size={16} />
            </button>
          )}
          <button
            type="submit"
            form="environment-form"
            className="button button-primary"
            disabled={saving || !form.customerId}
          >
            {saving && <LoaderCircle className="spin" size={16} />}
            {environment ? "Save changes" : "Save environment"}
          </button>
        </>
      }
      onBack={onClose}
    >
      <form
        id="environment-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError(undefined);
          try {
            onSaved(await window.bcFlow.saveEnvironment(form));
          } catch (cause) {
            setError(messageOf(cause));
          } finally {
            setSaving(false);
          }
        }}
      >
        {connection && (
          <output className={`connection-result ${connection.ok ? "ok" : "failed"}`}>
            {connection.message}
          </output>
        )}
        {error && <InlineError text={error} />}
        <DetailSection
          title="Environment"
          description="Which customer it belongs to, and what kind of target it is."
        >
          <Field
            label="Customer"
            hint={
              environment
                ? "An environment stays with its customer."
                : "Customers are managed under Configuration → Customers."
            }
          >
            {customers.length ? (
              <Select
                value={form.customerId ?? ""}
                disabled={Boolean(environment)}
                required
                onChange={(event) => {
                  const customer = customers.find((item) => item.id === event.target.value);
                  if (customer) {
                    setForm((current) => ({
                      ...current,
                      customerId: customer.id,
                      customerCode: customer.code,
                      customerName: customer.name,
                    }));
                  }
                }}
              >
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.code}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="notice-box">
                <span>
                  <strong>No customers yet.</strong> Create a customer first, then add its
                  environment.
                </span>
                <button type="button" className="button button-secondary" onClick={onNewCustomer}>
                  New customer
                </button>
              </div>
            )}
          </Field>
          <div className="form-grid">
            <Field label="Environment name">
              <input value={form.name} onChange={(e) => update("name", e.target.value)} required />
            </Field>
            <Field
              label="Type"
              hint="Production runs are blocked by default and cannot be enabled here."
            >
              <Select
                value={form.type}
                onChange={(e) => update("type", e.target.value as EnvironmentType)}
              >
                <option value="sandbox">Sandbox</option>
                <option value="uat">UAT</option>
                <option value="docker">Docker</option>
                <option value="production">Production (blocked)</option>
              </Select>
            </Field>
          </div>
        </DetailSection>
        <DetailSection title="Business Central" description="Where the replay runs.">
          <Field label="Business Central URL">
            <input
              type="url"
              value={form.baseUrl}
              onChange={(e) => update("baseUrl", e.target.value)}
              required
            />
          </Field>
          <div className="form-grid">
            <Field label="Tenant ID">
              <input
                value={form.tenantId}
                onChange={(e) => update("tenantId", e.target.value)}
                required
              />
            </Field>
            <Field label="Company">
              <input
                value={form.company}
                onChange={(e) => update("company", e.target.value)}
                placeholder="CRONUS BE"
                required
              />
            </Field>
          </div>
        </DetailSection>
        <DetailSection
          title="Authentication"
          description="Credentials stay in the system credential service, never in the workspace."
        >
          <div className="form-grid">
            <Field label="Mode">
              <Select
                value={form.authentication}
                onChange={(e) =>
                  update("authentication", e.target.value as EnvironmentInput["authentication"])
                }
              >
                <option value="AAD">Microsoft Entra ID</option>
                <option value="UserPassword">User/password</option>
                <option value="Windows">Windows</option>
              </Select>
            </Field>
            <Field label="Username">
              <input
                value={form.username}
                onChange={(e) => update("username", e.target.value)}
                disabled={form.authentication === "Windows"}
                placeholder="bc-test@contoso.com"
              />
            </Field>
          </div>
          {form.authentication !== "Windows" && (
            <Field
              label="Password"
              hint={
                environment?.hasCredential
                  ? "A password is stored. Leave empty to keep it; it is never shown again."
                  : "Encrypted with the operating-system credential service."
              }
            >
              <input
                type="password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                autoComplete="new-password"
                placeholder={environment?.hasCredential ? "••••••••••••" : undefined}
              />
            </Field>
          )}
        </DetailSection>
        {environment && (
          <DetailSection
            title="Projects"
            description="AL codebases that run against this environment. Tests link to projects."
          >
            <table className="plain-table">
              <tbody>
                {snapshot.projects
                  .filter(
                    (project) => project.environmentId === environment.id && !project.archivedAt,
                  )
                  .map((project) => (
                    <tr key={project.id}>
                      <td className="primary-cell">
                        <button
                          type="button"
                          className="cell-link"
                          onClick={() =>
                            onOpenProject({ projectId: project.id, environmentId: environment.id })
                          }
                        >
                          {project.name}
                        </button>
                      </td>
                      <td>{agentLabel(project.agent)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <button
              type="button"
              className="button"
              onClick={() => onOpenProject({ environmentId: environment.id })}
            >
              Add project
            </button>
          </DetailSection>
        )}
      </form>
    </RunPage>
  );
}
