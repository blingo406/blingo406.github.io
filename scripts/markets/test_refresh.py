"""Offline regression tests for source semantics and the public export boundary."""
import copy
from contextlib import redirect_stdout, redirect_stderr
from datetime import date
import importlib.util
import json
import io
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile

spec = importlib.util.spec_from_file_location("refresh", Path(__file__).with_name("refresh.py"))
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)
URL = "https://xmsyj.moa.gov.cn/jcyj/example.htm"


class ParsingTests(unittest.TestCase):
    def test_weekly_spans_and_missing_metrics(self):
        rows = refresh.parse_weekly("日期：2026-09-18<p>采集日为9月16日</p><p>全国生猪平均价格<span>15.20</span>元/公斤</p>", URL)
        self.assertEqual(rows, [{"series": "hog", "date": "2026-09-16", "value": 15.2, "published": "2026-09-18", "url": URL}])

    def test_new_year_and_invalid_price(self):
        html = "日期：2026-01-02 采集日为12月31日 全国生猪平均价格15.20元/公斤"
        self.assertEqual(refresh.parse_weekly(html, URL)[0]["date"], "2025-12-31")
        with self.assertRaises(ValueError):
            refresh.parse_weekly(html.replace("15.20", "0"), URL)
        with self.assertRaises(ValueError):
            refresh.parse_weekly(html.replace("采集日为12月31日", ""), URL)

    def test_report_dates_belong_to_adjacent_links(self):
        html = '<ul>2026-09-08<a href="/vCB_AllBulletinDetail?id=1">牧原股份：8月销售简报</a><br>2026-08-21<a href="/vCB_AllBulletinDetail?id=2">牧原股份：2026年半年度报告</a></ul>'
        rows = refresh.parse_muyuan(html, "https://vip.stock.finance.sina.com.cn/")
        self.assertEqual([r["date"] for r in rows], ["2026-09-08", "2026-08-21"])
        self.assertIsNone(refresh.report_type("半年度报告摘要"))

    def test_rss_timezone_and_event_type(self):
        xml = '<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link>https://www.federalreserve.gov/example.htm</link><pubDate>Wed, 16 Sep 2026 14:00:00 -0400</pubDate></item></channel></rss>'
        row = refresh.parse_fed_rss(xml)[0]
        self.assertEqual(row["publishedAt"], "2026-09-16T18:00:00+00:00")
        self.assertEqual(row["type"], "议息声明")

    def test_calendar_cross_month_and_past_filter(self):
        html = '<div class="panel"><div class="panel-heading">2026 FOMC Meetings</div><div class="fomc-meeting"><div class="fomc-meeting__month">April/May</div><div class="fomc-meeting__date">30-1*</div></div></div>'
        self.assertEqual(refresh.parse_fomc(html, date(2026, 1, 1))[0]["date"], "2026-05-01")
        with self.assertRaises(ValueError):
            refresh.parse_fomc(html, date(2026, 6, 1))

    def test_revisions_replace_but_dont_duplicate(self):
        previous = [{"series": "hog", "date": "2026-09-01", "value": 15}]
        incoming = [{"series": "hog", "date": "2026-09-01", "value": 16}]
        self.assertEqual(refresh.merge_records(previous, incoming, ["series", "date"]), incoming)
        self.assertEqual(refresh.merge_records(previous, [], ["series", "date"]), previous)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = json.loads(refresh.SNAPSHOT.read_text(encoding="utf-8"))

    def test_live_snapshot_schema(self):
        refresh.validate_snapshot(self.snapshot)

    def test_private_payload_and_unapproved_host_rejected(self):
        for field, value in [("url", "file:///D:/notes.md"), ("url", "https://unapproved.example/data"), ("private_notes", "secret")]:
            data = copy.deepcopy(self.snapshot)
            data["observations"][0][field] = value
            with self.assertRaises(ValueError):
                refresh.validate_snapshot(data)

    def test_outage_keeps_history_and_marks_failed_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            target = path / "snapshot.json"
            target.write_text(json.dumps(self.snapshot), encoding="utf-8")
            (path / "report-seeds.json").write_text("[]", encoding="utf-8")
            patches = {name: lambda: (_ for _ in ()).throw(RuntimeError("offline fixture")) for name in ["collect_weekly", "collect_dongrui", "collect_muyuan", "collect_fed", "collect_fomc"]}
            with patch.multiple(refresh, DATA=path, SNAPSHOT=target, **patches), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(refresh.main(), 2)
            result = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(result["observations"], self.snapshot["observations"])
            self.assertEqual(result["reports"], self.snapshot["reports"])
            self.assertTrue(all(s["state"] == "error" for s in result["status"]))


if __name__ == "__main__":
    unittest.main()
