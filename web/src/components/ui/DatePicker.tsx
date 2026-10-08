import { useEffect, useMemo, useRef, useState } from "react";
import type { Precision } from "@shared";
import { cn } from "@/lib/cn";
import {
  addMonths, addYears, clampDate, daysInMonth, endOfMonth, endOfYear, formatMonth,
  formatWithPrecision, isValidIso, monthIndex, startOfMonth, startOfYear, today,
  weekday, year as yearOf, type IsoDate,
} from "@/lib/dates";
import { Popover } from "./Popover";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

/*
 * A date field built for timelines that can span centuries.
 *
 * The native <input type="date"> was the wrong tool twice over. Visually it is
 * the browser's widget, not ours. Functionally it is worse: typing a year digit
 * by digit emits a value after every keystroke, so entering 2126 briefly claims
 * the year is 2, 21 and 212 - and a timeline reaching back to year 2 is two
 * thousand years long. That is what made keyboard entry lock the editor up.
 *
 * This field commits only complete, parsed dates, and its four zoom levels
 * (days, months, years, decades) put any century two clicks away.
 */

type View = "day" | "month" | "year" | "decade";

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_NAMES = Array.from({ length: 12 }, (_, index) =>
  formatMonth(`2026-${String(index + 1).padStart(2, "0")}-01`),
);

/** Years and decades are paged in blocks of twelve, so each grid is 3 x 4. */
const BLOCK = 12;
const blockStart = (value: number, size: number): number => Math.floor(value / size) * size;

/**
 * Parses the shorthands people actually type. Anything else is rejected rather
 * than guessed at, so a half-typed value never reaches the document.
 */
export function parseDateInput(raw: string, edge: "start" | "end"): IsoDate | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  const pad = (value: string, length = 2): string => value.padStart(length, "0");
  const build = (y: string, m?: string, d?: string): IsoDate | null => {
    const yearPart = pad(y, 4);
    if (m === undefined) {
      return edge === "start" ? `${yearPart}-01-01` : `${yearPart}-12-31`;
    }
    const monthPart = pad(m);
    if (Number(monthPart) < 1 || Number(monthPart) > 12) {
      return null;
    }
    if (d === undefined) {
      const iso = `${yearPart}-${monthPart}-01`;
      return edge === "start" ? iso : endOfMonth(iso);
    }
    const dayPart = pad(d);
    const iso = `${yearPart}-${monthPart}-${dayPart}`;
    if (Number(dayPart) < 1 || Number(dayPart) > daysInMonth(Number(yearPart), Number(monthPart) - 1)) {
      return null;
    }
    return isValidIso(iso) ? iso : null;
  };

  // 2126
  let match = /^(\d{1,4})$/.exec(text);
  if (match) {
    return build(match[1]!);
  }

  // 2126-03  or  2126-03-15
  match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (match) {
    return build(match[1]!, match[2]!, match[3]);
  }

  // 03.2126  or  15.03.2126  (also accepts / as the separator)
  match = /^(\d{1,2})[./](\d{4})$/.exec(text);
  if (match) {
    return build(match[2]!, match[1]!);
  }

  match = /^(\d{1,2})[./](\d{1,2})[./](\d{1,4})$/.exec(text);
  if (match) {
    return build(match[3]!, match[2]!, match[1]!);
  }

  return null;
}

