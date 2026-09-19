import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const output = path.join(root, "public/assets/optimized");
await fs.mkdir(output, { recursive: true });
const inputs = [
	{ source: "public/assets/home/home.webp", name: "nav-icon.webp", width: 96 },
	{ source: "public/assets/home/default-logo.webp", name: "nav-logo.webp", width: 320 },
];
for (const family of ["desktop", "mobile"]) {
	const directory = `public/assets/${family}-banner`;
	for (const file of (await fs.readdir(directory)).filter((name) => name.endsWith(".webp"))) {
		inputs.push({ source: `${directory}/${file}`, name: `${family}-${file}`, width: family === "desktop" ? 1600 : 800 });
	}
}
const results = [];
for (const input of inputs) {
	const source = path.join(root, input.source);
	const target = path.join(output, input.name);
	await sharp(source).rotate().resize({ width: input.width, withoutEnlargement: true }).webp({ quality: 76, effort: 6 }).toFile(target);
	results.push({ source: input.source, output: `public/assets/optimized/${input.name}`, before: (await fs.stat(source)).size, after: (await fs.stat(target)).size });
}
await fs.mkdir(path.join(root, ".performance"), { recursive: true });
await fs.writeFile(path.join(root, ".performance/image-savings.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
