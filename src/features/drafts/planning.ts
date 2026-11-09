export function isPlanningDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
export const dayLabel = new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" });

export function calendarMonth(selected: string) {
  const [year, month] = selected.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Math.ceil((offset + (next.valueOf() - first.valueOf()) / 86400000) / 7) * 7;

  return {
    title: monthLabel.format(first),
    start: dateKey(first),
    end: dateKey(new Date(Date.UTC(year, month, 0))),
    next: dateKey(next),
    previous: dateKey(new Date(Date.UTC(year, month - 2, 1))),
    cells: Array.from({ length: days }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, index - offset + 1));
      return { date: dateKey(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month - 1 };
    }),
  };
}
