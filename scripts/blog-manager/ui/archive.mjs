export function archiveFromPath(parts) {
	if (!Array.isArray(parts) || !parts.length || parts.some(part =>
		typeof part !== "string" || !part.trim() || /[\\/]/.test(part) || [".", ".."].includes(part.trim()))) {
		throw new Error("归档路径格式无效：每一级都要有名称，不能包含空层级、斜杠或 .、..");
	}
	const categoryPath = parts.map(part => part.trim());
	return { categoryPath, category: categoryPath.at(-1), parentCategory: categoryPath.at(-2) || "" };
}

export function manualArchive(selection) {
	if (selection.parentPath !== undefined) {
		if (typeof selection.parentPath !== "string") throw new Error("父级路径必须是文字");
		const parents = selection.parentPath.trim() ? selection.parentPath.trim().split(/[\\/]/) : [];
		return archiveFromPath([...parents, selection.category]);
	}
	if (selection.categoryPath !== undefined && !Array.isArray(selection.categoryPath)) throw new Error("归档路径必须是列表");
	if (selection.categoryPath?.length) return archiveFromPath(selection.categoryPath);
	// Compatibility with saved settings and older clients using one parent.
	if (selection.parentCategory !== undefined && typeof selection.parentCategory !== "string") throw new Error("父级归档必须是文字");
	return archiveFromPath([...(selection.parentCategory?.trim() ? selection.parentCategory.trim().split(/[\\/]/) : []), selection.category]);
}
