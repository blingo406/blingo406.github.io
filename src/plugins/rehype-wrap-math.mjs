import { visit } from "unist-util-visit";

export function rehypeWrapMath() {
	return (tree) => {
		visit(tree, "element", (node, index, parent) => {
			// rehype-mathjax 输出的行间公式带有 display="true" 属性
			if (
				node.tagName === "mjx-container" &&
				node.properties?.display === "true" &&
				parent
			) {
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
