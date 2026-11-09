export function futureUtcMinute(value: unknown, now = Date.now()): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const due = Date.parse(value + ":00Z");
  return due > now && new Date(due).toISOString().slice(0, 16) === value ? due : null;
}
