import { beijing, isTradingDay, positive, previousSession } from "../../src/lib/gold-etf-core.mjs";

export function collectorHealth(state, calendar, { watch = false, now = Date.now() } = {}) {
	const clock = beijing(now);
	const day = clock.slice(0, 10);
	const trading = isTradingDay(day, calendar);
	const previous = previousSession(day, calendar);
	const nav = state.navs?.find((row) =>
		row.date === previous && positive(row.value) && Date.parse(row.observedAt) <= now,
	);
	const fail = (reason) => ({ healthy: false, status: "unavailable", reason, referenceDate: nav?.date ?? null });
	if (trading === null || !previous) return fail("Exchange calendar needs updating");
	if (state.sourceStatus !== "ok") return fail(state.sourceError || "Quote source unavailable");
	if (!nav) return fail(`No valid previous-session NAV for ${previous}`);
	const needsCaptures = watch && trading && clock.slice(11, 16) >= "09:22" && clock.slice(11, 16) < "10:00";
	const captured = ["09:16", "09:21"].every((target) =>
		state.history?.some((row) => row.date === day && row.target === target && row.status === "captured"),
	);
	if (needsCaptures && !captured) return fail("One or more auction observation slots were missed");
	const cached = state.navStatus !== "ok";
	return {
		healthy: true,
		status: cached ? "degraded" : "ok",
		reason: cached ? `NAV refresh unavailable; retained valid cached reference for ${previous}. ${state.navError || ""}`.trim() : "Quote and previous-session NAV available",
		referenceDate: nav.date,
	};
}
