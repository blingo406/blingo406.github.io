/** Shared by the browser and the scheduled collector. All times use Beijing time. */
export const CODE = "159315";
export const TARGETS = ["09:16", "09:21"];
export const MAX_AGE_MS = 15_000;

export function beijing(now = Date.now()) {
	return new Date(now + 8 * 3_600_000).toISOString().slice(0, 19);
}

export function positive(value) {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function premium(price, nav) {
	return positive(price) && positive(nav) ? price / nav - 1 : null;
}

// Prices are in 0.001-yuan ticks. Integer arithmetic avoids rounding 1.2345 down.
export function lowerLimit(previousClose) {
	const ticks = Math.round(previousClose * 1000);
	return Math.floor((ticks * 9 + 5) / 10) / 1000;
}

export function thresholdPrice(nav, percent) {
	return Math.floor(nav * (100 - percent) * 10 + 1e-9) / 1000;
}

export function isTradingDay(date, calendar) {
	if (date < calendar.validFrom || date > calendar.validThrough) return null;
	const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();
	return (
		weekday !== 0 &&
		weekday !== 6 &&
		!calendar.closedRanges.some(
			([from, through]) => date >= from && date <= through,
		)
	);
}

export function previousSession(date, calendar) {
	let cursor = Date.parse(`${date}T12:00:00+08:00`);
	for (let i = 0; i < 35; i++) {
		cursor -= 86_400_000;
		const day = beijing(cursor).slice(0, 10);
		const trading = isTradingDay(day, calendar);
		if (trading === null) return null;
		if (trading) return day;
	}
	return null;
}

export function quoteURL() {
	const params = new URLSearchParams({
		secids: `0.${CODE}`,
		fields: "f2,f12,f14,f17,f18,f31,f32,f124,f297,f441",
		fltt: "2",
		invt: "2",
		_: String(Date.now()),
	});
	return `https://push2.eastmoney.com/api/qt/ulist.np/get?${params}`;
}

export function parseQuote(payload, receivedAt = new Date().toISOString()) {
	const row = payload?.data?.diff?.[0];
	if (payload?.rc !== 0 || String(row?.f12) !== CODE)
		throw new Error("Wrong or missing ETF quote");
	const epoch = Number(row.f124) * 1000;
	if (!Number.isFinite(epoch) || epoch < Date.UTC(2020, 0, 1))
		throw new Error("Missing quote time");
	return {
		code: CODE,
		name: "工银黄金股ETF",
		bid: positive(row.f31),
		ask: positive(row.f32),
		last: positive(row.f2),
		open: positive(row.f17),
		previousClose: positive(row.f18),
		iopv: positive(row.f441),
		quoteAt: new Date(epoch).toISOString(),
		receivedAt,
		tradingDate: String(row.f297).replace(
			/^(\d{4})(\d{2})(\d{2})$/,
			"$1-$2-$3",
		),
		source: "eastmoney",
		priceRole: "bid1",
		auctionPriceVerified: false,
	};
}

export function parseTencent(text, receivedAt = new Date().toISOString()) {
	const match = text.match(/^v_sz159315="([^"]+)";/);
	const fields = match?.[1].split("~");
	if (!fields || fields[2] !== CODE || !/^\d{14}$/.test(fields[30]))
		throw new Error("Invalid Tencent quote");
	const timestamp = fields[30].replace(
		/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
		"$1-$2-$3T$4:$5:$6+08:00",
	);
	return {
		code: CODE,
		name: "工银黄金股ETF",
		bid: positive(fields[9]),
		ask: positive(fields[19]),
		last: positive(fields[3]),
		open: positive(fields[5]),
		previousClose: positive(fields[4]),
		iopv: null,
		quoteAt: new Date(timestamp).toISOString(),
		receivedAt,
		tradingDate: timestamp.slice(0, 10),
		source: "tencent",
		priceRole: "bid1",
		auctionPriceVerified: false,
	};
}