export interface DatePickerProps {
  value: IsoDate;
  onChange: (value: IsoDate) => void;
  /** Controls which grid opens first and what a selection snaps to. */
  precision?: Precision;
  /** Whether an imprecise value resolves to the first or last day of its unit. */
  edge?: "start" | "end";
  min?: IsoDate;
  max?: IsoDate;
  id?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

export function DatePicker({
  value,
  onChange,
  precision = "day",
  edge = "start",
  min,
  max,
  id,
  disabled,
  ...aria
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(precision === "day" ? "day" : precision);
  const [cursor, setCursor] = useState<IsoDate>(value);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-anchor whenever the popover opens, so it never reopens on last month.
  useEffect(() => {
    if (!open) {
      return;
    }
    setCursor(isValidIso(value) ? value : today());
    setView(precision === "day" ? "day" : precision);
    setText("");
    setInvalid(false);
  }, [open, value, precision]);

  const commit = (next: IsoDate): void => {
    onChange(clampDate(next, min ?? "0001-01-01", max ?? "9999-12-31"));
    setOpen(false);
  };

  const submitText = (): void => {
    const parsed = parseDateInput(text, edge);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    commit(
      precision === "year"
        ? edge === "start" ? startOfYear(parsed) : endOfYear(parsed)
        : precision === "month"
          ? edge === "start" ? startOfMonth(parsed) : endOfMonth(parsed)
          : parsed,
    );
  };

  const outOfRange = (candidateStart: IsoDate, candidateEnd: IsoDate): boolean =>
    (max !== undefined && candidateStart > max) || (min !== undefined && candidateEnd < min);

  /* ----------------------------------------------------------- day grid -- */
  const dayCells = useMemo(() => {
    const first = startOfMonth(cursor);
    // Monday-first, matching the ISO weeks the axis uses.
    const lead = (weekday(first) + 6) % 7;
    const total = daysInMonth(yearOf(first), monthIndex(first));
    const cells: { iso: IsoDate; inMonth: boolean }[] = [];

    for (let index = 0; index < lead; index++) {
      cells.push({ iso: addDaysIso(first, index - lead), inMonth: false });
    }
    for (let day = 0; day < total; day++) {
      cells.push({ iso: addDaysIso(first, day), inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ iso: addDaysIso(first, cells.length - lead), inMonth: false });
    }
    return cells;
  }, [cursor]);

  const headerLabel =
    view === "day"
      ? `${formatMonth(cursor, "long")} ${yearOf(cursor)}`
      : view === "month"
        ? String(yearOf(cursor))
        : view === "year"
          ? `${blockStart(yearOf(cursor), BLOCK)}–${blockStart(yearOf(cursor), BLOCK) + BLOCK - 1}`
          : `${blockStart(yearOf(cursor), BLOCK * 10)}–${blockStart(yearOf(cursor), BLOCK * 10) + BLOCK * 10 - 1}`;

  const step = (direction: 1 | -1): void => {
    setCursor((current) =>
      view === "day"
        ? addMonths(current, direction)
        : view === "month"
          ? addYears(current, direction)
          : view === "year"
            ? addYears(current, direction * BLOCK)
            : addYears(current, direction * BLOCK * 10),
    );
  };

  const goUp = (): void => {
    setView((current) =>
      current === "day" ? "month" : current === "month" ? "year" : "decade",
    );
  };

  /*
   * Scrolling pages the grid. Reaching a distant decade by clicking an arrow
   * ten times is what makes a picker feel like a form rather than a tool, and
   * at century range the arrows alone are unusable. Registered directly because
   * React attaches wheel listeners passively, where preventDefault does nothing.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = gridRef.current;
    if (!element || !open) {
      return;
    }

    const handler = (event: WheelEvent): void => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      step(event.deltaY > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", handler, { passive: false });
    return () => element.removeEventListener("wheel", handler);
  });

  const gridButton = cn(
    "flex items-center justify-center rounded-md text-body",
    "transition-colors duration-[var(--dur-instant)] ease-standard",
    "hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
  );

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={setOpen}
      align="start"
      className="w-[17.5rem] p-2"
      trigger={
        <button
          type="button"
          id={id}
          disabled={disabled}
          {...aria}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-sm border border-line",
            "bg-sunken px-2.5 text-body text-ink",
            "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-standard",
            "hover:border-line-strong data-[state=open]:border-accent",
            "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25",
            "disabled:cursor-not-allowed disabled:opacity-55",
          )}
        >
          <span className="tabular truncate-1">{formatWithPrecision(value, precision)}</span>
          <CalendarIcon className="shrink-0 text-ink-subtle" />
        </button>
      }
    >
      {/* Typing is the fast path for distant dates, so it comes first. */}
      <div className="mb-2 flex gap-1.5">
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitText();
            }
          }}
          placeholder="Type a year, 03.2126, 15.03.2126…"
          aria-label="Type a date"
          aria-invalid={invalid}
          className={cn(
            "h-7 w-full rounded-sm border bg-sunken px-2 text-caption text-ink",
            "placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent/25",
            invalid ? "border-critical" : "border-line focus:border-accent",
          )}
        />
      </div>

      <div ref={gridRef}>
      <div className="mb-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous"
          className="flex size-7 items-center justify-center rounded-sm text-ink-muted hover:bg-accent-soft hover:text-ink"
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          onClick={goUp}
          disabled={view === "decade"}
          className={cn(
            "tabular h-7 flex-1 rounded-sm text-label text-ink",
            "hover:bg-accent-soft disabled:hover:bg-transparent",
          )}
        >
          {headerLabel}
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next"
          className="flex size-7 items-center justify-center rounded-sm text-ink-muted hover:bg-accent-soft hover:text-ink"
        >
          <ChevronRightIcon />
        </button>
      </div>

      {view === "day" ? (
        <>
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAY_INITIALS.map((initial, index) => (
              <span
                key={`${initial}-${index}`}
                className="flex h-6 items-center justify-center text-micro uppercase text-ink-subtle"
              >
                {initial}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {dayCells.map((cell) => {
              const selected = cell.iso === value;
              const isToday = cell.iso === today();
              return (
                <button
                  key={cell.iso}
                  type="button"
                  disabled={outOfRange(cell.iso, cell.iso)}
                  onClick={() => commit(cell.iso)}
                  className={cn(
                    gridButton,
                    "tabular h-8",
                    !cell.inMonth && "text-ink-subtle",
                    isToday && !selected && "ring-1 ring-inset ring-accent/50",
                    selected && "bg-accent text-accent-ink hover:bg-accent",
                  )}
                >
                  {Number(cell.iso.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </>
      ) : view === "month" ? (
        <div className="grid grid-cols-3 gap-1">
          {MONTH_NAMES.map((name, index) => {
            const iso = `${String(yearOf(cursor)).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}-01`;
            const selected = value.slice(0, 7) === iso.slice(0, 7);
            return (
              <button
                key={name}
                type="button"
                disabled={outOfRange(iso, endOfMonth(iso))}
                onClick={() => {
                  if (precision === "month") {
                    commit(edge === "start" ? iso : endOfMonth(iso));
                  }
                  else {
                    setCursor(iso);
                    setView("day");
                  }
                }}
                className={cn(gridButton, "h-9", selected && "bg-accent text-accent-ink hover:bg-accent")}
              >
                {name}
              </button>
            );
          })}
        </div>
      ) : view === "year" ? (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: BLOCK }, (_, index) => blockStart(yearOf(cursor), BLOCK) + index).map(
            (candidate) => {
              const iso = `${String(candidate).padStart(4, "0")}-01-01`;
              const selected = yearOf(value) === candidate;
              return (
                <button
                  key={candidate}
                  type="button"
                  disabled={outOfRange(iso, endOfYear(iso))}
                  onClick={() => {
                    if (precision === "year") {
                      commit(edge === "start" ? iso : endOfYear(iso));
                    }
                    else {
                      setCursor(iso);
                      setView("month");
                    }
                  }}
                  className={cn(
                    gridButton,
                    "tabular h-9",
                    selected && "bg-accent text-accent-ink hover:bg-accent",
                  )}
                >
                  {candidate}
                </button>
              );
            },
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {Array.from(
            { length: BLOCK },
            (_, index) => blockStart(yearOf(cursor), BLOCK * 10) + index * 10,
          ).map((decade) => (
            <button
              key={decade}
              type="button"
              onClick={() => {
                setCursor(`${String(decade).padStart(4, "0")}-01-01`);
                setView("year");
              }}
              className={cn(
                gridButton,
                "tabular h-9 text-label",
                yearOf(value) >= decade && yearOf(value) < decade + 10 &&
                  "bg-accent text-accent-ink hover:bg-accent",
              )}
            >
              {decade}s
            </button>
          ))}
        </div>
      )}

      </div>

      <div className="mt-2 flex justify-between border-t border-line pt-2">
        <button
          type="button"
          onClick={() => commit(today())}
          className="rounded-sm px-2 py-1 text-caption text-accent hover:bg-accent-soft"
        >
          Today
        </button>
        <span className="px-2 py-1 text-caption text-ink-subtle">Enter to apply</span>
      </div>
    </Popover>
  );
}

/** Local helper so the day grid can walk into neighbouring months. */
function addDaysIso(iso: IsoDate, count: number): IsoDate {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}
