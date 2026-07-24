/**
 * 字体子集化脚本。
 *
 * 本地两个中文字体（ZenMaruGothic / loli）原始 TTF 分别为 3.7MB / 10.5MB，
 * 未子集化直接发给浏览器会严重拖慢加载。本脚本扫描站点所有源码/内容里出现过的
 * 字符，用 pyftsubset 把两个字体裁剪成只含用到的字形的 woff2。
 *
 * 依赖：pyftsubset（`pip install "fonttools[woff]" brotli`）。
 * 用法：`node scripts/subset-fonts.mjs`（新增文章、出现新字后重新跑一遍再部署）。
 *
 * 输出：src/assets/fonts/*.subset.woff2，已被 astro.config.mjs 引用。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 扫描这些目录下的文本文件，收集所有出现过的字符。
const SCAN_DIRS = ["src"];
const TEXT_EXT = new Set([
	".md", ".mdx", ".astro", ".ts", ".tsx", ".js", ".mjs",
	".json", ".yaml", ".yml", ".svelte", ".vue", ".css", ".styl", ".html",
]);

// 始终包含的基础 Unicode 区间（ASCII / 拉丁 / 标点 / 假名 / 全角），
// 避免因当前内容里恰好没某个标点而缺字。
const BASE_UNICODES = [
	"U+0020-007E", // ASCII 可见字符
	"U+00A0-00FF", // Latin-1 补充
	"U+2010-2027", // 连字符、破折号、引号、省略号
	"U+2030-205E", // 千分号、角分角秒等
	"U+2190-2199", // 箭头（← → ↑ ↓）
	"U+3000-303F", // CJK 符号与标点（。、《》「」等）
	"U+3040-30FF", // 平假名 + 片假名
	"U+FF00-FFEF", // 全角形式（？！（）：等）
	"U+2460-24FF", // 带圈数字 ①②…
];

// 原始 TTF 放在 fonts-src/（src/ 之外），避免 Astro 构建把它们当资源一并输出到 dist。
const FONTS = [
	{ src: "fonts-src/ZenMaruGothic-Medium.ttf", out: "src/assets/fonts/ZenMaruGothic-Medium.subset.woff2" },
	{ src: "fonts-src/loli.ttf", out: "src/assets/fonts/loli.subset.woff2" },
];

function walk(dir, acc) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name.startsWith(".")) continue;
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full, acc);
		else if (TEXT_EXT.has(path.extname(e.name))) acc.push(full);
	}
	return acc;
}

const chars = new Set();
for (const d of SCAN_DIRS) {
	const abs = path.join(ROOT, d);
	if (!fs.existsSync(abs)) continue;
	for (const file of walk(abs, [])) {
		const text = fs.readFileSync(file, "utf-8");
		for (const ch of text) chars.add(ch);
	}
}
// 去掉控制字符，避免污染。
const charList = [...chars].filter((c) => c.codePointAt(0) >= 0x20).join("");

const tmp = path.join(os.tmpdir(), `mizuki-font-subset-${Date.now()}.txt`);
fs.writeFileSync(tmp, charList, "utf-8");
console.log(`收集到 ${[...chars].length} 个唯一字符。`);

for (const font of FONTS) {
	const src = path.join(ROOT, font.src);
	const out = path.join(ROOT, font.out);
	if (!fs.existsSync(src)) {
		console.warn(`跳过（源字体不存在）：${font.src}`);
		continue;
	}
	execFileSync(
		"pyftsubset",
		[
			src,
			`--text-file=${tmp}`,
			`--unicodes=${BASE_UNICODES.join(",")}`,
			"--flavor=woff2",
			"--layout-features=*",
			`--output-file=${out}`,
		],
		{ stdio: "inherit" },
	);
	const kb = (fs.statSync(out).size / 1024).toFixed(0);
	console.log(`${font.out} → ${kb} KB`);
}

fs.unlinkSync(tmp);
console.log("完成。");