export async function fetchQuote() {
	// Race independent public feeds; neither raw response is treated as an order signal.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 3500);
	const parsed = [];
	const usable = (quote) => {
		parsed.push(quote);
		const minute = beijing().slice(11, 16);
		if (
			minute >= "09:15" &&
			minute < "09:25" &&
			(Date.now() - Date.parse(quote.quoteAt) > MAX_AGE_MS ||
				!positive(quote.bid))
		)
			throw new Error("Quote not current");
		return quote;
	};
	try {
		return await Promise.any([
			fetch(quoteURL(), { signal: controller.signal, cache: "no-store" }).then(
				async (r) => {
					if (!r.ok) throw new Error("Eastmoney unavailable");
					return usable(parseQuote(await r.json()));
				},
			),
			fetch(`https://qt.gtimg.cn/q=sz159315&_=${Date.now()}`, {
				signal: controller.signal,
				cache: "no-store",
			}).then(async (r) => {
				if (!r.ok) throw new Error("Tencent unavailable");
				return usable(
					parseTencent(
						new TextDecoder("gb18030").decode(await r.arrayBuffer()),
					),
				);
			}),
		]);
	} catch (error) {
		if (parsed.length)
			return parsed.sort((a, b) => b.quoteAt.localeCompare(a.quoteAt))[0];
		throw error;
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

export async function fetchNAVs({
	fetchImpl = fetch,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	attempts = 3,
} = {}) {
	// Server-side only: the NAV host requires its own Referer and has no CORS.
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await fetchImpl(
				`https://api.fund.eastmoney.com/f10/lsjz?fundCode=159315&pageIndex=1&pageSize=8&_=${Date.now()}`,
				{
					headers: { Referer: "https://fundf10.eastmoney.com/" },
					signal: AbortSignal.timeout(5000),
					cache: "no-store",
				},
			);
			if (!response.ok) throw new Error(`NAV source HTTP ${response.status}`);
			const rows = (await response.json())?.Data?.LSJZList;
			if (!Array.isArray(rows)) throw new Error("NAV source empty");
			const observedAt = new Date().toISOString();
			const navs = rows
				.filter(
					(row) => /^\d{4}-\d{2}-\d{2}$/.test(row.FSRQ) && positive(row.DWJZ),
				)
				.map((row) => ({
					date: row.FSRQ,
					value: Number(row.DWJZ),
					observedAt,
				}));
			if (!navs.length) throw new Error("NAV source has no valid values");
			return navs;
		} catch (error) {
			if (attempt === attempts)
				throw new Error(
					`NAV refresh failed after ${attempts} attempts: ${error.message}`,
					{ cause: error },
				);
			await sleep(attempt * 1000);
		}
	}
}

export function assess(quote, navs, calendar, now = Date.now()) {
	const clock = beijing(now);
	const day = clock.slice(0, 10);
	const minute = clock.slice(11, 16);
	const trading = isTradingDay(day, calendar);
	const previous = previousSession(day, calendar);
	const nav =
		navs.find(
			(row) =>
				row.date === previous &&
				positive(row.value) &&
				Date.parse(row.observedAt) <= now,
		) ?? null;
	const discount = quote && nav ? premium(quote.bid, nav.value) : null;
	const limit = positive(quote?.previousClose)
		? lowerLimit(quote.previousClose)
		: null;
	const result = {
		day,
		minute,
		previous,
		nav,
		discount,
		lowerLimit: limit,
		level: 0,
		state: "waiting",
		message: "等待盘前报价",
		fresh: false,
		basis: "bid1 / previous-session unit NAV - 1",
		confirmedAuctionSignal: false,
	};
	const fail = (state, message) => ({ ...result, state, message });
	if (trading === null)
		return fail("calendar-unknown", "交易日历待更新，暂停条件提示");
	if (!trading) return fail("closed", "今日休市 · 下个交易日继续观察");
	if (minute < "09:15" || minute >= "09:25")
		return fail("outside", "重点观察 09:16 / 09:21");
	if (!quote || quote.code !== CODE) return fail("unavailable", "暂未取得行情");
	const quoteMs = Date.parse(quote.quoteAt);
	const receiveMs = Date.parse(quote.receivedAt);
	if (
		!Number.isFinite(quoteMs) ||
		!Number.isFinite(receiveMs) ||
		now - quoteMs > MAX_AGE_MS ||
		quoteMs > now + 2000 ||
		receiveMs > now + 2000 ||
		quote.tradingDate !== day ||
		beijing(quoteMs).slice(0, 10) !== day
	) {
		return fail("stale", "报价已过期 · 暂停条件提示");
	}
	if (!nav) return fail("nav-missing", "前一交易日净值待更新 · 暂停条件提示");
	if (!positive(quote.bid) || !positive(quote.previousClose) || !limit)
		return fail("unavailable", "买一报价不完整 · 暂停条件提示");
	if (quote.bid < limit - 0.00001 || quote.bid > quote.previousClose * 1.101)
		return fail("invalid", "报价超出正常范围 · 待核对");
	if (Math.abs(quote.bid - limit) < 0.00001)
		return {
			...result,
			fresh: true,
			state: "limit-down",
			message: "买一处于跌停价 · 已排除",
		};
	// This is an observation alert, not a verified auction reference price or an order.
	const level = discount <= -0.05 + 1e-12 ? 5 : 0;
	return {
		...result,
		fresh: true,
		level,
		state: level ? "attention" : "watching",
		message: level ? `参考折价达到 ${level}% · 重点关注` : "参考折价未到 5%",
	};
}

