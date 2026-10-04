import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assess, beijing, capturePoint, fetchNAVs, fetchQuote, finalizeHistory, isTradingDay, mergePoint, pollingDelay } from "../../src/lib/gold-etf-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "public/data/gold-etf/state.json");
const calendar = JSON.parse(await fs.readFile(path.join(root, "src/data/gold-etf/calendar.json"), "utf8"));
let state;
try { state = JSON.parse(await fs.readFile(output, "utf8")); }
catch { state = { version: 1, code: "159315", quote: null, navs: [], history: [], lastSuccessAt: null }; }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshNAV() {
	const navs = await fetchNAVs();
	if (!navs.length) throw new Error("No valid NAV values");
	state.navs = navs;
	state.navCheckedAt = new Date().toISOString();
}

async function save() {
	await fs.mkdir(path.dirname(output), { recursive: true });
	const temp = `${output}.tmp`;
	await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
	await fs.rename(temp, output);
}

let failed = false;
async function sample() {
	state.checkedAt = new Date().toISOString();
	try {
		state.quote = await fetchQuote();
		state.lastSuccessAt = new Date().toISOString();
		state.sourceStatus = "ok";
		const result = assess(state.quote, state.navs, calendar);
		state.history = mergePoint(state.history, capturePoint(state.quote, result));
		failed = false;
	} catch {
		state.sourceStatus = "unavailable";
		failed = true;
	}
}

try { await refreshNAV(); state.navStatus = "ok"; }
catch { state.navStatus = "unavailable"; }
const today = beijing().slice(0, 10);
const trading = isTradingDay(today, calendar);
state.sessionDate = today;
state.sessionStatus = trading === null ? "calendar-unknown" : trading ? "trading" : "closed";
const watch = process.argv.includes("--watch");
if (watch && trading) {
	while (beijing().slice(11, 19) < "09:14:50") {
		// An accidental invocation at midnight must not occupy a runner for hours.
		if (beijing().slice(11, 16) < "08:40") break;
		await sleep(30_000);
	}
	// Refresh just before the window, so yesterday's NAV can arrive after warmup.
	try { await refreshNAV(); state.navStatus = "ok"; } catch { state.navStatus = "unavailable"; }
	while (beijing().slice(0, 10) === today && beijing().slice(11, 19) >= "09:14:50" && beijing().slice(11, 19) < "09:22:05") {
		const start = Date.now();
		await sample();
		await save();
		await sleep(Math.max(100, (failed ? 5000 : pollingDelay()) - (Date.now() - start)));
	}
}
await sample();
if (trading) state.history = finalizeHistory(state.history, today);
await save();
console.log(JSON.stringify({ code: state.code, sessionDate: today, sessionStatus: state.sessionStatus, sourceStatus: state.sourceStatus, navStatus: state.navStatus, captures: state.history.filter((row) => row.date === today).map((row) => ({ target: row.target, status: row.status })) }));
// Allow the workflow to publish truthful failure state and then fail its health step.
const needsCaptures = watch && trading && beijing().slice(11, 16) >= "09:22" && beijing().slice(11, 16) < "10:00";
const captured = ["09:16", "09:21"].every((target) => state.history.some((row) => row.date === today && row.target === target && row.status === "captured"));
const healthy = !failed && state.navStatus === "ok" && (!needsCaptures || captured);
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `healthy=${healthy}\n`);
if (!process.env.GITHUB_ACTIONS && (failed || state.navStatus !== "ok")) process.exitCode = 2;
