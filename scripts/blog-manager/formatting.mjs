import MarkdownIt from "markdown-it";
import { slugify } from "../../src/utils/link-graph.mjs";

const parser = new MarkdownIt();
// Move Obsidian's leading tag-only lines to metadata in the publishing copy.
export function splitLeadingTags(body) {
	const tags = [];
	let rest = body;
	const line = /^(?:[ \t]*\r?\n)*[ \t]*((?:#[\p{L}\p{N}_/-]+[ \t]*)+)(?:\r?\n|$)/u;
	let match;
	while ((match = rest.match(line))) {
		tags.push(...[...match[1].matchAll(/#([^\s#]+)/g)].map(item => item[1]));
		rest = rest.slice(match[0].length);
	}
	return { tags: [...new Set(tags)], body: rest };
}

export function isMathText(metadata) {
	return Array.isArray(metadata.tags) && metadata.tags.some(tag => typeof tag === "string" && tag.trim().toLowerCase() === "math");
}

export const mathPeriods = text => text.replaceAll("。", ".");

function keepHeadingAnchors(body) {
	const lines = body.split("\n");
	const aliases = new Map();
	const usedIds = new Set();
	for (const token of parser.parse(body, {})) {
		if (token.type !== "heading_open" || !token.map) continue;
		const i = token.map[0];
		const match = lines[i].match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
		if (!match) continue;
		const oldId = slugify(match[1]);
		const newId = slugify(mathPeriods(match[1]));
		usedIds.add(newId);
		if (oldId !== newId) aliases.set(oldId, i);
	}
	for (const [oldId, i] of aliases) {
		if (usedIds.has(oldId)) continue;
		// Older published posts may still link to a heading with Chinese punctuation.
		const safeId = oldId.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
		lines[i] = `<div id="${safeId}"></div>\n\n${lines[i]}`;
	}
	return lines.join("\n");
}

export function formatBody(body, mathText) {
	// Preserve paragraph boundaries. A visually blank line containing CJK spaces
	// should be a Markdown blank line as well. Leave code and display math alone.
	const normalized = body.replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	const codeLines = new Set();
	for (const token of parser.parse(normalized, {})) if (["fence", "code_block"].includes(token.type) && token.map) {
		for (let i = token.map[0]; i < token.map[1]; i++) codeLines.add(i);
	}
	let mathBlock = false;
	let mathPrefix = "";
	for (let i = 0; i < lines.length; i++) {
		if (codeLines.has(i)) continue;
		const line = lines[i];
		const fence = line.match(/^([ \t]*(?:>[ \t]*)*)\$\$\s*$/);
		if (fence) {
			// A quoted closing fence cannot close an unquoted math block in remark-math.
			// Repair this narrow paste error in the published copy only.
			if (mathBlock && !mathPrefix.includes(">") && fence[1].includes(">")) lines[i] = `${mathPrefix}$$`;
			if (!mathBlock) mathPrefix = fence[1];
			mathBlock = !mathBlock;
			continue;
		}
		if (mathBlock) continue;
		if (/^[\s\u200b]*$/.test(line)) lines[i] = "";
		else if (/^(?:[ \t]*>[ \t]*)+[\s\u200b]*$/.test(line)) lines[i] = line.replace(/[\s\u200b]+$/, "");
	}
	const paragraphs = lines.join("\n");
	if (!mathText) return paragraphs;
	const result = keepHeadingAnchors(paragraphs);
	// Resolve references and attachments before this pass. Only displayed text
	// changes: destinations, identifiers and markup attributes must remain valid.
	const protectedSyntax = /\[\[[^\]\n]+\]\]|!?\[[^\]\n]*\]\((?:<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\)|^[ \t]{0,3}\[[^\]\n]+\]:[^\n]*|<[^>\n]+>|(?:https?:\/\/|mailto:)[^\s<>\]]+|\[\^[^\]\n]+\]|^\s*\[[^\]\n]+\]:/gm;
	let cursor = 0;
	let output = "";
	for (const match of result.matchAll(protectedSyntax)) {
		output += mathPeriods(result.slice(cursor, match.index));
		const syntax = match[0];
		if (syntax.startsWith("[[")) {
			const separator = syntax.indexOf("|");
			output += separator < 0 ? syntax : syntax.slice(0, separator + 1) + mathPeriods(syntax.slice(separator + 1));
		} else if (/^!?\[/.test(syntax) && syntax.includes("](")) {
			const close = syntax.indexOf("](");
			output += mathPeriods(syntax.slice(0, close)) + syntax.slice(close);
		} else output += syntax;
		cursor = match.index + syntax.length;
	}
	return output + mathPeriods(result.slice(cursor));
}
