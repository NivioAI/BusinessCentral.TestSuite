import { Check, X } from "lucide-react";
import { useState } from "react";
import type { AppSnapshot, TestDefinition } from "../../shared/models";
import type { View } from "../navigation";

const DISMISSED_KEY = "nivio.getStarted.dismissed";

interface Step {
  title: string;
  description: string;
  done: boolean;
  action: string;
  run(): void;
}

export function getStartedSteps(
  snapshot: AppSnapshot,
  go: { navigate(view: View): void; run(test: TestDefinition): void },
): Step[] {
  const customers = snapshot.customers.filter((item) => !item.archivedAt);
  const environments = snapshot.environments.filter((item) => !item.archivedAt);
  const tests = snapshot.tests.filter((item) => !item.archivedAt);
  return [
    {
      title: "Add a customer",
      description: customers[0]?.name ?? "The company whose Business Central you test.",
      done: customers.length > 0,
      action: "Add customer",
      run: () => go.navigate("customers"),
    },
    {
      title: "Add an environment",
      description: "A sandbox or UAT target. Credentials stay on this device.",
      done: environments.length > 0,
      action: "Add environment",
      run: () => go.navigate("environments"),
    },
    {
      title: "Import a test",
      description: "A Page Script YAML recording.",
      done: tests.length > 0,
      action: "Import test",
      run: () => go.navigate("tests"),
    },
    {
      title: "Run it",
      description: "Visible replay. You review the result.",
      done: snapshot.runs.length > 0,
      action: "Run a test",
      run: () => {
        const first = tests[0];
        if (first) go.run(first);
        else go.navigate("tests");
      },
    },
  ];
}

/** Shown on a fresh installation until the first run exists, or until it is closed. */
export function GetStarted({
  snapshot,
  onNavigate,
  onRun,
}: {
  snapshot: AppSnapshot;
  onNavigate(view: View): void;
  onRun(test: TestDefinition): void;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const steps = getStartedSteps(snapshot, { navigate: onNavigate, run: onRun });
  const doneCount = steps.filter((step) => step.done).length;
  if (dismissed || doneCount === steps.length) return null;
  const current = steps.findIndex((step) => !step.done);
  return (
    <section className="get-started" aria-label="Get started">
      <div className="get-started-head">
        <div>
          <p className="eyebrow">
            Get started · {doneCount} of {steps.length} done
          </p>
          <h2>Set up your first safe test</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Dismiss"
          onClick={() => {
            try {
              localStorage.setItem(DISMISSED_KEY, "1");
            } catch {
              // The panel simply comes back next time.
            }
            setDismissed(true);
          }}
        >
          <X size={16} />
        </button>
      </div>
      <progress
        className="get-started-progress"
        max={steps.length}
        value={doneCount}
        aria-label="Setup progress"
      />
      <ol className="get-started-steps">
        {steps.map((step, index) => (
          <li key={step.title} className={step.done ? "done" : undefined}>
            <span className="get-started-dot" aria-hidden="true">
              {step.done ? <Check size={14} /> : index + 1}
            </span>
            <span className="get-started-text">
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </span>
            {index === current && (
              <button type="button" className="button button-primary" onClick={step.run}>
                {step.action}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
