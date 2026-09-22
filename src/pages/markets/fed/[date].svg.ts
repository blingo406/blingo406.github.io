import type { APIRoute } from "astro";
import { snapshot } from "../../../lib/markets";

export function getStaticPaths() {
	return snapshot.meetings
		.filter((m) => m.projection)
		.map((meeting) => ({
			params: { date: meeting.date },
			props: { meeting },
		}));
}

export const GET: APIRoute = ({ props }) => {
	const meeting = props.meeting as (typeof snapshot.meetings)[number];
	const projection = meeting.projection;
	if (!projection) return new Response(null, { status: 404 });
	const { periods, dots } = projection;
	const low = Math.floor(Math.min(0, ...dots.map((d) => d.rate)));
	const high = Math.ceil(Math.max(...dots.map((d) => d.rate))) + 0.5;
	const y = (rate: number) => 345 - ((rate - low) / (high - low)) * 285;
	const x = (i: number) => 65 + (i + 0.5) * (675 / periods.length);
	const grid = Array.from(
		{ length: Math.floor((high - low) * 2) + 1 },
		(_, i) => low + i / 2,
	)
		.map(
			(rate) =>
				`<path d="M65 ${y(rate)}H740" stroke="#dce4e8"/><text x="52" y="${y(rate) + 4}" text-anchor="end">${rate.toFixed(1)}</text>`,
		)
		.join("");
	const marks = dots
		.flatMap((dot) =>
			Array.from(
				{ length: dot.count },
				(_, i) =>
					`<circle cx="${x(periods.indexOf(dot.period)) + (i - (dot.count - 1) / 2) * 6.5}" cy="${y(dot.rate)}" r="2.7" fill="#107d79"/>`,
			),
		)
		.join("");
	const labels = periods
		.map(
			(period, i) =>
				`<text x="${x(i)}" y="372" text-anchor="middle">${period.toLowerCase() === "longer run" ? "长期" : period}</text><text x="${x(i)}" y="391" text-anchor="middle" fill="#637781">n=${dots.filter((d) => d.period === period).reduce((sum, d) => sum + d.count, 0)}</text>`,
		)
		.join("");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 780 420" role="img" aria-labelledby="title desc"><title id="title">${meeting.date} FOMC 点阵图</title><desc id="desc">联邦基金利率预期，单位百分比。每个点代表一位参会者的预测，并非政策承诺。</desc><rect width="780" height="420" rx="12" fill="#fff"/><g font-family="system-ui,sans-serif" font-size="12" fill="#172c39"><text x="24" y="28" font-size="16" font-weight="600">${meeting.date} · FOMC 利率预期（%）</text><text x="24" y="47" fill="#637781">每点一位参会者 · 数据来源：Federal Reserve</text>${grid}${marks}${labels}</g></svg>`;
	return new Response(svg, {
		headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
	});
};
