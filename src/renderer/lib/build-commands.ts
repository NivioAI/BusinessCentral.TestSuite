import type {
  AppSnapshot,
  BcEnvironment,
  Customer,
  Investigation,
  Project,
  TestDefinition,
  TestPlan,
  TestRun,
} from "../../shared/models";
import { type Command, goToKeys } from "../commands";
import { navigation } from "../navigation";
import { relativeTime } from "./format";

export interface CommandActions {
  goTo(view: import("../navigation").View): void;
  runTest(test: TestDefinition): void;
  runPlan(plan: TestPlan): void;
  openRun(run: TestRun): void;
  openInvestigation(investigation: Investigation): void;
  createInvestigation(run: TestRun): void;
  importTest(): void;
  newPlan(): void;
  newCustomer(): void;
  editCustomer(customer: Customer): void;
  addEnvironment(): void;
  editEnvironment(environment: BcEnvironment): void;
  addProject(): void;
  openProject(project: Project): void;
}

/** Everything the search can find, as commands. Running one opens a screen or review page. */
export function buildCommands(snapshot: AppSnapshot, actions: CommandActions): Command[] {
  const commands: Command[] = [];
  const customerName = (id?: string) => snapshot.customers.find((item) => item.id === id)?.name;

  commands.push(
    {
      id: "a:import",
      title: "Import test",
      subtitle: "Add a Page Script YAML recording",
      group: "Actions",
      keywords: "new add yaml recording",
      run: actions.importTest,
    },
    {
      id: "a:plan",
      title: "New test plan",
      subtitle: "An ordered set of tests",
      group: "Actions",
      keywords: "add create",
      run: actions.newPlan,
    },
    {
      id: "a:customer",
      title: "New customer",
      group: "Actions",
      keywords: "add create",
      run: actions.newCustomer,
    },
    {
      id: "a:environment",
      title: "Add environment",
      subtitle: "A sandbox or UAT target",
      group: "Actions",
      keywords: "new create target",
      run: actions.addEnvironment,
    },
    {
      id: "a:project",
      title: "Add project",
      subtitle: "The AL code behind an environment",
      group: "Actions",
      keywords: "new create repository code",
      run: actions.addProject,
    },
  );

  const failed = snapshot.runs.find((run) => ["FAILED", "ERROR"].includes(run.status));
  if (failed) {
    const open = snapshot.investigations.some(
      (item) =>
        item.testDefinitionId === failed.testDefinitionId &&
        !["VERIFIED", "ABANDONED"].includes(item.status),
    );
    if (!open) {
      commands.push({
        id: "a:investigate",
        title: "Create investigation",
        subtitle: `${failed.testId} · ${failed.testName} · failed ${relativeTime(failed.startedAt)}`,
        group: "Actions",
        keywords: "failed fix agent analyse analyze",
        run: () => actions.createInvestigation(failed),
      });
    }
  }

  for (const item of navigation) {
    commands.push({
      id: `g:${item.id}`,
      title: item.label,
      group: "Go to",
      keys: goToKeys(item.id),
      run: () => actions.goTo(item.id),
    });
  }

  for (const test of snapshot.tests.filter((item) => !item.archivedAt)) {
    commands.push({
      id: `t:${test.id}`,
      title: `${test.testId} · ${test.name}`,
      subtitle: `Run · ${customerName(test.customerId) ?? "General"} · ${test.risk}`,
      group: "Tests",
      keywords: test.tags.join(" "),
      run: () => actions.runTest(test),
    });
  }
  for (const plan of snapshot.testPlans.filter((item) => !item.archivedAt)) {
    commands.push({
      id: `p:${plan.id}`,
      title: plan.name,
      subtitle: `Run plan · ${plan.testDefinitionIds.length} tests · ${customerName(plan.customerId) ?? ""}`,
      group: "Plans",
      run: () => actions.runPlan(plan),
    });
  }
  for (const investigation of snapshot.investigations) {
    const test = snapshot.tests.find((item) => item.id === investigation.testDefinitionId);
    commands.push({
      id: `i:${investigation.id}`,
      title: `INV-${investigation.number} · ${test?.name ?? "Investigation"}`,
      subtitle: investigation.status.replace(/_/g, " ").toLowerCase(),
      group: "Investigations",
      run: () => actions.openInvestigation(investigation),
    });
  }
  for (const project of snapshot.projects.filter((item) => !item.archivedAt)) {
    commands.push({
      id: `j:${project.id}`,
      title: project.name,
      subtitle: "Project",
      group: "Projects",
      run: () => actions.openProject(project),
    });
  }
  for (const environment of snapshot.environments.filter((item) => !item.archivedAt)) {
    commands.push({
      id: `e:${environment.id}`,
      title: `${environment.name} · ${environment.company}`,
      subtitle: `Environment · ${customerName(environment.customerId) ?? ""}`,
      group: "Environments",
      run: () => actions.editEnvironment(environment),
    });
  }
  for (const customer of snapshot.customers.filter((item) => !item.archivedAt)) {
    commands.push({
      id: `c:${customer.id}`,
      title: customer.name,
      subtitle: `Customer · ${customer.code}`,
      group: "Customers",
      run: () => actions.editCustomer(customer),
    });
  }
  for (const run of snapshot.runs.slice(0, 20)) {
    commands.push({
      id: `r:${run.id}`,
      title: `${run.testId} · ${run.testName}`,
      subtitle: `Run · ${run.status.toLowerCase()} · ${relativeTime(run.startedAt)}`,
      group: "Runs",
      run: () => actions.openRun(run),
    });
  }
  return commands;
}
