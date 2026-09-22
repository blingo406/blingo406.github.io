export function dateTime(value: string | null): string {
	return value
		? new Intl.DateTimeFormat("zh-CN", {
				timeZone: "Asia/Shanghai",
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			}).format(new Date(value))
		: "尚未成功更新";
}
