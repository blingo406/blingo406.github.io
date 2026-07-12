/**
 * 链接图（Link Graph）：扫描所有博文，构建
 *   - slug 索引：把 title / filename / alias 映射到规范 slug
 *   - heading 索引：每篇文章的标题 → 锚点 slug
 *   - 反向链接：目标 slug → [{ slug, title }]
 *
 * 该模块在首次调用 getLinkGraph() 时进行一次全量扫描并缓存结果。
 * 被 remark-wiki-link 插件和 Backlinks 组件复用。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "../content/posts");

let cache = null;

/** GitHub 风格 slug（与 rehype-slug 大致一致） */
export function slugify(text) {
	return String(text)
		.trim()
		.toLowerCase()
		.replace(
			/[\u2000-\u206f\u2e00-\u2e7f\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g,
			"",
		)
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function parseFrontmatter(raw) {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) return { data: {}, content: raw };
	const data = {};
	for (const line of m[1].split(/\r?\n/)) {
		const km = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
		if (!km) continue;
		let value = km[2].trim();
		if (value === "") continue;
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		} else if (value.startsWith("[") && value.endsWith("]")) {
			value = value
				.slice(1, -1)
				.split(",")
				.map((s) => {
					let v = s.trim();
					if (
						(v.startsWith('"') && v.endsWith('"')) ||
						(v.startsWith("'") && v.endsWith("'"))
					) {
						v = v.slice(1, -1);
					}
					return v;
				})
				.filter(Boolean);
		}
		data[km[1]] = value;
	}
	return { data, content: m[2] };
}

function walk(dir, base = dir) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			results.push(...walk(full, base));
		} else if (/\.mdx?$/.test(e.name)) {
			const rel = path.relative(base, full).replace(/\\/g, "/");
			results.push({ full, rel });
		}
	}
	return results;
}

function extractHeadings(content) {
	const headings = {};
	const seen = {};
	const cleaned = content
		.replace(/```[\s\S]*?```/g, "")
		.replace(/~~~[\s\S]*?~~~/g, "");
	for (const line of cleaned.split(/\r?\n/)) {
		const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
		if (!m) continue;
		const text = m[2].trim();
		let slug = slugify(text);
		if (seen[slug] !== undefined) {
			seen[slug]++;
			slug = `${slug}-${seen[slug]}`;
		} else {
			seen[slug] = 0;
		}
		headings[text.toLowerCase()] = slug;
	}
	return headings;
}

function extractOutboundLinks(content) {
	const links = new Set();
	const cleaned = content
		.replace(/```[\s\S]*?```/g, "")
		.replace(/~~~[\s\S]*?~~~/g, "")
		.replace(/`[^`]+`/g, "");
	const re = /\[\[([^[\]]+?)\]\]/g;
	let m = re.exec(cleaned);
	while (m !== null) {
		const raw = m[1];
		let target = raw.includes("|") ? raw.split("|")[0] : raw;
		target = target.split("#")[0].split("^")[0].trim();
		if (target) links.add(target.toLowerCase());
		m = re.exec(cleaned);
	}
	return [...links];
}

export function getLinkGraph() {
	if (cache) return cache;

	const posts = [];
	for (const { full, rel } of walk(CONTENT_DIR)) {
		let raw;
		try {
			raw = fs.readFileSync(full, "utf-8");
		} catch {
			continue;
		}
		const { data, content } = parseFrontmatter(raw);
		if (data.draft === "true" || data.draft === true) continue;

		const slug = rel.replace(/\.mdx?$/, "");
		posts.push({
			slug,
			title: data.title || slug,
			aliases: Array.isArray(data.aliases)
				? data.aliases
				: typeof data.aliases === "string"
					? [data.aliases]
					: [],
			headings: extractHeadings(content),
			outboundLinks: extractOutboundLinks(content),
		});
	}

	const slugIndex = {};
	const addKey = (key, slug) => {
		if (!key) return;
		const k = String(key).toLowerCase().trim();
		if (!k) return;
		if (!(k in slugIndex)) slugIndex[k] = slug;
	};
	for (const post of posts) {
		addKey(post.title, post.slug);
		addKey(post.slug, post.slug);
		addKey(post.slug.split("/").pop(), post.slug);
		for (const alias of post.aliases) addKey(alias, post.slug);
	}

	const headingIndex = {};
	const titleIndex = {};
	for (const post of posts) {
		headingIndex[post.slug] = post.headings;
		titleIndex[post.slug] = post.title;
	}

	const backlinks = {};
	const outlinks = {};
	for (const post of posts) {
		for (const target of post.outboundLinks) {
			const targetSlug = slugIndex[target];
			if (!targetSlug || targetSlug === post.slug) continue;

			if (!backlinks[targetSlug]) backlinks[targetSlug] = [];
			if (!backlinks[targetSlug].some((b) => b.slug === post.slug)) {
				backlinks[targetSlug].push({
					slug: post.slug,
					title: post.title,
				});
			}

			if (!outlinks[post.slug]) outlinks[post.slug] = [];
			if (!outlinks[post.slug].some((o) => o.slug === targetSlug)) {
				outlinks[post.slug].push({
					slug: targetSlug,
					title: titleIndex[targetSlug],
				});
			}
		}
	}

	cache = { slugIndex, headingIndex, titleIndex, backlinks, outlinks };
	return cache;
}

/** 解析 [[target#heading^block|alias]] 中的 target 部分为 URL */
export function resolveWikiLink(target) {
	const { slugIndex, headingIndex, titleIndex } = getLinkGraph();
	let cleanTarget = target;
	let heading = null;
	let blockId = null;

	if (cleanTarget.includes("#")) {
		const idx = cleanTarget.indexOf("#");
		heading = cleanTarget.slice(idx + 1).trim();
		cleanTarget = cleanTarget.slice(0, idx).trim();
	}
	if (cleanTarget.includes("^")) {
		const idx = cleanTarget.indexOf("^");
		blockId = cleanTarget.slice(idx + 1).trim();
		cleanTarget = cleanTarget.slice(0, idx).trim();
	}

	const slug = cleanTarget ? slugIndex[cleanTarget.toLowerCase()] : null;
	if (!slug) return null;

	let href = `/posts/${slug}/`;
	if (heading) {
		const hSlug =
			headingIndex[slug]?.[heading.toLowerCase()] || slugify(heading);
		href += `#${hSlug}`;
	} else if (blockId) {
		href += `#block-${blockId}`;
	}

	return { href, slug, title: titleIndex[slug] };
}

export function getBacklinks(slug) {
	const { backlinks } = getLinkGraph();
	return backlinks[slug] || [];
}

export function getOutlinks(slug) {
	const { outlinks } = getLinkGraph();
	return outlinks[slug] || [];
}
