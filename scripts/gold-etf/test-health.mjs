import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fetchNAVs } from "../../src/lib/gold-etf-core.mjs";
import { collectorHealth } from "./health.mjs";

const calendar = JSON.parse(fs.readFileSync(new URL("../../src/data/gold-etf/calendar.json", import.meta.url)));
const now = Date.parse("2026-10-08T09:16:01+08:00");
const reference = { date: "2026-09-30", value: 1.5393, observedAt: "2026-10-07T15:00:00+08:00" };
const state = () => ({ sourceStatus: "ok", navStatus: "unavailable", navError: "HTTP 503", navs: [reference], history: [] });

test("NAV retries transient HTTP and malformed responses before accepting valid values", async () => {
	let calls = 0;
	const delays = [];
	const rows = await fetchNAVs({
		fetchImpl: async () => {
			calls++;
			if (calls === 1) return new Response("", { status: 503 });
			if (calls === 2) return Response.json({ Data: { LSJZList: [] } });
			return Response.json({ Data: { LSJZList: [{ FSRQ: "2026-09-30", DWJZ: "1.5393" }, { FSRQ: "bad", DWJZ: "0" }] } });
		},
		sleep: async (ms) => delays.push(ms),
	});
	assert.equal(calls, 3);
	assert.deepEqual(delays, [1000, 2000]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].value, 1.5393);
	assert.ok(Number.isFinite(Date.parse(rows[0].observedAt)));
});

test("NAV permanent failure stays visible after bounded retries", async () => {
	let calls = 0;
	await assert.rejects(fetchNAVs({
		fetchImpl: async () => { calls++; return new Response("", { status: 503 }); },
		sleep: async () => {},
	}), /failed after 3 attempts: NAV source HTTP 503/);
	assert.equal(calls, 3);
});

test("cached exact previous-session NAV keeps monitoring usable without claiming source recovery", () => {
	const snapshot = state();
	const health = collectorHealth(snapshot, calendar, { now });
	assert.equal(health.healthy, true);
	assert.equal(health.status, "degraded");
	assert.equal(health.referenceDate, "2026-09-30");
	assert.match(health.reason, /HTTP 503/);
	assert.equal(snapshot.navStatus, "unavailable");
	assert.equal(collectorHealth(snapshot, calendar, { now: Date.parse("2026-10-07T15:15:00+08:00") }).healthy, true);
});

test("missing, old, zero or future-observed cached NAV cannot pass health", () => {
	for (const navs of [[], [{ ...reference, date: "2026-09-29" }], [{ ...reference, value: 0 }], [{ ...reference, observedAt: "2026-10-08T10:00:00+08:00" }]]) {
		assert.equal(collectorHealth({ ...state(), navs }, calendar, { now }).healthy, false);
	}
	assert.equal(collectorHealth(state(), calendar, { now: Date.parse("2026-10-09T09:16:01+08:00") }).healthy, false);
});

test("quote failures, expired calendar and missed observation slots still fail health", () => {
	assert.equal(collectorHealth({ ...state(), sourceStatus: "unavailable" }, calendar, { now }).healthy, false);
	assert.equal(collectorHealth(state(), calendar, { now: Date.parse("2027-01-04T09:16:01+08:00") }).healthy, false);
	const afterWindow = Date.parse("2026-10-08T09:23:00+08:00");
	assert.equal(collectorHealth(state(), calendar, { watch: true, now: afterWindow }).healthy, false);
	const history = ["09:16", "09:21"].map((target) => ({ date: "2026-10-08", target, status: "captured" }));
	assert.equal(collectorHealth({ ...state(), history }, calendar, { watch: true, now: afterWindow }).healthy, true);
});
