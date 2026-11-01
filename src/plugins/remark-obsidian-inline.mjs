// Obsidian inline syntax, applied to phrasing nodes so math and code stay intact.
export function remarkObsidianInline() {
	return (tree, file) => {
		const source = String(file);
		function transform(node, insideLink = false) {
			if (!node.children || node.type === "html") return;
			const linked =
				insideLink || node.type === "link" || node.type === "linkReference";
			for (const child of node.children) transform(child, linked);
			if (
				![
					"paragraph",
					"heading",
					"tableCell",
					"strong",
					"emphasis",
					"delete",
					"link",
					"linkReference",
				].includes(node.type)
			)
				return;
			const parts = [];
			for (const child of node.children) {
				if (child.type !== "text") {
					parts.push(child);
					continue;
				}
				const raw = child.position
					? source.slice(child.position.start.offset, child.position.end.offset)
					: child.value;
				const rawMatches = [...raw.matchAll(/==/g)];
				let occurrence = 0;
				let start = 0;
				for (const match of child.value.matchAll(/==/g)) {
					const original = rawMatches[occurrence++];
					if (!original) continue;
					const before = raw.slice(0, original.index);
					const slashes = before.match(/\\+$/)?.[0].length || 0;
					if (
						slashes % 2 ||
						raw[original.index - 1] === "=" ||
						raw[original.index + 2] === "="
					)
						continue;
					if (match.index > start)
						parts.push({
							type: "text",
							value: child.value.slice(start, match.index),
						});
					parts.push({ type: "highlightDelimiter" });
					start = match.index + 2;
				}
				if (start === 0) parts.push(child);
				else if (start < child.value.length)
					parts.push({ type: "text", value: child.value.slice(start) });
			}
			const children = [];
			for (let i = 0; i < parts.length; i++) {
				if (parts[i].type !== "highlightDelimiter") {
					children.push(parts[i]);
					continue;
				}
				const end = parts.findIndex(
					(part, j) => j > i && part.type === "highlightDelimiter",
				);
				if (end < 0) {
					children.push({ type: "text", value: "==" });
					continue;
				}
				children.push({
					type: "obsidianHighlight",
					data: { hName: "mark" },
					children: parts.slice(i + 1, end),
				});
				i = end;
			}
			// Links in source remain links; code/math nodes are never searched for hashtags.
			function tags(child) {
				if (child.type === "obsidianHighlight") {
					child.children = child.children.flatMap(tags);
					return [child];
				}
				if (linked || child.type !== "text") return [child];
				const result = [];
				let start = 0;
				for (const match of child.value.matchAll(
					/(?<![\p{L}\p{N}_/#&\\])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)(?![\p{L}\p{N}_/-])/gu,
				)) {
					if (!/[\p{L}_-]/u.test(match[1])) continue;
					if (
						child.position &&
						source
							.slice(child.position.start.offset, child.position.end.offset)
							.includes(`\\${match[0]}`)
					)
						continue;
					if (match.index > start)
						result.push({
							type: "text",
							value: child.value.slice(start, match.index),
						});
					result.push({
						type: "link",
						url: `/archive/?tag=${encodeURIComponent(match[1])}`,
						data: { hProperties: { className: ["obsidian-tag"] } },
						children: [{ type: "text", value: match[0] }],
					});
					start = match.index + match[0].length;
				}
				if (start < child.value.length)
					result.push({ type: "text", value: child.value.slice(start) });
				return result;
			}
			node.children = children.flatMap(tags);
		}
		transform(tree);
	};
}
