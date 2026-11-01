// Obsidian inline syntax, applied to phrasing nodes so math and code stay intact.
export function remarkObsidianInline() {
	return (tree, file) => {
		const source = String(file);
		function transform(node) {
			if (!node.children || node.type === "html") return;
			for (const child of node.children) transform(child);
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
			node.children = children;
		}
		transform(tree);
	};
}
