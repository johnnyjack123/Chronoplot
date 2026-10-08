/*
 * Reading dates out of note frontmatter.
 *
 * Pure string handling, no Obsidian API, so it can be tested on its own - which
 * matters because this is where the sharpest edge in the whole integration
 * lives.
 *
 * THE TRAP: `chronoplot-start: 01032026` unquoted is parsed by YAML as a
 * NUMBER, and the leading zero is dropped. The plugin receives 1032026. The
 * first of the month silently becomes garbage and the note looks perfectly
 * fine. The recommended form is quoted and dotted - "01.03.2026" - but people
 * will write the bare digits, so a number is recovered by zero-padding to the
 * nearest valid length. The valid lengths are known (8, 6, 4), which is the
 * only reason recovery is possible at all rather than a guess.
 */

export type Precision = "day" | "month" | "year";

export interface ParsedDate {
  iso: string;
  precision: Precision;
  /** Set when the value had to be repaired, so the note can be fixed. */
  recovered?: string;
}

const pad = (value: string | number, length: number): string =>
  String(value).padStart(length, "0");

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function build(year: string, month?: string, day?: string): ParsedDate | null {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1 || y > 9999) {
    return null;
  }

  if (month === undefined) {
    return { iso: `${pad(year, 4)}-01-01`, precision: "year" };
  }

  const m = Number(month);
  if (m < 1 || m > 12) {
    return null;
  }
  if (day === undefined) {
    return { iso: `${pad(year, 4)}-${pad(month, 2)}-01`, precision: "month" };
  }

  const d = Number(day);
  if (d < 1 || d > daysInMonth(y, m)) {
    return null;
  }
  return { iso: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`, precision: "day" };
}

/** Digit-only forms, by length: ddmmyyyy, mmyyyy, yyyy. */
function fromDigits(digits: string): ParsedDate | null {
  if (digits.length === 8) {
    return build(digits.slice(4), digits.slice(2, 4), digits.slice(0, 2));
  }
  if (digits.length === 6) {
    return build(digits.slice(2), digits.slice(0, 2));
  }
  if (digits.length === 4) {
    return build(digits);
  }
  return null;
}

/**
 * Parses whatever the frontmatter produced.
 *
 * Accepts a string, a number (see the trap above) or a Date, because Obsidian's
 * metadata cache hands back all three depending on how the value was written.
 */
export function parseFrontmatterDate(raw: unknown): ParsedDate | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  /* A real Date: written as an unquoted ISO date, which YAML types as one. */
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      return null;
    }
    return { iso: raw.toISOString().slice(0, 10), precision: "day" };
  }

  /*
   * A number: YAML dropped a leading zero. Recover by padding to the nearest
   * valid length upwards - 7 digits was meant to be 8, 5 was 6, 3 was 4 - and
   * report it, so the note gets quoted rather than relying on this forever.
   */
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0) {
      return null;
    }

    const digits = String(raw);
    const target = [4, 6, 8].find((length) => digits.length <= length);
    if (target === undefined) {
      return null;
    }

    const parsed = fromDigits(pad(digits, target));
    if (!parsed) {
      return null;
    }
    return digits.length === target
      ? parsed
      : {
          ...parsed,
          recovered: `read as ${pad(digits, target)}; quote the value to be sure`,
        };
  }

  if (typeof raw !== "string") {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }

  /* ISO: 2026-03-01, 2026-03, 2026 */
  let match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text);
  if (match) {
    return build(match[1]!, match[2], match[3]);
  }

  /* Dotted or slashed, day first: 01.03.2026, 1/3/2026 */
  match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (match) {
    return build(match[3]!, match[2]!, match[1]!);
  }

  /* Dotted, month and year: 03.2026 */
  match = /^(\d{1,2})[./](\d{4})$/.exec(text);
  if (match) {
    return build(match[2]!, match[1]!);
  }

  /* Bare digits, quoted: "01032026" */
  match = /^(\d{4}|\d{6}|\d{8})$/.exec(text);
  if (match) {
    return fromDigits(match[1]!);
  }

  return null;
}

/**
 * The precision of a range is the coarser of its two ends.
 *
 * A note saying it runs from a month to a specific day is not really precise to
 * the day, and pretending otherwise would draw a bar whose start is a
 * fabrication.
 */
export function combinePrecision(a: Precision, b: Precision): Precision {
  const order: Precision[] = ["day", "month", "year"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!;
}
