import fs from "node:fs/promises";
import path from "node:path";
import MarkdownIt from "markdown-it";
import { walk, splitDocument, yamlDocument, slash, exists } from "./core.mjs";
import { mathPeriods } from "./formatting.mjs";

const parser = new MarkdownIt();
const key = value => value.normalize("NFC").toLowerCase();
const withoutExtension = value => value.replace(/\.(mdx?|txt)$/i, "");
export const postSlug = target => key(withoutExtension(target.replace(/^src\/content\/posts\//, "")));

// Transform only prose; fence, indented code, and inline code remain byte-for-byte intact.
export async function transformProse(body, transform) {
	const tokens = parser.parse(body, {});
	const lines = body.split(/(?<=\n)/);
	const excluded = new Set();
	for (const token of tokens) if (["fence", "code_block"].includes(token.type) && token.map) {
		for (let i = token.map[0]; i < token.map[1]; i++) excluded.add(i);
	}
	let result = "";
	for (let i = 0; i < lines.length; i++) {
		if (excluded.has(i)) { result += lines[i]; continue; }
		const pieces = lines[i].split(/(`+[^`]*(?:`[^`]+)*?`+)/g);
		for (const piece of pieces) result += piece.startsWith("`") ? piece : await transform(piece);
	}
	return result;
}

export async function resolveReferences(root, source, posts, state) {
	const catalog = [];
	const bySource = new Map(posts.map(post => [post.id, post]));
	const selectedTargets = new Set(posts.map(post => post.target));
	for (const id of await walk(source)) {
		if (!/\.(mdx?|txt)$/i.test(id)) continue;
		const { frontmatter, body } = splitDocument(await fs.readFile(path.join(source, id), "utf8"));
		const data = yamlDocument(frontmatter).toJS() || {};
		const selected = bySource.get(id);
		const saved = state.entries[id];
		let publishedBody = body;
		if (!selected && saved?.target && /^src\/content\/posts\/[^/\\]+\.(md|mdx)$/.test(saved.target) && await exists(path.join(root, saved.target))) {
			publishedBody = splitDocument(await fs.readFile(path.join(root, saved.target), "utf8")).body;
		}
		catalog.push({ id, target: selected?.target || saved?.target, body: selected?.body || publishedBody,
			mathText: selected?.mathText ?? saved?.mathText ?? false, sourceTitle: selected?.sourceTitle || data.title,
			title: selected?.title || data.title || path.basename(id, path.extname(id)),
			aliases: data.aliases, draft: selected ? selected.draft : saved ? saved.draft : data.draft,
			available: !!(selected || saved), selected: !!selected });
	}
	const sourceTargets = new Set(catalog.map(p => p.target));
	for (const id of await walk(path.join(root, "src/content/posts"))) {
		if (!/\.mdx?$/i.test(id)) continue;
		const target = `src/content/posts/${id}`;
		if (selectedTargets.has(target) || sourceTargets.has(target)) continue;
		const { frontmatter, body } = splitDocument(await fs.readFile(path.join(root, target), "utf8"));
		const data = yamlDocument(frontmatter).toJS() || {};
		catalog.push({ id, target, body, title: data.title, aliases: data.aliases, draft: data.draft, available: true, site: true });
	}
	const references = [];
	const issues = [];
	const find = (target, current) => {
		if (!target) return catalog.find(p => p.id === current.id && !p.site);
		const clean = withoutExtension(decodeURIComponent(target).replace(/\\/g, "/"));
		const relative = withoutExtension(slash(path.normalize(path.join(path.dirname(current.id), clean))));
		let matches = catalog.filter(p => !p.site && key(withoutExtension(p.id)) === key(relative));
		if (!matches.length) matches = catalog.filter(p => key(withoutExtension(p.id)) === key(clean));
		if (!matches.length && !clean.includes("/")) matches = catalog.filter(p => [p.title, p.sourceTitle, withoutExtension(path.basename(p.id)), ...(Array.isArray(p.aliases) ? p.aliases : [])].filter(Boolean).some(v => key(String(v)) === key(clean)));
		if (matches.length !== 1) throw new Error(matches.length ? `引用重名，请使用完整路径：${target}` : `找不到引用目标：${target}`);
		return matches[0];
	};
	for (const post of posts) {
		const env = {};
		parser.parse(post.body, env);
		const resolve = (reference, label, embed = false) => {
			const match = reference.match(/^([^#^]*)(.*)$/);
			const note = find(match[1].trim(), post);
			if (!note.available) throw new Error(`引用目标尚未提交，请一起勾选：${note.id}`);
			if (note.draft && !post.draft) throw new Error(`公开文章引用了草稿：${note.id}`);
			if (embed) throw new Error(`笔记嵌入 ![[${reference}]] 请改为普通双链；图片和 PDF 嵌入可直接导入`);
			let suffix = decodeURIComponent(match[2]).replace(/^#\^/, "^");
			if (note.mathText && suffix.startsWith("#")) suffix = mathPeriods(suffix);
			if (suffix.startsWith("^") && !note.body.includes(`id="block-${suffix.slice(1)}"`) && !new RegExp(`\\^${suffix.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(note.body)) throw new Error(`块引用不存在：${reference}`);
			if (suffix.startsWith("^") && !note.selected && !note.body.includes(`id="block-${suffix.slice(1)}"`)) throw new Error(`块引用目标需一起重新提交以生成锚点：${note.id}`);
			references.push({ from: post.id, target: note.id, path: note.target, suffix, draft: post.draft });
			return `[[${postSlug(note.target)}${suffix}|${(label || reference || post.title).replace(/[\[\]\n|]/g, "")}]]`;
		};
		post.body = await transformProse(post.body, async text => {
			// Expand reference-style Markdown links/images before resolving destinations.
			text = text.replace(/(!?\[([^\]\n]+)\])\[([^\]\n]*)\]/g, (all, prefix, label, ref) => {
				const definition = env.references?.[(ref || label).trim().replace(/\s+/g, " ").toUpperCase()];
				return definition ? `${prefix}(<${definition.href}>)` : all;
			});
			text = text.replace(/!?\[\[([^\]\n]+)\]\]|(?<!!)\[([^\]\n]+)\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\)/g, (all, wiki, label, href) => {
				try {
					if (wiki) {
						const [reference, alias] = wiki.split("|");
						if (all.startsWith("!") && /\.(?:png|jpe?g|gif|webp|svg|avif|pdf|mp3|mp4|wav|webm)(?:[|#?]|$)/i.test(reference)) return all;
						return resolve(reference, alias, all.startsWith("!"));
					}
					const reference = href.replace(/^<|>$/g, "");
					if (/^(?:[a-z][\w+.-]*:|\/\/|\/)/i.test(reference)) return all;
					if (/\.(?:mdx?|txt)(?:#|$)/i.test(reference) || reference.startsWith("#")) return resolve(reference, label);
					return all;
				} catch (e) { issues.push(`${post.id}：${e.message}`); return all; }
			});
			// The existing blog resolves ^block links but needs real HTML anchors.
			return text.replace(/(?:^|\s)\^([a-zA-Z0-9-]+)\s*$/g, (all, id) => ` <span id="block-${id}"></span>${all.endsWith("\n") ? "\n" : ""}`);
		});
	}
	if (issues.length) throw new Error(`引用检查未通过：\n${[...new Set(issues)].join("\n")}`);
	return references;
}
