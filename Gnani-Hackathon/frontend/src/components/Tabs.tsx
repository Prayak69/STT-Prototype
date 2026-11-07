import { useRef } from "react";
import type { LucideIcon } from "lucide-react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  count?: number;
}

interface TabsProps<T extends string> {
  items: Array<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export function Tabs<T extends string>({ items, value, onChange, label }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = (index: number) => {
    const next = (index + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-0.5 rounded-xl bg-slate-100 p-1"
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                focusTab(index + 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                focusTab(index - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusTab(0);
              } else if (event.key === "End") {
                event.preventDefault();
                focusTab(items.length - 1);
              }
            }}
            className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
              selected
                ? "bg-white text-slate-900 shadow-sm shadow-slate-200/70"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Icon className="hidden h-3 w-3 shrink-0 sm:block" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
            {typeof item.count === "number" && item.count > 0 && (
              <span
                className={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums sm:inline ${
                  selected ? "bg-indigo-50 text-indigo-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
