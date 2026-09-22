import snapshot from "../data/markets/snapshot.json";
import sources from "../data/markets/sources.json";

export { snapshot, sources };
export type Observation = (typeof snapshot.observations)[number];
export const metrics: Record<
	string,
	{
		name: string;
		unit: string;
		color: string;
		gapDays?: number;
		frequency?: string;
		source?: string;
		sourceUrl?: string;
	}
> = {
	hog: { name: "全国生猪价格", unit: "元/公斤", color: "#107d79" },
	piglet: { name: "全国仔猪价格", unit: "元/公斤", color: "#ae6b32" },
	pork: { name: "全国猪肉价格", unit: "元/公斤", color: "#6265b5" },
	corn: { name: "全国玉米价格", unit: "元/公斤", color: "#ae6b32" },
	soymeal: { name: "全国豆粕价格", unit: "元/公斤", color: "#107d79" },
	feed: { name: "育肥猪配合饲料", unit: "元/公斤", color: "#6265b5" },
	hog_spot: {
		name: "全国外三元生猪现货均价",
		unit: "元/公斤",
		color: "#107d79",
		gapDays: 2,
		frequency: "日度",
		source: "中国养猪网／玄田数据 · 全国外三元现货均价",
		sourceUrl: "https://zhujia.zhuwang.com.cn/",
	},
	hog_nbs: {
		name: "全国外三元生猪旬均价",
		unit: "元/公斤",
		color: "#6265b5",
		gapDays: 12,
		frequency: "旬度",
		source: "国家统计局 · 流通领域生猪（外三元）价格",
		sourceUrl: "https://www.stats.gov.cn/sj/zxfb/",
	},
};

export function series(id: string): Observation[] {
	return snapshot.observations
		.filter((row) => row.series === id)
		.sort((a, b) => a.date.localeCompare(b.date));
}

export { dateTime } from "./market-time";

export function statusFor(id: string) {
	return snapshot.status.find((row) => row.id === id);
}

export function delta(rows: Observation[]): string {
	if (rows.length < 2) return "暂无可比上期";
	const previous = rows.at(-2);
	const current = rows.at(-1);
	if (!previous || !current || previous.value === 0) return "暂无可比上期";
	const value = (current.value / previous.value - 1) * 100;
	return `${value > 0 ? "+" : ""}${value.toFixed(2)}% · 较 ${previous.date}`;
}
