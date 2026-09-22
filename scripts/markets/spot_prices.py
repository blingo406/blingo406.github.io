"""Keep daily spot quotes and official ten-day averages as separate series."""
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

DAILY_URL = "https://zhujia.zhuwang.com.cn/"
NBS_URL = "https://www.stats.gov.cn/sj/zxfb/"


def parse_daily(html, url=DAILY_URL):
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.select_one(".nationalprice")
    if not heading or "全国" not in heading.get_text():
        raise ValueError("National daily quote absent")
    stamp = re.search(r"(20\d{2})/(\d{1,2})/(\d{1,2})", heading.get_text())
    if not stamp:
        raise ValueError("Daily observation date absent")
    observed = date(*map(int, stamp.groups())).isoformat()
    # Read the labelled quote card, never the first price in arbitrary page text.
    for node in soup.select(".value-box"):
        card = node.parent.parent.parent
        if "生猪(外三元)" in card.get_text() and "/公斤" in card.get_text():
            value = float(node.get_text(strip=True))
            if not 0 < value < 100:
                raise ValueError("Implausible spot quote")
            return [{"series": "hog_spot", "date": observed, "value": value,
                     "published": observed, "url": url}]
    raise ValueError("External three-way crossbreed quote absent")


def parse_nbs(html, url):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text() if soup.title else ""
    period = re.search(r"(20\d{2})年(\d{1,2})月([上中下])旬流通领域", title)
    if not period:
        raise ValueError("NBS reporting period missing")
    year, month = int(period[1]), int(period[2])
    day = {"上": 10, "中": 20, "下": monthrange(year, month)[1]}[period[3]]
    published = re.search(r"(20\d{2})[/-](\d{2})[/-](\d{2})\s+\d{2}:\d{2}", soup.get_text(" ", strip=True))
    if not published:
        raise ValueError("NBS publication date missing")
    for tr in soup.select("tr"):
        cells = [re.sub(r"\s+", "", td.get_text()) for td in tr.find_all("td")]
        if len(cells) == 5 and cells[0].replace("（", "(").replace("）", ")") == "生猪(外三元)":
            if cells[1] not in {"千克", "公斤"}:
                raise ValueError("NBS unit changed")
            value = float(cells[2])
            if not 0 < value < 100:
                raise ValueError("Implausible ten-day price")
            return [{"series": "hog_nbs", "date": date(year, month, day).isoformat(),
                     "value": value, "published": date(*map(int, published.groups())).isoformat(), "url": url}]
    raise ValueError("NBS hog price absent")


def collect_nbs(get_text, backfill=False):
    first = get_text(NBS_URL)
    count = re.search(r'createPageHTML\((\d+),', first)
    pages = min(int(count[1]), 200) if backfill and count else 1
    links, failures = set(), []

    def index_links(html, base):
        return {urljoin(base, a["href"]) for a in BeautifulSoup(html, "html.parser").select("a[href]")
                if "旬流通领域重要生产资料市场价格变动情况" in a.get_text()}

    links.update(index_links(first, NBS_URL))
    with ThreadPoolExecutor(max_workers=3) as pool:
        pending = {pool.submit(get_text, urljoin(NBS_URL, f"index_{i}.html")): i for i in range(1, pages)}
        for future in as_completed(pending):
            try:
                links.update(index_links(future.result(), NBS_URL))
            except Exception:
                failures.append(f"index {pending[future]}")
        pending = {pool.submit(lambda u: parse_nbs(get_text(u), u), u): u for u in links}
        rows = []
        for future in as_completed(pending):
            try:
                rows.extend(future.result())
            except Exception:
                failures.append(pending[future])
    if not rows:
        raise ValueError("No NBS hog prices collected")
    if failures:
        print("NBS missing:", failures)
    return {"observations": rows, "warning": f"{len(failures)} 项统计局资料未读取，历史值保留" if failures else None}
