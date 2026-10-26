import type { TestPlan } from "../shared/models";
import { type PlanRunContext, unattendedBlocker } from "../shared/plan-run";
import { dueState, scheduleLabel } from "../shared/schedule";

export interface SchedulerDeps {
  plans(): TestPlan[];
  context(): PlanRunContext;
  /** A run or plan is already going. */
  busy(): boolean;
  now(): Date;
  /** Ask the window to start the plan. The store marks the moment handled once it does. */
  emitDue(plan: TestPlan, occurrence: string): void;
  /** Mark a moment as seen, as a reminder for the user when a reason is given. */
  handle(
    planId: string,
    occurrence: string,
    pending?: { reason: "review" | "missed"; detail?: string },
  ): Promise<void>;
  notify(title: string, body: string): void;
}

const TICK_MS = 30_000;

/**
 * Looks at the plan schedules while Test Suite is open. It never starts anything by itself:
 * it asks the window to start a plan that is safe to run unattended, and turns everything else
 * (a missed moment, a plan that needs you) into a reminder.
 */
export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.deps.now();
      for (const plan of this.deps.plans()) {
        if (!plan.schedule || plan.archivedAt) continue;
        const { state, occurrence } = dueState(plan.schedule, plan.scheduleHandledAt, now);
        if (state === "none") continue;
        const moment = occurrence.toISOString();
        if (state === "missed") {
          await this.deps.handle(plan.id, moment, { reason: "missed" });
          this.deps.notify(
            `${plan.name} missed its run`,
            `${scheduleLabel(plan.schedule)}. Open Test Suite to run it now or skip it.`,
          );
          continue;
        }
        const blocker = unattendedBlocker(this.deps.context(), plan);
        if (blocker) {
          await this.deps.handle(plan.id, moment, { reason: "review", detail: blocker });
          this.deps.notify(`${plan.name} is due`, `It needs you: ${blocker}`);
          continue;
        }
        if (this.deps.busy()) continue; // still on time at the next look
        this.deps.emitDue(plan, moment);
      }
    } finally {
      this.ticking = false;
    }
  }
}
