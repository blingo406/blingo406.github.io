import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import rehypeMathjax from "rehype-mathjax";
import remarkMath from "remark-math";
import { remarkObsidianInline } from "../src/plugins/remark-obsidian-inline.mjs";
import { remarkWikiLink } from "../src/plugins/remark-wiki-link.mjs";

const processor = await createMarkdownProcessor({
	remarkPlugins: [remarkMath, remarkWikiLink, remarkObsidianInline],
	rehypePlugins: [rehypeMathjax],
	syntaxHighlight: false,
});
const render = async (source) => (await processor.render(source)).code;

test("highlight wraps math and emphasis while accepting inner whitespace", async () => {
	const html = await render("或==存在$M>0$==，== **注意** ==。");
	assert.match(html, /<mark>存在<mjx-container/);
	assert.match(html, /<mark> <strong>注意<\/strong> <\/mark>/);
	assert.ok(!html.includes("=="));
});

test("body hashtags are no longer rendered as tag links", async () => {
	const html = await render("#math #数学分析 #comprehension #数学/积分");
	assert.ok(!html.includes('class="obsidian-tag"'));
	assert.match(html, /#math #数学分析 #comprehension #数学\/积分/);
});

test("code, math, links, wiki fragments, headings and numeric hashes stay intact", async () => {
	const html = await render(
		"# 标题\n\n`==code== #math` $x==y$ [#math](/a) [[#heading]] #123 https://example.com/#anchor\n\n```text\n==code== #math\n```",
	);
	assert.ok(!html.includes("<mark>"));
	assert.ok(!html.includes('class="obsidian-tag"'));
	assert.match(html, /<h1[^>]*>标题<\/h1>/);
});

test("unmatched, escaped and longer delimiters stay literal", async () => {
	const html = await render(
		String.raw`==未闭合\n\n\==普通\== ===普通=== \#math`.replaceAll(
			String.raw`\n`,
			"\n",
		),
	);
	assert.ok(!html.includes("<mark>"));
	assert.ok(!html.includes('class="obsidian-tag"'));
});