export function pollingDelay(now = Date.now()) {
	const time = beijing(now).slice(11, 19);
	if (
		(time >= "09:15:50" && time <= "09:17:00") ||
		(time >= "09:20:50" && time <= "09:22:00")
	)
		return 1000;
	return time >= "09:14:50" && time < "09:25:05" ? 3000 : 60_000;
}

export function capturePoint(quote, result, now = Date.now()) {
	const clock = beijing(now);
	const quoteMinute = quote
		? beijing(Date.parse(quote.quoteAt)).slice(11, 16)
		: "";
	if (
		!TARGETS.includes(result.minute) ||
		clock.slice(0, 10) !== result.day ||
		clock.slice(11, 16) !== result.minute ||
		quoteMinute !== result.minute ||
		!result.fresh
	)
		return null;
	return {
		date: result.day,
		target: result.minute,
		quoteAt: quote.quoteAt,
		receivedAt: quote.receivedAt,
		bid: quote.bid,
		ask: quote.ask,
		discount: result.discount,
		level: result.level,
		state: result.state,
		nav: result.nav,
		lowerLimit: result.lowerLimit,
		basis: result.basis,
		confirmedAuctionSignal: false,
	};
}

export function mergePoint(history, point) {
	if (!point) return history;
	const key = `${point.date}/${point.target}`;
	const existing = history.find((row) => `${row.date}/${row.target}` === key);
	const first =
		existing?.first && existing.first.quoteAt <= point.quoteAt
			? existing.first
			: point;
	const strongest =
		existing?.strongest && existing.strongest.discount <= point.discount
			? existing.strongest
			: point;
	const trigger = existing?.trigger ?? (point.level === 5 ? point : null);
	const row = {
		date: point.date,
		target: point.target,
		status: "captured",
		first,
		strongest,
		trigger,
	};
	return [
		...history.filter((item) => `${item.date}/${item.target}` !== key),
		row,
	].sort((a, b) =>
		`${b.date}/${b.target}`.localeCompare(`${a.date}/${a.target}`),
	);
}

export function finalizeHistory(history, day, now = Date.now()) {
	const clock = beijing(now);
	const rows = [...history];
	for (const target of TARGETS) {
		if (
			clock.slice(0, 10) !== day ||
			clock.slice(11, 16) <= target ||
			rows.some((row) => row.date === day && row.target === target)
		)
			continue;
		rows.push({
			date: day,
			target,
			status: "missed",
			first: null,
			strongest: null,
		});
	}
	return rows.sort((a, b) =>
		`${b.date}/${b.target}`.localeCompare(`${a.date}/${a.target}`),
	);
}
