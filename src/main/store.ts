import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import type { DataCategory, DataDeletionResult } from "../shared/data-categories";
import { CLOSED_STATUSES } from "../shared/investigation-status";
import type {
  AppSettingsInput,
  AppState,
  BcEnvironment,
  BeginTestPlanRunInput,
  Customer,
  CustomerInput,
  EnvironmentInput,
  Investigation,
  ParameterProfileInput,
  Project,
  ProjectInput,
  TestDefinition,
  TestDefinitionInput,
  TestGroup,
  TestGroupInput,
  TestParameter,
  TestPlan,
  TestPlanInput,
  TestPlanRun,
  TestRun,
} from "../shared/models";
import { DEFAULT_NOTIFICATIONS, withNotificationDefaults } from "../shared/notifications";
import { latestOccurrence } from "../shared/schedule";
import { resolveBusinessCentralUrl } from "./runtime";
import { CURRENT_STATE_VERSION, migrateState } from "./state-migrations";
import type { PortableWorkspaceState } from "./workspace-backup";

interface SecretRecord {
  environmentId: string;
  encryptedPassword?: string;
  encryptedSessionState?: string;
}

const EMPTY_STATE: AppState = {
  schemaVersion: CURRENT_STATE_VERSION,
  settings: {
    stepDelayMs: 500,
    textSize: "medium",
    runRetentionDays: 90,
    notifications: { ...DEFAULT_NOTIFICATIONS },
  },
  customers: [],
  testGroups: [],
  testPlans: [],
  testPlanRuns: [],
  environments: [],
  projects: [],
  investigations: [],
  tests: [],
  runs: [],
  parameterProfiles: [],
  mcpApprovals: [],
};

export class JsonStore {
  private state: AppState = structuredClone(EMPTY_STATE);
  private secrets: SecretRecord[] = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private recoveredPaths = new Set<string>();

  constructor(
    private readonly statePath: string,
    private readonly secretsPath: string,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const migrated = await this.readState();
    this.state = migrated.state;
    this.state.settings ??= structuredClone(EMPTY_STATE.settings);
    this.state.settings.textSize ??= "medium";
    this.state.settings.runRetentionDays ??= 90;
    this.state.settings.notifications = withNotificationDefaults(this.state.settings.notifications);
    this.state.customers ??= [];
    this.state.environments ??= [];
    this.state.projects ??= [];
    this.state.investigations ??= [];
    this.state.tests ??= [];
    this.state.runs ??= [];
    this.state.parameterProfiles ??= [];
    this.state.mcpApprovals ??= [];
    this.state.testGroups ??= [];
    this.state.testPlans ??= [];
    for (const plan of this.state.testPlans) plan.parameterProfileIds ??= {};
    this.state.testPlanRuns ??= [];
    let stateChanged = migrated.changed;
    for (const item of [
      ...this.state.customers,
      ...this.state.testGroups,
      ...this.state.testPlans,
    ]) {
      if (item.id) continue;
      item.id = randomUUID();
      stateChanged = true;
    }
    for (const planRun of this.state.testPlanRuns.filter((run) => run.status === "RUNNING")) {
      planRun.status = "ABORTED";
      planRun.finishedAt = new Date().toISOString();
      stateChanged = true;
    }
    let generalGroup = this.state.testGroups.find((group) => group.system);
    if (!generalGroup) {
      generalGroup = { id: randomUUID(), name: "General", system: true };
      this.state.testGroups.unshift(generalGroup);
      stateChanged = true;
    }
    for (const test of this.state.tests) {
      test.forbiddenActions ??= [];
      if (test.groupId) continue;
      let group = this.state.testGroups.find(
        (item) => item.customerId === test.customerId && item.name === "Customizations",
      );
      if (!group && test.customerId) {
        group = {
          id: randomUUID(),
          name: "Customizations",
          customerId: test.customerId,
          system: false,
        };
        this.state.testGroups.push(group);
      }
      test.groupId = group?.id ?? generalGroup.id;
      stateChanged = true;
    }
    this.secrets = await this.readJson<SecretRecord[]>(this.secretsPath, []);
    const previousUrls = this.state.environments.map((environment) => environment.baseUrl);
    for (const environment of this.state.environments) {
      environment.baseUrl = resolveBusinessCentralUrl(
        environment.baseUrl,
        environment.tenantId,
        environment.name,
      );
      environment.hasRememberedSession = this.secrets.some(
        (secret) => secret.environmentId === environment.id && secret.encryptedSessionState,
      );
    }
    if (
      stateChanged ||
      this.state.environments.some(
        (environment, index) => environment.baseUrl !== previousUrls[index],
      )
    ) {
      await this.persist();
    }
  }

  get recoveredFromBackup(): boolean {
    return this.recoveredPaths.size > 0;
  }

