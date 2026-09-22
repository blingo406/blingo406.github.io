import copy
from datetime import datetime, timezone
import json
import unittest
from unittest.mock import patch

import refresh
from fed_meetings import parse_decision, parse_projection, collect_meetings
from spot_prices import parse_daily, parse_nbs


class HistoryTests(unittest.TestCase):
    def test_chinese_daily_quote_after_utc_midnight_boundary(self):
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 9, 22, 17, tzinfo=timezone.utc).astimezone(tz)
        data = json.loads(refresh.SNAPSHOT.read_text(encoding="utf-8"))
        row = next(r for r in data["observations"] if r["series"] == "hog_spot")
        row["date"] = row["published"] = "2026-09-23"
        with patch.object(refresh, "datetime", Clock):
            refresh.validate_snapshot(data)
            row["date"] = row["published"] = "2026-09-24"
            with self.assertRaises(ValueError):
                refresh.validate_snapshot(data)

    def test_no_historical_deletion_and_revision_preserved(self):
        row = {"series": "hog", "date": "2014-09-03", "published": "2014-09-11", "value": 14.98, "url": "https://www.moa.gov.cn/example.htm"}
        revised = {**row, "value": 15}
        old = {"observations": [row], "reports": [], "events": [], "meetings": [], "revisions": []}
        current = copy.deepcopy(old)
        current["observations"] = refresh.merge_records([row], [revised], ["series", "date"])
        current["revisions"] = refresh.preserve_observation_revisions([row], [revised], [])
        self.assertEqual(current["revisions"][0]["value"], 14.98)
        self.assertEqual(refresh.preserve_observation_revisions([row], [revised], current["revisions"]), current["revisions"])
        refresh.validate_retention(old, current)
        current["observations"] = []
        with self.assertRaises(ValueError):
            refresh.validate_retention(old, current)

    def test_daily_national_scope_date_and_crossbreed(self):
        html = '<div class="nationalprice">全国 2026/9/22</div><article>生猪(外三元)<div><div><div class="value-box">10.65</div><span>/公斤</span></div></div></article>'
        self.assertEqual(parse_daily(html)[0]["value"], 10.65)
        self.assertEqual(parse_daily(html)[0]["date"], "2026-09-22")
        for invalid in [html.replace("全国", "江西省"), html.replace("外三元", "内三元"), html.replace("/公斤", "/吨")]:
            with self.assertRaises(ValueError):
                parse_daily(invalid)

    def test_nbs_observation_is_period_end_not_publication(self):
        html = '<title>2024年2月下旬流通领域重要生产资料市场价格变动情况</title><p>2024/03/04 09:30</p><table><tr><td>生猪（外三元）</td><td>千克</td><td>14.3</td><td>-0.1</td><td>-0.7</td></tr></table>'
        row = parse_nbs(html, "https://www.stats.gov.cn/example.html")[0]
        self.assertEqual((row["date"], row["published"], row["value"]), ("2024-02-29", "2024-03-04", 14.3))

    def test_fomc_mixed_fractions_and_action(self):
        url = "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm"
        html = '<p>The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent.</p>'
        row = parse_decision(html, url)
        self.assertEqual((row["action"], row["targetLower"], row["targetUpper"], row["changeBasisPoints"]), ("加息", 3.75, 4, 25))
        self.assertEqual(parse_decision(html.replace("raise", "lower"), url)["action"], "降息")
        self.assertEqual(parse_decision('<p>The Committee decided to maintain the target range for the federal funds rate at 0 to 1/4 percent.</p>', url)["targetUpper"], 0.25)

    def test_negative_projection_and_missing_distribution(self):
        html = '<table><tr><th>Midpoint of target range or target level (Percent)</th><th>2015</th><th>Longer Run</th></tr><tr><td>-0.125</td><td>1</td><td></td></tr><tr><td>0.125</td><td>16</td><td>17</td></tr></table>'
        projection = parse_projection(html, "https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20150917.htm")
        self.assertEqual(projection["dots"][0]["rate"], -0.125)
        with self.assertRaises(ValueError):
            parse_projection(html.replace('<td>17</td>', '<td></td>'), projection["url"])

    def test_projection_cannot_belong_to_another_meeting(self):
        data = json.loads(refresh.SNAPSHOT.read_text(encoding="utf-8"))
        row = next(m for m in data["meetings"] if m["projection"])
        row["projection"]["url"] = 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl19990301.htm'
        with self.assertRaises(ValueError):
            refresh.validate_snapshot(data)

    def test_non_sep_meeting_does_not_borrow_previous_plot(self):
        cal = '<a href="/newsevents/pressreleases/monetary20260128a.htm">HTML</a>'
        html = '<title>Federal Reserve issues FOMC statement</title><p>The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent.</p>'
        result = collect_meetings(lambda url: cal if 'calendars' in url else html, [])
        self.assertEqual(result['meetings'][0]['projectionState'], 'none')
        self.assertIsNone(result['meetings'][0]['projection'])


if __name__ == "__main__":
    unittest.main()
