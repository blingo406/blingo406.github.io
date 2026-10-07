import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assess, beijing, capturePoint, fetchNAVs, fetchQuote, finalizeHistory, isTradingDay, mergePoint, pollingDelay } from "../../src/lib/gold-etf-core.mjs";
import { collectorHealth } from "./health.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "public/data/gold-etf/state.json");
const calendar = JSON.parse(await fs.readFile(path.join(root, "src/data/gold-etf/calendar.json"), "utf8"));
let state;
try { state = JSON.parse(await fs.readFile(output, "utf8")); }
catch { state = { version: 1, code: "159315", quote: null, navs: [], history: [], lastSuccessAt: null }; }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshNAV() {
	state.navCheckedAt = new Date().toISOString();
	try {
		state.navs = await fetchNAVs();
		state.navLastSuccessAt = new Date().toISOString();
		state.navStatus = "ok";
		delete state.navError;
	} catch (error) {
		state.navStatus = "unavailable";
		state.navError = error.message;
	}
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
		delete state.sourceError;
		const result = assess(state.quote, state.navs, calendar);
		state.history = mergePoint(state.history, capturePoint(state.quote, result));
		failed = false;
	} catch (error) {
		state.sourceStatus = "unavailable";
		state.sourceError = error.errors?.map((cause) => cause.message).join("; ") || error.message;
		failed = true;
	}
}

await refreshNAV();
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
	await refreshNAV();
	while (beijing().slice(0, 10) === today && beijing().slice(11, 19) >= "09:14:50" && beijing().slice(11, 19) < "09:22:05") {
		const start = Date.now();
		await sample();
		await save();
		await sleep(Math.max(100, (failed ? 5000 : pollingDelay()) - (Date.now() - start)));
	}
}
await sample();
if (trading) state.history = finalizeHistory(state.history, today);
const health = collectorHealth(state, calendar, { watch });
state.health = health;
await save();
console.log(JSON.stringify({ code: state.code, sessionDate: today, sessionStatus: state.sessionStatus, sourceStatus: state.sourceStatus, navStatus: state.navStatus, navError: state.navError, sourceError: state.sourceError, health, captures: state.history.filter((row) => row.date === today).map((row) => ({ target: row.target, status: row.status })) }));
// Publish truthful source status first; only unusable monitoring data fails the health job.
const reason = health.reason.replace(/[\r\n]/g, " ");
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `healthy=${health.healthy}\nhealth_reason=${reason}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Gold ETF data health\n\n- Session: ${today} (${state.sessionStatus})\n- Quote source: ${state.sourceStatus}\n- NAV source: ${state.navStatus}\n- Monitoring data: ${health.status}\n- ${reason}\n`);
if (process.env.GITHUB_ACTIONS && health.status === "degraded") console.log(`::warning::${reason.replace(/%/g, "%25")}`);
if (!process.env.GITHUB_ACTIONS && !health.healthy) process.exitCode = 2;
