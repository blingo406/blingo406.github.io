export interface CategoryData {
	categoryPath?: string[];
	category?: string | null;
	parentCategory?: string | null;
}

export interface CategoryNode {
	name: string;
	path: string[];
	count: number;
	totalCount: number;
	children: CategoryNode[];
}

export function getPostCategoryPath(data: CategoryData): string[] {
	if (data.categoryPath?.length)
		return data.categoryPath.map((part) => part.trim());
	if (!data.category?.trim()) return [];
	return [data.parentCategory, data.category]
		.filter((part): part is string => !!part?.trim())
		.map((part) => part.trim());
}

export function matchesCategoryPath(
	data: CategoryData,
	filter: string,
): boolean {
	const path = getPostCategoryPath(data).join("/");
	return path === filter || path.startsWith(`${filter}/`);
}

export function buildCategoryTree(
	posts: CategoryData[],
	uncategorized: string,
): CategoryNode[] {
	const roots: CategoryNode[] = [];
	for (const data of posts) {
		const path = getPostCategoryPath(data);
		if (!path.length) path.push(uncategorized);
		let siblings = roots;
		for (let i = 0; i < path.length; i++) {
			let node = siblings.find((item) => item.name === path[i]);
			if (!node) {
				node = {
					name: path[i],
					path: path.slice(0, i + 1),
					count: 0,
					totalCount: 0,
					children: [],
				};
				siblings.push(node);
			}
			node.totalCount++;
			if (i === path.length - 1) node.count++;
			siblings = node.children;
		}
	}
	const sort = (nodes: CategoryNode[]) => {
		nodes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
		for (const node of nodes) sort(node.children);
	};
	sort(roots);
	return roots;
}
