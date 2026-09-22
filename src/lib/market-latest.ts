import { metrics, series, snapshot } from "./markets";

export function latestSummary() {
	const keys = ["hog_spot", "hog", "piglet", "corn"];
	return {
		generatedAt: snapshot.generatedAt,
		quotes: keys.map((key) => ({
			key,
			name: metrics[key].name,
			frequency: metrics[key].frequency || "周度",
			...series(key).at(-1),
		})),
		meeting:
			[...snapshot.meetings].sort((a, b) => b.date.localeCompare(a.date))[0] ||
			null,
		reports: ["002714", "001201"]
			.map(
				(company) =>
					[...snapshot.reports]
						.filter((r) => r.company === company)
						.sort((a, b) => b.date.localeCompare(a.date))[0],
			)
			.filter(Boolean),
		issues: snapshot.status.filter((s) => s.state !== "ok").map((s) => s.id),
	};
}
