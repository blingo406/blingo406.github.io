import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scan, makePlan, hash, splitDocument, yamlDocument, saveState, readState, inside } from "./core.mjs";
import { git, run, prepare, publish, discard, verifyBuiltLinks } from "./publisher.mjs";
import { transformProse, postSlug } from "./references.mjs";
import { formatBody, isMathText, splitLeadingTags } from "./formatting.mjs";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import remarkMath from "remark-math";
import rehypeMathjax from "rehype-mathjax";
import { parse as parseHtml } from "node-html-parser";
import { buildCategoryTree, getPostCategoryPath, matchesCategoryPath } from "../../src/utils/category-utils.ts";
import { manualArchive } from "./ui/archive.mjs";

async function fixture(t, docs = {}) {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), "mizuki-manager-test-"));
	const root = path.join(base, "repo");
	const source = path.join(base, "notes");
	await fs.mkdir(path.join(root, "src/content/posts"), { recursive: true });
	await fs.mkdir(source, { recursive: true });
	for (const [file, text] of Object.entries(docs)) {
		await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true });
		await fs.writeFile(path.join(source, file), text);
	}
	t.after(async () => {
		assert.equal(path.dirname(base), os.tmpdir());
		assert.match(path.basename(base), /^mizuki-manager-test-/);
		await fs.rm(base, { recursive: true, force: true });
	});
	const choose = async (ids, extra = {}) => (await scan(root, source)).items.filter(i => !ids || ids.includes(i.id)).map(i => ({ id: i.id, hash: i.hash, category: "新归档", parentCategory: "随笔", mode: "auto", ...extra }));
	return { base, root, source, choose };
}

test("recursive discovery, hidden config skipped, original documents preserved", async t => {
	const f = await fixture(t, { "档/中文.md": "# 标题\n\n正文", ".obsidian/private.md": "secret", "杂记.txt": "普通文字", "report.docx": "unsupported" });
	const scanResult = await scan(f.root, f.source);
	assert.equal(scanResult.items.length, 2);
	assert.deepEqual(scanResult.unsupported, ["report.docx"]);
	const plan = await makePlan(f.root, f.source, await f.choose());
	const data = yamlDocument(splitDocument(plan.posts[0].content).frontmatter).toJS();
	assert.ok(data.published instanceof Date);
	assert.equal(data.category, "新归档");
	assert.equal(data.parentCategory, "随笔");
	assert.equal(await fs.readFile(path.join(f.source, "档/中文.md"), "utf8"), "# 标题\n\n正文");
});

