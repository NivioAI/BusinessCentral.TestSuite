import { describe, expect, it } from "vitest";
import { createFixture } from "./helpers/investigation-fixture";

async function setup() {
  const fixture = await createFixture();
  const { store, test, environment } = fixture;
  await store
    .saveTest({ ...test, id: test.id, parameters: undefined } as never)
    .catch(() => undefined);
  // The fixture test has no parameters; give it one so profiles can hold a value.
  const stored = store.findTest(test.id);
  if (stored)
    stored.parameters = [{ name: "customer", type: "string", required: true, secret: false }];
  await store.saveEnvironment({
    customerId: environment.customerId,
    customerCode: "DEMO",
    customerName: "Demo",
    tenantId: "tenant",
    name: "UAT",
    company: "CRONUS",
    type: "uat",
    baseUrl: "http://localhost:8080/bc",
    authentication: "Windows",
  });
  const other = store.snapshot().environments.find((item) => item.id !== environment.id);
  if (!other) throw new Error("Expected a second environment");
  return { ...fixture, other };
}

describe("parameter profiles per environment", () => {
  it("keeps one profile per test, name and environment", async () => {
    const { store, test, environment, other } = await setup();
    const base = { testDefinitionId: test.id, name: "Default", values: { customer: "10000" } };
    await store.saveParameterProfile({ ...base, environmentId: environment.id });
    await store.saveParameterProfile({
      ...base,
      environmentId: other.id,
      values: { customer: "20000" },
    });
    await store.saveParameterProfile({ ...base, values: { customer: "30000" } });
    expect(store.snapshot().parameterProfiles).toHaveLength(3);

    await store.saveParameterProfile({
      ...base,
      environmentId: environment.id,
      values: { customer: "11111" },
    });
    const profiles = store.snapshot().parameterProfiles;
    expect(profiles).toHaveLength(3);
    expect(profiles.find((item) => item.environmentId === environment.id)?.values.customer).toBe(
      "11111",
    );
  });

  it("refuses a profile for an environment that does not exist", async () => {
    const { store, test } = await setup();
    await expect(
      store.saveParameterProfile({
        testDefinitionId: test.id,
        environmentId: "00000000-0000-4000-8000-000000000099",
        name: "x",
        values: { customer: "1" },
      }),
    ).rejects.toThrow("environment of this profile");
  });

  it("only lets a plan use profiles of its own environment, or ones without an environment", async () => {
    const { store, test, environment, other } = await setup();
    await store.saveParameterProfile({
      testDefinitionId: test.id,
      environmentId: other.id,
      name: "Other",
      values: { customer: "2" },
    });
    await store.saveParameterProfile({
      testDefinitionId: test.id,
      name: "Everywhere",
      values: { customer: "3" },
    });
    const [forOther, everywhere] = [
      store.snapshot().parameterProfiles.find((item) => item.name === "Other"),
      store.snapshot().parameterProfiles.find((item) => item.name === "Everywhere"),
    ];
    const plan = {
      name: "Plan",
      customerId: environment.customerId,
      environmentId: environment.id,
      testDefinitionIds: [test.id],
    };
    await expect(
      store.saveTestPlan({ ...plan, parameterProfileIds: { [test.id]: forOther?.id ?? "" } }),
    ).rejects.toThrow("another environment");
    await store.saveTestPlan({ ...plan, parameterProfileIds: { [test.id]: everywhere?.id ?? "" } });
    expect(store.snapshot().testPlans).toHaveLength(1);
  });

  it("removes an environment's profiles when the environment is deleted", async () => {
    const { store, test, other } = await setup();
    await store.saveParameterProfile({
      testDefinitionId: test.id,
      environmentId: other.id,
      name: "Gone",
      values: { customer: "2" },
    });
    await store.saveParameterProfile({
      testDefinitionId: test.id,
      name: "Stays",
      values: { customer: "3" },
    });
    await store.deleteEnvironment(other.id);
    expect(store.snapshot().parameterProfiles.map((item) => item.name)).toEqual(["Stays"]);
  });
});
