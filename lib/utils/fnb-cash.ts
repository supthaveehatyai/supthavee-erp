export function drawerCustody(float: number, counted: number, handover: number): { float: number; total: number; sales: number } {
  const base = float > 0 ? float : 1200;
  const total = counted >= base
    ? counted
    : counted > 0
      ? base + counted
      : handover > 0 && handover < base
        ? base + handover
        : Math.max(counted, 0);
  return { float: base, total, sales: Math.max(0, Math.round((total - base) * 100) / 100) };
}
