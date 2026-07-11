/**
 * Swup 钩子管理器
 * 统一管理所有 Swup 生命周期钩子
 */

export interface SwupHooksManagerOptions {
	showBanner?: () => void;
	initFancybox?: () => Promise<void>;
	cleanupFancybox?: () => void;
	initCustomScrollbar?: () => void;
}

export class SwupHooksManager {
	private bannerEnabled: boolean;
	private hooks: SwupHooksManagerOptions;

	constructor(bannerEnabled: boolean, options: SwupHooksManagerOptions = {}) {
		this.bannerEnabled = bannerEnabled;
		this.hooks = options;
	}

	/**
	 * 注册所有 Swup 钩子
	 */
	registerHooks(): void {
		if (!window.swup) return;

		// 页面内容替换前：清理旧页面资源
		window.swup.hooks.on("content:replace", () => {
			if (this.hooks.cleanupFancybox) {
				this.hooks.cleanupFancybox();
			}
		});

		// 页面内容替换后：重新初始化组件
		window.swup.hooks.on("page:view", () => {
			if (this.hooks.showBanner && this.bannerEnabled) {
				this.hooks.showBanner();
			}
			if (this.hooks.initFancybox) {
				this.hooks.initFancybox();
			}
			if (this.hooks.initCustomScrollbar) {
				this.hooks.initCustomScrollbar();
			}
		});
	}
}