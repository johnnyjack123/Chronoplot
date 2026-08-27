import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSwitch from "@radix-ui/react-switch";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";

/* ------------------------------------------------------------- segmented -- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is only an icon. */
  title?: string;
}

/**
 * A small set of mutually exclusive choices, shown all at once. Preferred over
 * a select whenever there are five or fewer options and they are short - it
 * removes a click and shows the whole choice space at a glance.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm border border-line bg-sunken p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative inline-flex items-center justify-center rounded-[4px] font-medium",
              "transition-[background-color,color] duration-[var(--dur-instant)] ease-standard",
              size === "sm" ? "h-6 px-2 text-caption" : "h-7 px-2.5 text-label",
              selected
                ? "bg-accent text-accent-ink shadow-1"
                : "text-ink-muted hover:bg-accent-soft hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- select -- */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  className,
  placeholder = "Select…",
}: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  id?: string;
  className?: string;
  placeholder?: string;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={(next) => onChange(next as T)}>
      <RadixSelect.Trigger
        id={id}
        className={cn(
          "inline-flex h-8 w-full items-center justify-between gap-2 rounded-sm",
          "border border-line bg-sunken px-2.5 text-body text-ink",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-standard",
          "hover:border-line-strong data-[state=open]:border-accent",
          "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25",
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="text-ink-subtle">
          <ChevronDownIcon />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "cp-pop z-[var(--z-popover)] max-h-72 min-w-[var(--radix-select-trigger-width)]",
            "overflow-hidden rounded-lg border border-line bg-raised shadow-2",
          )}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "relative flex cursor-pointer select-none items-center gap-2 rounded-md",
                  "px-2 py-1.5 pr-8 text-body text-ink outline-none",
                  "data-[highlighted]:bg-accent-soft data-[highlighted]:text-ink",
                )}
              >
                <div className="min-w-0">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  {option.hint ? (
                    <p className="truncate-1 text-caption text-ink-subtle">{option.hint}</p>
                  ) : null}
                </div>
                <RadixSelect.ItemIndicator className="absolute right-2 text-accent">
                  <CheckIcon />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

/* ---------------------------------------------------------------- switch -- */

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="block text-body text-ink">{label}</span>
        {hint ? <span className="block text-caption text-ink-subtle">{hint}</span> : null}
      </span>
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border border-line bg-sunken",
          "transition-colors duration-[var(--dur-fast)] ease-standard",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        )}
      >
        <RadixSwitch.Thumb
          className={cn(
            "block size-3.5 translate-x-0.5 rounded-full bg-ink-muted",
            "transition-transform duration-[var(--dur-fast)] ease-standard",
            "data-[state=checked]:translate-x-4 data-[state=checked]:bg-accent-ink",
          )}
        />
      </RadixSwitch.Root>
    </label>
  );
}
