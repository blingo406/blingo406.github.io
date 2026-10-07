# 工银黄金股 ETF 盘前观察

The active page is <https://market-observation.blingo406.workers.dev/strategies/> in the independent `D:\MarketObservation` project. It is named `指标检测` and displays a compact `黄金股ETF套利` card with a status badge. Click the badge to enable sound and desktop notifications. The blog retains one Links entry and redirects all former observation pages. The research article remains under `策略分析`; its rules and records are preserved. The page does not display or save observation history; browser storage contains only alert deduplication keys. Alerts have **one threshold, 5%**, at Beijing 09:16 and 09:21. No 6% escalation, order routing, or shutdown task is configured. This directory and its manual workflow are migration archives.

## Meaning of an alert

The current observable is **bid1 / previous exchange session official unit NAV − 1**. Neither Eastmoney nor Tencent bid1 has been verified as the pre-auction indicative matching price. The page therefore labels all alerts as reference-discount observations requiring confirmation in trading software. It never sets `confirmedAuctionSignal` to true. No historical 09:16/09:21 data are reconstructed from daily prices.

Checks shared by collector and page: symbol, exchange date, quote timestamp no more than 15 seconds old, no future timestamp beyond two seconds, valid previous-session NAV observed by decision time, positive quote, reasonable price range, and exclusion of bid1 exactly at the 10% lower limit rounded half-up to a 0.001-yuan tick. IOPV is not used to trigger; no independent pre-auction IOPV timestamp was available.

## Run

Node 22+, no package installation required:

```
node --test scripts/gold-etf/test-*.mjs
node scripts/gold-etf/collect.mjs --once
node scripts/gold-etf/collect.mjs --watch
```

The collector writes only `public/data/gold-etf/state.json`. It preserves prior captures. Each target minute stores its first valid observation, deepest observed reference discount, and first eligible 5% trigger. A later limit-down quote does not erase the earlier trigger. A late or failed run records missed slots and never fills them with a different minute's quote. The public JSON contains no local paths, portfolio data, tokens, or account identifiers.

## Data health

NAV requests retry up to three times, each with a five-second timeout and one-/two-second backoff. HTTP status, parse failures and connection failures remain in the run log, job summary and public source status. A temporary NAV refresh failure retains the original dated values; it does not change `navStatus` to `ok`.

Monitoring remains usable with a cached NAV only when its date is the exact previous exchange session, its value is positive and it was observed before the current check. This includes a holiday run with the last valid session's NAV. Such a run reports degraded health and a warning. Missing/old/future-observed references, quote outages, expired calendars and required missed capture slots still fail health. Auction alert conditions are unchanged.

## Timing

- Page: concurrent public-feed requests, no overlapping cycles, timeout 3.5 seconds. Target cadence is one second at 09:15:50–09:17:00 and 09:20:50–09:22:00; three seconds otherwise during the auction. Failed requests back off to 15 seconds. Timezone logic uses UTC+8 explicitly.
- Browser sound and Notification permission require a click. Notifications deduplicate by date/target/5%; page must remain open. Screen wake lock is requested when supported. Browser sleep/background throttling and upstream delay remain possible.
- Automatic collection now uses the independent Worker and D1. NAV checks run every five minutes, with minute sampling at 09:15–09:25. The GitHub workflow has no schedule and is retained for manual archive diagnostics. Calendar filters exchange holidays, including weekend makeup workdays. Known calendar ends 2026-12-31; after that alerts fail closed until the next exchange calendar is added.
- The active page reads `/api/gold/state` on the independent site. Both reference and quote retain their actual dates. A missing previous-session NAV suppresses alerts. Data updates do not require Git commits or a blog rebuild.
- Background minute sampling is best effort and may miss the target observation minute. Immediate on-page warnings use the browser's public quote feed, with a same-site API fallback. A missed slot is not reconstructed from another minute.

## Verify deployment

For the active deployment, inspect the independent `/api/health`, `/api/gold/state`, Cron logs and page. The old workflow may be run manually to diagnose the archived Node collector. Off-market connectivity verifies only access and parsing; the first real trading session must establish whether bid1 provides useful auction observations. Do not report a real-time auction feed as verified from a holiday test.

Research table/CSV provenance is the locally frozen 2026-10-04 entry-limit-down variant through 2026-09-30. Only whitelisted results were exported; minute-matched tables use 26 and 13 records, respectively.
