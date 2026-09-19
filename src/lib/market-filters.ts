for (const group of document.querySelectorAll<HTMLElement>(
	"[data-filter-group]",
)) {
	const controls = group.querySelector<HTMLElement>("[data-filter-controls]");
	const query = group.querySelector<HTMLInputElement>("[data-search]");
	const filters = group.querySelectorAll<HTMLSelectElement>(
		"select[data-filter]",
	);
	const items = group.querySelectorAll<HTMLElement>("[data-filter-item]");
	const update = () => {
		let count = 0;
		for (const item of items) {
			const matches =
				(!query?.value ||
					(item.textContent || "")
						.toLowerCase()
						.includes(query.value.trim().toLowerCase())) &&
				[...filters].every(
					(filter) =>
						!filter.value ||
						item.getAttribute(`data-${filter.dataset.filter}`) === filter.value,
				);
			item.hidden = !matches;
			if (matches) count++;
		}
		const result = group.querySelector("[data-result-count]");
		if (result) result.textContent = `共 ${count} 条`;
		const empty = group.querySelector<HTMLElement>("[data-empty]");
		if (empty) empty.hidden = count !== 0;
	};
	query?.addEventListener("input", update);
	filters.forEach((filter) => {
		filter.addEventListener("change", update);
	});
	if (controls) controls.hidden = false;
	update();
}
