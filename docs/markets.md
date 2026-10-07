# 市场观察站与博客入口

独立站：<https://market-observation.blingo406.workers.dev/>。项目位于 `D:\MarketObservation`，单独托管在 Cloudflare Workers，使用 D1 保存公开数据。博客只在现有 Links 菜单保留一个「市场观察站」链接，首页没有数据卡片或数据／策略栏目。

博客原有 `/research/`、`/research/markets/*/`、`/research/strategies/`、`/markets/*/` 和 `/strategies/` 页面保留跳转，分别对应独立站总览、数据页面和策略工具。黄金股 ETF 文章正文及研究记录保留，只更新工具链接。

## 更新方式

独立 Worker 每分钟唤醒，八个普通采集器按五分钟周期分组检查；网页每分钟读取接口，数据缓存最多额外 60 秒。新数据直接写入数据库，不需要提交 Git、运行博客 Actions 或重建博客。

检查频率不改变源站的日度、旬度、周度发布口径。页面保留实际数据日期、来源链接、最近检查和成功时间。源站失败保留已有记录，并显示失败状态；价格修订保存旧值。日常采集只检查最新公开列表，历史缺口不估算填补。

后台与前端健康状态：<https://market-observation.blingo406.workers.dev/api/health>。完整公开历史：<https://market-observation.blingo406.workers.dev/markets/archive.json>。正式数据来自 D1；独立项目中的公开种子用于首次导入与静态回退。

## 数据边界与历史

首次迁移保留 2,901 条价格、60 篇公告、15 条政策发布、105 次会议及当时的 10 个未来日程。来源包括农业农村部周报、中国养猪网全国外三元日价、统计局外三元旬价、东瑞官网、明确标注转载的牧原公告、Fed RSS、FOMC 日历及会议资料。

每条记录按公开字段验证。标题、发布日期、数值、单位和原链接可以导出；私人笔记、视频转写、持仓、账户信息及付费数据不属于导出内容。站点不访问私人知识库。

日价、旬均价与周价分开，不拼接口径。图表可以筛选时间范围、下载 CSV；旧记录不滚动删除。Fed 会议只关联同日官方 SEP，未发布与采集失败分别标注；点阵 SVG 按官方数值表生成。

## 博客中的迁移归档

博客内 `src/data/markets/snapshot.json`、原 JSON／SVG 地址与 `public/data/gold-etf/` 继续保存迁移时的公开记录。这些文件作为归档，不代表独立站最新状态。

`.github/workflows/markets.yml` 和 `gold-etf.yml` 已移除 schedule，保留手动运行用于旧采集器诊断。日常数据维护使用独立项目；手动运行旧任务仍可能写入归档并重建博客。

博客已有 Blog Manager 工作与本次迁移无关，提交时按文件范围保留。

## 维护

在 `D:\MarketObservation` 中执行 `pnpm check`、`pnpm test`、`pnpm build`；业务代码更新后执行 `pnpm deploy`。保留 `wrangler.jsonc` 中同一个数据库 ID，禁止清空历史库。部署说明、费用边界与验证记录见该项目的 `README.md` 和 `docs/verification.md`。

黄金股 ETF 的条件与时点不变：09:16、09:21，前一交易日单位净值，买一参考折价达到 5%，排除跌停、过期行情和缺失净值。页面提醒需要打开页面并点击启用；后台分钟采样不能保证两个竞价时点均完整捕获。日历目前有效至 2026-12-31，过期暂停条件提示。
