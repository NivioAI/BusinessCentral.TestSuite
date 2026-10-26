import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  MonitorPlay,
  Play,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { RunProgressEvent, RunProgressKind } from "../../shared/models";

const icons = {
  "runner-started": Play,
  "target-selected": Boxes,
  "browser-ready": CheckCircle2,
  "authentication-required": ShieldCheck,
  "authentication-complete": ShieldCheck,
  "replay-started": MonitorPlay,
  "step-started": Activity,
  warning: AlertTriangle,
  error: XCircle,
  completed: CheckCircle2,
  update: ChevronRight,
} satisfies Record<RunProgressKind, typeof Activity>;

export function latestRunProgress(events: RunProgressEvent[]): RunProgressEvent | undefined {
  return events.at(-1);
}

export function RunProgressList({ events }: { events: RunProgressEvent[] }) {
  if (!events.length) {
    return <div className="run-event-empty">Waiting for the first replay update…</div>;
  }
  return (
    <div className="run-event-list" role="log" aria-label="Run activity">
      {events.map((event, index) => {
        const EventIcon = icons[event.kind];
        return (
          <div className={`run-event run-event-${event.tone}`} key={`${index}-${event.occurredAt}`}>
            <span className="run-event-icon">
              <EventIcon size={15} />
            </span>
            <span className="run-event-copy">
              <strong>{event.title}</strong>
              <small>{event.detail}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}
