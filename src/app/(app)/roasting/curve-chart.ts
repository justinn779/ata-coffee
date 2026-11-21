import { prisma } from "@/lib/db";
import { ROAST_EVENT } from "@/lib/labels";

/** 建立 ECharts 選項：BT / ET / RoR 分開顯示（圖例可切換），並標示事件。 */
export async function curveOption(roastBatchIds: string[], opts?: { labels?: Record<string, string>; showEt?: boolean; events?: boolean }) {
  const curves = await prisma.roastCurve.findMany({
    where: { roastBatchId: { in: roastBatchIds }, isActive: true },
    include: { points: { orderBy: { timeSec: "asc" } }, roastBatch: { include: { events: true } } },
  });
  if (!curves.length) return null;
  const multi = roastBatchIds.length > 1;
  const series: Record<string, unknown>[] = [];
  for (const c of curves) {
    const name = opts?.labels?.[c.roastBatchId] ?? c.roastBatch.batchNo;
    const pts = c.points;
    const toMin = (t: unknown) => Math.round((Number(t) / 60) * 1000) / 1000;
    if (pts.some((p) => p.btC != null))
      series.push({
        name: multi ? `${name} BT` : "BT 豆溫",
        type: "line",
        showSymbol: false,
        data: pts.filter((p) => p.btC != null).map((p) => [toMin(p.timeSec), Number(p.btC)]),
        markLine:
          !multi && opts?.events !== false
            ? {
                symbol: "none",
                label: { formatter: "{b}", position: "insideEndTop", fontSize: 10 },
                lineStyle: { type: "dashed", color: "var(--muted)" },
                data: c.roastBatch.events
                  .filter((e) => ["DRY_END", "FC_START", "FC_END", "DROP", "TURNING_POINT"].includes(e.type))
                  .map((e) => ({ name: ROAST_EVENT[e.type], xAxis: Math.round((e.timeSec / 60) * 1000) / 1000 })),
              }
            : undefined,
      });
    if ((opts?.showEt ?? !multi) && pts.some((p) => p.etC != null))
      series.push({ name: multi ? `${name} ET` : "ET 環境溫", type: "line", showSymbol: false, lineStyle: { type: multi ? "dotted" : "solid" }, data: pts.filter((p) => p.etC != null).map((p) => [toMin(p.timeSec), Number(p.etC)]) });
    if (pts.some((p) => p.rorC != null))
      series.push({ name: multi ? `${name} RoR` : `RoR${c.rorComputed ? "（由 BT 計算）" : ""}`, type: "line", yAxisIndex: 1, showSymbol: false, lineStyle: { width: 1 }, data: pts.filter((p) => p.rorC != null).map((p) => [toMin(p.timeSec), Number(p.rorC)]) });
  }
  return {
    tooltip: { trigger: "axis" },
    legend: { type: "scroll", top: 0 },
    grid: { top: 48, left: 52, right: 52, bottom: 56 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
    xAxis: { type: "value", name: "時間（分）", nameLocation: "middle", nameGap: 26, min: 0 },
    yAxis: [
      { type: "value", name: "溫度 °C", scale: true },
      { type: "value", name: "RoR °C/分", scale: true, splitLine: { show: false } },
    ],
    series,
  };
}
