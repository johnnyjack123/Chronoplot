/*
 * Checks for the calendar maths. Run with:  npx tsx web/test/dates.test.ts
 * These are the cases that actually break date code: month-end clamping, leap
 * years, ISO week numbering across a year boundary, and DST-sensitive ranges.
 */
import {
  addDays, addMonths, addYears, daysBetween, endOfMonth, endOfQuarter, inclusiveDays,
  isoWeekNumber, isWeekend, quarterOf, snapToPrecision, startOfQuarter, startOfWeek,
  formatWithPrecision,
} from "../src/lib/dates.ts";

let failed = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failed++;
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${actual}, want ${expected}`}`);
}

// Month-end clamping: the classic off-by-a-month bug.
eq("31 Jan + 1 month", addMonths("2026-01-31", 1), "2026-02-28");
eq("31 Jan + 1 month (leap)", addMonths("2024-01-31", 1), "2024-02-29");
eq("31 Mar - 1 month", addMonths("2026-03-31", -1), "2026-02-28");
eq("15 Dec + 1 month crosses year", addMonths("2026-12-15", 1), "2027-01-15");
eq("15 Jan - 1 month crosses year", addMonths("2026-01-15", -1), "2025-12-15");
eq("29 Feb + 1 year", addYears("2024-02-29", 1), "2025-02-28");

// Leap years.
eq("Feb 2024 ends on 29th", endOfMonth("2024-02-10"), "2024-02-29");
eq("Feb 2026 ends on 28th", endOfMonth("2026-02-10"), "2026-02-28");
eq("2100 is not a leap year", endOfMonth("2100-02-01"), "2100-02-28");
eq("2000 is a leap year", endOfMonth("2000-02-01"), "2000-02-29");

// Day arithmetic must not drift across a DST change (Europe switches 29 Mar 2026).
eq("days across spring DST", daysBetween("2026-03-28", "2026-03-30"), 2);
eq("days across autumn DST", daysBetween("2026-10-24", "2026-10-26"), 2);
eq("a full non-leap year", daysBetween("2026-01-01", "2027-01-01"), 365);
eq("a full leap year", daysBetween("2024-01-01", "2025-01-01"), 366);
eq("inclusive single day", inclusiveDays("2026-05-04", "2026-05-04"), 1);
eq("add days across month end", addDays("2026-01-31", 1), "2026-02-01");

// ISO weeks start on Monday and number from the first Thursday.
eq("Monday is its own week start", startOfWeek("2026-03-02"), "2026-03-02");
eq("Sunday belongs to the previous Monday", startOfWeek("2026-03-08"), "2026-03-02");
eq("1 Jan 2026 is week 1", isoWeekNumber("2026-01-01"), 1);
eq("31 Dec 2025 is week 1 of 2026", isoWeekNumber("2025-12-31"), 1);
eq("4 Jan 2027 is week 1", isoWeekNumber("2027-01-04"), 1);
eq("mid-year week number", isoWeekNumber("2026-07-01"), 27);

// Quarters.
eq("Feb is Q1", quarterOf("2026-02-14"), 1);
eq("Q3 starts in July", startOfQuarter("2026-08-20"), "2026-07-01");
eq("Q3 ends in September", endOfQuarter("2026-08-20"), "2026-09-30");

// Weekends.
eq("Saturday is a weekend", isWeekend("2026-03-07"), true);
eq("Monday is not", isWeekend("2026-03-02"), false);

// Precision snapping is what keeps stored dates matching what was displayed.
eq("month precision snaps start", snapToPrecision("2026-05-17", "month", "start"), "2026-05-01");
eq("month precision snaps end", snapToPrecision("2026-05-17", "month", "end"), "2026-05-31");
eq("year precision snaps start", snapToPrecision("2026-05-17", "year", "start"), "2026-01-01");
eq("year precision snaps end", snapToPrecision("2026-05-17", "year", "end"), "2026-12-31");
eq("day precision is untouched", snapToPrecision("2026-05-17", "day", "start"), "2026-05-17");

// Labels must not show a day the user never chose.
eq("year label", formatWithPrecision("2026-05-17", "year"), "2026");
eq("month label", formatWithPrecision("2026-05-17", "month"), "May 2026");

console.log(failed === 0 ? "\nAll date checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
