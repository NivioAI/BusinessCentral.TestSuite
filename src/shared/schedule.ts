export interface PlanSchedule {
  days: "every-day" | "weekdays";
  /** Local time of day, "HH:MM". */
  time: string;
}

/** A scheduled run still counts as on time for this long after its moment. */
export const ON_TIME_WINDOW_MS = 5 * 60_000;

export function isValidTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

/** The most recent moment, at or before `now`, at which the schedule was due. */
export function latestOccurrence(schedule: PlanSchedule, now: Date): Date {
  const [hours, minutes] = schedule.time.split(":").map(Number);
  const moment = new Date(now);
  moment.setHours(hours, minutes, 0, 0);
  if (moment.getTime() > now.getTime()) moment.setDate(moment.getDate() - 1);
  if (schedule.days === "weekdays") {
    while (moment.getDay() === 0 || moment.getDay() === 6) moment.setDate(moment.getDate() - 1);
  }
  return moment;
}

export type DueState = "none" | "on-time" | "missed";

/**
 * Whether a plan with this schedule is due. `handledAt` is the last moment that was started,
 * skipped or turned into a reminder.
 */
export function dueState(
  schedule: PlanSchedule,
  handledAt: string | undefined,
  now: Date,
): { state: DueState; occurrence: Date } {
  const occurrence = latestOccurrence(schedule, now);
  if (handledAt && new Date(handledAt).getTime() >= occurrence.getTime()) {
    return { state: "none", occurrence };
  }
  const late = now.getTime() - occurrence.getTime();
  return { state: late <= ON_TIME_WINDOW_MS ? "on-time" : "missed", occurrence };
}

export const scheduleLabel = (schedule: PlanSchedule) =>
  `${schedule.days === "weekdays" ? "Weekdays" : "Every day"} at ${schedule.time}`;
