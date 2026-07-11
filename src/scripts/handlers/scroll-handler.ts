/**
 * 滚动处理器
 * 管理页面滚动相关的功能，包括自定义滚动条和滚动监听
 */

/**
 * 滚动处理器类
 * 负责自定义滚动条初始化和滚动事件管理
 */
export class ScrollHandler {
	private mathjaxScrollbarStyleAdded = false;

	/**
	 * 初始化自定义滚动条
	 * 为 MathJax 公式添加水平滚动支持
	 */
	initCustomScrollbar(): void {
		const mathjaxElements = document.querySelectorAll(
			".mjx-container:not([data-scrollbar-initialized])",
		) as NodeListOf<HTMLElement>;

		mathjaxElements.forEach((element) => {
			if (!element.parentNode) {
				return;
			}

			const container = document.createElement("div");
			container.className = "mathjax-display-container";
			element.parentNode.insertBefore(container, element);
			container.appendChild(element);

			// 使用 CSS 滚动条
			container.style.cssText = `
				overflow-x: auto;
				scrollbar-width: thin;
				scrollbar-color: rgba(0,0,0,0.3) transparent;
			`;

			// 添加 webkit 自定义滚动条样式（只添加一次）
			this.addMathjaxScrollbarStyle();

			element.setAttribute("data-scrollbar-initialized", "true");
		});
	}

	/**
	 * 添加 MathJax 滚动条样式（只添加一次）
	 */
	private addMathjaxScrollbarStyle(): void {
		if (this.mathjaxScrollbarStyleAdded) {
			return;
		}

		const style = document.createElement("style");
		style.textContent = `
			.mathjax-display-container::-webkit-scrollbar {
				height: 6px;
			}
			.mathjax-display-container::-webkit-scrollbar-track {
				background: transparent;
			}
			.mathjax-display-container::-webkit-scrollbar-thumb {
				background: rgba(0,0,0,0.3);
				border-radius: 3px;
			}
			.mathjax-display-container::-webkit-scrollbar-thumb:hover {
				background: rgba(0,0,0,0.5);
			}
		`;

		if (!document.head.querySelector("style[data-mathjax-scrollbar]")) {
			style.setAttribute("data-mathjax-scrollbar", "true");
			document.head.appendChild(style);
			this.mathjaxScrollbarStyleAdded = true;
		}
	}

	/**
	 * 节流函数
	 * 限制函数调用频率
	 */
	static throttle<T extends (...args: any[]) => any>(
		func: T,
		limit: number,
	): (...args: Parameters<T>) => void {
		let inThrottle = false;
		return function (this: any, ...args: Parameters<T>) {
			if (!inThrottle) {
				func.apply(this, args);
				inThrottle = true;
				setTimeout(() => (inThrottle = false), limit);
			}
		};
	}
}

// 创建全局实例
let globalScrollHandler: ScrollHandler | null = null;

/**
 * 获取全局滚动处理器实例
 */
export function getScrollHandler(): ScrollHandler {
	if (!globalScrollHandler) {
		globalScrollHandler = new ScrollHandler();
	}
	return globalScrollHandler;
}

/**
 * 初始化自定义滚动条（便捷函数）
 */
export function initCustomScrollbar(): void {
	const handler = getScrollHandler();
	handler.initCustomScrollbar();
}