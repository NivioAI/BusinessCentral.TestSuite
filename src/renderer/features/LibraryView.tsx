import {
  Archive,
  ArchiveRestore,
  Building2,
  ClipboardList,
  FileCode2,
  Import,
  ListChecks,
  Pencil,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type {
  AppSnapshot,
  RiskLevel,
  TestDefinition,
  TestDefinitionInput,
  TestRun,
} from "../../shared/models";
import { EditPage } from "../components/EditPage";
import { EmptyState, Field } from "../components/Field";
import { PageActions } from "../components/PageActions";
import { RowMenu, type RowMenuItem } from "../components/RowMenu";
import { DetailSection } from "../components/RunPage";
import { Select } from "../components/Select";
import { Tile } from "../components/Tile";
import { ViewSwitch, useViewMode } from "../components/ViewSwitch";
import { formatDuration, messageOf } from "../lib/format";
import { RiskPill } from "../lib/ui";

export function TestLibrary({
  snapshot,
  contextCustomerId,
  contextEnvironmentId,
  onRun,
  onImport,
  onEdit,
  onUpdate,
  onCreatePlan,
  onArchive,
  onDelete,
}: {
  snapshot: AppSnapshot;
  contextCustomerId: string;
  contextEnvironmentId: string;
  onRun(test: TestDefinition): void;
  onImport(): void;
  onEdit(test: TestDefinition): void;
  onUpdate(test: TestDefinition): void;
  onCreatePlan(testIds: string[]): void;
  onArchive(test: TestDefinition): void;
  onDelete(test: TestDefinition): void;
}) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [riskFilter, setRiskFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [viewMode, setViewMode] = useViewMode("tests");
  const toggleSelected = (id: string) =>
    setSelectedTestIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  const availableTags = [...new Set(snapshot.tests.flatMap((test) => test.tags))].sort();
  const tests = snapshot.tests.filter((test) => {
    if (Boolean(test.archivedAt) !== showArchived) return false;
    if (riskFilter !== "all" && test.risk !== riskFilter) return false;
    if (tagFilter !== "all" && !test.tags.includes(tagFilter)) return false;
    if (projectFilter !== "all" && !test.projectIds?.includes(projectFilter)) return false;
    const latestRun = snapshot.runs.find((run) => run.testDefinitionId === test.id);
    if (resultFilter === "never" && latestRun) return false;
    if (resultFilter === "passed" && latestRun?.status !== "PASSED") return false;
    if (resultFilter === "attention" && !latestRun?.status.match(/^(FAILED|BLOCKED|ERROR)$/))
      return false;
    if (resultFilter === "flaky" && !testStability(test.id, snapshot.runs).includes("flaky"))
      return false;
    if (contextCustomerId !== "all" && test.customerId && test.customerId !== contextCustomerId)
      return false;
    if (contextEnvironmentId !== "all") {
      const environment = snapshot.environments.find((item) => item.id === contextEnvironmentId);
      if (
        !environment ||
        (test.customerId && test.customerId !== environment.customerId) ||
        !test.allowedEnvironmentTypes.includes(environment.type)
      )
        return false;
    }
    const group = snapshot.testGroups.find((item) => item.id === test.groupId);
    return `${test.testId} ${test.name} ${test.tags.join(" ")} ${group?.name ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  const populatedGroups = snapshot.testGroups
    .map((group) => ({ group, tests: tests.filter((test) => test.groupId === group.id) }))
    .filter(({ tests: groupedTests }) => groupedTests.length);
  const menuItems = (test: TestDefinition): RowMenuItem[] => [
    { label: "Update recording", icon: Import, onSelect: () => onUpdate(test) },
    { label: "Edit", icon: Pencil, onSelect: () => onEdit(test) },
    {
      label: test.archivedAt ? "Restore" : "Archive",
      icon: test.archivedAt ? ArchiveRestore : Archive,
      onSelect: () => onArchive(test),
    },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(test) },
  ];
  const runAction = (test: TestDefinition) =>
    !test.archivedAt && (
      <button
        type="button"
        className="icon-button"
        onClick={() => onRun(test)}
        aria-label="Run test"
      >
        <Play size={14} />
      </button>
    );
  return (
    <section className="library-page">
      <PageActions>
        <button type="button" className="button button-primary" onClick={onImport}>
          <Import size={16} /> Import test
        </button>
      </PageActions>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search test ID, name or tag…"
          />
        </div>
        <label className="compact-setting">
          <span className="visually-hidden">Risk</span>
          <Select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
            <option value="all">All risks</option>
            <option value="read-only">Read-only</option>
            <option value="reversible">Reversible</option>
            <option value="destructive">Destructive</option>
          </Select>
        </label>
        <label className="compact-setting">
          <span className="visually-hidden">Tag</span>
          <Select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
            <option value="all">All tags</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
        </label>
        {snapshot.projects.some((project) => !project.archivedAt) && (
          <label className="compact-setting">
            <span className="visually-hidden">Project</span>
            <Select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="all">All projects</option>
              {snapshot.projects
                .filter((project) => !project.archivedAt)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </Select>
          </label>
        )}
        <label className="compact-setting">
          <span className="visually-hidden">Latest result</span>
          <Select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
            <option value="all">All results</option>
            <option value="attention">Needs attention</option>
            <option value="passed">Latest passed</option>
            <option value="flaky">Possibly flaky</option>
            <option value="never">Never run</option>
          </Select>
        </label>
        <button
          type="button"
          className="icon-button icon-toggle"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((current) => !current)}
          aria-label={showArchived ? "Active tests" : "Archived tests"}
        >
          <ArchiveRestore size={16} />
        </button>
        {!showArchived && (
          <button
            type="button"
            className="icon-button icon-toggle"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((current) => !current);
              setSelectedTestIds([]);
            }}
            aria-label={selecting ? "Done selecting" : "Select tests"}
          >
            <ListChecks size={16} />
          </button>
        )}
        {selectedTestIds.length > 0 && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => onCreatePlan(selectedTestIds)}
          >
            <ClipboardList size={16} /> Create plan ({selectedTestIds.length})
          </button>
        )}
        <span className="filter-spacer" />
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
      </div>
      {tests.length ? (
        populatedGroups.map(({ group, tests: groupedTests }) => {
          const customer = snapshot.customers.find((item) => item.id === group.customerId);
          return (
            <section className="list-section" key={group.id}>
              <header className="list-section-header">
                <span className="logo-chip logo-chip-small" aria-hidden="true">
                  <Building2 size={15} />
                </span>
                <strong>{group.name}</strong>
                <span>
                  {customer?.name ?? "Standard Business Central"} · {groupedTests.length}{" "}
                  {groupedTests.length === 1 ? "test" : "tests"}
                </span>
              </header>
              {viewMode === "list" ? (
                <table className="plain-table fixed-table">
                  <colgroup>
                    <col />
                    <col className="col-projects" />
                    <col className="col-risk" />
                    <col className="col-results" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Test</th>
                      <th scope="col">Projects</th>
                      <th scope="col">Risk</th>
                      <th scope="col">Last results</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedTests.map((test) => (
                      <tr key={test.id}>
                        <td className="primary-cell">
                          <span className="cell-with-chip">
                            {selecting && (
                              <input
                                type="checkbox"
                                checked={selectedTestIds.includes(test.id)}
                                aria-label={`Select ${test.testId}`}
                                onChange={() => toggleSelected(test.id)}
                              />
                            )}
                            <span className="logo-chip logo-chip-small" aria-hidden="true">
                              <FileCode2 size={15} />
                            </span>
                            <span>
                              {test.testId} · {test.name}
                            </span>
                          </span>
                        </td>
                        <td>
                          {(test.projectIds ?? [])
                            .map(
                              (id) => snapshot.projects.find((project) => project.id === id)?.name,
                            )
                            .filter(Boolean)
                            .join(", ") || <span className="cell-sub">None</span>}
                        </td>
                        <td>
                          <RiskPill risk={test.risk} />
                        </td>
                        <td>{testStability(test.id, snapshot.runs)}</td>
                        <td className="numeric">
                          <span className="row-actions-inline">
                            {runAction(test)}
                            <RowMenu label={`Actions for ${test.testId}`} items={menuItems(test)} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="tile-grid">
                  {groupedTests.map((test) => (
                    <Tile
                      key={test.id}
                      logo={<FileCode2 size={22} />}
                      title={`${test.testId} · ${test.name}`}
                      line1={customer?.name ?? "All customers"}
                      line2={testStability(test.id, snapshot.runs)}
                      status={<RiskPill risk={test.risk} />}
                      actions={
                        <>
                          {selecting && (
                            <label className="select-box">
                              <input
                                type="checkbox"
                                checked={selectedTestIds.includes(test.id)}
                                onChange={() => toggleSelected(test.id)}
                              />
                              Select
                            </label>
                          )}
                          {runAction(test)}
                          <RowMenu label={`Actions for ${test.testId}`} items={menuItems(test)} />
                        </>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      ) : (
        <EmptyState
          icon={FileCode2}
          title="No matching tests"
          text="Import a YAML recording or adjust your search."
          action="Import test"
          onAction={onImport}
        />
      )}
    </section>
  );
}

export function testStability(testDefinitionId: string, runs: TestRun[]): string {
  const completed = runs.filter(
    (run) => run.testDefinitionId === testDefinitionId && run.status !== "RUNNING",
  );
  if (!completed.length) return "Not run yet";
  const passed = completed.filter((run) => run.status === "PASSED").length;
  const average = Math.round(
    completed.reduce((total, run) => total + (run.durationMs ?? 0), 0) / completed.length,
  );
  const alternating = completed
    .slice(0, 4)
    .some((run, index, items) => (index ? run.status !== items[index - 1].status : false));
  return `${Math.round((passed / completed.length) * 100)}% pass · ${formatDuration(average)}${alternating ? " · Possibly flaky" : ""}`;
}

export function TestDefinitionModal({
  snapshot,
  test,
  onClose,
  onSaved,
}: {
  snapshot: AppSnapshot;
  test: TestDefinition;
  onClose(): void;
  onSaved(snapshot: AppSnapshot): void;
}) {
  const [form, setForm] = useState<TestDefinitionInput>({
    id: test.id,
    groupId: test.groupId,
    name: test.name,
    description: test.description ?? "",
    risk: test.risk,
    forbiddenActions: test.forbiddenActions,
    tags: test.tags,
    projectIds: test.projectIds ?? [],
  });
  const [tags, setTags] = useState(test.tags.join(", "));
  const [forbiddenActions, setForbiddenActions] = useState(test.forbiddenActions.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const groupCustomerId = snapshot.testGroups.find((item) => item.id === form.groupId)?.customerId;
  const selectableProjects = snapshot.projects.filter((project) => {
    if (project.archivedAt && !form.projectIds.includes(project.id)) return false;
    const environment = snapshot.environments.find((item) => item.id === project.environmentId);
    return !groupCustomerId || environment?.customerId === groupCustomerId;
  });

  return (
    <EditPage
      title={`Edit ${test.testId}`}
      eyebrow="Test definition"
      onClose={onClose}
      busy={busy}
      action="Save changes"
      error={error}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          const saved = await window.bcFlow.saveTest({
            ...form,
            forbiddenActions: forbiddenActions
              .split(",")
              .map((action) => action.trim())
              .filter(Boolean),
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          });
          onSaved(saved);
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <DetailSection title="Test" description="Where it lives and what it is called.">
        <Field label="Test group">
          <Select
            value={form.groupId}
            onChange={(event) => setForm({ ...form, groupId: event.target.value })}
          >
            {snapshot.testGroups.map((group) => {
              const customer = snapshot.customers.find((item) => item.id === group.customerId);
              return (
                <option key={group.id} value={group.id}>
                  {customer ? `${customer.name} · ${group.name}` : group.name}
                </option>
              );
            })}
          </Select>
        </Field>
        <Field label="Name">
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </Field>
        <Field label="Description">
          <input
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
      </DetailSection>
      <DetailSection title="Safety" description="What the test may do, and how risky it is.">
        <Field
          label="Forbidden actions"
          hint="Comma-separated actions this test must never perform, for example Post or Delete."
        >
          <input
            value={forbiddenActions}
            onChange={(event) => setForbiddenActions(event.target.value)}
            placeholder="Post, Delete, Send externally"
          />
        </Field>
        <div className="form-grid">
          <Field label="Risk">
            <Select
              value={form.risk}
              onChange={(event) => setForm({ ...form, risk: event.target.value as RiskLevel })}
            >
              <option value="read-only">Read-only</option>
              <option value="reversible">Reversible write</option>
              <option value="destructive">Destructive</option>
            </Select>
          </Field>
          <Field label="Tags" hint="Comma-separated">
            <input value={tags} onChange={(event) => setTags(event.target.value)} />
          </Field>
        </div>
      </DetailSection>
      <DetailSection title="Projects" description="The AL code this test belongs to.">
        <Field
          group
          label="Projects"
          hint="The AL code this test belongs to. When it fails, you pick one of these to investigate."
        >
          <div className="check-list">
            {selectableProjects.length ? (
              selectableProjects.map((project) => (
                <label key={project.id} className="inline-check">
                  <input
                    type="checkbox"
                    checked={form.projectIds.includes(project.id)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        projectIds: event.target.checked
                          ? [...form.projectIds, project.id]
                          : form.projectIds.filter((id) => id !== project.id),
                      })
                    }
                  />
                  {project.name}
                </label>
              ))
            ) : (
              <span className="field-hint">No projects for this customer yet.</span>
            )}
          </div>
        </Field>
      </DetailSection>
    </EditPage>
  );
}

export function ImportModal({
  snapshot,
  onClose,
  onImported,
}: { snapshot: AppSnapshot; onClose(): void; onImported(snapshot: AppSnapshot): void }) {
  const [groupId, setGroupId] = useState(snapshot.testGroups[0]?.id ?? "");
  const [testId, setTestId] = useState("");
  const [risk, setRisk] = useState<RiskLevel>("read-only");
  const [tags, setTags] = useState("smoke");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <EditPage
      title="Import test"
      eyebrow="Test library"
      onClose={onClose}
      busy={busy}
      action="Continue to file"
      error={error}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          onImported(
            await window.bcFlow.selectAndImportTest({
              groupId,
              testId: testId || undefined,
              risk,
              tags: tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
              allowedEnvironmentTypes: ["sandbox", "uat", "docker"],
            }),
          );
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <DetailSection title="Destination" description="Where the test is stored in the library.">
        <Field label="Test group">
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            {snapshot.testGroups.map((group) => {
              const customer = snapshot.customers.find((item) => item.id === group.customerId);
              return (
                <option value={group.id} key={group.id}>
                  {customer ? `${customer.name} · ${group.name}` : group.name}
                </option>
              );
            })}
          </Select>
        </Field>
      </DetailSection>
      <DetailSection title="Details" description="How the test is identified and classified.">
        <div className="form-grid">
          <Field label="Test ID" hint="Optional; filename is used when empty.">
            <input
              value={testId}
              onChange={(e) => setTestId(e.target.value)}
              placeholder="BC-SALES-001"
            />
          </Field>
          <Field label="Risk">
            <Select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)}>
              <option value="read-only">Read-only</option>
              <option value="reversible">Reversible write</option>
              <option value="destructive">Destructive</option>
            </Select>
          </Field>
        </div>
        <Field label="Tags" hint="Comma-separated">
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <div className="drop-preview">
          <FileCode2 size={24} />
          <div>
            <strong>Select YAML after Continue</strong>
            <span>The validated test is copied into the protected local library.</span>
          </div>
        </div>
      </DetailSection>
    </EditPage>
  );
}