  async saveCustomer(input: CustomerInput): Promise<void> {
    const duplicate = this.state.customers.find(
      (customer) =>
        customer.id !== input.id && customer.code.toLowerCase() === input.code.toLowerCase(),
    );
    if (duplicate) throw new Error("A customer with this code already exists.");
    const existing = input.id
      ? this.state.customers.find((customer) => customer.id === input.id)
      : undefined;
    if (input.id && !existing) throw new Error("The customer no longer exists.");
    if (existing) {
      const previousCode = existing.code;
      Object.assign(existing, { code: input.code, name: input.name });
      for (const run of this.state.runs.filter((item) => item.customerCode === previousCode)) {
        run.customerCode = input.code;
      }
    } else {
      this.state.customers.push({
        id: randomUUID(),
        code: input.code,
        name: input.name,
        active: true,
      });
    }
    await this.persist();
  }

  async saveSettings(input: AppSettingsInput): Promise<void> {
    this.state.settings = input;
    await this.persist();
  }

  async saveParameterProfile(input: ParameterProfileInput): Promise<void> {
    const test = this.findTest(input.testDefinitionId);
    if (!test) throw new Error("The test no longer exists.");
    const secretNames = new Set(
      test.parameters.filter((parameter) => parameter.secret).map((parameter) => parameter.name),
    );
    const parameterNames = new Set(test.parameters.map((parameter) => parameter.name));
    if (Object.keys(input.values).some((name) => !parameterNames.has(name))) {
      throw new Error("The parameter profile has an unknown parameter.");
    }
    if (Object.keys(input.values).some((name) => secretNames.has(name))) {
      throw new Error("Secret parameters cannot be saved in a profile.");
    }
    if (input.environmentId && !this.findEnvironment(input.environmentId)) {
      throw new Error("The environment of this profile no longer exists.");
    }
    const existing = this.state.parameterProfiles.find(
      (profile) =>
        profile.testDefinitionId === input.testDefinitionId &&
        profile.environmentId === input.environmentId &&
        profile.name.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
    );
    const profile = {
      id: existing?.id ?? randomUUID(),
      ...input,
      updatedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, profile);
    else this.state.parameterProfiles.push(profile);
    await this.persist();
  }

