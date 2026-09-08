/*
 * Frontmatter date parsing.
 * Run with:  npx tsx obsidian-plugin/test/frontmatter.test.ts
 *
 * The leading-zero recovery is the reason this file exists. YAML silently turns
 * an unquoted 01032026 into the number 1032026, and without recovery the first
 * of the month becomes the tenth of a different one with nothing to show that
 * anything went wrong.
 */
import { combinePrecision, parseFrontmatterDate } from "../src/frontmatter.ts";

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), `got ${String(actual)}, want ${String(expected)}`);

/* 1. The documented forms. */
{
  const day = parseFrontmatterDate("01.03.2026")!;
  eq("dotted day", day.iso, "2026-03-01");
  eq("dotted day precision", day.precision, "day");

  const month = parseFrontmatterDate("03.2026")!;
  eq("dotted month", month.iso, "2026-03-01");
  eq("dotted month precision", month.precision, "month");

  const year = parseFrontmatterDate("2026")!;
  eq("bare year", year.iso, "2026-01-01");
  eq("bare year precision", year.precision, "year");

  eq("iso day", parseFrontmatterDate("2026-03-01")?.iso, "2026-03-01");
  eq("iso month", parseFrontmatterDate("2026-03")?.iso, "2026-03-01");
  eq("iso month precision", parseFrontmatterDate("2026-03")?.precision, "month");
  eq("slashes work too", parseFrontmatterDate("1/3/2026")?.iso, "2026-03-01");
  eq("single digits pad", parseFrontmatterDate("1.3.2026")?.iso, "2026-03-01");
}

/* 2. Quoted digit forms. */
{
  eq("quoted 8 digits", parseFrontmatterDate("01032026")?.iso, "2026-03-01");
  eq("quoted 6 digits", parseFrontmatterDate("032026")?.iso, "2026-03-01");
  eq("quoted 6 digits precision", parseFrontmatterDate("032026")?.precision, "month");
  eq("quoted 4 digits", parseFrontmatterDate("2026")?.iso, "2026-01-01");
  check("no recovery note when it was quoted", parseFrontmatterDate("01032026")?.recovered === undefined);
}

/* 3. THE TRAP: YAML dropped the leading zero and handed over a number. */
{
  const recovered = parseFrontmatterDate(1032026)!;
  eq("7 digits recover to 8", recovered.iso, "2026-03-01");
  eq("recovered precision", recovered.precision, "day");
  check("the repair is reported", typeof recovered.recovered === "string", String(recovered.recovered));

  eq("5 digits recover to 6", parseFrontmatterDate(32026)?.iso, "2026-03-01");
  eq("5 digits are a month", parseFrontmatterDate(32026)?.precision, "month");
  eq("3 digits recover to 4", parseFrontmatterDate(999)?.iso, "0999-01-01");

  // A number that needed no padding is not flagged.
  const clean = parseFrontmatterDate(15032026)!;
  eq("8-digit number needs no repair", clean.iso, "2026-03-15");
  check("and is not flagged", clean.recovered === undefined);

  // The one that started all this: 1 March, written unquoted.
  eq("the reported case parses correctly", parseFrontmatterDate(1032026)?.iso, "2026-03-01");
}

/* 4. A Date, which is what an unquoted ISO date becomes. */
{
  eq("a Date is accepted", parseFrontmatterDate(new Date("2026-03-01T00:00:00Z"))?.iso, "2026-03-01");
  check("an invalid Date is rejected", parseFrontmatterDate(new Date("nonsense")) === null);
}

/* 5. Rejections. Every one of these must be reported, never guessed at. */
{
  const bad = [
    "", "   ", "not a date", "2026-13-01", "32.01.2026", "29.02.2026", "00.03.2026",
    "2026-00-01", "2026-03-32", "123456789", "12345", true, {}, [], null, undefined,
  ];
  for (const value of bad) {
    check(`rejects ${JSON.stringify(value)}`, parseFrontmatterDate(value) === null);
  }
}

/* 6. Leap years are respected, not waved through. */
{
  eq("29 Feb in a leap year", parseFrontmatterDate("29.02.2024")?.iso, "2024-02-29");
  check("29 Feb in a common year is refused", parseFrontmatterDate("29.02.2026") === null);
  eq("29 Feb 2000", parseFrontmatterDate("29.02.2000")?.iso, "2000-02-29");
  check("29 Feb 2100 is refused", parseFrontmatterDate("29.02.2100") === null);
}

/* 7. A range is only as precise as its coarser end. */
{
  eq("day with day", combinePrecision("day", "day"), "day");
  eq("day with month", combinePrecision("day", "month"), "month");
  eq("month with year", combinePrecision("month", "year"), "year");
  eq("order does not matter", combinePrecision("year", "day"), "year");
}

console.log(failed === 0 ? "\nAll frontmatter checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
