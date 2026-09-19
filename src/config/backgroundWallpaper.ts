import type { FullscreenWallpaperConfig } from "../types/config";

export const fullscreenWallpaperConfig: FullscreenWallpaperConfig = {
	enable: true,
	src: {
		desktop: [
			"/assets/optimized/desktop-2.webp",
			"/assets/optimized/desktop-3.webp",
			"/assets/optimized/desktop-5.webp",
			"/assets/optimized/desktop-6.webp",
			"/assets/optimized/desktop-7.webp",
			"/assets/optimized/desktop-8.webp",
		],
		mobile: [
			"/assets/optimized/mobile-1.webp",
			"/assets/optimized/mobile-2.webp",
			"/assets/optimized/mobile-3.webp",
			"/assets/optimized/mobile-4.webp",
		],
	},
	position: "center",
	carousel: {
		enable: true,
		interval: 5,
	},
	zIndex: -1,
	opacity: 0.8,
	blur: 1,
	switchable: true,
	overlay: {
		opacity: 0.8, // 壁纸不透明度，0-1
		blur: 1.5, // 背景模糊半径（px）
		cardOpacity: 0.8, // 卡片不透明度，0-1
		switchable: {
			opacity: true,
			blur: true,
			cardOpacity: true,
		},
	},
	fullscreen: {
		switchable: {
			opacity: true,
			blur: true,
		},
	},
};
