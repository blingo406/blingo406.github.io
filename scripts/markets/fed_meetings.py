"""FOMC decisions and same-meeting SEP distributions from Federal Reserve releases."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from fractions import Fraction
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

CALENDAR = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"


def rate_number(text):
    text = text.strip().replace("¼", "1/4").replace("½", "1/2").replace("¾", "3/4")
    parts = re.split(r"[-\s]+", text)
    return sum(float(Fraction(part)) for part in parts if part)


def parse_decision(html, url):
    stamp = re.search(r"monetary(\d{8})[a-z]?\.htm", url)
    if not stamp:
        raise ValueError("Statement date absent")
    when = date.fromisoformat(stamp[1]).isoformat()
    soup = BeautifulSoup(html, "html.parser")
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).replace("–", "-").replace("‑", "-")
    # Longest alternatives first avoids reading 1/4 as 1. The selected clause
    # must mention the federal funds target, not inflation or a forecast.
    number = r"(?:\d+[- ]\d/\d|\d/\d|\d+(?:\.\d+)?)"
    clauses = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
    candidates = [s for s in clauses if "target range" in s.lower() and "federal funds" in s.lower()]
    chosen, bounds = None, None
    for sentence in candidates:
        matches = list(re.finditer(rf"({number})\s+to\s+({number})\s+percent", sentence))
        if matches:
            chosen, bounds = sentence, matches[-1]
            if re.search(r"decided|maintain|keep|reaffirm|current", sentence, re.I):
                break
    if not bounds:
        raise ValueError("Unrecognized federal funds target range")
    low, high = rate_number(bounds[1]), rate_number(bounds[2])
    if not 0 <= low < high <= 25 or high - low > 1:
        raise ValueError("Implausible target range")
    action = "维持"
    if re.search(r"\b(raise|increase)\b.{0,80}target range", chosen, re.I):
        action = "加息"
    elif re.search(r"\b(lower|reduce|cut)\b.{0,80}target range", chosen, re.I):
        action = "降息"
    elif not re.search(r"maintain|keep|reaffirm|current|remains|unchanged", chosen, re.I):
        raise ValueError("Unrecognized policy action")
    change = re.search(rf"\bby\s+({number})\s+percentage point", chosen, re.I)
    bps = round(rate_number(change[1]) * 100) if change else (0 if action == "维持" else None)
    movement = action + (f" {bps} 个基点" if bps else "利率不变" if action == "维持" else "")
    return {"id": f"fomc-{when}", "date": when, "url": url,
            "action": action, "targetLower": low, "targetUpper": high,
            "changeBasisPoints": bps, "summary": f"{movement}，联邦基金利率目标区间为 {low:g}%–{high:g}%。",
            "projectionState": "none", "projection": None}


def parse_projection(html, url):
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        rows = [[cell.get_text(" ", strip=True) for cell in tr.find_all(["td", "th"])] for tr in table.find_all("tr")]
        if not rows:
            continue
        header = " ".join(rows[0]).lower()
        if not ("midpoint of target range" in header or "target federal funds rate at year-end" in header or "target federal funds rate or target range" in header):
            continue
        periods = [re.sub(r"\s+", " ", v).strip() for v in rows[0][1:]]
        if not periods or any(not re.fullmatch(r"20\d{2}|Longer [Rr]un", p) for p in periods):
            raise ValueError("Unrecognized projection periods")
        dots = []
        for cells in rows[1:]:
            if len(cells) != len(periods) + 1:
                raise ValueError("Projection table width changed")
            rate = float(cells[0])
            if not -5 <= rate <= 25:
                raise ValueError("Implausible projected rate")
            for period, count in zip(periods, cells[1:]):
                if count in ["", "-", "—"]:
                    continue
                if not count.isdigit() or not 0 <= int(count) <= 25:
                    raise ValueError("Invalid participant count")
                if int(count):
                    dots.append({"period": period, "rate": rate, "count": int(count)})
        for period in periods:
            if not 5 <= sum(d["count"] for d in dots if d["period"] == period) <= 25:
                raise ValueError("Incomplete projection distribution")
        return {"url": url, "periods": periods, "dots": dots}
    raise ValueError("Dot plot table missing")


def collect_meetings(get_text, previous, backfill=False):
    pages = [(CALENDAR, get_text(CALENDAR))]
    if backfill:
        current_years = [int(y) for y in re.findall(r'monetary(20\d{2})\d{4}a\.htm', pages[0][1])]
        for year in range(2014, min(current_years)):
            url = f"https://www.federalreserve.gov/monetarypolicy/fomchistorical{year}.htm"
            pages.append((url, get_text(url)))
    statements, projections, conferences = {}, {}, {}
    for base, html in pages:
        for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
            url = urljoin(base, a["href"])
            match = re.search(r"/(monetary|fomcprojtabl|fomcpresconf)(\d{8})(a?)\.htm$", url)
            if not match or match[2] > date.today().strftime("%Y%m%d"):
                continue
            kind, stamp = match[1], match[2]
            if kind == "monetary" and match[3] == "a":
                # Other monetary releases (facilities, strategy reviews) are
                # not rate decisions. Follow only the calendar's statements.
                if a.get_text(" ", strip=True).lower() in {"statement", "html"}:
                    statements[stamp] = url
            elif kind == "fomcprojtabl":
                projections[stamp] = url
            elif kind == "fomcpresconf":
                conferences[stamp] = url
    old = {row["date"].replace("-", ""): row for row in previous}
    # Recheck recent decisions; immutable older records do not need repeated I/O.
    latest = sorted(statements)[-2:]
    needed = {k: v for k, v in statements.items() if backfill or k not in old or k in latest or old[k]["projectionState"] == "error"}
    failures = []

    def collect(item):
        stamp, url = item
        html = get_text(url)
        page = BeautifulSoup(html, "html.parser")
        if page.title and "fomc statement" not in page.title.get_text().lower():
            if re.search(r"facility|facilities|strategy|longer-run", page.title.get_text(), re.I):
                return None
            raise ValueError("Unexpected statement page title")
        record = parse_decision(html, url)
        projection_url = projections.get(stamp)
        # Earlier calendars link projections from the press conference page.
        if not projection_url and stamp in conferences:
            try:
                soup = BeautifulSoup(get_text(conferences[stamp]), "html.parser")
                for a in soup.find_all("a", href=True):
                    if f"fomcprojtabl{stamp}.htm" in a["href"]:
                        projection_url = urljoin(conferences[stamp], a["href"])
                        break
            except Exception:
                record["projectionState"] = "error"
        if projection_url:
            try:
                record["projection"] = parse_projection(get_text(projection_url), projection_url)
                record["projectionState"] = "available"
            except Exception:
                record["projectionState"] = "error"
        if record["projectionState"] == "error" and old.get(stamp, {}).get("projection"):
            record["projection"] = old[stamp]["projection"]
        return record

    records = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {k: pool.submit(collect, (k, v)) for k, v in needed.items()}
        for stamp, future in futures.items():
            try:
                row = future.result()
                if row is None:
                    continue
                records.append(row)
                if row["projectionState"] == "error":
                    failures.append(stamp + ": projection")
            except Exception as exc:
                failures.append(stamp + ": " + str(exc))
    if not records and not previous:
        raise ValueError("No FOMC decisions collected")
    if failures:
        print("FOMC incomplete:", failures)
    return {"meetings": records, "warning": f"{len(failures)} 项会议资料暂未读取，已有资料保留" if failures else None}
