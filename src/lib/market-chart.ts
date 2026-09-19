import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { Observation } from "./markets";

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export function mountChart(root: HTMLElement) {
	const data: Record<string, Observation[]> = JSON.parse(
		root.dataset.datasets || "{}",
	);
	const labels: Record<string, { name: string; color: string }> = JSON.parse(
		root.dataset.metrics || "{}",
	);
	const canvas = root.querySelector<HTMLElement>(".chart-canvas");
	const metric = root.querySelector<HTMLSelectElement>("[data-series]");
	const range = root.querySelector<HTMLSelectElement>("[data-range]");
	if (!canvas || !metric || !range) return;
	canvas.hidden = false;
	const chart = init(canvas, undefined, { renderer: "canvas" });
	const selected = () => {
		const rows = data[metric.value] || [];
		const end = Date.parse(rows.at(-1)?.date || "");
		return rows.filter(
			(row) =>
				range.value === "all" ||
				Date.parse(row.date) >= end - Number(range.value) * 86400000,
		);
	};
	const render = () => {
		const rows = selected();
		const label = labels[metric.value];
		const style = getComputedStyle(document.documentElement);
		const points: [string, number | null][] = [];
		for (const row of rows) {
			const previous = points.at(-1);
			if (
				previous &&
				Date.parse(row.date) - Date.parse(previous[0]) > 11 * 86400000
			) {
				points.push([
					new Date(Date.parse(previous[0]) + 7 * 86400000)
						.toISOString()
						.slice(0, 10),
					null,
				]);
			}
			points.push([row.date, row.value]);
		}
		chart.setOption(
			{
				animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
				grid: { left: 52, right: 22, top: 35, bottom: 36 },
				tooltip: {
					trigger: "axis",
					renderMode: "richText",
					valueFormatter: (value: unknown) =>
						`${Number(value).toFixed(2)} 元/公斤`,
				},
				xAxis: {
					type: "time",
					boundaryGap: false,
					axisLabel: {
						color: style.getPropertyValue("--m-muted"),
						hideOverlap: true,
						formatter: "{MM}-{dd}",
					},
					axisLine: {
						lineStyle: { color: style.getPropertyValue("--m-line") },
					},
				},
				yAxis: {
					type: "value",
					scale: true,
					name: "元/公斤",
					nameTextStyle: { color: style.getPropertyValue("--m-muted") },
					axisLabel: { color: style.getPropertyValue("--m-muted") },
					splitLine: {
						lineStyle: {
							color: style.getPropertyValue("--m-line"),
							type: "dashed",
						},
					},
				},
				series: [
					{
						name: label.name,
						type: "line",
						data: points,
						connectNulls: false,
						showSymbol: rows.length < 20,
						symbolSize: 5,
						smooth: false,
						lineStyle: { width: 2.5, color: label.color },
						itemStyle: { color: label.color },
						areaStyle: { opacity: 0.06, color: label.color },
					},
				],
			},
			true,
		);
		const summary = root.querySelector(".chart-summary");
		const last = rows.at(-1);
		if (summary)
			summary.textContent = last
				? `${label.name} · ${rows.length} 期 · ${rows[0].date} 至 ${last.date} · 最新 ${last.value.toFixed(2)} 元/公斤`
				: "暂无数据";
	};
	render();
	root.querySelector(".chart-fallback")?.setAttribute("hidden", "");
	const controls = root.querySelector<HTMLElement>("[data-chart-controls]");
	if (controls) controls.hidden = false;
	metric.addEventListener("change", render);
	range.addEventListener("change", render);
	new ResizeObserver(() => chart.resize()).observe(canvas);
	window.addEventListener("market-theme-change", render);
	root.querySelector("[data-csv]")?.addEventListener("click", () => {
		const rows = selected();
		const csv =
			"\uFEFF采集日期,指标,价格,单位,发布日期,来源\r\n" +
			rows
				.map((r) =>
					[
						r.date,
						labels[metric.value].name,
						r.value,
						"元/公斤",
						r.published,
						r.url,
					].join(","),
				)
				.join("\r\n");
		const url = URL.createObjectURL(
			new Blob([csv], { type: "text/csv;charset=utf-8" }),
		);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${metric.value}-${rows.at(-1)?.date || "data"}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	});
}
