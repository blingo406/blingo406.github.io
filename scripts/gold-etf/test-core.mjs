import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { assess, capturePoint, finalizeHistory, isTradingDay, lowerLimit, mergePoint, parseQuote, parseTencent, pollingDelay, premium, previousSession, thresholdPrice } from "../../src/lib/gold-etf-core.mjs";
const calendar = JSON.parse(fs.readFileSync(new URL("../../src/data/gold-etf/calendar.json", import.meta.url)));
const now = Date.parse("2026-10-08T09:16:01+08:00");
const navs = [{ date: "2026-09-30", value: 1.5393, observedAt: "2026-10-08T09:14:00+08:00" }];
const payload = { rc: 0, data: { diff: [{ f12: "159315", f31: 1.462, f32: 1.463, f2: 1.537, f17: "-", f18: 1.537, f124: (now - 1000) / 1000, f297: 20261008, f441: 1.5362 }] } };
const quote = () => parseQuote(payload, new Date(now).toISOString());
test("price/NAV sign, exact threshold and legal ticks", () => {
  assert.equal(premium(0.95, 1), -0.050000000000000044);
  assert.equal(premium(0, 1), null);
  assert.equal(lowerLimit(1.365), 1.229);
  assert.equal(lowerLimit(2.573), 2.316);
  assert.equal(thresholdPrice(1.5393, 5), 1.462);
});
test("China holiday calendar does not treat makeup workdays as trading days", () => {
  assert.equal(isTradingDay("2026-10-01", calendar), false);
  assert.equal(isTradingDay("2026-10-08", calendar), true);
  assert.equal(isTradingDay("2026-10-10", calendar), false);
  assert.equal(isTradingDay("2027-01-04", calendar), null);
  assert.equal(previousSession("2026-10-08", calendar), "2026-09-30");
});
test("5 percent alert is observation only; 6 percent never escalates", () => {
  const result = assess(quote(), navs, calendar, now);
  assert.equal(result.level, 5);
  assert.equal(result.confirmedAuctionSignal, false);
  assert.equal(assess({ ...quote(), bid: 1.44 }, navs, calendar, now).level, 5);
});
test("stale, future, missing, wrong symbol and incomplete NAV fail closed", () => {
  for (const value of [null, { ...quote(), code: "159321" }, { ...quote(), bid: 0 }, { ...quote(), quoteAt: new Date(now - 16000).toISOString() }, { ...quote(), quoteAt: new Date(now + 5000).toISOString() }, { ...quote(), tradingDate: "2026-09-30" }]) assert.equal(assess(value, navs, calendar, now).level, 0);
  assert.equal(assess(quote(), [{ ...navs[0], date: "2026-09-29" }], calendar, now).level, 0);
  assert.equal(assess(quote(), [{ ...navs[0], observedAt: "2026-10-08T10:00:00+08:00" }], calendar, now).level, 0);
  assert.throws(() => parseQuote({ rc: 0, data: { diff: [{ f12: "159321" }] } }));
});
test("limit-down quote excluded, one tick above retained", () => {
  const limit = lowerLimit(quote().previousClose);
  assert.equal(assess({ ...quote(), bid: limit }, navs, calendar, now).state, "limit-down");
  assert.equal(assess({ ...quote(), bid: limit + 0.001 }, navs, calendar, now).level, 5);
});
test("capture requires quote itself in target minute, preserves first and strongest", () => {
  const result = assess(quote(), navs, calendar, now);
  const point = capturePoint(quote(), result, now);
  assert.ok(point);
  const older = { ...quote(), quoteAt: "2026-10-08T09:15:59+08:00" };
  assert.equal(capturePoint(older, assess(older, navs, calendar, now), now), null);
  const history = mergePoint(mergePoint([], point), { ...point, quoteAt: new Date(now + 1000).toISOString(), discount: -0.08 });
  assert.equal(history.length, 1);
  assert.equal(history[0].first.quoteAt, point.quoteAt);
  assert.equal(history[0].strongest.discount, -0.08);
  assert.equal(finalizeHistory(history, "2026-10-08", now + 7 * 60000).find((r) => r.target === "09:16").status, "captured");
  assert.equal(finalizeHistory([], "2026-10-08", now + 7 * 60000).length, 2);
});
test("one second target polling is independent of local timezone", () => {
  assert.equal(pollingDelay(now), 1000);
  assert.equal(pollingDelay(Date.parse("2026-10-08T09:21:00+08:00")), 1000);
  assert.equal(pollingDelay(Date.parse("2026-10-08T09:18:00+08:00")), 3000);
  assert.equal(pollingDelay(Date.parse("2026-10-08T10:00:00+08:00")), 60000);
});
test("earlier valid alert is preserved even if price later reaches limit down", () => {
  const point = capturePoint(quote(), assess(quote(), navs, calendar, now), now);
  const history = mergePoint(mergePoint([], point), { ...point, quoteAt: new Date(now + 4000).toISOString(), level: 0, discount: -0.1, state: "limit-down" });
  assert.equal(history[0].trigger.level, 5);
  assert.equal(history[0].strongest.state, "limit-down");
  assert.equal(history[0].first.receivedAt, point.receivedAt);
});
test("Tencent fallback reads bid, previous close and exchange time, never guesses IOPV", () => {
  const fields = Array(31).fill("");
  Object.assign(fields, { 2: "159315", 3: "1.537", 4: "1.537", 5: "0", 9: "1.462", 19: "1.463", 30: "20261008091600" });
  const parsed = parseTencent(`v_sz159315="${fields.join("~")}";`);
  assert.equal(parsed.bid, 1.462);
  assert.equal(parsed.previousClose, 1.537);
  assert.equal(parsed.quoteAt, "2026-10-08T01:16:00.000Z");
  assert.equal(parsed.iopv, null);
  assert.equal(parsed.open, null);
  assert.throws(() => parseTencent('v_sz159321="bad";'));
});
