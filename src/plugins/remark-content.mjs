import getReadingTime from "reading-time";
import { visit } from "unist-util-visit";

export function remarkContent() {
	return (tree, { data }) => {
		// --- 安全性检查：确保 data.astro 存在 ---
		if (!data.astro) {
			data.astro = {};
		}
		if (!data.astro.frontmatter) {
			data.astro.frontmatter = {};
		}

		let fullText = ""; // 用于计算字数（包含全文）
		let excerpt = ""; // 用于存放摘要

		// 定义“手动摘要”的分隔符正则 (支持 或 ，忽略大小写)
		const moreTagRegex = /<!--\s*more\s*-->/i;
		let moreTagIndex = -1;

		// --- 遍历 AST 查找手动摘要分隔符 ---
		if (tree.children && Array.isArray(tree.children)) {
			moreTagIndex = tree.children.findIndex(
				(node) =>
					node.type === "html" && node.value && moreTagRegex.test(node.value),
			);
		}

		// --- 计算摘要 (Excerpt) ---
		if (moreTagIndex !== -1) {
			// 提取它之前的所有内容
			const excerptNodes = tree.children.slice(0, moreTagIndex);
			excerpt = excerptNodes.map(getNodeText).join("");
		} else {
			// 提取第一个非空的段落
			if (tree.children && Array.isArray(tree.children)) {
				for (const node of tree.children) {
					if (node.type === "paragraph") {
						const text = getNodeText(node);
						// 确保提取出的文本不是仅包含空白字符
						if (text && text.trim().length > 0) {
							excerpt = text;
							break;
						}
					}
				}
			}
		}

		// --- 收集正文文本（用于字数 & 阅读时间）---
		visit(tree, (node) => {
			// 跳过代码块，不计入字数
			if (node.type === "code" || node.type === "inlineCode") {
				return "skip";
			}

			// 文本节点与数学公式节点都要计入。
			// remark-math 会把 $...$ / $$...$$ 解析成 inlineMath / math 节点，
			// LaTeX 源码存放在 node.value；此前只统计 text 节点，导致数理文章的
			// 字数严重偏低（与 Obsidian 的字符计数相去甚远）。
			if (
				(node.type === "text" ||
					node.type === "inlineMath" ||
					node.type === "math") &&
				node.value
			) {
				fullText += `${node.value} `;
			}
		});

		// 针对 CJK (中日韩) 字符的字数统计优化
		const cjkPattern =
			/[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/g;

		const cjkMatches = fullText.match(cjkPattern);
		const cjkCount = cjkMatches ? cjkMatches.length : 0;

		// 字数：按“字符”统计（去除所有空白），对齐 Obsidian 状态栏的字符计数。
		const totalWords = fullText.replace(/\s+/g, "").length;

		// 阅读时间：西文按词（200/分）、中文按字（400/分）估算。
		const nonCjkText = fullText.replace(cjkPattern, " ");
		const nonCjkWords = getReadingTime(nonCjkText).words;
		const minutes = nonCjkWords / 200 + cjkCount / 400;

		// --- 注入数据到 Frontmatter ---
		data.astro.frontmatter.excerpt = excerpt;
		data.astro.frontmatter.minutes = Math.max(1, Math.round(minutes));
		data.astro.frontmatter.words = totalWords;
	};
}

/**
 * 辅助函数：递归从节点中提取纯文本
 */
function getNodeText(node) {
	// 安全性检查
	if (!node) {
		return "";
	}

	// 如果是文本节点，直接返回
	if (node.type === "text") {
		return node.value || "";
	}

	// 如果是图片，提取 alt 文本 (可选，这里选择提取以保持语义)
	if (node.type === "image") {
		return node.alt || "";
	}

	// 跳过代码块和 HTML 标签
	if (
		node.type === "code" ||
		node.type === "inlineCode" ||
		node.type === "html"
	) {
		return "";
	}

	// 递归处理子节点
	if (node.children && Array.isArray(node.children)) {
		return node.children.map(getNodeText).join("");
	}

	return "";
}
