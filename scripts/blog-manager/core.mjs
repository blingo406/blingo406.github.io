import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseDocument, isMap } from "yaml";
import { resolveReferences, transformProse } from "./references.mjs";
import { formatBody, isMathText, mathPeriods } from "./formatting.mjs";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const textHash = (value) => hash(String(value).replace(/\r\n/g, "\n"));
export const slash = (value) => value.split(path.sep).join("/");
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const documents = new Set([".md", ".mdx", ".txt"]);
const assets = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".pdf", ".mp3", ".mp4", ".wav", ".webm"]);

export async function exists(file) {
	try { await fs.access(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; }
}

export async function inside(root, relative) {
	if (typeof relative !== "string" || !relative || relative.includes("\0") || path.isAbsolute(relative)) throw new Error("无效的文件路径");
	const base = await fs.realpath(root);
	const target = await fs.realpath(path.resolve(base, relative));
	const rel = path.relative(base, target);
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("文件必须位于文档目录内");
	return target;
}

export async function walk(root, relative = "") {
	const result = [];
	for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
		if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
		const name = slash(path.join(relative, entry.name));
		if (entry.isDirectory()) result.push(...await walk(root, name));
		else if (entry.isFile()) result.push(name);
	}
	return result.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function yamlDocument(text = "") {
	const doc = parseDocument(text.trim() ? text : "{}", { schema: "yaml-1.1", uniqueKeys: true });
	if (doc.errors.length) throw new Error(`frontmatter 格式错误：${doc.errors[0].message}`);
	if (doc.contents && !isMap(doc.contents)) throw new Error("frontmatter 必须是 YAML 字段列表");
	if (doc.contents) doc.contents.flow = false;
	doc.toJS({ maxAliasCount: 50 });
	return doc;
}

export function splitDocument(text) {
	text = text.replace(/^\uFEFF/, "");
	if (!/^---\s*\r?\n/.test(text)) return { frontmatter: "", body: text };
	const match = text.match(/^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$)/);
	if (!match) throw new Error("frontmatter 缺少结尾的 ---");
	return { frontmatter: match[1], body: text.slice(match[0].length) };
}

export function validateMetadata(data) {
	if (typeof data.title !== "string" || !data.title.trim()) throw new Error("请填写 title（文章标题）");
	for (const key of ["published", "updated"]) {
		if (key === "updated" && data[key] === undefined) continue;
		if (!(data[key] instanceof Date) || Number.isNaN(data[key].valueOf())) throw new Error(`${key} 请使用不带引号的有效日期，例如 2026-10-03`);
	}
	for (const key of ["draft", "pinned", "comment", "encrypted", "hideHomeContent"]) {
		if (data[key] !== undefined && typeof data[key] !== "boolean") throw new Error(`${key} 必须填写 true 或 false`);
	}
	for (const key of ["description", "image", "lang", "author", "sourceLink", "licenseName", "licenseUrl", "password", "passwordHint", "alias", "permalink"]) {
		if (data[key] !== undefined && typeof data[key] !== "string") throw new Error(`${key} 必须是文字`);
	}
	if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some(t => typeof t !== "string"))) throw new Error("tags 请使用文字列表，例如 [生活, 学习]");
	if (data.priority !== undefined && (typeof data.priority !== "number" || !Number.isFinite(data.priority))) throw new Error("priority 必须是数字");
	if (data.encrypted && !data.password) throw new Error("加密文章需要填写 password");
}

