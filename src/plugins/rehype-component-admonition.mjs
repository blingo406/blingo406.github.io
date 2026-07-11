/// <reference types="mdast" />
import { h } from "hastscript";

/**
 * Creates an admonition component.
 *
 * @param {Object} properties - The properties of the component.
 * @param {string} [properties.title] - An optional title.
 * @param {('tip'|'note'|'important'|'caution'|'warning')} type - The admonition type.
 * @param {import('mdast').RootContent[]} children - The children elements of the component.
 * @returns {import('mdast').Parent} The created admonition component.
 */
// 默认标题映射（首字母大写的规范名称）
const DEFAULT_TITLES = {
	note: "Note",
	tip: "Tip",
	important: "Important",
	warning: "Warning",
	caution: "Caution",
	abstract: "Abstract",
	info: "Info",
	success: "Success",
	question: "Question",
	failure: "Failure",
	danger: "Danger",
	bug: "Bug",
	example: "Example",
	quote: "Quote",
};

export function AdmonitionComponent(properties, children, type) {
	if (!Array.isArray(children) || children.length === 0) {
		return h(
			"div",
			{ class: "hidden" },
			'Invalid admonition directive. (Admonition directives must be of block type ":::note{name="name"} <content> :::")',
		);
	}

	let label = null;
	if (properties?.["has-directive-label"]) {
		// :::note[Custom Title] 语法
		label = children[0];
		// biome-ignore lint/style/noParameterAssign: <check later>
		children = children.slice(1);
		label.tagName = "div";
	} else if (properties?.title) {
		// >[!type] Custom Title 语法（Obsidian 风格）
		label = h("span", {}, properties.title);
	}

	const titleText = label ?? (DEFAULT_TITLES[type] ?? type.toUpperCase());

	return h("blockquote", { class: `admonition bdm-${type}` }, [
		h("span", { class: "bdm-title" }, titleText),
		...children,
	]);
}
