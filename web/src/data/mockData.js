// Shared stats/reference helpers for the AgriShare web frontend. Shapes
// mirror the ERD (tbl_Farmers, tbl_Distributions, tbl_Commodities, tbl_Requests)
// and match exactly what src/lib/api/*.js maps Supabase rows into, so these
// pure functions work unchanged whether fed real or (in tests) fake records.

export const barangays = ["Langapud"];

export const commodityCategories = ["Rice", "Corn", "Vegetables", "Fertilizer", "Farm Tools", "Livestock"];

export function distributionTotalQty(dist) {
  return dist.items.reduce((sum, i) => sum + i.quantity, 0);
}

export function computeCommodityStats(commodityList, distributionList) {
  const totals = {};
  for (const dist of distributionList) {
    for (const item of dist.items) {
      totals[item.name] = (totals[item.name] ?? 0) + item.quantity;
    }
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const mostDistributed = entries[0] ?? [commodityList[0]?.name ?? "-", 0];
  const totalQuantity = entries.reduce((sum, [, qty]) => sum + qty, 0);
  return { totals, mostDistributedName: mostDistributed[0], mostDistributedQty: mostDistributed[1], totalQuantity };
}

export const reportTypes = ["Beneficiary List", "Distribution Summary", "Liquidation Report", "Accomplishment Report"];

// Buckets real distribution quantities by month for whichever year the data
// actually falls in (the most recent event's year), instead of assuming
// "this year" — seed/demo data and today's calendar date won't usually match.
export function computeDistributionTrend(distributionList) {
  const year = distributionList.reduce((latest, d) => {
    const y = new Date(d.date).getFullYear();
    return Number.isFinite(y) && y > latest ? y : latest;
  }, new Date().getFullYear());

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const trend = months.map((month) => ({ month, quantity: 0 }));
  for (const d of distributionList) {
    const date = new Date(d.date);
    if (date.getFullYear() !== year) continue;
    trend[date.getMonth()].quantity += distributionTotalQty(d);
  }
  return { year, trend };
}

export function computeDistributionByCommodity(commodityList, distributionList, topN = 4) {
  const { totals } = computeCommodityStats(commodityList, distributionList);
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, topN).map(([name, value]) => ({ name, value }));
  const othersValue = entries.slice(topN).reduce((sum, [, v]) => sum + v, 0);
  if (othersValue > 0) top.push({ name: "Others", value: othersValue });
  return top;
}

export function computeRequestStats(list) {
  const total = list.length;
  const pending = list.filter((r) => r.status === "Pending").length;
  const forwarded = list.filter((r) => r.status === "Forwarded").length;
  const approved = list.filter((r) => r.status === "Approved").length;
  const rejected = list.filter((r) => r.status === "Rejected").length;
  return { total, pending, forwarded, approved, rejected };
}

export function computeFarmerStats(list) {
  const total = list.length;
  const active = list.filter((f) => f.status === "Active").length;
  const inactive = total - active;
  const validated = list.filter((f) => f.validationStatus === "Validated").length;
  const pending = list.filter((f) => f.validationStatus === "Pending").length;
  const notValidated = list.filter((f) => f.validationStatus === "Not Validated").length;
  return { total, active, inactive, validated, pending, notValidated };
}
