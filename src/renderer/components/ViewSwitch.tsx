import { LayoutGrid, List } from "lucide-react";
import { useState } from "react";

export type ViewMode = "list" | "tiles";

const storagePrefix = "nivio.bc-flow-tester.view.";

function readViewMode(page: string): ViewMode {
  try {
    return localStorage.getItem(storagePrefix + page) === "tiles" ? "tiles" : "list";
  } catch {
    return "list";
  }
}

export function useViewMode(page: string): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => readViewMode(page));
  const update = (next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(storagePrefix + page, next);
    } catch {
      // The choice only lasts for this session when storage is unavailable.
    }
  };
  return [mode, update];
}

const options: Array<{ id: ViewMode; label: string; icon: typeof List }> = [
  { id: "list", label: "List", icon: List },
  { id: "tiles", label: "Tiles", icon: LayoutGrid },
];

export function ViewSwitch({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange(mode: ViewMode): void;
}) {
  return (
    <fieldset className="view-switch" aria-label="View">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={mode === option.id}
            onClick={() => onChange(option.id)}
          >
            <Icon size={15} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
