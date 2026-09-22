import { latestSummary } from "../../lib/market-latest";
export function GET() {
	const data = latestSummary();
	// The homepage only needs the decision, never the full historical dot tables.
	return new Response(
		JSON.stringify({
			...data,
			meeting: data.meeting
				? { date: data.meeting.date, summary: data.meeting.summary }
				: null,
		}),
		{
			headers: { "Content-Type": "application/json; charset=utf-8" },
		},
	);
}
