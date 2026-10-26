import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AgentKind,
  AppSnapshot,
  Project,
  ProjectInput,
  ProjectInspection,
} from "../../shared/models";
import { EmptyState, Field, InlineError } from "../components/Field";
import { PageActions } from "../components/PageActions";
import { RowMenu, type RowMenuItem } from "../components/RowMenu";
import { DetailSection, RunPage } from "../components/RunPage";
import { Select } from "../components/Select";
import { Tile } from "../components/Tile";
import { ViewSwitch, useViewMode } from "../components/ViewSwitch";
import { messageOf } from "../lib/format";

const AGENTS: Array<{ id: AgentKind; label: string }> = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "other", label: "Other" },
];

export const agentLabel = (agent: AgentKind) =>
  AGENTS.find((item) => item.id === agent)?.label ?? agent;

export function ProjectsView({
  snapshot,
  onAdd,
  onOpen,
  onArchive,
}: {
  snapshot: AppSnapshot;
  onAdd(): void;
  onOpen(project: Project): void;
  onArchive(project: Project): void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useViewMode("projects");
  const environmentOf = (project: Project) =>
    snapshot.environments.find((item) => item.id === project.environmentId);
  const projects = snapshot.projects.filter(
    (project) =>
      Boolean(project.archivedAt) === showArchived &&
      `${project.name} ${environmentOf(project)?.name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const testCount = (project: Project) =>
    snapshot.tests.filter((test) => !test.archivedAt && test.projectIds?.includes(project.id))
      .length;
  const openCount = (project: Project) =>
    snapshot.investigations.filter(
      (item) =>
        item.projectId === project.id && item.status !== "VERIFIED" && item.status !== "ABANDONED",
    ).length;
  const menu = (project: Project): RowMenuItem[] => [
    { label: "Edit", icon: Pencil, onSelect: () => onOpen(project) },
    {
      label: project.archivedAt ? "Restore" : "Archive",
      icon: project.archivedAt ? ArchiveRestore : Archive,
      onSelect: () => onArchive(project),
    },
  ];
  const openBadge = (project: Project) =>
    openCount(project) ? (
      <span className="pill pill-warn">{openCount(project)} open</span>
    ) : undefined;
  return (
    <>
      <PageActions>
        {!showArchived && (
          <button type="button" className="button button-primary" onClick={onAdd}>
            <Plus size={16} /> Add project
          </button>
        )}
      </PageActions>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects…"
          />
        </div>
        <button
          type="button"
          className="icon-button icon-toggle"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((current) => !current)}
          aria-label={showArchived ? "Active projects" : "Archived projects"}
        >
          <ArchiveRestore size={16} />
        </button>
        <span className="filter-spacer" />
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
      </div>
      {projects.length ? (
        viewMode === "list" ? (
          <table className="plain-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Environment</th>
                <th scope="col">Code folder</th>
                <th scope="col" className="numeric">
                  Tests
                </th>
                <th scope="col">Investigations</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td className="primary-cell">
                    <span className="cell-with-chip">
                      <span className="logo-chip logo-chip-small" aria-hidden="true">
                        <GitBranch size={15} />
                      </span>
                      <span>
                        <button type="button" className="cell-link" onClick={() => onOpen(project)}>
                          {project.name}
                        </button>
                        <small className="cell-sub">{agentLabel(project.agent)}</small>
                      </span>
                    </span>
                  </td>
                  <td>{environmentOf(project)?.name}</td>
                  <td className="mono-cell">{project.codePath ?? "Not set on this device"}</td>
                  <td className="numeric">{testCount(project)}</td>
                  <td>{openBadge(project) ?? <span className="cell-sub">None</span>}</td>
                  <td className="numeric">
                    <RowMenu label={`Actions for ${project.name}`} items={menu(project)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="tile-grid">
            {projects.map((project) => (
              <Tile
                key={project.id}
                logo={<GitBranch size={22} />}
                title={project.name}
                line1={environmentOf(project)?.name}
                line2={`${testCount(project)} tests · ${agentLabel(project.agent)}`}
                status={openBadge(project)}
                actions={
                  <>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onOpen(project)}
                      aria-label="Open project"
                    >
                      <ChevronRight size={16} />
                    </button>
                    <RowMenu label={`Actions for ${project.name}`} items={menu(project)} />
                  </>
                }
              />
            ))}
          </div>
        )
      ) : (
        <EmptyState
          icon={GitBranch}
          title={showArchived ? "No archived projects" : "No projects yet"}
          text={
            showArchived
              ? "Archived projects appear here."
              : "Add the AL code behind an environment so failed tests can be handed to a coding agent."
          }
          action={showArchived ? undefined : "Add project"}
          onAction={onAdd}
        />
      )}
    </>
  );
}

export function ProjectPage({
  snapshot,
  project,
  defaultEnvironmentId,
  onClose,
  onSaved,
}: {
  snapshot: AppSnapshot;
  project?: Project;
  defaultEnvironmentId?: string;
  onClose(): void;
  onSaved(snapshot: AppSnapshot): void;
}) {
  const environments = snapshot.environments.filter(
    (item) => !item.archivedAt && item.type !== "production",
  );
  const [form, setForm] = useState<ProjectInput>({
    id: project?.id,
    environmentId: project?.environmentId ?? defaultEnvironmentId ?? environments[0]?.id ?? "",
    name: project?.name ?? "",
    description: project?.description ?? "",
    codePath: project?.codePath,
    agent: project?.agent ?? "claude-code",
    instructions: project?.instructions ?? "",
  });
  const [inspection, setInspection] = useState<ProjectInspection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [current, setCurrent] = useState(project);
  const update = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) =>
    setForm((state) => ({ ...state, [key]: value }));

  useEffect(() => {
    if (!project?.id || !project.codePath) return;
    let active = true;
    window.bcFlow
      .inspectProject(project.id)
      .then((result) => active && setInspection(result))
      .catch((cause) => active && setError(messageOf(cause)));
    return () => {
      active = false;
    };
  }, [project?.id, project?.codePath]);

  const environment = snapshot.environments.find((item) => item.id === form.environmentId);
  const linkedTests = snapshot.tests.filter((test) => {
    if (test.archivedAt) return false;
    const group = snapshot.testGroups.find((item) => item.id === test.groupId);
    return !group?.customerId || group.customerId === environment?.customerId;
  });

  const choose = async () => {
    setError(undefined);
    try {
      const result = await window.bcFlow.chooseProjectFolder();
      if (!result) return;
      update("codePath", result.path);
      setInspection(result.inspection);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const toggleTest = async (testId: string, linked: boolean) => {
    if (!current?.id) return;
    const test = snapshot.tests.find((item) => item.id === testId);
    if (!test) return;
    const projectIds = new Set(test.projectIds ?? []);
    if (linked) projectIds.add(current.id);
    else projectIds.delete(current.id);
    try {
      onSaved(
        await window.bcFlow.saveTest({
          id: test.id,
          groupId: test.groupId,
          name: test.name,
          description: test.description,
          risk: test.risk,
          forbiddenActions: test.forbiddenActions,
          tags: test.tags,
          projectIds: [...projectIds],
        }),
      );
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const folderStatus = !form.codePath ? (
    <span className="pill pill-neutral">No code folder</span>
  ) : inspection?.exists === false ? (
    <span className="pill pill-warn">Folder not found</span>
  ) : inspection ? (
    <span className="pill pill-ok">Code folder found</span>
  ) : undefined;

  return (
    <RunPage
      title={project ? project.name : "Add project"}
      subtitle={
        project
          ? `${environment?.name ?? "Environment"} · Business Central`
          : "The AL code behind an environment"
      }
      status={folderStatus}
      actions={
        <button
          type="submit"
          form="project-form"
          className="button button-primary"
          disabled={busy || !environments.length}
        >
          {project ? "Save changes" : "Save project"}
        </button>
      }
      onBack={onClose}
    >
      <form
        id="project-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            const next = await window.bcFlow.saveProject({
              ...form,
              description: form.description || undefined,
              instructions: form.instructions || undefined,
            });
            onSaved(next);
            if (!project) onClose();
            else setCurrent(next.projects.find((item) => item.id === project.id));
          } catch (cause) {
            setError(messageOf(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <InlineError text={error} />}
        {!environments.length && (
          <InlineError text="Add a sandbox or UAT environment first. Production environments cannot have projects." />
        )}
        <DetailSection
          title="Project"
          description="A name for the code, and the environment it runs in."
        >
          <div className="form-grid">
            <Field label="Project name">
              <input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Contoso Sales AL"
                required
              />
            </Field>
            <Field label="Environment">
              <Select
                value={form.environmentId}
                onChange={(event) => update("environmentId", event.target.value)}
                required
              >
                {environments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.company}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </DetailSection>
        <DetailSection
          title="Code folder"
          description="The local copy of the AL code. It stays on this device and is never part of a workspace backup."
        >
          <div className="folder-row">
            <span className="mono-cell folder-path">{form.codePath ?? "No folder chosen"}</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => void choose()}
              aria-label="Choose folder"
            >
              <FolderOpen size={16} />
            </button>
          </div>
          {inspection?.exists && (
            <table className="plain-table">
              <tbody>
                <tr>
                  <td className="primary-cell">Git repository</td>
                  <td>{inspection.isGitRepository ? "Yes" : "No"}</td>
                  <td className="numeric">
                    <span
                      className={`pill ${inspection.isGitRepository ? "pill-ok" : "pill-warn"}`}
                    >
                      {inspection.isGitRepository ? "Ready" : "Not a repository"}
                    </span>
                  </td>
                </tr>
                {inspection.gitRoot && (
                  <tr>
                    <td className="primary-cell">Repository root</td>
                    <td className="mono-cell">{inspection.gitRoot}</td>
                    <td />
                  </tr>
                )}
                <tr>
                  <td className="primary-cell">Current branch</td>
                  <td className="mono-cell">{inspection.branch ?? "unknown"}</td>
                  <td />
                </tr>
                <tr>
                  <td className="primary-cell">AL apps found</td>
                  <td className="mono-cell">
                    {inspection.apps.length
                      ? inspection.apps.map((app) => `${app.name} ${app.version}`).join(" · ")
                      : "None"}
                  </td>
                  <td className="numeric">
                    <span className={`pill ${inspection.apps.length ? "pill-ok" : "pill-warn"}`}>
                      {inspection.apps.length ? `${inspection.apps.length} apps` : "No app.json"}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </DetailSection>
        <DetailSection
          title="Coding agent"
          description="A preference. You can pick another agent per investigation."
        >
          <fieldset className="choice-chips" aria-label="Coding agent">
            {AGENTS.map((agent) => (
              <button
                type="button"
                key={agent.id}
                aria-pressed={form.agent === agent.id}
                onClick={() => update("agent", agent.id)}
              >
                {agent.label}
              </button>
            ))}
          </fieldset>
          <Field
            label="Instructions for the agent"
            hint="Added to every agent brief for this project. Maximum 4 000 characters."
          >
            <textarea
              value={form.instructions ?? ""}
              onChange={(event) => update("instructions", event.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Follow the AL guidelines of this repository. Keep changes minimal."
            />
          </Field>
        </DetailSection>
        <DetailSection
          title="Linked tests"
          description="A test can belong to several projects. Failures are investigated in the project you pick."
        >
          {current?.id ? (
            linkedTests.length ? (
              <table className="plain-table">
                <tbody>
                  {linkedTests.map((test) => {
                    const linked = Boolean(test.projectIds?.includes(current.id));
                    return (
                      <tr key={test.id}>
                        <td className="primary-cell">
                          {test.testId} · {test.name}
                        </td>
                        <td className="numeric">
                          <label className="inline-check">
                            <input
                              type="checkbox"
                              checked={linked}
                              onChange={(event) => void toggleTest(test.id, event.target.checked)}
                            />
                            {linked ? <CheckCircle2 size={14} /> : null}
                            Linked
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="section-empty">No tests for this customer yet.</p>
            )
          ) : (
            <p className="section-empty">Save the project first, then link tests to it.</p>
          )}
        </DetailSection>
      </form>
    </RunPage>
  );
}
