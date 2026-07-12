/**
 * Remark 插件：把 Obsidian 风格的 [[wiki-link]] 语法转换成 <a> 节点。
 *
 * 支持的语法：
 *   [[note]]
 *   [[note|alias]]
 *   [[note#heading]]
 *   [[note#heading|alias]]
 *   [[note^block-id]]
 *
 * 断链会被渲染为带 .wiki-link-broken 类的 <a>，方便样式区分。
 */

import { visit } from "unist-util-visit";
import { resolveWikiLink } from "../utils/link-graph.mjs";

const WIKI_LINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;

export function remarkWikiLink() {
	return (tree) => {
		visit(tree, "text", (node, index, parent) => {
			if (!parent || typeof node.value !== "string") return;
			if (!node.value.includes("[[")) return;

			const value = node.value;
			const children = [];
			let lastIndex = 0;
			let match;

			WIKI_LINK_RE.lastIndex = 0;
			while ((match = WIKI_LINK_RE.exec(value)) !== null) {
				if (match.index > lastIndex) {
					children.push({
						type: "text",
						value: value.slice(lastIndex, match.index),
					});
				}

				const raw = match[1];
				let target = raw;
				let alias = null;
				if (raw.includes("|")) {
					const idx = raw.indexOf("|");
					target = raw.slice(0, idx).trim();
					alias = raw.slice(idx + 1).trim();
				}

				const resolved = resolveWikiLink(target);
				const displayText = alias ?? target;

				if (resolved) {
					children.push({
						type: "link",
						url: resolved.href,
						title: resolved.title || null,
						data: {
							hProperties: {
								className: ["wiki-link"],
								"data-wiki-target": target,
							},
						},
						children: [{ type: "text", value: displayText }],
					});
				} else {
					children.push({
						type: "link",
						url: "#",
						title: null,
						data: {
							hProperties: {
								className: ["wiki-link", "wiki-link-broken"],
								"data-wiki-target": target,
							},
						},
						children: [{ type: "text", value: displayText }],
					});
				}

				lastIndex = match.index + match[0].length;
			}

			if (lastIndex === 0) return;
			if (lastIndex < value.length) {
				children.push({ type: "text", value: value.slice(lastIndex) });
			}

			parent.children.splice(index, 1, ...children);
			return index + children.length;
		});
	};
}
