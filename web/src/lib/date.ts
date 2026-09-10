export function calculateAge(
  dob: string | null | undefined,
  fallbackAge: string | null | undefined,
): string {
  if (!dob) return fallbackAge || "—";

  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return fallbackAge || "—";

  const today = new Date();
  let years = today.getFullYear() - birthDate.getFullYear();
  let months = today.getMonth() - birthDate.getMonth();
  let days = today.getDate() - birthDate.getDate();

  if (days < 0) {
    months -= 1;
    // Get last day of previous month
    const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += prevMonth.getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (years === 0 && months === 0 && days >= 0) parts.push(`${days}d`);

  return parts.join(" ") || "0d";
}
