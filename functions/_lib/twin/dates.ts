// Date maths for the "DERIVED FACTS" block. The model must not do this arithmetic
// itself (free models get it wrong), so it is computed here from the structured CV.

export interface YearMonth {
  year: number;
  /** 0-11 */
  month: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parses "Sept 2019", "Jul 2017", "May 2006". Anything else (year only, ranges, text) -> null. */
export function parseMonthYear(text: string): YearMonth | null {
  const match = /^\s*([A-Za-z]{3,9})\.?\s+(\d{4})\s*$/.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
  const year = Number(match[2]);
  if (month === -1 || year < 1950 || year > 2100) return null;
  return { year, month };
}

export const isPresent = (text: string): boolean =>
  /^\s*(present|current|now|ongoing)\s*$/i.test(text);

export const monthsBetween = (from: YearMonth, to: YearMonth): number =>
  (to.year - from.year) * 12 + (to.month - from.month);

export function formatDuration(totalMonths: number): string {
  if (!Number.isFinite(totalMonths) || totalMonths < 0) return "unknown";
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" ") : "less than 1 month";
}

const formatYearMonth = ({ year, month }: YearMonth): string =>
  `${year}-${String(month + 1).padStart(2, "0")}`;

export interface RoleFact {
  role: string;
  company: string;
  start: string;
  end: string;
  duration: string;
  current: boolean;
}

export interface DerivedFacts {
  /** UTC date the facts are computed for, YYYY-MM-DD. */
  asOf: string;
  roles: RoleFact[];
  currentRoles: string[];
  /** Span from the earliest parseable start to the latest end (or as-of date), or null. */
  careerSpan: string | null;
}

interface ExperienceLike {
  role: string;
  company: string;
  startDate: string;
  endDate: string;
}

export function deriveFacts(experience: ExperienceLike[], asOf: Date): DerivedFacts {
  const now: YearMonth = { year: asOf.getUTCFullYear(), month: asOf.getUTCMonth() };
  const roles: RoleFact[] = [];
  let earliest: YearMonth | null = null;
  let latest: YearMonth | null = null;

  for (const exp of experience) {
    const start = parseMonthYear(exp.startDate);
    const current = isPresent(exp.endDate);
    const end = current ? now : parseMonthYear(exp.endDate);

    if (start && (!earliest || monthsBetween(earliest, start) < 0)) earliest = start;
    if (end && (!latest || monthsBetween(latest, end) > 0)) latest = end;

    roles.push({
      role: exp.role,
      company: exp.company,
      start: start ? formatYearMonth(start) : "unknown",
      end: current ? "present" : end ? formatYearMonth(end) : "unknown",
      duration: start && end ? formatDuration(monthsBetween(start, end)) : "unknown",
      current,
    });
  }

  return {
    asOf: asOf.toISOString().slice(0, 10),
    roles,
    currentRoles: roles.filter((r) => r.current).map((r) => `${r.role} at ${r.company}`),
    careerSpan: earliest && latest ? formatDuration(monthsBetween(earliest, latest)) : null,
  };
}

/** Plain-text block for the system prompt. "unknown" means: do not compute, say you do not know. */
export function formatFactsBlock(facts: DerivedFacts): string {
  const lines = [`As of: ${facts.asOf} (UTC date)`];
  for (const r of facts.roles) {
    lines.push(`- ${r.role} at ${r.company}: ${r.start} to ${r.end} = ${r.duration}`);
  }
  lines.push(
    `Current role(s): ${facts.currentRoles.length > 0 ? facts.currentRoles.join("; ") : "none listed"}`,
  );
  if (facts.careerSpan) {
    lines.push(`Span from the earliest listed role to the latest (all roles, including non-software): ${facts.careerSpan}`);
  }
  return lines.join("\n");
}
