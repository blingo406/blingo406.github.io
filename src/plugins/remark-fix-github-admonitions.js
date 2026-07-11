import { visit } from "unist-util-visit";

// 匹配 Obsidian 风格的 callout 声明，支持可选标题和折叠标记
// 例如：[!note]、[!warning]+ 、[!tip]- 自定义标题
const OBSIDIAN_CALLOUT_REGEX = /^\s*\[!(?<type>\w+)\](?<foldable>[+-]?)(?:\s+(?<title>.+))?\s*$/;

// Obsidian callout 类型别名映射到规范名称
const TYPE_ALIAS_MAP = {
	// 已有类型
	note: "note",
	tip: "tip",
	important: "important",
	warning: "warning",
	caution: "caution",
	// 新增规范类型
	abstract: "abstract",
	info: "info",
	success: "success",
	question: "question",
	failure: "failure",
	danger: "danger",
	bug: "bug",
	example: "example",
	quote: "quote",
	// 别名映射
	seealso: "note",
	hint: "tip",
	attention: "warning",
	summary: "abstract",
	tldr: "abstract",
	todo: "info",
	check: "success",
	done: "success",
	help: "question",
	faq: "question",
	fail: "failure",
	missing: "failure",
	error: "danger",
	cite: "quote",
};

function parseCalloutDeclaration(text) {
	const match = text.match(OBSIDIAN_CALLOUT_REGEX);
	if (!match) return null;
	const rawType = match.groups.type.toLowerCase();
	const canonicalType = TYPE_ALIAS_MAP[rawType];
	if (!canonicalType) return null;
	return {
		type: canonicalType,
		title: match.groups.title?.trim() || null,
	};
}

export function remarkFixGithubAdmonitions() {
	return (tree) => {
		visit(tree, "blockquote", (node, index, parent) => {
			if (!parent || index === undefined) {
				return;
			}

			const firstChild = node.children[0];
			if (firstChild?.type !== "paragraph") {
				return;
			}

			const firstParagraphChild = firstChild.children[0];
			if (firstParagraphChild?.type !== "text") {
				return;
			}

			const possibleTypeDeclaration = firstParagraphChild.value.split("\n")[0];
			if (!possibleTypeDeclaration) {
				return;
			}

			const parsed = parseCalloutDeclaration(possibleTypeDeclaration);
			if (!parsed) {
				return;
			}

			const { type: directiveName, title } = parsed;

			const textNodeChildren =
				firstParagraphChild.value.split("\n").length > 1
					? [
							{
								type: "text",
								value: firstParagraphChild.value
									.split("\n")
									.slice(1)
									.join("\n"),
							},
						]
					: [];

			const paragraphChildren = [
				...textNodeChildren,
				...firstChild.children.slice(1),
			];

			const alertParagraphChildren =
				paragraphChildren.length > 0
					? [{ type: "paragraph", children: paragraphChildren }]
					: [];

			const directive = {
				type: "containerDirective",
				name: directiveName,
				attributes: title ? { title } : {},
				children: [...alertParagraphChildren, ...node.children.slice(1)],
			};

			parent.children[index] = directive;
		});
	};
}
