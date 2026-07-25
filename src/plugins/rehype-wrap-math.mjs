import { visit } from "unist-util-visit";

export function rehypeWrapMath() {
	return (tree) => {
		visit(tree, "element", (node, index, parent) => {
			// rehype-katex 输出的行间公式是 <span class="katex-display">，
			// 用滚动容器包起来，超宽公式在容器内横向滚动而非撑破页面。
			const cls = node.properties?.className;
			const isKatexDisplay =
				Array.isArray(cls) && cls.includes("katex-display");
			if (isKatexDisplay && parent) {
				const wrapper = {
					type: "element",
					tagName: "div",
					properties: {
						className: ["mathjax-display-container"],
					},
					children: [node],
				};
				parent.children[index] = wrapper;
			}
		});
	};
}
