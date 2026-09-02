import type { LabResultDetail } from "./api";

export interface HistoryRow {
  analyteName: string;
  unit: string | null;
  referenceRange: string;
  values: Record<string, { value: string | null; normal_min: number | null; normal_max: number | null } | null>;
}

export function transformToHistory(details: LabResultDetail[]): {
  dates: string[];
  rows: HistoryRow[];
} {
  // Sort details by date ascending
  const sortedDetails = [...details].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const formatDate = (d: string) => {
    const date = new Date(d);
    return (
      date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      }) +
      " " +
      date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  };

  const dates = sortedDetails.map((d) => formatDate(d.created_at));

  const analyteMap: Record<string, HistoryRow> = {};

  sortedDetails.forEach((d) => {
    const dateStr = formatDate(d.created_at);
    if (Array.isArray(d.values)) {
      d.values.forEach((v) => {
        const key = v.analyte_name;
        if (!analyteMap[key]) {
          const refRange =
            v.normal_min != null || v.normal_max != null
              ? `${v.normal_min ?? "—"} – ${v.normal_max ?? "—"}`
              : "—";
          analyteMap[key] = {
            analyteName: v.analyte_name,
            unit: v.unit,
            referenceRange: refRange,
            values: {},
          };
        }
        analyteMap[key].values[dateStr] = { value: v.observed_value, normal_min: v.normal_min, normal_max: v.normal_max };
      });
    }
  });

  const analyteOrder: string[] = [];
  sortedDetails.forEach((d) => {
    if (Array.isArray(d.values)) {
      d.values.forEach((v) => {
        if (!analyteOrder.includes(v.analyte_name)) {
          analyteOrder.push(v.analyte_name);
        }
      });
    }
  });

  const rows = analyteOrder
    .map((name) => analyteMap[name])
    .filter(Boolean);

  return { dates, rows };
}
