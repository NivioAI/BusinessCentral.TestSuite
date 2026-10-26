import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  copyPageScriptIncludes,
  materializePageScript,
  parsePageScriptContents,
  parsePageScriptFile,
} from "../src/main/page-script";

describe("Page Script parser", () => {
  it("extracts metadata and typed parameters", async () => {
    const parsed = await parsePageScriptFile(
      join(process.cwd(), "fixtures/page-scripts/customer-list.sample.yml"),
    );
    expect(parsed.name).toBe("Customer list smoke test");
    expect(parsed.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Customer No.", type: "string", defaultValue: "TEST001" }),
        expect.objectContaining({ name: "Minimum rows", type: "number", defaultValue: 1 }),
      ]),
    );
    expect(parsed.versionHash).toMatch(/^[a-f0-9]{12}$/);
  });

  it("rejects YAML without executable steps", () => {
    expect(() => parsePageScriptContents("name: Empty\nsteps: []\n")).toThrow("no runnable steps");
  });

  it("materializes run-specific parameter defaults without changing the source", async () => {
    const source = join(process.cwd(), "fixtures/page-scripts/customer-list.sample.yml");
    const directory = await mkdtemp(join(tmpdir(), "bcft-"));
    const target = join(directory, "run.yml");
    await materializePageScript(source, target, { "Customer No.": "TEST999", "Minimum rows": 3 });
    const [original, materialized] = await Promise.all([
      readFile(source, "utf8"),
      readFile(target, "utf8"),
    ]);
    expect(original).toContain("default: TEST001");
    expect(materialized).toContain("default: TEST999");
    expect(materialized).toContain("default: 3");
  });

  it("adds a configured wait after executable steps in the run copy", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-"));
    const source = join(directory, "source.yml");
    const target = join(directory, "run.yml");
    await writeFile(
      source,
      "description: Delay test\nsteps:\n  - type: input\n    value: A\n  - type: scope\n    steps:\n      - type: invoke\n  - type: wait\n    time: 100\n",
      "utf8",
    );

    await materializePageScript(source, target, {}, 500);

    const document = parse(await readFile(target, "utf8")) as {
      steps: Array<{ type: string; time?: number; steps?: Array<{ type: string; time?: number }> }>;
    };
    expect(document.steps.map((step) => step.type)).toEqual(["input", "wait", "scope", "wait"]);
    expect(document.steps[1].time).toBe(500);
    expect(document.steps[2].steps?.map((step) => step.type)).toEqual(["invoke", "wait"]);
    expect(document.steps[3].time).toBe(100);
  });
});

describe("Page Script includes", () => {
  it("validates, hashes and copies relative include bundles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-includes-"));
    await mkdir(join(directory, "includes"));
    await writeFile(
      join(directory, "main.yml"),
      "steps:\n  - type: include\n    file: ./includes/customer.yml\nname: Main\n",
    );
    await writeFile(
      join(directory, "includes/customer.yml"),
      "steps:\n  - type: navigate\n    description: Open customers\nname: Customer\n",
    );
    const parsed = await parsePageScriptFile(join(directory, "main.yml"));
    expect(parsed.includedFiles).toEqual(["includes/customer.yml"]);
    const target = join(directory, "run");
    await copyPageScriptIncludes(join(directory, "main.yml"), target);
    await expect(readFile(join(target, "includes/customer.yml"), "utf8")).resolves.toContain(
      "Open customers",
    );
  });

  it("rejects include paths outside the selected script directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-includes-"));
    await writeFile(join(directory, "outside.yml"), "steps:\n  - type: navigate\n");
    await mkdir(join(directory, "bundle"));
    await writeFile(
      join(directory, "bundle/main.yml"),
      "steps:\n  - type: include\n    file: ../outside.yml\n",
    );
    await expect(parsePageScriptFile(join(directory, "bundle/main.yml"))).rejects.toThrow(
      "outside the selected folder",
    );
  });

  it("rejects cyclic includes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-includes-"));
    await writeFile(
      join(directory, "main.yml"),
      "steps:\n  - type: include\n    file: ./part.yml\n",
    );
    await writeFile(
      join(directory, "part.yml"),
      "steps:\n  - type: include\n    file: ./main.yml\n",
    );
    await expect(parsePageScriptFile(join(directory, "main.yml"))).rejects.toThrow("circular");
  });
});
