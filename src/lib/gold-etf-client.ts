import {
	assess,
	beijing,
	capturePoint,
	fetchQuote,
	isTradingDay,
	pollingDelay,
	previousSession,
} from "./gold-etf-core.mjs";

type Quote = Awaited<ReturnType<typeof fetchQuote>>;
type Point = {
	date: string;
	target: string;
	quoteAt: string;
	receivedAt: string;
	bid: number;
	ask: number | null;
	discount: number;
	level: number;
	state: string;
};
type Nav = { date: string; value: number; observedAt: string };
type State = {
	quote: Quote | null;
	navs: Nav[];
};
const { seed, calendar } = JSON.parse(
	document.getElementById("etf-seed")?.textContent || "{}",
);
const state: State = seed;
const set = (id: string, text: string) => {
	const element = document.getElementById(id);
	if (element && element.textContent !== text) element.textContent = text;
};
const percent = (n: number | null | undefined) =>
	n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const time = (iso: string) => beijing(Date.parse(iso)).slice(11, 19);
let quote = state.quote;
let audio: AudioContext | null = null;
let alertsEnabled = false;
let requestRunning = false;
let failures = 0;
let nextPoll = 0;
let lastReferenceCheck = 0;
let referenceRunning = false;
let notifications = new Set<string>();
try {
	notifications = new Set(
		JSON.parse(localStorage.getItem("gold-etf-alerts-v1") || "[]"),
	);
} catch {
	/* Browser storage may be disabled. The live page still works. */
}

function alert(point: Point) {
	if (!alertsEnabled || point.level !== 5) return;
	const key = `${point.date}/${point.target}/5`;
	if (notifications.has(key)) return;
	notifications.add(key);
	try {
		localStorage.setItem(
			"gold-etf-alerts-v1",
			JSON.stringify([...notifications].slice(-200)),
		);
	} catch {
		/* In-memory deduplication remains active. */
	}
	const message = `${point.target} 工银黄金股ETF：参考折价 ${percent(point.discount)}，满足 5% 提醒条件。请核对竞价报价。`;
	if (audio?.state === "running") {
		for (const delay of [0, 0.3, 0.6]) {
			const tone = audio.createOscillator();
			const gain = audio.createGain();
			tone.connect(gain);
			gain.connect(audio.destination);
			tone.frequency.value = 880;
			gain.gain.setValueAtTime(0.12, audio.currentTime + delay);
			gain.gain.exponentialRampToValueAtTime(
				0.001,
				audio.currentTime + delay + 0.22,
			);
			tone.start(audio.currentTime + delay);
			tone.stop(audio.currentTime + delay + 0.23);
		}
	}
	if ("Notification" in window && Notification.permission === "granted") {
		try {
			const notification = new Notification("黄金股 ETF · 5% 重点提示", {
				body: message,
				tag: key,
				requireInteraction: true,
			});
			notification.onclick = () => {
				window.focus();
				notification.close();
			};
		} catch {
			/* Some mobile browsers require a service worker; keep sound and banner. */
		}
	}
	set(
		"etf-notify-state",
		`${time(point.quoteAt)} 已提示：参考折价 ${percent(point.discount)}。该分钟不重复提醒。`,
	);
}

function render() {
	const now = Date.now();
	const result = assess(quote, state.navs, calendar, now);
	set("etf-clock", `北京时间 ${beijing(now).replace("T", " ")}`);
	set("etf-signal", result.message);
	const hero = document.getElementById("etf-hero");
	if (hero) hero.dataset.level = String(result.level);
	document.title = `${result.level ? "【5% 重点关注】" : ""}工银黄金股 ETF · 09:16 / 09:21`;
	set("etf-discount", result.fresh ? percent(result.discount) : "—");
	const point = capturePoint(quote, result, now) as Point | null;
	if (point) {
		alert(point);
	}
}

async function refreshQuote() {
	if (requestRunning) return;
	requestRunning = true;
	const started = Date.now();
	try {
		quote = await fetchQuote();
		failures = 0;
	} catch {
		failures++;
	} finally {
		requestRunning = false;
		nextPoll =
			started +
			(failures ? Math.min(15000, 1000 * 2 ** failures) : pollingDelay());
		render();
	}
}

async function refreshReference() {
	if (referenceRunning) return;
	referenceRunning = true;
	lastReferenceCheck = Date.now();
	try {
		// The NAV provider is not CORS-enabled. Read the collector's public data directly,
		// avoiding the delay of a complete GitHub Pages rebuild during morning warmup.
		const url = `https://raw.githubusercontent.com/blingo406/blingo406.github.io/main/public/data/gold-etf/state.json?_=${Date.now()}`;
		const response = await fetch(url, {
			signal: AbortSignal.timeout(5000),
			cache: "no-store",
		});
		if (!response.ok) return;
		const data = await response.json();
		if (data.code !== "159315" || !Array.isArray(data.navs)) return;
		state.navs = data.navs;
		render();
	} catch {
		/* Retain dated reference values; assess rejects the wrong session. */
	} finally {
		referenceRunning = false;
	}
}

document.getElementById("etf-refresh")?.addEventListener("click", () => {
	void refreshQuote();
	void refreshReference();
});
document.getElementById("etf-enable")?.addEventListener("click", async () => {
	alertsEnabled = true;
	try {
		audio ??= new AudioContext();
		await audio.resume();
	} catch {
		/* Desktop notification can still work. */
	}
	try {
		if ("Notification" in window && Notification.permission === "default")
			await Notification.requestPermission();
	} catch {
		/* Keep the on-page alert available. */
	}
	const desktop =
		"Notification" in window && Notification.permission === "granted";
	set("etf-enable", "重点提示已开启");
	set(
		"etf-notify-state",
		`声音${audio?.state === "running" ? "已开启" : "不可用"}；桌面通知${desktop ? "已开启" : "未获授权"}。请保持本页打开、设备联网。`,
	);
	try {
		if ("wakeLock" in navigator && document.visibilityState === "visible")
			await navigator.wakeLock.request("screen");
	} catch {
		/* Wake lock is optional. */
	}
	render();
});
window.addEventListener("storage", (event) => {
	if (event.key === "gold-etf-alerts-v1" && event.newValue) {
		try {
			notifications = new Set(JSON.parse(event.newValue));
		} catch {
			/* Ignore corrupt local storage. */
		}
	}
});
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") void refreshQuote();
});
window.setInterval(() => {
	render();
	const day = beijing().slice(0, 10);
	if (isTradingDay(day, calendar) && Date.now() >= nextPoll)
		void refreshQuote();
	const previous = previousSession(day, calendar);
	const needsNav = !state.navs.some((row) => row.date === previous);
	if (Date.now() - lastReferenceCheck > (needsNav ? 30_000 : 300_000))
		void refreshReference();
}, 500);
render();
void refreshQuote();
void refreshReference();
