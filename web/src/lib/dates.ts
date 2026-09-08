/*
 * Calendar maths for the timeline.
 *
 * Every date in a document is a plain "YYYY-MM-DD" string with no time and no
 * timezone, and every function here operates in UTC. That is deliberate: a
 * timeline bar that starts on 1 March must start on 1 March for a reader in any
 * timezone, and local-time arithmetic silently shifts dates across DST
 * boundaries. Nothing in this module ever touches the local clock except
 * `today()`, which asks what the user's calendar says right now.
 */

import { snapToUnit } from "@shared";

export type IsoDate = string;

const DAY_MS = 86_400_000;

/** Parses "YYYY-MM-DD" into a UTC-midnight timestamp. */
export function toTime(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function toIso(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10);
}

export function isValidIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toTime(value));
}

/** Today in the viewer's own calendar, as an ISO date. */
export function today(): IsoDate {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

/** Days covered by an inclusive range, so a single-day range is 1. */
export function inclusiveDays(from: IsoDate, to: IsoDate): number {
  return daysBetween(from, to) + 1;
}

export function addDays(date: IsoDate, count: number): IsoDate {
  return toIso(toTime(date) + count * DAY_MS);
}

export function addMonths(date: IsoDate, count: number): IsoDate {
  const d = new Date(toTime(date));
  const targetMonth = d.getUTCMonth() + count;
  const year = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  // Clamp so adding a month to 31 January lands on 28/29 February rather than
  // rolling over into March.
  const lastDay = daysInMonth(year, month);
  const day = Math.min(d.getUTCDate(), lastDay);
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addYears(date: IsoDate, count: number): IsoDate {
  return addMonths(date, count * 12);
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function year(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

/** 0-based, so January is 0. */
export function monthIndex(date: IsoDate): number {
  return Number(date.slice(5, 7)) - 1;
}

export function dayOfMonth(date: IsoDate): number {
  return Number(date.slice(8, 10));
}

/** 0 = Sunday, matching Date.getUTCDay. */
export function weekday(date: IsoDate): number {
  return new Date(toTime(date)).getUTCDay();
}

export function isWeekend(date: IsoDate): boolean {
  const day = weekday(date);
  return day === 0 || day === 6;
}

/* ------------------------------------------------------------- boundaries -- */

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const y = year(date);
  const m = monthIndex(date);
  return `${date.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

export function startOfYear(date: IsoDate): IsoDate {
  return `${date.slice(0, 4)}-01-01`;
}

export function endOfYear(date: IsoDate): IsoDate {
  return `${date.slice(0, 4)}-12-31`;
}

export function startOfQuarter(date: IsoDate): IsoDate {
  const q = Math.floor(monthIndex(date) / 3);
  return `${date.slice(0, 4)}-${String(q * 3 + 1).padStart(2, "0")}-01`;
}

export function endOfQuarter(date: IsoDate): IsoDate {
  return endOfMonth(addMonths(startOfQuarter(date), 2));
}

/** ISO-8601 week: weeks start on Monday. */
export function startOfWeek(date: IsoDate): IsoDate {
  const day = weekday(date);
  const backtrack = day === 0 ? 6 : day - 1;
  return addDays(date, -backtrack);
}

export function endOfWeek(date: IsoDate): IsoDate {
  return addDays(startOfWeek(date), 6);
}

/** ISO-8601 week number, the one a Monday-based calendar shows. */
export function isoWeekNumber(date: IsoDate): number {
  const thursday = addDays(startOfWeek(date), 3);
  const firstThursday = addDays(startOfWeek(`${thursday.slice(0, 4)}-01-04`), 3);
  return Math.round(daysBetween(firstThursday, thursday) / 7) + 1;
}

export function quarterOf(date: IsoDate): number {
  return Math.floor(monthIndex(date) / 3) + 1;
}

export const clampDate = (date: IsoDate, min: IsoDate, max: IsoDate): IsoDate =>
  date < min ? min : date > max ? max : date;

/* ------------------------------------------------------------- formatting -- */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let existing = cache.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options });
    cache.set(key, existing);
  }
  return existing;
}

export function formatDate(date: IsoDate): string {
  return formatter({ day: "numeric", month: "short", year: "numeric" }).format(toTime(date));
}

export function formatMonth(date: IsoDate, style: "short" | "long" = "short"): string {
  return formatter({ month: style }).format(toTime(date));
}

export function formatDayNumber(date: IsoDate): string {
  return String(dayOfMonth(date));
}

export function formatWeekdayInitial(date: IsoDate): string {
  return formatter({ weekday: "narrow" }).format(toTime(date));
}

/**
 * How a date reads once its precision is taken into account: a month-precision
 * item says "Mar 2026", not "1 Mar 2026", because the day was never meaningful.
 */
export function formatWithPrecision(date: IsoDate, precision: "day" | "month" | "year"): string {
  if (precision === "year") return date.slice(0, 4);
  if (precision === "month") return formatter({ month: "short", year: "numeric" }).format(toTime(date));
  return formatDate(date);
}

/**
 * Snaps a date to the start (or inclusive end) of the unit its precision names.
 *
 * Re-exported from the shared model rather than implemented here: the sync
 * endpoint has to snap dates identically, and two implementations of "what a
 * month-precision item means" would eventually disagree.
 */
export const snapToPrecision = snapToUnit;
