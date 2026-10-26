import { describe, expect, it } from "vitest";
import { DATA_CATEGORIES, withDependencies } from "../src/shared/data-categories";
import { deleteDataInputSchema } from "../src/shared/schemas";
import { createFixture } from "./helpers/investigation-fixture";

describe("withDependencies", () => {
  it("adds what cannot exist without the selection and keeps a stable order", () => {
    expect(withDependencies(["runs"])).toEqual(["runs", "investigations"]);
    expect(withDependencies(["tests"])).toEqual(["runs", "investigations", "plans", "tests"]);
    expect(withDependencies(["projects"])).toEqual(["investigations", "projects"]);
    expect(withDependencies(["credentials"])).toEqual(["credentials"]);
    expect(withDependencies([])).toEqual([]);
  });

  it("is idempotent for every category", () => {
    for (const category of DATA_CATEGORIES) {
      const once = withDependencies([category]);
      expect(withDependencies(once)).toEqual(once);
    }
  });
});

describe("deleteDataInputSchema", () => {
  it("rejects empty, unknown and non-array input", () => {
    expect(deleteDataInputSchema.safeParse({ categories: [] }).success).toBe(false);
    expect(deleteDataInputSchema.safeParse({ categories: ["customers"] }).success).toBe(false);
    expect(deleteDataInputSchema.safeParse({ categories: "runs" }).success).toBe(false);
    expect(deleteDataInputSchema.safeParse({ categories: ["runs"] }).success).toBe(true);
  });
});

describe("deleting a test with history", () => {
  it("refuses without consent, then removes runs, investigations and plan history", async () => {
    const fixture = await createFixture();
    const { store, test } = fixture;
    await expect(store.deleteTest(test.id)).rejects.toThrow("run history");
    const removed = await store.deleteTest(test.id, true);
    expect(removed.runs.map((run) => run.id)).toEqual(["run-1"]);
    const state = store.snapshot();
    expect(state.tests).toHaveLength(0);
    expect(state.runs).toHaveLength(0);
  });

  it("refuses to delete while the test is running or has open investigations", async () => {
    const fixture = await createFixture({ runStatus: "RUNNING" });
    await expect(fixture.store.deleteTest(fixture.test.id, true)).rejects.toThrow("active");
  });
});

describe("JsonStore.deleteData", () => {
  it("deletes only the chosen categories", async () => {
    const fixture = await createFixture();
    const { store } = fixture;
    const outcome = await store.deleteData(withDependencies(["runs"]));
    expect(outcome.result.runs).toBe(1);
    const state = store.snapshot();
    expect(state.runs).toHaveLength(0);
    expect(state.tests).toHaveLength(1);
    expect(state.projects).toHaveLength(1);
    expect(state.customers).toHaveLength(1);
    expect(state.environments).toHaveLength(1);
  });

  it("clears project links when projects are deleted and credentials flags when requested", async () => {
    const fixture = await createFixture();
    const { store } = fixture;
    await store.deleteData(["projects"]);
    expect(store.snapshot().projects).toHaveLength(0);
    await store.deleteData(["credentials", "approvals"]);
    expect(store.snapshot().environments[0].hasCredential).toBe(false);
  });

  it("removes tests with their dependencies and refuses during an active run", async () => {
    const fixture = await createFixture();
    const outcome = await fixture.store.deleteData(withDependencies(["tests"]));
    expect(outcome.tests).toHaveLength(1);
    expect(fixture.store.snapshot().tests).toHaveLength(0);
    expect(fixture.store.snapshot().runs).toHaveLength(0);

    const running = await createFixture({ runStatus: "RUNNING" });
    await expect(running.store.deleteData(["runs"])).rejects.toThrow("active");
  });
});