export function completeMetadata(frontmatter, body, id, savedFrontmatter) {
	const doc = yamlDocument(frontmatter);
	for (const [old, key] of [["date", "published"], ["sticky", "pinned"], ["language", "lang"]]) {
		if (doc.has(old) && !doc.has(key)) { doc.set(key, doc.get(old)); doc.delete(old); }
	}
	const fill = (key, value) => { if (!doc.has(key) || doc.get(key) === null || doc.get(key) === "") doc.set(key, value); };
	fill("title", body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(id, path.extname(id)));
	const saved = savedFrontmatter ? yamlDocument(savedFrontmatter).toJS() : null;
	fill("published", saved?.published || new Date(`${today()}T00:00:00Z`));
	fill("description", body.replace(/```[\s\S]*?```/g, "").replace(/[#>*`\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 140));
	const tagLine = body.match(/^\s*((?:#[\p{L}\p{N}_/-]+[ \t]*)+)\r?\n/u)?.[1];
	fill("tags", tagLine ? [...tagLine.matchAll(/#([^\s#]+)/g)].map(match => match[1]) : []);
	fill("draft", false);
	return doc;
}

export function directoryArchive(id) {
	const parts = id.replace(/\\/g, "/").split("/");
	if (parts.some(part => !part || part === "." || part === ".." || part.includes(":"))) throw new Error("无效的源目录路径");
	const categoryPath = parts.slice(0, -1);
	if (!categoryPath.length) categoryPath.push("未分类");
	return { categoryPath, category: categoryPath.at(-1), parentCategory: categoryPath.at(-2) || "" };
}

export async function readState(root) {
	const file = path.join(root, ".blog-manager/state.json");
	if (!await exists(file)) return { entries: {} };
	return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function saveState(root, state) {
	const dir = path.join(root, ".blog-manager");
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, "state.json.tmp"), JSON.stringify(state, null, 2));
	await fs.rename(path.join(dir, "state.json.tmp"), path.join(dir, "state.json"));
}

// A source path is a location, not the identity of a published article.
// Only recover records whose old source disappeared; active same-name notes
// are independent documents. Never guess when more than one record matches.
export function publishedRecord(state, id, files, title) {
	if (state.entries[id]) return { saved: state.entries[id], previousId: id };
	const key = value => String(value || "").normalize("NFC").trim().toLowerCase();
	const stem = value => key(path.basename(value, path.extname(value)));
	const candidates = Object.entries(state.entries).filter(([oldId, saved]) =>
		!files.includes(oldId) && saved.target &&
		(stem(oldId) === stem(id) || (title && key(saved.sourceTitle || saved.title) === key(title))));
	if (candidates.length > 1) throw new Error(`${id}：匹配到多篇历史文章，请先核对导入记录，不能自动创建或覆盖`);
	return candidates.length ? { saved: candidates[0][1], previousId: candidates[0][0] } : {};
}

export async function scan(root, source) {
	const state = await readState(root);
	const files = await walk(source);
	const categories = new Map();
	const add = (category, parentCategory = "", categoryPath = []) => {
		if (category) categories.set(JSON.stringify(categoryPath.length ? categoryPath : [parentCategory, category]), { category, parentCategory, categoryPath });
	};
	const warnings = [];
	for (const id of await walk(path.join(root, "src/content/posts"))) {
		if (![".md", ".mdx"].includes(path.extname(id).toLowerCase())) continue;
		try {
			const { frontmatter } = splitDocument(await fs.readFile(path.join(root, "src/content/posts", id), "utf8"));
			const data = yamlDocument(frontmatter).toJS();
			add(data?.category, data?.parentCategory || "", data?.categoryPath || []);
		} catch (e) { warnings.push(`${id}: ${e.message}`); }
	}
	for (const saved of Object.values(state.entries)) add(saved.category, saved.parentCategory, saved.categoryPath || []);
	const items = [];
	for (const id of files.filter(f => documents.has(path.extname(f).toLowerCase()))) {
		const raw = await fs.readFile(await inside(source, id), "utf8");
		try {
			const parts = splitDocument(raw);
			const data = yamlDocument(parts.frontmatter).toJS() || {};
			const { saved, previousId } = publishedRecord(state, id, files, data.title || parts.body.match(/^#\s+(.+)$/m)?.[1]);
			const suggestion = completeMetadata(parts.frontmatter, parts.body, id, saved?.frontmatter).toString();
			const effectiveMetadata = saved?.mode === "manual" ? yamlDocument(saved.frontmatter).toJS() : data;
			items.push({ id, hash: hash(raw), body: parts.body, original: parts.frontmatter, suggestion,
				mathText: isMathText(saved?.mode === "manual" ? effectiveMetadata : yamlDocument(suggestion).toJS()),
				directoryArchive: directoryArchive(id), archiveMode: saved?.archiveMode || (saved ? "manual" : "directory"),
				categoryPath: saved?.categoryPath || data.categoryPath || [],
				category: saved?.category || data.category || "", parentCategory: saved?.parentCategory || data.parentCategory || "",
				target: saved?.target, previousId,
				status: previousId && previousId !== id ? "路径已变更，将更新原文章" : saved ? (saved.sourceHash === hash(raw) ? "已提交" : "有修改") : "未提交",
				savedFrontmatter: saved?.frontmatter, savedMode: saved?.mode, suggestedCategory: path.dirname(id) === "." ? "" : path.basename(path.dirname(id)) });
		} catch (e) { items.push({ id, hash: hash(raw), error: e.message }); }
	}
	return { items, categories: [...categories.values()], warnings,
		unsupported: files.filter(f => !documents.has(path.extname(f).toLowerCase()) && !assets.has(path.extname(f).toLowerCase())) };
}

async function rewriteAssets(body, id, source, files, root) {
	const output = new Map();
	const resolveAsset = async (reference) => {
		if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return reference;
		if (reference.startsWith("/") && await exists(path.join(root, "public", reference.slice(1).split(/[?#]/)[0]))) return reference;
		const [bare, suffix = ""] = reference.split(/(?=[#?])/s, 2);
		const decoded = decodeURIComponent(bare.replace(/\\/g, "/").replace(/^\//, ""));
		const ext = path.extname(decoded).toLowerCase();
		if (!assets.has(ext)) throw new Error(`不支持的附件引用：${reference}。笔记之间请使用 [[笔记名称]]。`);
		let relative = reference.startsWith("/") ? decoded : slash(path.join(path.dirname(id), decoded));
		if (!files.includes(relative)) {
			const matches = files.filter(f => f === decoded || path.basename(f) === decoded);
			if (matches.length !== 1) throw new Error(`附件不存在或重名：${reference}`);
			relative = matches[0];
		}
		const bytes = await fs.readFile(await inside(source, relative));
		const target = `public/images/blog-import/${hash(bytes).slice(0, 24)}${ext}`;
		output.set(target, bytes);
		return `/${target.slice(7)}${suffix}`;
	};
	// Leave fenced code and inline code examples untouched.
	const result = await transformProse(body, async part => {
		if (/<(?:img|a|source|video|audio)\b[^>]*\b(?:src|href|poster)=["'](?![a-z][\w+.-]*:|\/|#)/i.test(part)) throw new Error(`${id}：HTML/JSX 中的本地资源请改成 Markdown 链接或图片语法`);
		const pattern = /!\[\[([^\]\n]+)\]\]|(!?\[[^\]\n]*\])\((<[^>]+>|[^\s)]+)(\s+["'][^\n]*?["'])?\)/g;
		let cursor = 0;
		let rewritten = "";
		for (const m of part.matchAll(pattern)) {
			rewritten += part.slice(cursor, m.index);
			if (m[1]) {
				const [ref, alt = ""] = m[1].split("|");
				const image = /\.(?:png|jpe?g|gif|webp|svg|avif)(?:[#?]|$)/i.test(ref);
				rewritten += `${image ? "!" : ""}[${(alt || (image ? "" : ref)).replace(/[\[\]]/g, "")}](${await resolveAsset(ref)})`;
			} else {
				const ref = m[3].replace(/^<|>$/g, "");
				const websitePage = ref.startsWith("/") && !assets.has(path.extname(ref.split(/[?#]/)[0]).toLowerCase());
				rewritten += `${m[2]}(${websitePage ? ref : await resolveAsset(ref)}${m[4] || ""})`;
			}
			cursor = m.index + m[0].length;
		}
		return rewritten + part.slice(cursor);
	});
	return { body: result, assets: output };
}

export async function makePlan(root, source, selections) {
	if (!Array.isArray(selections) || !selections.length) throw new Error("请至少选择一篇文档");
	const state = await readState(root);
	const allFiles = await walk(source);
	const used = new Set();
	const targets = new Set();
	const writes = new Map();
	const posts = [];
	for (const selected of selections) {
		const { id, mode } = selected;
		const archiveMode = selected.archiveMode || "manual";
		if (!["directory", "manual"].includes(archiveMode)) throw new Error("无效的归档方式");
		const { category, parentCategory = "", categoryPath } = archiveMode === "directory" ? directoryArchive(id) : selected;
		if (used.has(id)) throw new Error(`重复选择：${id}`);
		used.add(id);
		if (!documents.has(path.extname(id).toLowerCase())) throw new Error("仅支持 Markdown、MDX 和 TXT 文档");
		if (typeof category !== "string" || !category.trim() || typeof parentCategory !== "string") throw new Error(`${id}：请选择或创建归档`);
		if (!["auto", "manual"].includes(mode)) throw new Error("请选择 frontmatter 模式");
		const raw = await fs.readFile(await inside(source, id), "utf8");
		if (hash(raw) !== selected.hash) throw new Error(`${id} 已被修改，请重新扫描后再提交`);
		const parts = splitDocument(raw);
		const identity = publishedRecord(state, id, allFiles, yamlDocument(parts.frontmatter).toJS()?.title || parts.body.match(/^#\s+(.+)$/m)?.[1]);
		const doc = mode === "auto" ? completeMetadata(parts.frontmatter, parts.body, id, identity.saved?.frontmatter) : yamlDocument(selected.frontmatter);
		doc.set("category", category.trim());
		doc.set("parentCategory", parentCategory.trim());
		if (categoryPath?.length) {
			if (!Array.isArray(categoryPath) || categoryPath.some(part => typeof part !== "string" || !part.trim() || /[\\/]/.test(part))) throw new Error("归档路径格式无效");
			doc.set("categoryPath", categoryPath.map(part => part.trim()));
		} else doc.delete("categoryPath");
		const sourceTitle = doc.get("title");
		const mathText = isMathText(doc.toJS());
		if (mathText) for (const field of ["title", "description"]) {
			if (typeof doc.get(field) === "string") doc.set(field, mathPeriods(doc.get(field)));
		}
		const data = yamlDocument(doc.toString()).toJS({ maxAliasCount: 50 });
		validateMetadata(data);
		const stem = path.basename(id, path.extname(id)).normalize("NFC").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 100) || "post";
		const extension = path.extname(id).toLowerCase() === ".mdx" ? ".mdx" : ".md";
		const target = identity.saved?.target || `src/content/posts/${stem}-${hash(id).slice(0, 8)}${extension}`;
		if (!/^src\/content\/posts\/[^/\\]+\.(md|mdx)$/.test(target)) throw new Error("导入记录中的目标路径无效");
		if (targets.has(target)) throw new Error(`${id}：多篇源文档指向同一篇网站文章，请分别核对`);
		targets.add(target);
		const frontmatter = doc.toString();
		posts.push({ id, target, mode, archiveMode, categoryPath: data.categoryPath || [], mathText, sourceTitle, title: data.title, category: data.category, parentCategory: data.parentCategory, draft: !!data.draft,
			sourceHash: hash(raw), previousHash: identity.saved?.outputHash,
			supersededIds: identity.previousId && identity.previousId !== id ? [identity.previousId] : [],
			frontmatter, body: parts.body });
	}
	const references = await resolveReferences(root, source, posts, state);
	for (const post of posts) {
		const transformed = await rewriteAssets(post.body, post.id, source, allFiles, root);
		for (const [file, bytes] of transformed.assets) writes.set(file, bytes);
		const metadata = yamlDocument(post.frontmatter);
		if (metadata.get("image")) {
			const cover = await rewriteAssets(`![cover](<${metadata.get("image")}>)`, post.id, source, allFiles, root);
			metadata.set("image", cover.body.match(/^!\[cover\]\((.*?)\)$/)[1]);
			for (const [file, bytes] of cover.assets) writes.set(file, bytes);
			post.frontmatter = metadata.toString();
		}
		post.body = formatBody(transformed.body, post.mathText);
		post.content = `---\n${post.frontmatter}---\n${post.body}`.replace(/\r\n/g, "\n");
		post.outputHash = textHash(post.content);
		writes.set(post.target, Buffer.from(post.content));
	}
	return { posts, writes, references };
}