test("directory archives keep every folder, derive each selection independently and leave sources intact", async t => {
	const id = "数学/代数/教材笔记/抽象代数/群同态.md";
	const raw = "#math #抽象代数 #comprehension\n\n正文。\n";
	const f = await fixture(t, { [id]: raw, "计算机/教材笔记/抽象代数/同名.md": "正文", "根目录.md": "正文" });
	const item = (await scan(f.root, f.source)).items.find(item => item.id === id);
	assert.equal(item.archiveMode, "directory");
	assert.deepEqual(item.directoryArchive.categoryPath, ["数学", "代数", "教材笔记", "抽象代数"]);
	const plan = await makePlan(f.root, f.source, await f.choose(null, { archiveMode: "directory", category: "忽略", parentCategory: "忽略" }));
	const post = plan.posts.find(post => post.id === id);
	const metadata = yamlDocument(post.frontmatter).toJS();
	assert.deepEqual(metadata.categoryPath, ["数学", "代数", "教材笔记", "抽象代数"]);
	assert.equal(metadata.category, "抽象代数");
	assert.equal(metadata.parentCategory, "教材笔记");
	assert.deepEqual(metadata.tags, ["math", "抽象代数", "comprehension"]);
	assert.equal(post.mathText, true);
	assert.doesNotMatch(post.body, /#math|#抽象代数|#comprehension/);
	assert.deepEqual(plan.posts.find(post => post.id === "根目录.md").categoryPath, ["未分类"]);
	assert.deepEqual(plan.posts.find(post => post.id.startsWith("计算机/")).categoryPath, ["计算机", "教材笔记", "抽象代数"]);
	assert.equal(await fs.readFile(path.join(f.source, id), "utf8"), raw);
	assert.doesNotMatch(post.frontmatter, /[A-Z]:\\/);
});

test("publishing removes only leading tag lines and respects manual metadata", async t => {
	const raw = "\r\n#math #数学/分析\r\n#math #学习\r\n\r\n## 标题\r\n正文 #保留\r\n\r\n```md\r\n#代码\r\n```\r\n";
	const leading = splitLeadingTags(raw);
	assert.deepEqual(leading.tags, ["math", "数学/分析", "学习"]);
	assert.match(leading.body, /^\r\n## 标题/);
	assert.equal(splitLeadingTags("```md\n#math\n```\n").body, "```md\n#math\n```\n");
	const f = await fixture(t, { "A.md": raw });
	const selections = await f.choose(null, { mode: "manual", frontmatter: "title: A\npublished: 2026-10-31\ntags: [自选]\n" });
	const post = (await makePlan(f.root, f.source, selections)).posts[0];
	assert.deepEqual(yamlDocument(post.frontmatter).toJS().tags, ["自选"]);
	assert.equal(yamlDocument(post.frontmatter).toJS().published.toISOString().slice(0, 10), "2026-10-31");
	assert.doesNotMatch(post.body, /#math|#数学\/分析|#学习/);
	assert.match(post.body, /正文 #保留/);
	assert.match(post.body, /```md\n#代码\n```/);
	assert.equal(await fs.readFile(path.join(f.source, "A.md"), "utf8"), raw);
});

test("moving a directory archive updates its path while retaining the published URL and date", async t => {
	const f = await fixture(t, { "数学/旧目录/A.md": "正文" });
	const original = (await makePlan(f.root, f.source, await f.choose(null, { archiveMode: "directory" }))).posts[0];
	await saveState(f.root, { entries: { [original.id]: original } });
	await fs.mkdir(path.join(f.source, "数学/新目录"), { recursive: true });
	await fs.rename(path.join(f.source, original.id), path.join(f.source, "数学/新目录/A.md"));
	const post = (await makePlan(f.root, f.source, await f.choose(null, { archiveMode: "directory" }))).posts[0];
	assert.equal(post.target, original.target);
	assert.deepEqual(post.categoryPath, ["数学", "新目录"]);
	assert.equal(yamlDocument(post.frontmatter).toJS().published.valueOf(), yamlDocument(original.frontmatter).toJS().published.valueOf());
});

test("full paths separate same-name categories, count descendants, and support legacy metadata", () => {
	const a = { categoryPath: ["数学", "代数", "教材笔记", "抽象代数"] };
	const b = { categoryPath: ["计算机", "教材笔记", "抽象代数"] };
	const legacy = { category: "数学分析", parentCategory: "数学" };
	const tree = buildCategoryTree([a, b, legacy], "未分类");
	const math = tree.find(node => node.name === "数学");
	assert.equal(math.totalCount, 2);
	assert.equal(math.children.find(node => node.name === "代数").children[0].children[0].count, 1);
	assert.equal(tree.find(node => node.name === "计算机").totalCount, 1);
	assert.equal(matchesCategoryPath(a, "数学/代数"), true);
	assert.equal(matchesCategoryPath(b, "数学/代数"), false);
	assert.equal(matchesCategoryPath(a, "数学/代"), false);
	assert.equal(matchesCategoryPath(legacy, "数学"), true);
	assert.deepEqual(getPostCategoryPath(legacy), ["数学", "数学分析"]);
	assert.equal(buildCategoryTree([{}], "未分类")[0].count, 1);
});

test("manual archives accept multiple parents, normalize both separators and reject empty levels", () => {
	const expected = { categoryPath: ["数学", "代数", "教材笔记", "抽象代数"], category: "抽象代数", parentCategory: "教材笔记" };
	assert.deepEqual(manualArchive({ category: " 抽象代数 ", parentPath: " 数学 / 代数 / 教材笔记 " }), expected);
	assert.deepEqual(manualArchive({ category: "抽象代数", parentPath: "数学\\代数\\教材笔记" }), expected);
	assert.deepEqual(manualArchive({ categoryPath: expected.categoryPath, category: "旧分类", parentCategory: "旧父级" }), expected);
	assert.deepEqual(manualArchive({ category: "世界模型", parentPath: "" }).categoryPath, ["世界模型"]);
	for (const parentPath of ["数学//代数", "/数学", "数学/", "数学/../代数"]) {
		assert.throws(() => manualArchive({ category: "抽象代数", parentPath }), /归档路径格式无效/);
	}
	assert.throws(() => manualArchive({ category: "代数/抽象代数", parentPath: "数学" }), /归档路径格式无效/);
	assert.throws(() => manualArchive({ categoryPath: "数学/代数" }), /必须是列表/);
});

test("manual parent paths persist through planning, saved settings and repeated import", async t => {
	const f = await fixture(t, { "A.md": "原始正文", "B.md": "另一篇正文" });
	const selections = await f.choose(null, { archiveMode: "manual", category: "抽象代数", parentPath: "数学 / 代数 / 教材笔记" });
	const plan = await makePlan(f.root, f.source, selections);
	for (const post of plan.posts) {
		assert.deepEqual(post.categoryPath, ["数学", "代数", "教材笔记", "抽象代数"]);
		const data = yamlDocument(post.frontmatter).toJS();
		assert.deepEqual(data.categoryPath, post.categoryPath);
		assert.equal(data.parentCategory, "教材笔记");
	}
	await saveState(f.root, { entries: Object.fromEntries(plan.posts.map(post => [post.id, post])) });
	const scanResult = await scan(f.root, f.source);
	assert.equal(scanResult.items[0].archiveMode, "manual");
	assert.deepEqual(scanResult.items[0].categoryPath, plan.posts[0].categoryPath);
	const again = await makePlan(f.root, f.source, await f.choose(null, {
		archiveMode: "manual", categoryPath: scanResult.items[0].categoryPath,
	}));
	assert.deepEqual(again.posts.map(post => post.outputHash), plan.posts.map(post => post.outputHash));
	assert.equal(await fs.readFile(path.join(f.source, "A.md"), "utf8"), "原始正文");
});

test("manual metadata is validated, false flags and custom fields preserved", async t => {
	const f = await fixture(t, { "A.md": "正文" });
	const selection = await f.choose(null, { mode: "manual", frontmatter: 'title: 手写标题\npublished: 2026-09-20\ndraft: true\ncomment: false\npriority: 2\ntags: [学习]\n' });
	const plan = await makePlan(f.root, f.source, selection);
	assert.equal(plan.posts[0].title, "手写标题");
	assert.equal(plan.posts[0].draft, true);
	assert.match(plan.posts[0].frontmatter, /comment: false/);
	selection[0].frontmatter = 'title: 标题\npublished: "2026-09-20"';
	await assert.rejects(makePlan(f.root, f.source, selection), /不带引号/);
	selection[0].frontmatter = "title: 标题\ntitle: 重复\npublished: 2026-09-20";
	await assert.rejects(makePlan(f.root, f.source, selection), /frontmatter 格式错误/);
	selection[0].frontmatter = "published: 2026-09-20";
	await assert.rejects(makePlan(f.root, f.source, selection), /title/);
});

test("automatic mode keeps source metadata and migrates legacy date keys", async t => {
	const f = await fixture(t, { "A.md": '---\ntitle: 原标题\ndate: 2020-01-02\ndraft: true\ncomment: false\ntags: [一, 二]\n---\n# 标题不应覆盖\n正文' });
	const [post] = (await makePlan(f.root, f.source, await f.choose())).posts;
	const data = yamlDocument(post.frontmatter).toJS();
	assert.equal(data.published.toISOString().slice(0, 10), "2020-01-02");
	assert.equal(data.title, "原标题");
	assert.equal(data.comment, false);
	assert.equal(data.draft, true);
	assert.deepEqual(data.tags, ["一", "二"]);
});

test("source modifications and path traversal are rejected", async t => {
	const f = await fixture(t, { "A.md": "原文" });
	const selections = await f.choose();
	await fs.writeFile(path.join(f.source, "A.md"), "修改");
	await assert.rejects(makePlan(f.root, f.source, selections), /已被修改/);
	await fs.writeFile(path.join(f.base, "outside.md"), "private");
	await assert.rejects(inside(f.source, "../outside.md"), /目录内/);
});

test("cross-folder wikilinks, Markdown links, aliases, heading and block references", async t => {
	const f = await fixture(t, {
		"甲/A.md": "# A\n[[../乙/B#标题|别名]]\n[普通链接](../乙/B.md#标题)\n[[乙/B#^block1]]\n[引用式][ref]\n\n[ref]: ../乙/B.md\n",
		"乙/B.md": "## 标题\n\n内容 ^block1\n",
	});
	const plan = await makePlan(f.root, f.source, await f.choose());
	const a = plan.posts.find(p => p.id === "甲/A.md");
	const b = plan.posts.find(p => p.id === "乙/B.md");
	assert.match(a.content, new RegExp(`\\[\\[${postSlug(b.target)}#标题\\|别名\\]\\]`));
	assert.match(a.content, /\|普通链接\]\]/);
	assert.match(a.content, /\^block1\|/);
	assert.match(b.content, /<span id="block-block1"><\/span>/);
	assert.equal(plan.references.length, 4);
	await assert.rejects(makePlan(f.root, f.source, await f.choose(["甲/A.md"])), /尚未提交/);
});

test("missing and ambiguous references cannot silently produce broken pages", async t => {
	const f = await fixture(t, { "A.md": "[[缺失文章]]", "甲/B.md": "B", "乙/B.md": "B" });
	await assert.rejects(makePlan(f.root, f.source, await f.choose()), /找不到引用目标/);
	await fs.writeFile(path.join(f.source, "A.md"), "[[B]]");
	await assert.rejects(makePlan(f.root, f.source, await f.choose()), /引用重名/);
	await fs.writeFile(path.join(f.source, "A.md"), "[[甲/B]]");
	const selections = await f.choose();
	Object.assign(selections.find(s => s.id === "甲/B.md"), { mode: "manual", frontmatter: "title: B\npublished: 2026-01-01\ndraft: true" });
	await assert.rejects(makePlan(f.root, f.source, selections), /引用了草稿/);
});

test("attachments resolve relative to source and from vault; code stays untouched", async t => {
	const code = '```md\n[[missing]] ![[missing.png]]\n```\n`[[also missing]]`\n';
	const f = await fixture(t, { "目录/A.md": `# A\n![[Pasted image.png]]\n![图片](<../附件/Pasted image.png>)\n${code}`, "附件/Pasted image.png": Buffer.from([1, 2, 3]) });
	const plan = await makePlan(f.root, f.source, await f.choose());
	assert.equal(plan.writes.size, 2);
	assert.match(plan.posts[0].content, /!\[\]\(\/images\/blog-import\/[a-f0-9]+\.png\)/);
	assert.ok(plan.posts[0].content.endsWith(code));
	assert.equal(await transformProse("    [[missing]]\n", () => "changed"), "    [[missing]]\n");
});

test("cover images and explicit reference-style images are copied", async t => {
	const f = await fixture(t, { "A.md": '---\ntitle: A\npublished: 2026-09-01\nimage: 图片.png\n---\n![展示][picture]\n\n[picture]: 图片.png\n', "图片.png": Buffer.from([8, 7, 6]) });
	const plan = await makePlan(f.root, f.source, await f.choose());
	assert.match(plan.posts[0].frontmatter, /image: \/images\/blog-import\//);
	assert.match(plan.posts[0].body, /!\[展示\]\(\/images\/blog-import\//);
	assert.equal(plan.writes.size, 2);
});

test("published block anchors can be referenced without reimporting the target", async t => {
	const f = await fixture(t, { "A.md": "[[B#^block1]]\n![[附件.pdf]]", "B.md": "内容 ^block1\n", "附件.pdf": "pdf-test" });
	const first = await makePlan(f.root, f.source, await f.choose());
	const b = first.posts.find(p => p.id === "B.md");
	await fs.writeFile(path.join(f.root, b.target), b.content);
	await saveState(f.root, { entries: { "B.md": b } });
	const again = await makePlan(f.root, f.source, await f.choose(["A.md"]));
	assert.equal(again.references.length, 1);
	assert.match(again.posts[0].body, /\[附件\.pdf\]\(\/images\/blog-import\//);
	assert.doesNotMatch(again.posts[0].body, /!\[附件/);
});

test("automatic updates preserve the original publication date", async t => {
	const f = await fixture(t, { "A.md": "# A\n更新的正文" });
	await saveState(f.root, { entries: { "A.md": { frontmatter: "title: A\npublished: 2020-01-02\n", mode: "auto" } } });
	const plan = await makePlan(f.root, f.source, await f.choose());
	assert.equal(yamlDocument(plan.posts[0].frontmatter).toJS().published.toISOString().slice(0, 10), "2020-01-02");
});

test("generated links are recognized by the actual website backlink graph", async t => {
	const f = await fixture(t, { "甲/26.09.22 A.md": "# A\n[[../乙/B#细节|显示文字]]\n[返回说明](../乙/B.md)\n", "乙/B.md": "# B\n## 细节\n[[../甲/26.09.22 A]]" });
	const plan = await makePlan(f.root, f.source, await f.choose());
	for (const [file, bytes] of plan.writes) await fs.writeFile(path.join(f.root, file), bytes);
	const a = plan.posts.find(p => p.id.startsWith("甲/"));
	const b = plan.posts.find(p => p.id.startsWith("乙/"));
	const module = pathToFileURL(fileURLToPath(new URL("../../src/utils/link-graph.mjs", import.meta.url))).href;
	const output = await run(process.execPath, ["--input-type=module", "-e", `import {getBacklinks,getOutlinks,resolveWikiLink} from ${JSON.stringify(module)}; console.log(JSON.stringify({inbound:getBacklinks(${JSON.stringify(postSlug(b.target))}),outbound:getOutlinks(${JSON.stringify(postSlug(a.target))}),link:resolveWikiLink(${JSON.stringify(`${postSlug(b.target)}#细节`)})}));`], f.root);
	const graph = JSON.parse(output);
	assert.equal(graph.inbound[0].slug, postSlug(a.target));
	assert.equal(graph.outbound[0].slug, postSlug(b.target));
	assert.equal(graph.link.href, `/posts/${postSlug(b.target)}/#细节`);
});

test("same filenames in different folders get stable unique destinations", async t => {
	const f = await fixture(t, { "甲/同名.md": "甲", "乙/同名.md": "乙" });
	const selections = await f.choose();
	const one = await makePlan(f.root, f.source, selections);
	const two = await makePlan(f.root, f.source, selections);
	assert.notEqual(one.posts[0].target, one.posts[1].target);
	assert.deepEqual(one.posts.map(p => p.target), two.posts.map(p => p.target));
});

test("only the Math tag enables conversion, including manual frontmatter", async t => {
	assert.equal(isMathText({ tags: ["Math", "学习"] }), true);
	assert.equal(isMathText({ tags: ["math"] }), true);
	assert.equal(isMathText({ tags: ["MATH"] }), true);
	assert.equal(isMathText({ tags: ["mathematics", "数学"], category: "数学分析" }), false);
	assert.equal(isMathText({ category: "数学", title: "线性代数" }), false);
	const f = await fixture(t, { "数学.md": "第一段。\n\n第二段。" });
	const plan = await makePlan(f.root, f.source, await f.choose(null, { contentType: "math" }));
	assert.equal(plan.posts[0].body, "第一段。\n\n第二段。");
	assert.equal(plan.posts[0].mathText, false);
	const manual = await makePlan(f.root, f.source, await f.choose(null, { mode: "manual", frontmatter: "title: 数学\npublished: 2026-10-03\ntags: [Math]\n" }));
	assert.equal(manual.posts[0].body, "第一段.\n\n第二段.");
	await saveState(f.root, { entries: { "数学.md": manual.posts[0] } });
	assert.equal((await scan(f.root, f.source)).items[0].mathText, true);
});

test("math punctuation converts visible content, preserves link destinations and source", async t => {
	const source = "---\ntags: [Math]\n---\n# 标题。\n\n第一段。$\\text{结论。}$\n\n第二段。\n\n[外链。](https://example.invalid/目录。/a)\n";
	const f = await fixture(t, { "数学/A.md": source });
	const plan = await makePlan(f.root, f.source, await f.choose());
	const post = plan.posts[0];
	assert.equal(post.mathText, true);
	assert.equal(post.title, "标题.");
	assert.match(post.body, /第一段\.\$\\text\{结论\.\}\$/);
	assert.match(post.body, /\n\n第二段\.\n\n/);
	assert.match(post.body, /\[外链\.\]\(https:\/\/example.invalid\/目录。\/a\)/);
	assert.doesNotMatch(yamlDocument(post.frontmatter).toJS().description, /。/);
	assert.equal(await fs.readFile(path.join(f.source, "数学/A.md"), "utf8"), source);
});

test("heading references follow the target's math setting and retain older anchors", async t => {
	const f = await fixture(t, { "数学/A.md": "---\ntags: [Math]\n---\n[[B。#结论。|引用。]]\n[[C#保留。|说明。]]", "B。.md": "---\ntags: [math]\n---\n## 结论。\n\n正文。", "C.md": "## 保留。\n\n普通文本。" });
	const selections = await f.choose();
	const plan = await makePlan(f.root, f.source, selections);
	const a = plan.posts.find(p => p.id === "数学/A.md");
	const b = plan.posts.find(p => p.id === "B。.md");
	assert.match(a.body, /#结论\.\|引用\.\]\]/);
	assert.match(a.body, /#保留。\|说明\.\]\]/);
	assert.equal(plan.references.find(r => r.target === "B。.md").suffix, "#结论.");
	const renderer = await createMarkdownProcessor({ syntaxHighlight: false });
	const html = parseHtml((await renderer.render(b.body)).code);
	assert.ok(html.querySelectorAll("[id]").some(n => n.id === "结论。"));
	assert.ok(html.querySelectorAll("[id]").some(n => n.id === "结论"));
});

test("Obsidian blank lines produce separate paragraphs with the site's math renderer", async t => {
	const source = "---\r\ntags: [Math]\r\n---\r\n第一段。\r\n继续第一段。\r\n\r\n第二段。\r\n\u3000\r\n第三段。\r\n\r\n$$\r\nx^2=1\r\n$$\r\n\r\n公式后的段落。\r\n\r\n> 引用第一段。\r\n>\u3000\r\n> 引用第二段。\r\n";
	const f = await fixture(t, { "数学/分段.md": source });
	const post = (await makePlan(f.root, f.source, await f.choose())).posts[0];
	assert.match(post.body, /第一段\.\n继续第一段\.\n\n第二段\.\n\n第三段\./);
	assert.match(post.body, /\$\$\nx\^2=1\n\$\$\n\n公式后的段落\./);
	const renderer = await createMarkdownProcessor({ syntaxHighlight: false, remarkPlugins: [remarkMath], rehypePlugins: [rehypeMathjax] });
	const html = parseHtml((await renderer.render(post.body)).code);
	const paragraphs = html.querySelectorAll("p").map(p => p.textContent.trim());
	assert.ok(paragraphs.includes("第一段.\n继续第一段."));
	for (const text of ["第二段.", "第三段.", "公式后的段落.", "引用第一段.", "引用第二段."]) assert.ok(paragraphs.includes(text), text);
	assert.ok(html.querySelector('mjx-container[display="true"]'));
	assert.equal(html.querySelectorAll("blockquote p").length, 2);
	assert.equal(await fs.readFile(path.join(f.source, "数学/分段.md"), "utf8"), source);
});

test("paragraph normalization leaves code and display-math whitespace untouched", () => {
	const source = "```txt\n\u3000\n代码\n```\n\n$$\na+b\n\u3000\n=c\n$$\n\n普通段落\n\u3000\n下一段";
	assert.equal(formatBody(source, false), source.replace("普通段落\n\u3000\n下一段", "普通段落\n\n下一段"));
});

test("an accidental quoted closing math fence cannot swallow following sections", async () => {
	const raw = "$$\nf:G\\to G/N\n> $$\n\n### 同构定理\n\n正文\n\n> $$\n> x=1\n> $$\n";
	const body = formatBody(raw, false);
	assert.ok(body.endsWith("> $$\n> x=1\n> $$\n"));
	const renderer = await createMarkdownProcessor({ syntaxHighlight: false, remarkPlugins: [remarkMath], rehypePlugins: [rehypeMathjax] });
	const html = parseHtml((await renderer.render(body)).code);
	assert.equal(html.querySelector("h3").textContent, "同构定理");
	assert.equal(html.querySelectorAll("[data-mjx-error]").length, 0);
	assert.equal(html.querySelectorAll('mjx-container[display="true"]').length, 2);
});

test("built-page verification detects missing heading anchors and broken wiki links", async t => {
	const f = await fixture(t);
	await fs.mkdir(path.join(f.root, "dist/posts/a"), { recursive: true });
	await fs.mkdir(path.join(f.root, "dist/posts/b"), { recursive: true });
	await fs.writeFile(path.join(f.root, "dist/posts/a/index.html"), '<a class="wiki-link" href="/posts/b/#目标">B</a>');
	await fs.writeFile(path.join(f.root, "dist/posts/b/index.html"), '<h2 id="目标">标题</h2>');
	const plan = { posts: [{ id: "a.md", target: "src/content/posts/a.md" }] };
	await verifyBuiltLinks(f.root, plan);
	await fs.writeFile(path.join(f.root, "dist/posts/b/index.html"), '<h2 id="different">标题</h2>');
	await assert.rejects(verifyBuiltLinks(f.root, plan), /锚点不存在/);
});

async function gitFixture(t) {
	const f = await fixture(t, { "A.md": "# 文章\n正文" });
	const remote = path.join(f.base, "remote.git");
	await git(f.base, ["init", "--bare", remote]);
	await git(f.root, ["init", "-b", "main"]);
	await git(f.root, ["config", "user.name", "Manager Test"]);
	await git(f.root, ["config", "user.email", "manager@example.invalid"]);
	await fs.writeFile(path.join(f.root, ".gitignore"), ".blog-manager/\n");
	await fs.writeFile(path.join(f.root, "unrelated.txt"), "original");
	await git(f.root, ["add", "."]);
	await git(f.root, ["commit", "-m", "initial"]);
	await git(f.root, ["remote", "add", "origin", remote]);
	await git(f.root, ["push", "-u", "origin", "main"]);
	return { ...f, remote };
}

test("moving a published note updates its original URL and migrates the saved identity", async t => {
	const f = await gitFixture(t);
	const original = await prepare(f.root, f.source, await makePlan(f.root, f.source, await f.choose()), () => {}, async () => {});
	await publish(f.root, original, () => {});
	const first = original.plan.posts[0];
	await discard(f.root, original);
	await fs.mkdir(path.join(f.source, "新目录"));
	await fs.rename(path.join(f.source, "A.md"), path.join(f.source, "新目录/A.md"));
	await fs.appendFile(path.join(f.source, "新目录/A.md"), "\n新的正文");
	assert.match((await scan(f.root, f.source)).items[0].status, /路径已变更/);
	const plan = await makePlan(f.root, f.source, await f.choose());
	assert.equal(plan.posts[0].target, first.target);
	assert.equal(yamlDocument(plan.posts[0].frontmatter).toJS().published.valueOf(), yamlDocument(first.frontmatter).toJS().published.valueOf());
	const prepared = await prepare(f.root, f.source, plan, () => {}, async () => {});
	await publish(f.root, prepared, () => {});
	assert.equal(await git(f.remote, ["ls-tree", "-r", "--name-only", "main", "src/content/posts"]), first.target);
	assert.match(await git(f.remote, ["show", `main:${first.target}`]), /新的正文/);
	const state = await readState(f.root);
	assert.equal(state.entries["A.md"], undefined);
	assert.equal(state.entries["新目录/A.md"].target, first.target);
	await discard(f.root, prepared);
	assert.equal((await makePlan(f.root, f.source, await f.choose())).posts[0].outputHash, plan.posts[0].outputHash);
});

test("renamed notes match their unique title; ambiguous historical matches are blocked", async t => {
	const f = await fixture(t, { "改名.md": "# 固定标题\n新正文" });
	const saved = { target: "src/content/posts/original.md", title: "固定标题", frontmatter: "title: 固定标题\npublished: 2020-01-02\n" };
	await saveState(f.root, { entries: { "旧名.md": saved } });
	assert.equal((await makePlan(f.root, f.source, await f.choose())).posts[0].target, saved.target);
	await saveState(f.root, { entries: { "旧名.md": saved, "其他旧名.md": { ...saved, target: "src/content/posts/other.md" } } });
	assert.match((await scan(f.root, f.source)).items[0].error, /多篇历史文章/);
	await assert.rejects(makePlan(f.root, f.source, [{ id: "改名.md", hash: hash("# 固定标题\n新正文"), category: "测试", mode: "auto" }]), /多篇历史文章/);
});

test("an active source is never adopted as a moved note", async t => {
	const f = await fixture(t, { "旧/A.md": "# 同名\n旧", "新/A.md": "# 同名\n新" });
	await saveState(f.root, { entries: { "旧/A.md": { target: "src/content/posts/original.md", title: "同名" } } });
	const plan = await makePlan(f.root, f.source, await f.choose());
	assert.notEqual(plan.posts[0].target, plan.posts[1].target);
});

test("publish commits only reviewed files, preserves unrelated staged changes, is repeatable", async t => {
	const f = await gitFixture(t);
	await fs.writeFile(path.join(f.root, "unrelated.txt"), "do not publish");
	await git(f.root, ["add", "unrelated.txt"]);
	const plan = await makePlan(f.root, f.source, await f.choose());
	let validated = false;
	const prepared = await prepare(f.root, f.source, plan, () => {}, async () => { validated = true; });
	assert.ok(validated);
	const result = await publish(f.root, prepared, () => {});
	assert.equal(result.status, "pushed");
	assert.equal(await git(f.remote, ["show", "main:unrelated.txt"]), "original");
	assert.equal(await git(f.root, ["diff", "--cached", "--name-only"]), "unrelated.txt");
	assert.equal((await readState(f.root)).entries["A.md"].sourceHash, hash("# 文章\n正文"));
	await discard(f.root, prepared);
	const again = await prepare(f.root, f.source, await makePlan(f.root, f.source, await f.choose()), () => {}, async () => {});
	assert.equal(again.changes, "");
	assert.equal((await publish(f.root, again, () => {})).status, "unchanged");
	await discard(f.root, again);
});

test("failed validation never pushes; concurrent remote edits force recheck", async t => {
	const f = await gitFixture(t);
	const base = await git(f.remote, ["rev-parse", "main"]);
	const plan = await makePlan(f.root, f.source, await f.choose());
	await assert.rejects(prepare(f.root, f.source, plan, () => {}, async () => { throw new Error("build failed"); }), /build failed/);
	assert.equal(await git(f.remote, ["rev-parse", "main"]), base);
	const prepared = await prepare(f.root, f.source, plan, () => {}, async () => {});
	await fs.writeFile(path.join(f.root, "new.txt"), "remote change");
	await git(f.root, ["add", "new.txt"]);
	await git(f.root, ["commit", "-m", "other work"]);
	await git(f.root, ["push", "origin", "main"]);
	await assert.rejects(publish(f.root, prepared, () => {}), /新的更新/);
	assert.equal((await readState(f.root)).entries["A.md"], undefined);
	await discard(f.root, prepared);
});

test("published target changed outside the manager cannot be overwritten", async t => {
	const f = await gitFixture(t);
	const plan = await makePlan(f.root, f.source, await f.choose());
	await fs.writeFile(path.join(f.root, plan.posts[0].target), "someone else changed it");
	await git(f.root, ["add", "."]);
	await git(f.root, ["commit", "-m", "edit elsewhere"]);
	await git(f.root, ["push", "origin", "main"]);
	await saveState(f.root, { entries: { "A.md": { ...plan.posts[0], outputHash: hash("older content") } } });
	await assert.rejects(prepare(f.root, f.source, plan, () => {}, async () => {}), /不会覆盖/);
});
