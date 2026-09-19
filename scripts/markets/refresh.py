"""Collect external public releases only. No local knowledge-base input exists.

Snapshots are durable, append/replace by stable identity, and atomically written.
An unavailable source keeps its previous records and exposes an error status.
Run from any directory: python scripts/markets/refresh.py
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup
import requests

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "src" / "data" / "markets"
SNAPSHOT = DATA / "snapshot.json"
ALLOWED_HOSTS = {
    "xmsyj.moa.gov.cn", "www.moa.gov.cn", "www.stats.gov.cn",
    "www.dongruifoods.com", "static.cninfo.com.cn", "www.cninfo.com.cn",
    "vip.stock.finance.sina.com.cn", "www.federalreserve.gov",
    "www.bls.gov", "www.bea.gov",
}
WEEKLY_URL = "https://xmsyj.moa.gov.cn/jcyj/index.htm"
FED_CALENDAR = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
BACKFILL_PAGES = 1
METRICS = {
    "hog": ("全国生猪平均价格", "生猪", "元/公斤"),
    "piglet": ("全国仔猪平均价格", "仔猪", "元/公斤"),
    "pork": ("全国猪肉平均价格", "猪肉", "元/公斤"),
    "corn": ("全国玉米平均价格", "玉米", "元/公斤"),
    "soymeal": ("全国豆粕平均价格", "豆粕", "元/公斤"),
    "feed": ("育肥猪配合饲料平均价格", "育肥猪配合饲料", "元/公斤"),
}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_text(url, encoding="utf-8"):
    if urlparse(url).hostname not in ALLOWED_HOSTS:
        raise ValueError("Source host is not allowlisted")
    response = requests.get(url, timeout=(8, 25), headers={
        "User-Agent": "PublicMarketResearch/1.0", "Accept": "text/html,application/xml;q=0.9,*/*;q=0.8",
    })
    response.raise_for_status()
    if urlparse(response.url).hostname not in ALLOWED_HOSTS:
        raise ValueError("Redirect left the source allowlist")
    if len(response.content) > 5_000_000:
        raise ValueError("Unexpectedly large source document")
    return response.content.decode(encoding, errors="replace")


def document_id(value):
    return sha256(value.encode()).hexdigest()[:18]


def parse_weekly(html, url):
    soup = BeautifulSoup(html, "html.parser")
    text = re.sub(r"\s+", "", soup.get_text(" ", strip=True))
    published_match = re.search(r"日期[：:]\s*(20\d{2}-\d{2}-\d{2})", text)
    if not published_match:
        raise ValueError("Weekly release publication date missing")
    published = date.fromisoformat(published_match[1])
    sample = re.search(r"采集日为\s*(\d{1,2})月\s*(\d{1,2})日", text)
    if not sample:
        raise ValueError("Weekly observation date missing")
    year = published.year - (int(sample[1]) > published.month)
    observed = date(year, int(sample[1]), int(sample[2])).isoformat()
    rows = []
    for metric, (phrase, _, _) in METRICS.items():
        found = re.search(re.escape(phrase) + r"\s*([\d.]+)\s*元[/／]公斤", text)
        if found:
            value = float(found[1])
            if not 0 < value < 500:
                raise ValueError(f"Implausible {metric} price")
            rows.append({"series": metric, "date": observed, "value": value,
                         "published": published.isoformat(), "url": url})
    if not any(row["series"] == "hog" for row in rows):
        raise ValueError("Hog price absent from weekly release")
    return rows


def collect_weekly():
    pages = [WEEKLY_URL] + [urljoin(WEEKLY_URL, f"index_{i}.htm") for i in range(1, BACKFILL_PAGES)]
    links = []
    for page_url in pages:
        soup = BeautifulSoup(get_text(page_url), "html.parser")
        links.extend(urljoin(page_url, a.get("href", "")) for a in soup.find_all("a")
            if "畜产品和饲料集贸市场价格情况" in a.get_text())
    links = list(dict.fromkeys(links))
    if not links:
        raise ValueError("No weekly release links")
    rows, failures = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(lambda u: parse_weekly(get_text(u), u), url): url for url in links}
        for future in as_completed(futures):
            try:
                rows.extend(future.result())
            except Exception:
                failures.append(futures[future])
    if not rows:
        raise ValueError("All weekly releases failed")
    return {"observations": rows, "warning": f"{len(failures)} 篇周报未读取，已保留历史值" if failures else None}


def report_type(title):
    if any(word in title for word in ["摘要", "英文", "审计", "审核"]):
        return None
    if re.search(r"(年度|半年度|季度)报告", title):
        return "定期报告"
    if "销售" in title and ("简报" in title or "情况" in title):
        return "销售简报"
    if "投资者关系活动记录" in title:
        return "投资者关系"
    return None


def parse_dongrui(html, page_url):
    soup = BeautifulSoup(html, "html.parser")
    reports = []
    for a in soup.find_all("a", href=True):
        title = a.get_text(" ", strip=True)
        kind = report_type(title)
        matched = re.search(r"(20\d{2}-\d{2}-\d{2})", title)
        href = urljoin(page_url, a["href"])
        if kind and matched and urlparse(href).hostname == "www.dongruifoods.com":
            title = title.replace(matched[1], "").strip()
            reports.append({"id": document_id(href), "company": "001201", "companyName": "东瑞股份",
                "title": title, "date": matched[1], "type": kind, "url": href,
                "source": "东瑞股份官网", "origin": "issuer"})
    return reports


def collect_dongrui():
    reports = []
    for page in ["27", "81", "80"]:
        url = "https://www.dongruifoods.com/investor/" + page
        reports.extend(parse_dongrui(get_text(url), url))
    if not reports:
        raise ValueError("No company report links parsed")
    return {"reports": reports}


def collect_muyuan():
    # Issuer text republished by Sina is explicitly labelled as a mirror.
    url = "https://vip.stock.finance.sina.com.cn/corp/go.php/vCB_AllBulletin/stockid/002714.phtml"
    reports = []
    visited = set()
    for _ in range(3):
        if url in visited:
            break
        visited.add(url)
        html = get_text(url, "gb18030")
        reports.extend(parse_muyuan(html, url))
        soup = BeautifulSoup(html, "html.parser")
        next_link = soup.find("a", string=re.compile("下一页"))
        if not next_link or not next_link.get("href"):
            break
        url = urljoin(url, next_link["href"]).replace("http://", "https://", 1)
    if not reports:
        raise ValueError("Announcement mirror layout unavailable")
    return {"reports": reports}


def parse_muyuan(html, url):
    soup = BeautifulSoup(html, "html.parser")
    reports = []
    for a in soup.find_all("a", href=True):
        title = a.get_text(" ", strip=True)
        kind = report_type(title)
        if not kind or "vCB_AllBulletinDetail" not in a["href"]:
            continue
        # This source puts dates in a text node immediately before each link,
        # all inside one ul. Reading the parent would select another report's date.
        text = str(a.previous_sibling or "")
        matched = re.search(r"(20\d{2}-\d{2}-\d{2})", text)
        if not matched:
            continue
        href = urljoin(url, a["href"])
        reports.append({"id": document_id(href), "company": "002714", "companyName": "牧原股份",
            "title": title, "date": matched[1], "type": kind, "url": href,
            "source": "新浪财经·公司公告转载", "origin": "mirror"})
    return reports


def parse_fed_rss(xml):
    root = ET.fromstring(xml)
    rows = []
    for item in root.findall("./channel/item"):
        title, url = item.findtext("title", ""), item.findtext("link", "")
        timestamp = parsedate_to_datetime(item.findtext("pubDate")).astimezone(timezone.utc).isoformat()
        kind = "政策公告"
        if "FOMC statement" in title:
            kind = "议息声明"
        elif "projections" in title.lower():
            kind = "经济预测"
        elif "minutes" in title.lower():
            kind = "会议纪要"
        rows.append({"id": document_id(url), "title": title, "type": kind,
            "institution": "美联储", "publishedAt": timestamp, "date": timestamp[:10],
            "url": url, "state": "released", "source": "Federal Reserve"})
    if not rows:
        raise ValueError("Empty Fed feed")
    return rows


def collect_fed():
    return {"events": parse_fed_rss(get_text("https://www.federalreserve.gov/feeds/press_monetary.xml"))}


def parse_fomc(html, today):
    soup = BeautifulSoup(html, "html.parser")
    events = []
    for panel in soup.select(".panel"):
        heading = panel.select_one(".panel-heading")
        year_match = re.search(r"(20\d{2})", heading.get_text() if heading else "")
        if not year_match or int(year_match[1]) < today.year:
            continue
        year = int(year_match[1])
        for meeting in panel.select(".fomc-meeting"):
            month_el, day_el = meeting.select_one(".fomc-meeting__month"), meeting.select_one(".fomc-meeting__date")
            if not month_el or not day_el:
                continue
            month_text, day_text = month_el.get_text(strip=True), day_el.get_text(strip=True)
            if "/" in month_text:
                month_text = month_text.split("/")[-1]
            days = re.findall(r"\d+", day_text)
            if not days:
                continue
            month = datetime.strptime(month_text, "%B").month
            end = date(year, month, int(days[-1]))
            if end < today:
                continue
            events.append({"id": f"fomc-{end}", "title": "FOMC 议息会议", "type": "议息日程",
                "institution": "美联储", "date": end.isoformat(), "publishedAt": None,
                "url": FED_CALENDAR, "state": "scheduled", "source": "Federal Reserve",
                "note": f"美国东部日期，{month_text} {day_text}；以官网最新安排为准"})
    if not events:
        raise ValueError("No upcoming FOMC meetings parsed")
    return events


def collect_fomc():
    return {"calendar": parse_fomc(get_text(FED_CALENDAR), date.today())}


def merge_records(previous, incoming, keys):
    merged = {tuple(row[k] for k in keys): row for row in previous}
    for row in incoming:
        merged[tuple(row[k] for k in keys)] = row
    return sorted(merged.values(), key=lambda row: (row.get("date", ""), row.get("id", "")))


def validate_snapshot(snapshot):
    allowed_top = {"schemaVersion", "generatedAt", "observations", "reports", "events", "calendar", "status"}
    if set(snapshot) != allowed_top:
        raise ValueError("Unexpected public snapshot fields")
    if snapshot["schemaVersion"] != 1:
        raise ValueError("Unsupported snapshot schema")
    datetime.fromisoformat(snapshot["generatedAt"])
    allowed_fields = {
        "observations": {"series", "date", "value", "published", "url"},
        "reports": {"id", "company", "companyName", "title", "date", "type", "url", "source", "origin"},
        "events": {"id", "title", "type", "institution", "publishedAt", "date", "url", "state", "source"},
        "calendar": {"id", "title", "type", "institution", "publishedAt", "date", "url", "state", "source", "note"},
    }
    for table, fields in allowed_fields.items():
        for row in snapshot[table]:
            if set(row) != fields or urlparse(row["url"]).hostname not in ALLOWED_HOSTS or urlparse(row["url"]).scheme != "https":
                raise ValueError(f"Non-public or unexpected {table} data")
            date.fromisoformat(row["date"])
            if table != "calendar" and row["date"] > date.today().isoformat():
                raise ValueError("Future publication or observation")
    for row in snapshot["observations"]:
        if row["series"] not in METRICS or not isinstance(row["value"], (int, float)) or not 0 < row["value"] < 500:
            raise ValueError("Invalid observation")
        if date.fromisoformat(row["published"]) < date.fromisoformat(row["date"]):
            raise ValueError("Observation follows its publication")
    for row in snapshot["status"]:
        if set(row) != {"id", "state", "checkedAt", "lastSuccessAt", "count", "message"}:
            raise ValueError("Unexpected status fields")
        if row["id"] not in {"moa_weekly", "dongrui", "muyuan", "fed_rss", "fomc"} or row["state"] not in {"ok", "partial", "error"}:
            raise ValueError("Unknown source status")
    text = json.dumps(snapshot, ensure_ascii=False)
    if re.search(r"好人豆子|做多中国|全文转写|要点笔记|file://|[A-Za-z]:\\", text):
        raise ValueError("Private content marker rejected")


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    previous = json.loads(SNAPSHOT.read_text(encoding="utf-8")) if SNAPSHOT.exists() else {}
    snapshot = {"schemaVersion": 1, "generatedAt": now(), **{key: previous.get(key, []) for key in ["observations", "reports", "events", "calendar", "status"]}}
    seeds = json.loads((DATA / "report-seeds.json").read_text(encoding="utf-8"))
    snapshot["reports"] = merge_records(snapshot["reports"], seeds, ["id"])
    old_status = {row["id"]: row for row in snapshot["status"]}
    statuses = []
    collectors = {"moa_weekly": collect_weekly, "dongrui": collect_dongrui, "muyuan": collect_muyuan, "fed_rss": collect_fed, "fomc": collect_fomc}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(fn): source for source, fn in collectors.items()}
        for future in as_completed(futures):
            source = futures[future]
            checked = now()
            try:
                result = future.result()
                count = 0
                for table in ["observations", "reports", "events", "calendar"]:
                    if table in result:
                        incoming = result[table]
                        count += len(incoming)
                        # Upcoming meetings are a current schedule: replace after a
                        # successful fetch so moved/cancelled meetings disappear.
                        snapshot[table] = incoming if table == "calendar" else merge_records(snapshot[table], incoming, ["series", "date"] if table == "observations" else ["id"])
                statuses.append({"id": source, "state": "partial" if result.get("warning") else "ok", "checkedAt": checked, "lastSuccessAt": checked, "count": count, "message": result.get("warning") or "更新成功"})
            except Exception as exc:
                # Do not export response bodies or local exception paths.
                statuses.append({"id": source, "state": "error", "checkedAt": checked,
                    "lastSuccessAt": old_status.get(source, {}).get("lastSuccessAt"), "count": 0,
                    "message": "来源暂不可用，保留上次有效数据；可直接访问原始网站"})
                print(f"{source}: {type(exc).__name__}: {exc}", file=sys.stderr)
    snapshot["status"] = sorted(statuses, key=lambda item: item["id"])
    snapshot["calendar"] = [row for row in snapshot["calendar"] if row["date"] >= date.today().isoformat()]
    validate_snapshot(snapshot)
    serialized = json.dumps(snapshot, ensure_ascii=False, indent="\t") + "\n"
    temporary = SNAPSHOT.with_suffix(".tmp")
    temporary.write_text(serialized, encoding="utf-8")
    temporary.replace(SNAPSHOT)
    print(json.dumps({"observations": len(snapshot["observations"]), "reports": len(snapshot["reports"]), "events": len(snapshot["events"]), "calendar": len(snapshot["calendar"]), "status": statuses}, ensure_ascii=False))
    # Distinguish a valid stale snapshot from a parsing/export validation error.
    return 2 if all(row["state"] == "error" for row in statuses) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill-pages", type=int, default=1, choices=range(1, 26))
    BACKFILL_PAGES = parser.parse_args().backfill_pages
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
