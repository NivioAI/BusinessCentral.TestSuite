import type { BcEnvironment, ParameterProfile, TestDefinition, TestPlan } from "./models";

/** What the helpers below need to see of the workspace. */
export interface PlanRunContext {
  tests: TestDefinition[];
  parameterProfiles: ParameterProfile[];
  environments?: BcEnvironment[];
}

export type PlanParameterValues = Record<string, Record<string, string | number | boolean>>;

const testsOf = (context: PlanRunContext, ids: string[]) =>
  ids
    .map((id) => context.tests.find((test) => test.id === id))
    .filter((test): test is TestDefinition => Boolean(test));

/** Saved profile or default for every parameter; secrets stay empty. */
export function defaultPlanParameters(
  context: PlanRunContext,
  plan: TestPlan,
  testIds: string[] = plan.testDefinitionIds,
): PlanParameterValues {
  return Object.fromEntries(
    testsOf(context, testIds).map((test) => {
      const profile = context.parameterProfiles.find(
        (item) => item.id === plan.parameterProfileIds?.[test.id],
      );
      return [
        test.id,
        Object.fromEntries(
          test.parameters.map((parameter) => [
            parameter.name,
            parameter.secret
              ? ""
              : (profile?.values[parameter.name] ?? parameter.defaultValue ?? ""),
          ]),
        ),
      ];
    }),
  );
}

/**
 * Why this run needs the user's eyes first, or undefined when it does not: every test must
 * exist and only read, and every required value must already be known.
 */
export function reviewBlocker(
  context: PlanRunContext,
  plan: TestPlan,
  testIds: string[] = plan.testDefinitionIds,
): string | undefined {
  const tests = testsOf(context, testIds);
  if (tests.length !== testIds.length || tests.length === 0) {
    return "A test of this plan no longer exists.";
  }
  if (tests.some((test) => test.risk !== "read-only")) return "It contains tests that change data.";
  const values = defaultPlanParameters(context, plan, testIds);
  const missing = tests.some((test) =>
    test.parameters.some(
      (parameter) => parameter.required && (values[test.id]?.[parameter.name] ?? "") === "",
    ),
  );
  return missing ? "A test needs values that no saved profile or default provides." : undefined;
}

export const canStartWithoutReview = (
  context: PlanRunContext,
  plan: TestPlan,
  testIds: string[] = plan.testDefinitionIds,
): boolean => reviewBlocker(context, plan, testIds) === undefined;

/** Why a scheduled plan cannot run without anyone present, or undefined when it can. */
export function unattendedBlocker(context: PlanRunContext, plan: TestPlan): string | undefined {
  const environment = context.environments?.find((item) => item.id === plan.environmentId);
  if (!environment || environment.archivedAt) return "Its environment no longer exists.";
  if (environment.type === "production") return "Production runs are blocked.";
  if (environment.authentication !== "Windows" && !environment.hasRememberedSession) {
    return "It needs you to sign in with Microsoft (MFA). Run it once with the session remembered.";
  }
  return reviewBlocker(context, plan);
}
