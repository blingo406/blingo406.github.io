import { snapshot } from "../../lib/markets";
export function GET() {
	return new Response(JSON.stringify(snapshot.observations), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}
