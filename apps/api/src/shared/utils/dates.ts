export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function daysBetween(date1: Date, date2: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diff / msPerDay);
}

export function isDeadlineCritical(deadline: Date, warningDays = 3): boolean {
  const now = new Date();
  const remaining = daysBetween(now, deadline);
  return deadline.getTime() >= now.getTime() && remaining <= warningDays;
}

export function calculateLiDeadline(shipmentDate: Date): Date {
  return addDays(shipmentDate, 13);
}
