"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, BarChart, RadarChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, DataZoomComponent, RadarComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, BarChart, RadarChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, DataZoomComponent, RadarComponent, CanvasRenderer]);

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * ECharts 包裝：自動套用品牌色與亮／暗色模式；option 中的 "var(--x)" 會被替換為實際顏色。
 */
export function Chart({ option, height = 320, ariaLabel }: { option: Record<string, unknown>; height?: number; ariaLabel: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current, undefined, { renderer: "canvas" });
    const render = () => {
      const resolved = JSON.parse(JSON.stringify(option), (_k, v) => (typeof v === "string" && v.startsWith("var(--") ? css(v.slice(4, -1)) : v));
      const fg = css("--fg");
      const muted = css("--muted");
      const border = css("--border");
      chart.setOption(
        {
          color: [1, 2, 3, 4, 5].map((i) => css(`--chart-${i}`)),
          textStyle: { color: fg, fontFamily: getComputedStyle(document.body).fontFamily },
          grid: { left: 48, right: 24, top: 40, bottom: 40, containLabel: true },
          tooltip: { trigger: "axis", backgroundColor: css("--surface"), borderColor: border, textStyle: { color: fg } },
          legend: { textStyle: { color: muted }, top: 0 },
          ...resolved,
          xAxis: patchAxis(resolved.xAxis, muted, border),
          yAxis: patchAxis(resolved.yAxis, muted, border),
        },
        true,
      );
    };
    render();
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el.current);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const mo = new MutationObserver(render);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    mq.addEventListener("change", render);
    return () => {
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener("change", render);
      chart.dispose();
    };
  }, [option]);
  return <div ref={el} role="img" aria-label={ariaLabel} style={{ height }} className="w-full" />;
}

function patchAxis(axis: unknown, muted: string, border: string) {
  if (!axis) return undefined;
  const patch = (a: Record<string, unknown>) => ({
    axisLabel: { color: muted },
    axisLine: { lineStyle: { color: border } },
    splitLine: { lineStyle: { color: border, type: "dashed" } },
    nameTextStyle: { color: muted },
    ...a,
  });
  return Array.isArray(axis) ? axis.map(patch) : patch(axis as Record<string, unknown>);
}