  async importWorkspace(
    imported: PortableWorkspaceState,
    mode: "merge" | "replace",
  ): Promise<void> {
    const mergeById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
      const merged = new Map(current.map((item) => [item.id, item]));
      for (const item of incoming) merged.set(item.id, item);
      return [...merged.values()];
    };
    this.state.settings = {
      ...imported.settings,
      notifications: withNotificationDefaults(imported.settings.notifications),
      // A path on this device is never taken from a backup, and a restore does not erase it.
      customAgent: this.state.settings.customAgent,
    };
    this.state.customers =
      mode === "replace" ? imported.customers : mergeById(this.state.customers, imported.customers);
    this.state.testGroups =
      mode === "replace"
        ? imported.testGroups
        : mergeById(this.state.testGroups, imported.testGroups);
    this.state.environments =
      mode === "replace"
        ? imported.environments
        : mergeById(this.state.environments, imported.environments);
    // Code folders are local to this device: keep them, and keep projects that have investigations.
    const localProjects = new Map(this.state.projects.map((item) => [item.id, item]));
    const importedProjects = imported.projects.map((project) => ({
      ...project,
      codePath: localProjects.get(project.id)?.codePath,
    }));
    const referencedIds = new Set(this.state.investigations.map((item) => item.projectId));
    this.state.projects =
      mode === "replace"
        ? [
            ...importedProjects,
            ...this.state.projects.filter(
              (item) =>
                referencedIds.has(item.id) && !importedProjects.some((next) => next.id === item.id),
            ),
          ]
        : mergeById(this.state.projects, importedProjects);
    this.state.tests =
      mode === "replace" ? imported.tests : mergeById(this.state.tests, imported.tests);
    const localPlans = new Map(this.state.testPlans.map((item) => [item.id, item]));
    const importedPlans = imported.testPlans.map((plan) => {
      if (!plan.schedule) return plan;
      // A restored schedule starts from now: it keeps the local history and never fires at once.
      const local = localPlans.get(plan.id);
      return {
        ...plan,
        scheduleHandledAt:
          local?.scheduleHandledAt ?? latestOccurrence(plan.schedule, new Date()).toISOString(),
        schedulePending: local?.schedulePending,
      };
    });
    this.state.testPlans =
      mode === "replace" ? importedPlans : mergeById(this.state.testPlans, importedPlans);
    this.state.parameterProfiles =
      mode === "replace"
        ? imported.parameterProfiles
        : mergeById(this.state.parameterProfiles, imported.parameterProfiles);
    await this.persist();
  }

  async deleteCustomer(id: string): Promise<void> {
    const customer = this.findCustomer(id);
    if (!customer) throw new Error("The customer no longer exists.");
    if (this.state.environments.some((environment) => environment.customerId === id))
      throw new Error("Delete the environments of this customer first.");
    if (this.state.testGroups.some((group) => group.customerId === id))
      throw new Error("Delete the test groups of this customer first.");
    if (this.state.testPlans.some((plan) => plan.customerId === id))
      throw new Error("Delete the test plans of this customer first.");
    if (this.state.runs.some((run) => run.customerCode === customer.code))
      throw new Error("This customer has run history and cannot be deleted.");
    this.state.customers = this.state.customers.filter((item) => item.id !== id);
    await this.persist();
  }

  async saveTestGroup(input: TestGroupInput): Promise<void> {
    if (!this.findCustomer(input.customerId)) throw new Error("Select a valid customer.");
    const duplicate = this.state.testGroups.some(
      (group) =>
        group.id !== input.id &&
        group.customerId === input.customerId &&
        group.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (duplicate) throw new Error("This group already exists for the selected customer.");
    const existing = input.id ? this.findTestGroup(input.id) : undefined;
    if (input.id && (!existing || existing.system))
      throw new Error("The test group no longer exists.");
    if (existing) {
      Object.assign(existing, { customerId: input.customerId, name: input.name });
      for (const test of this.state.tests.filter((item) => item.groupId === existing.id)) {
        test.customerId = input.customerId;
      }
    } else {
      this.state.testGroups.push({
        id: randomUUID(),
        customerId: input.customerId,
        name: input.name,
        system: false,
      });
    }
    await this.persist();
  }

  async deleteTestGroup(id: string): Promise<void> {
    const group = this.findTestGroup(id);
    if (!group || group.system) throw new Error("The General group cannot be deleted.");
    if (this.state.tests.some((test) => test.groupId === id))
      throw new Error("Move or delete the tests in this group first.");
    this.state.testGroups = this.state.testGroups.filter((item) => item.id !== id);
    await this.persist();
  }

  async saveTest(input: TestDefinitionInput): Promise<void> {
    const test = this.findTest(input.id);
    const group = this.findTestGroup(input.groupId);
    if (!test) throw new Error("The test no longer exists.");
    if (!group) throw new Error("Select a valid test group.");
    const projectIds = [...new Set(input.projectIds)];
    for (const projectId of projectIds) {
      const project = this.findProject(projectId);
      const environment = project ? this.findEnvironment(project.environmentId) : undefined;
      if (!project || !environment) throw new Error("A chosen project no longer exists.");
      if (group.customerId && environment.customerId !== group.customerId)
        throw new Error("A project must belong to the same customer as the test.");
    }
    Object.assign(test, input, { customerId: group.customerId, projectIds });
    await this.persist();
  }

  async updateTestVersion(id: string, versionHash: string): Promise<void> {
    const test = this.findTest(id);
    if (!test) throw new Error("The test no longer exists.");
    test.versionHash = versionHash;
    await this.persist();
  }

  async updateTestRecording(
    id: string,
    update: {
      recordingPath: string;
      parameters: TestParameter[];
      versionHash: string;
      importedAt: string;
    },
  ): Promise<void> {
    const test = this.findTest(id);
    if (!test) throw new Error("The test no longer exists.");
    Object.assign(test, update);
    const allowedProfileNames = new Set(
      update.parameters.filter((parameter) => !parameter.secret).map((parameter) => parameter.name),
    );
    for (const profile of this.state.parameterProfiles.filter(
      (item) => item.testDefinitionId === id,
    )) {
      profile.values = Object.fromEntries(
        Object.entries(profile.values).filter(([name]) => allowedProfileNames.has(name)),
      );
    }
    await this.persist();
  }

  /** Runs and open investigations that deleting this test with its history would touch. */
  historyOfTest(id: string): { runs: TestRun[]; investigations: Investigation[] } {
    return {
      runs: this.state.runs.filter((run) => run.testDefinitionId === id),
      investigations: this.state.investigations.filter((item) => item.testDefinitionId === id),
    };
  }

  async deleteTest(
    id: string,
    withHistory = false,
  ): Promise<{ runs: TestRun[]; investigations: Investigation[] }> {
    if (!this.findTest(id)) throw new Error("The test no longer exists.");
    if (this.state.testPlans.some((plan) => plan.testDefinitionIds.includes(id)))
      throw new Error("This test is used in a test plan.");
    const history = this.historyOfTest(id);
    if (!withHistory && history.runs.length)
      throw new Error("This test has run history and cannot be deleted.");
    if (history.runs.some((run) => run.status === "RUNNING"))
      throw new Error("An active test run cannot be deleted.");
    if (history.investigations.some((item) => !CLOSED_STATUSES.includes(item.status)))
      throw new Error("Close the open investigations of this test first.");
    const runIds = new Set(history.runs.map((run) => run.id));
    this.state.runs = this.state.runs.filter((run) => !runIds.has(run.id));
    this.state.investigations = this.state.investigations.filter(
      (item) => item.testDefinitionId !== id,
    );
    this.state.testPlanRuns = this.state.testPlanRuns
      .map((planRun) => ({
        ...planRun,
        items: planRun.items.filter((item) => item.testDefinitionId !== id),
      }))
      .filter((planRun) => planRun.items.length > 0);
    this.state.tests = this.state.tests.filter((test) => test.id !== id);
    this.state.parameterProfiles = this.state.parameterProfiles.filter(
      (profile) => profile.testDefinitionId !== id,
    );
    await this.persist();
    return history;
  }

  /**
   * Deletes the chosen data. Callers pass a dependency-closed set (see withDependencies).
   * Returns what was removed so the controller can delete files that belong to it.
   */
  async deleteData(categories: readonly DataCategory[]): Promise<{
    result: DataDeletionResult;
    runs: TestRun[];
    investigations: Investigation[];
    tests: TestDefinition[];
  }> {
    const chosen = new Set(categories);
    if (this.state.runs.some((run) => run.status === "RUNNING"))
      throw new Error("Wait until the active test run has finished.");
    const removed = {
      runs: [] as TestRun[],
      investigations: [] as Investigation[],
      tests: [] as TestDefinition[],
    };
    const result: DataDeletionResult = {
      runs: 0,
      investigations: 0,
      plans: 0,
      tests: 0,
      projects: 0,
    };
    if (chosen.has("runs")) {
      removed.runs = this.state.runs;
      this.state.runs = [];
      this.state.testPlanRuns = [];
      result.runs = removed.runs.length;
    }
    if (chosen.has("investigations")) {
      removed.investigations = this.state.investigations;
      this.state.investigations = [];
      result.investigations = removed.investigations.length;
    }
    if (chosen.has("plans")) {
      result.plans = this.state.testPlans.length;
      this.state.testPlans = [];
      this.state.testPlanRuns = [];
    }
    if (chosen.has("tests")) {
      removed.tests = this.state.tests;
      this.state.tests = [];
      this.state.parameterProfiles = [];
      result.tests = removed.tests.length;
    }
    if (chosen.has("projects")) {
      result.projects = this.state.projects.length;
      this.state.projects = [];
      for (const test of this.state.tests) test.projectIds = [];
    }
    if (chosen.has("approvals")) this.state.mcpApprovals = [];
    if (chosen.has("credentials")) {
      this.secrets = [];
      for (const environment of this.state.environments) {
        environment.hasCredential = false;
        environment.hasRememberedSession = false;
      }
    }
    await Promise.all([this.persist(), this.persistSecrets()]);
    return { result, ...removed };
  }

  async setTestArchived(id: string, archived: boolean): Promise<void> {
    const test = this.findTest(id);
    if (!test) throw new Error("The test no longer exists.");
    if (archived && this.state.testPlans.some((plan) => plan.testDefinitionIds.includes(id))) {
      throw new Error("Remove the test from active test plans first.");
    }
    test.archivedAt = archived ? new Date().toISOString() : undefined;
    await this.persist();
  }

  async setEntityArchived(
    kind: "customer" | "test-group" | "environment" | "test-plan" | "project",
    id: string,
    archived: boolean,
  ): Promise<void> {
    const archivedAt = archived ? new Date().toISOString() : undefined;
    if (kind === "customer") {
      const item = this.findCustomer(id);
      if (!item) throw new Error("The customer no longer exists.");
      item.active = !archived;
      item.archivedAt = archivedAt;
    } else if (kind === "test-group") {
      const item = this.findTestGroup(id);
      if (!item || item.system) throw new Error("The test group no longer exists.");
      if (archived && this.state.tests.some((test) => test.groupId === id && !test.archivedAt))
        throw new Error("Archive the active tests in this group first.");
      item.archivedAt = archivedAt;
    } else if (kind === "environment") {
      const item = this.findEnvironment(id);
      if (!item) throw new Error("The environment no longer exists.");
      if (
        archived &&
        this.state.testPlans.some((plan) => plan.environmentId === id && !plan.archivedAt)
      )
        throw new Error("Archive the active test plans for this environment first.");
      item.active = !archived;
      item.archivedAt = archivedAt;
    } else if (kind === "project") {
      const item = this.findProject(id);
      if (!item) throw new Error("The project no longer exists.");
      if (archived && this.openInvestigationsFor(id).length)
        throw new Error("Close the open investigations of this project first.");
      item.archivedAt = archivedAt;
    } else {
      const item = this.findTestPlan(id);
      if (!item) throw new Error("The test plan no longer exists.");
      if (
        archived &&
        this.state.testPlanRuns.some((run) => run.testPlanId === id && run.status === "RUNNING")
      )
        throw new Error("An active test plan cannot be archived.");
      item.archivedAt = archivedAt;
    }
    await this.persist();
  }

  async saveTestPlan(input: TestPlanInput): Promise<void> {
    const customer = this.findCustomer(input.customerId);
    if (!customer) throw new Error("Select a valid customer.");
    const environment = this.findEnvironment(input.environmentId);
    if (!environment || environment.customerId !== customer.id)
      throw new Error("Select a valid target of the chosen customer.");
    const tests = input.testDefinitionIds.map((id) => this.findTest(id));
    if (tests.some((test) => !test)) throw new Error("A selected test no longer exists.");
    if (
      tests.some(
        (test) =>
          test &&
          ((test.customerId && test.customerId !== customer.id) ||
            !test.allowedEnvironmentTypes.includes(environment.type)),
      )
    ) {
      throw new Error("All tests must be suitable for the chosen customer and environment.");
    }
    const selectedIds = new Set(input.testDefinitionIds);
    for (const [testId, profileId] of Object.entries(input.parameterProfileIds ?? {})) {
      const profile = this.state.parameterProfiles.find((item) => item.id === profileId);
      if (!selectedIds.has(testId) || profile?.testDefinitionId !== testId) {
        throw new Error("A parameter profile does not belong to the selected test.");
      }
      if (profile.environmentId && profile.environmentId !== input.environmentId) {
        throw new Error("A parameter profile belongs to another environment.");
      }
    }
    const existing = input.id
      ? this.state.testPlans.find((plan) => plan.id === input.id)
      : undefined;
    if (input.id && !existing) throw new Error("The test plan no longer exists.");
    const { schedule, ...fields } = input;
    const now = new Date();
    if (existing) {
      Object.assign(existing, fields);
      if (!schedule) {
        existing.schedule = undefined;
        existing.scheduleHandledAt = undefined;
        existing.schedulePending = undefined;
      } else if (
        existing.schedule?.days !== schedule.days ||
        existing.schedule?.time !== schedule.time
      ) {
        // Moments before this change never fire, and an old reminder no longer applies.
        existing.schedule = schedule;
        existing.scheduleHandledAt = latestOccurrence(schedule, now).toISOString();
        existing.schedulePending = undefined;
      }
    } else {
      this.state.testPlans.push({
        id: randomUUID(),
        name: input.name,
        customerId: input.customerId,
        environmentId: input.environmentId,
        testDefinitionIds: input.testDefinitionIds,
        parameterProfileIds: input.parameterProfileIds,
        ...(schedule
          ? { schedule, scheduleHandledAt: latestOccurrence(schedule, now).toISOString() }
          : {}),
      });
    }
    await this.persist();
  }

  async deleteTestPlan(id: string): Promise<void> {
    if (!this.state.testPlans.some((plan) => plan.id === id))
      throw new Error("The test plan no longer exists.");
    this.state.testPlans = this.state.testPlans.filter((plan) => plan.id !== id);
    this.state.testPlanRuns = this.state.testPlanRuns.filter((run) => run.testPlanId !== id);
    await this.persist();
  }

  async beginTestPlanRun(input: BeginTestPlanRunInput): Promise<string> {
    if (this.state.testPlanRuns.some((run) => run.status === "RUNNING"))
      throw new Error("A test plan is already running.");
    const plan = this.findTestPlan(input.planId);
    let planName: string;
    let customerId: string;
    let environmentId: string;
    let testDefinitionIds: string[];
    if (plan) {
      testDefinitionIds = input.testDefinitionIds ?? plan.testDefinitionIds;
      const positions = testDefinitionIds.map((id) => plan.testDefinitionIds.indexOf(id));
      if (
        !testDefinitionIds.length ||
        positions.some(
          (position, index) => position < 0 || (index > 0 && position <= positions[index - 1]),
        )
      )
        throw new Error("The tests must come from the plan, in the plan's order.");
      planName = plan.name;
      customerId = plan.customerId;
      environmentId = plan.environmentId;
    } else if (input.planId.startsWith("regression:")) {
      const environment = input.environmentId
        ? this.findEnvironment(input.environmentId)
        : undefined;
      if (!environment || environment.type === "production" || environment.archivedAt)
        throw new Error("Select a valid environment.");
      testDefinitionIds = input.testDefinitionIds ?? [];
      if (!testDefinitionIds.length) throw new Error("Select at least one test.");
      for (const id of testDefinitionIds) {
        const test = this.findTest(id);
        if (
          !test ||
          test.archivedAt ||
          !test.allowedEnvironmentTypes.includes(environment.type) ||
          (test.customerId && test.customerId !== environment.customerId)
        )
          throw new Error("A selected test cannot run on this environment.");
      }
      planName = input.name ?? "Regression";
      customerId = environment.customerId;
      environmentId = environment.id;
    } else {
      throw new Error("The test plan no longer exists.");
    }
    if (
      input.resumedFromId &&
      !this.state.testPlanRuns.some(
        (run) => run.id === input.resumedFromId && run.testPlanId === input.planId,
      )
    )
      throw new Error("The execution to resume no longer exists.");
    const id = randomUUID();
    this.state.testPlanRuns.unshift({
      id,
      testPlanId: input.planId,
      planName,
      customerId,
      environmentId,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      items: [],
      testDefinitionIds,
      resumedFromId: input.resumedFromId,
      adHoc: plan ? undefined : true,
      scheduled: input.scheduledFor ? true : undefined,
    });
    if (plan && input.scheduledFor) {
      // This run answers the scheduled moment: it is handled, and no reminder is left.
      plan.scheduleHandledAt = input.scheduledFor;
      plan.schedulePending = undefined;
    }
    this.state.testPlanRuns = this.state.testPlanRuns.slice(0, 200);
    await this.persist();
    return id;
  }

  async recordTestPlanRunResult(planRunId: string, runId: string): Promise<void> {
    const planRun = this.state.testPlanRuns.find((item) => item.id === planRunId);
    const run = this.state.runs.find((item) => item.id === runId);
    const plan = planRun ? this.findTestPlan(planRun.testPlanId) : undefined;
    if (!planRun || planRun.status !== "RUNNING")
      throw new Error("This plan run is no longer active.");
    const tests = planRun.testDefinitionIds ?? plan?.testDefinitionIds;
    if (!run || !tests || run.environmentId !== planRun.environmentId)
      throw new Error("The test run does not belong to this plan run.");
    const expectedTestId = tests[planRun.items.length];
    if (run.testDefinitionId !== expectedTestId)
      throw new Error("The test run is not at the expected position in the plan.");
    planRun.items.push({
      sequence: planRun.items.length + 1,
      testDefinitionId: run.testDefinitionId,
      testId: run.testId,
      testName: run.testName,
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    });
    if (run.status !== "PASSED") {
      planRun.status = run.status === "ABORTED" ? "ABORTED" : "FAILED";
      planRun.finishedAt = run.finishedAt ?? new Date().toISOString();
    } else if (planRun.items.length === tests.length) {
      planRun.status = "PASSED";
      planRun.finishedAt = run.finishedAt ?? new Date().toISOString();
    }
    await this.persist();
  }

  /** Marks a scheduled moment as seen. With a reason it becomes a reminder for the user. */
  async handleScheduledMoment(
    planId: string,
    occurrence: string,
    pending?: { reason: "review" | "missed"; detail?: string },
  ): Promise<void> {
    const plan = this.findTestPlan(planId);
    if (!plan?.schedule) return;
    plan.scheduleHandledAt = occurrence;
    plan.schedulePending = pending ? { occurrence, ...pending } : undefined;
    await this.persist();
  }

  /** The user decided: skip the waiting reminder. */
  async dismissSchedulePending(planId: string): Promise<void> {
    const plan = this.findTestPlan(planId);
    if (!plan?.schedulePending) return;
    plan.schedulePending = undefined;
    await this.persist();
  }

  async abortTestPlanRun(planRunId: string): Promise<void> {
    const planRun = this.state.testPlanRuns.find((item) => item.id === planRunId);
    if (!planRun || planRun.status !== "RUNNING") return;
    planRun.status = "ABORTED";
    planRun.finishedAt = new Date().toISOString();
    await this.persist();
  }

  snapshot(): AppState {
    return structuredClone(this.state);
  }

  async saveEnvironment(input: EnvironmentInput): Promise<void> {
    let customer = input.customerId
      ? this.state.customers.find((item) => item.id === input.customerId)
      : undefined;
    if (!customer) {
      customer = this.state.customers.find(
        (item) => item.code.toLowerCase() === input.customerCode.toLowerCase(),
      );
    }
    if (!customer) {
      customer = {
        id: randomUUID(),
        code: input.customerCode,
        name: input.customerName,
        active: true,
      } satisfies Customer;
      this.state.customers.push(customer);
    } else {
      customer.code = input.customerCode;
      customer.name = input.customerName;
    }

    const environmentId = input.id ?? randomUUID();
    const hasCredential =
      Boolean(input.password) ||
      this.secrets.some(
        (secret) => secret.environmentId === environmentId && secret.encryptedPassword,
      );
    const environment: BcEnvironment = {
      id: environmentId,
      customerId: customer.id,
      tenantId: input.tenantId,
      name: input.name,
      company: input.company,
      type: input.type,
      baseUrl: resolveBusinessCentralUrl(input.baseUrl, input.tenantId, input.name),
      authentication: input.authentication,
      username: input.username,
      hasCredential,
      hasRememberedSession: this.secrets.some(
        (secret) => secret.environmentId === environmentId && secret.encryptedSessionState,
      ),
      active: true,
    };
    const index = this.state.environments.findIndex((item) => item.id === environmentId);
    if (index === -1) this.state.environments.push(environment);
    else this.state.environments[index] = environment;

    if (input.password) await this.setPassword(environmentId, input.password);
    await this.persist();
  }

  async deleteEnvironment(id: string): Promise<void> {
    if (!this.findEnvironment(id)) throw new Error("The environment no longer exists.");
    if (this.state.projects.some((project) => project.environmentId === id))
      throw new Error("Delete or archive the projects of this environment first.");
    if (
      this.state.tests.some((test) =>
        this.state.runs.some((run) => run.environmentId === id && run.testDefinitionId === test.id),
      )
    ) {
      throw new Error("This environment has run history and cannot be deleted.");
    }
    if (this.state.testPlans.some((plan) => plan.environmentId === id))
      throw new Error("This environment is used in a test plan.");
    this.state.environments = this.state.environments.filter((item) => item.id !== id);
    this.state.parameterProfiles = this.state.parameterProfiles.filter(
      (profile) => profile.environmentId !== id,
    );
    this.secrets = this.secrets.filter((item) => item.environmentId !== id);
    await Promise.all([this.persist(), this.persistSecrets()]);
  }

  async saveProject(input: ProjectInput): Promise<void> {
    const environment = this.findEnvironment(input.environmentId);
    if (!environment) throw new Error("Select a valid environment.");
    if (environment.type === "production")
      throw new Error("Production environments cannot have projects.");
    const existing = input.id ? this.findProject(input.id) : undefined;
    if (input.id && !existing) throw new Error("The project no longer exists.");
    if (
      existing &&
      existing.environmentId !== input.environmentId &&
      this.state.investigations.some((item) => item.projectId === existing.id)
    )
      throw new Error("A project with investigations cannot move to another environment.");
    const project: Project = { ...input, id: existing?.id ?? randomUUID(), agent: input.agent };
    if (existing) Object.assign(existing, project);
    else this.state.projects.push(project);
    await this.persist();
  }

  async addInvestigation(investigation: Investigation): Promise<void> {
    this.state.investigations.unshift(investigation);
    await this.persist();
  }

  async updateInvestigation(investigation: Investigation): Promise<void> {
    const index = this.state.investigations.findIndex((item) => item.id === investigation.id);
    if (index === -1) throw new Error("The investigation no longer exists.");
    investigation.updatedAt = new Date().toISOString();
    this.state.investigations[index] = investigation;
    await this.persist();
  }

  nextInvestigationNumber(): number {
    return this.state.investigations.reduce((max, item) => Math.max(max, item.number), 0) + 1;
  }

  openInvestigationsFor(projectId: string): Investigation[] {
    return this.state.investigations.filter(
      (item) =>
        item.projectId === projectId && item.status !== "VERIFIED" && item.status !== "ABANDONED",
    );
  }

  findProject(id: string): Project | undefined {
    return this.state.projects.find((item) => item.id === id);
  }

  findInvestigation(id: string): Investigation | undefined {
    return this.state.investigations.find((item) => item.id === id);
  }

  async addTest(test: TestDefinition): Promise<void> {
    const existing = this.state.tests.findIndex(
      (item) =>
        item.groupId === test.groupId && item.testId.toLowerCase() === test.testId.toLowerCase(),
    );
    if (existing !== -1 && this.state.tests[existing].id !== test.id) {
      throw new Error("A test with this ID already exists in this group.");
    }
    if (existing === -1) this.state.tests.push(test);
    else this.state.tests[existing] = test;
    await this.persist();
  }

  async addRun(run: TestRun): Promise<void> {
    this.state.runs.unshift(run);
    this.state.runs = this.state.runs.slice(0, 500);
    await this.persist();
  }

  async updateRun(run: TestRun): Promise<void> {
    const index = this.state.runs.findIndex((item) => item.id === run.id);
    if (index === -1) this.state.runs.unshift(run);
    else this.state.runs[index] = run;
    await this.persist();
  }

  async saveMcpApprovals(approvals: AppState["mcpApprovals"]): Promise<void> {
    this.state.mcpApprovals = structuredClone(approvals).slice(0, 100);
    await this.persist();
  }

  async deleteRun(id: string): Promise<TestRun> {
    const run = this.state.runs.find((item) => item.id === id);
    if (!run) throw new Error("The test run no longer exists.");
    if (run.status === "RUNNING") throw new Error("An active test run cannot be deleted.");
    if (
      this.state.testPlanRuns.some((planRun) => planRun.items.some((item) => item.runId === id))
    ) {
      throw new Error("This test run is part of a test plan history.");
    }
    this.state.runs = this.state.runs.filter((item) => item.id !== id);
    await this.persist();
    return run;
  }

  async pruneRuns(retentionDays: number): Promise<TestRun[]> {
    if (!retentionDays) return [];
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const protectedRunIds = new Set(
      this.state.testPlanRuns.flatMap((planRun) => planRun.items.map((item) => item.runId)),
    );
    const removed = this.state.runs.filter(
      (run) =>
        run.status !== "RUNNING" &&
        !protectedRunIds.has(run.id) &&
        new Date(run.startedAt).getTime() < cutoff,
    );
    if (!removed.length) return [];
    const removedIds = new Set(removed.map((run) => run.id));
    this.state.runs = this.state.runs.filter((run) => !removedIds.has(run.id));
    await this.persist();
    return removed;
  }

  findEnvironment(id: string): BcEnvironment | undefined {
    return this.state.environments.find((item) => item.id === id);
  }

  findCustomer(id: string): Customer | undefined {
    return this.state.customers.find((item) => item.id === id);
  }

  findTestGroup(id: string): TestGroup | undefined {
    return this.state.testGroups.find((item) => item.id === id);
  }

  findTestPlan(id: string): TestPlan | undefined {
    return this.state.testPlans.find((item) => item.id === id);
  }

  findTest(id: string): TestDefinition | undefined {
    return this.state.tests.find((item) => item.id === id);
  }

  getPassword(environmentId: string): string | undefined {
    const record = this.secrets.find((item) => item.environmentId === environmentId);
    if (!record?.encryptedPassword || !safeStorage.isEncryptionAvailable()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(record.encryptedPassword, "base64"));
    } catch {
      return undefined;
    }
  }

  getSessionState(environmentId: string): string | undefined {
    const record = this.secrets.find((item) => item.environmentId === environmentId);
    if (!record?.encryptedSessionState || !safeStorage.isEncryptionAvailable()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(record.encryptedSessionState, "base64"));
    } catch {
      return undefined;
    }
  }

  async setSessionState(environmentId: string, sessionState: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure OS encryption is not available; the session was not saved.");
    }
    const record = this.secretRecord(environmentId);
    record.encryptedSessionState = safeStorage.encryptString(sessionState).toString("base64");
    const environment = this.findEnvironment(environmentId);
    if (environment) environment.hasRememberedSession = true;
    await Promise.all([this.persistSecrets(), this.persist()]);
  }

  async clearSessionState(environmentId: string): Promise<void> {
    const record = this.secrets.find((item) => item.environmentId === environmentId);
    if (record) record.encryptedSessionState = undefined;
    const environment = this.findEnvironment(environmentId);
    if (environment) environment.hasRememberedSession = false;
    await Promise.all([this.persistSecrets(), this.persist()]);
  }

  private async setPassword(environmentId: string, password: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure OS encryption is not available; the credential was not saved.");
    }
    const encryptedPassword = safeStorage.encryptString(password).toString("base64");
    this.secretRecord(environmentId).encryptedPassword = encryptedPassword;
    await this.persistSecrets();
  }

  private secretRecord(environmentId: string): SecretRecord {
    let record = this.secrets.find((item) => item.environmentId === environmentId);
    if (!record) {
      record = { environmentId };
      this.secrets.push(record);
    }
    return record;
  }

  private async persist(): Promise<void> {
    await this.atomicWrite(this.statePath, JSON.stringify(this.state, null, 2));
  }

  private async persistSecrets(): Promise<void> {
    await this.atomicWrite(this.secretsPath, JSON.stringify(this.secrets, null, 2));
  }

  private async atomicWrite(path: string, contents: string): Promise<void> {
    const write = this.writeQueue.then(async () => {
      const temporary = `${path}.tmp`;
      await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
      await copyFile(path, `${path}.bak`).catch(() => undefined);
      await rename(temporary, path);
    });
    this.writeQueue = write.catch(() => undefined);
    await write;
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch {
      try {
        const recovered = JSON.parse(await readFile(`${path}.bak`, "utf8")) as T;
        this.recoveredPaths.add(path);
        return recovered;
      } catch {
        return fallback;
      }
    }
  }

  private async readState(): Promise<{ state: AppState; changed: boolean }> {
    try {
      return migrateState(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (primaryError) {
      try {
        const migrated = migrateState(JSON.parse(await readFile(`${this.statePath}.bak`, "utf8")));
        this.recoveredPaths.add(this.statePath);
        return { ...migrated, changed: true };
      } catch {
        if ((primaryError as NodeJS.ErrnoException).code === "ENOENT") {
          return { state: structuredClone(EMPTY_STATE), changed: false };
        }
        throw primaryError;
      }
    }
  }
}

export function storePaths(userDataDirectory: string): {
  statePath: string;
  secretsPath: string;
  runsDirectory: string;
} {
  return {
    statePath: join(userDataDirectory, "state.json"),
    secretsPath: join(userDataDirectory, "secrets.json"),
    runsDirectory: join(userDataDirectory, "runs"),
  };
}
