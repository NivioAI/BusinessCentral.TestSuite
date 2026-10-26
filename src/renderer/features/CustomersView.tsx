import {
  Archive,
  ArchiveRestore,
  Building2,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type {
  AppSnapshot,
  Customer,
  CustomerInput,
  TestGroup,
  TestGroupInput,
} from "../../shared/models";
import { EditPage } from "../components/EditPage";
import { Field } from "../components/Field";
import { PageActions } from "../components/PageActions";
import { RowMenu, type RowMenuItem } from "../components/RowMenu";
import { DetailSection } from "../components/RunPage";
import { Select } from "../components/Select";
import { Tile } from "../components/Tile";
import { ViewSwitch, useViewMode } from "../components/ViewSwitch";
import { messageOf } from "../lib/format";
import { plural } from "../lib/ui";

export function CustomersView({
  snapshot,
  onAddCustomer,
  onAddGroup,
  onEditCustomer,
  onDeleteCustomer,
  onEditGroup,
  onDeleteGroup,
  onArchiveCustomer,
  onArchiveGroup,
}: {
  snapshot: AppSnapshot;
  onAddCustomer(): void;
  onAddGroup(): void;
  onEditCustomer(customer: Customer): void;
  onDeleteCustomer(customer: Customer): void;
  onEditGroup(group: TestGroup): void;
  onDeleteGroup(group: TestGroup): void;
  onArchiveCustomer(customer: Customer): void;
  onArchiveGroup(group: TestGroup): void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useViewMode("customers");
  const customers = snapshot.customers.filter(
    (customer) =>
      (showArchived
        ? Boolean(customer.archivedAt) ||
          snapshot.testGroups.some(
            (group) => group.customerId === customer.id && Boolean(group.archivedAt),
          )
        : !customer.archivedAt) &&
      `${customer.name} ${customer.code}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groupsOf = (customer: Customer) =>
    snapshot.testGroups.filter(
      (group) => group.customerId === customer.id && Boolean(group.archivedAt) === showArchived,
    );
  const environmentCount = (customer: Customer) =>
    snapshot.environments.filter((environment) => environment.customerId === customer.id).length;
  const customerMenu = (customer: Customer): RowMenuItem[] => [
    { label: "Edit", icon: Pencil, onSelect: () => onEditCustomer(customer) },
    ...(!showArchived || customer.archivedAt
      ? [
          {
            label: customer.archivedAt ? "Restore" : "Archive",
            icon: customer.archivedAt ? ArchiveRestore : Archive,
            onSelect: () => onArchiveCustomer(customer),
          },
        ]
      : []),
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDeleteCustomer(customer) },
  ];
  const groupMenu = (group: TestGroup): RowMenuItem[] => [
    { label: "Edit group", icon: Pencil, onSelect: () => onEditGroup(group) },
    {
      label: group.archivedAt ? "Restore group" : "Archive group",
      icon: group.archivedAt ? ArchiveRestore : Archive,
      onSelect: () => onArchiveGroup(group),
    },
    { label: "Delete group", icon: Trash2, danger: true, onSelect: () => onDeleteGroup(group) },
  ];
  const generalTests = snapshot.tests.filter((test) => !test.customerId).length;
  const groupChips = (customer: Customer) => {
    const groups = groupsOf(customer);
    return groups.length ? (
      <span className="chip-list">
        {groups.map((group) => (
          <span className="chip" key={group.id}>
            {group.name}
            <RowMenu label={`Actions for ${group.name}`} items={groupMenu(group)} />
          </span>
        ))}
      </span>
    ) : (
      <span className="cell-sub">No groups yet</span>
    );
  };
  return (
    <>
      <PageActions>
        <button
          type="button"
          className="button button-secondary"
          onClick={onAddGroup}
          disabled={!snapshot.customers.length}
        >
          <FolderPlus size={16} /> New group
        </button>
        <button type="button" className="button button-primary" onClick={onAddCustomer}>
          <Plus size={16} /> New customer
        </button>
      </PageActions>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customers…"
          />
        </div>
        <button
          type="button"
          className="icon-button icon-toggle"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((current) => !current)}
          aria-label={showArchived ? "Active customers" : "Archived customers"}
        >
          <ArchiveRestore size={16} />
        </button>
        <span className="filter-spacer" />
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
      </div>
      {viewMode === "list" ? (
        <table className="plain-table">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Test groups</th>
              <th scope="col" className="numeric">
                Environments
              </th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!showArchived && (
              <tr>
                <td className="primary-cell">
                  <span className="cell-with-chip">
                    <span className="logo-chip logo-chip-small" aria-hidden="true">
                      <FolderOpen size={15} />
                    </span>
                    <span>
                      General
                      <small className="cell-sub">Standard Business Central test flows</small>
                    </span>
                  </span>
                </td>
                <td>
                  <span className="pill-neutral">{plural(generalTests, "test")}</span>
                </td>
                <td className="numeric">—</td>
                <td />
              </tr>
            )}
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td className="primary-cell">
                  <span className="cell-with-chip">
                    <span className="logo-chip logo-chip-small" aria-hidden="true">
                      <Building2 size={15} />
                    </span>
                    <span>
                      {customer.name}
                      <small className="cell-sub">{customer.code}</small>
                    </span>
                  </span>
                </td>
                <td>{groupChips(customer)}</td>
                <td className="numeric">{environmentCount(customer)}</td>
                <td className="numeric">
                  <RowMenu label={`Actions for ${customer.name}`} items={customerMenu(customer)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="tile-grid">
          {!showArchived && (
            <Tile
              logo={<FolderOpen size={22} />}
              title="General"
              line1="Standard Business Central test flows"
              line2={plural(generalTests, "test")}
            />
          )}
          {customers.map((customer) => (
            <Tile
              key={customer.id}
              logo={<Building2 size={22} />}
              title={customer.name}
              line1={customer.code}
              line2={`${plural(groupsOf(customer).length, "group")} · ${plural(environmentCount(customer), "environment")}`}
              actions={
                <RowMenu label={`Actions for ${customer.name}`} items={customerMenu(customer)} />
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

export function CustomerModal({
  customer,
  onClose,
  onSaved,
}: { customer?: Customer; onClose(): void; onSaved(snapshot: AppSnapshot): void }) {
  const [form, setForm] = useState<CustomerInput>({
    id: customer?.id,
    code: customer?.code ?? "",
    name: customer?.name ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <EditPage
      title={customer ? "Edit customer" : "New customer"}
      eyebrow="Customer system"
      onClose={onClose}
      busy={busy}
      action={customer ? "Save changes" : "Save customer"}
      error={error}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          onSaved(await window.bcFlow.saveCustomer(form));
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <DetailSection title="Customer" description="Code and name used across the app.">
        <div className="form-grid">
          <Field label="Customer code">
            <input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              placeholder="CONTOSO"
              required
            />
          </Field>
          <Field label="Customer name">
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Contoso Belgium"
              required
            />
          </Field>
        </div>
      </DetailSection>
    </EditPage>
  );
}

export function TestGroupModal({
  snapshot,
  group,
  onClose,
  onSaved,
}: {
  snapshot: AppSnapshot;
  group?: TestGroup;
  onClose(): void;
  onSaved(snapshot: AppSnapshot): void;
}) {
  const [form, setForm] = useState<TestGroupInput>({
    id: group?.id,
    customerId: group?.customerId ?? snapshot.customers[0]?.id ?? "",
    name: group?.name ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <EditPage
      title={group ? "Edit test group" : "New test group"}
      eyebrow="Customer application"
      onClose={onClose}
      busy={busy}
      action={group ? "Save changes" : "Save group"}
      error={error}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          onSaved(await window.bcFlow.saveTestGroup(form));
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <DetailSection title="Test group" description="Group tests by application or customization.">
        <Field label="Customer">
          <Select
            value={form.customerId}
            onChange={(event) => setForm({ ...form, customerId: event.target.value })}
            required
          >
            {snapshot.customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Group name" hint="Use the application or customization name.">
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Warehouse extension"
            required
          />
        </Field>
      </DetailSection>
    </EditPage>
  );
}
