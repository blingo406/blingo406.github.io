import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { parse as parseHtml } from "node-html-parser";
import { exists, hash, textHash, readState, saveState, inside } from "./core.mjs";
import { postSlug } from "./references.mjs";

export function run(command, args, cwd, log = () => {}, env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, windowsHide: true, shell: false,
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ENABLE_CONTENT_SYNC: "false", ...env } });
		let output = "";
		const capture = chunk => { const text = chunk.toString(); output = (output + text).slice(-200000); log(text); };
		child.stdout.on("data", capture);
		child.stderr.on("data", capture);
		child.on("error", reject);
		child.on("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} ${args[0]} 失败（${code}）\n${output.slice(-3500)}`)));
	});
}

export async function git(root, args, log = () => {}) {
	try { return await run("git", ["-c", "core.quotepath=false", ...args], root, log); }
	catch (error) {
		if (!["fetch", "push"].includes(args[0]) || !/Failed to connect|Could not connect to server/i.test(error.message)) throw error;
		let proxy;
		try { proxy = await run("git", ["config", "--get", "http.proxy"], root); } catch { throw error; }
		if (!/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/i.test(proxy)) throw error;
		log("本机 Git 代理不可用，正在尝试直接连接（不修改全局设置）…\n");
		return run("git", ["-c", "core.quotepath=false", "-c", "http.proxy=", "-c", "https.proxy=", ...args], root, log);
	}
}

export async function pnpm(root, args, log) {
	// Dependencies were checked against the lockfile above. Never let pnpm's
	// automatic pre-run install replace a shared node_modules junction.
	const runArgs = ["--config.verify-deps-before-run=false", ...args];
	const env = { pnpm_config_verify_deps_before_run: "" };
	const candidates = [process.env.npm_execpath, process.env.BLOG_MANAGER_PNPM,
		path.join(process.env.APPDATA || os.homedir(), "npm/node_modules/pnpm/bin/pnpm.mjs")].filter(Boolean);
	for (const script of candidates) {
		if (/pnpm\.(c?js|mjs)$/.test(script) && await exists(script)) return run(process.execPath, [script, ...runArgs], root, log, env);
	}
	if (process.platform !== "win32") return run("pnpm", runArgs, root, log, env);
	throw new Error("未找到 pnpm。请通过 pnpm blog:manager 启动，或设置 BLOG_MANAGER_PNPM 为 pnpm.mjs 路径。");
}

export async function verifySite(root, original, log) {
	const wanted = parseYaml(await fs.readFile(path.join(root, "pnpm-lock.yaml"), "utf8")).importers["."];
	const installed = parseYaml(await fs.readFile(path.join(original, "pnpm-lock.yaml"), "utf8")).importers["."];
	const sameLock = ["dependencies", "devDependencies", "optionalDependencies"].every(section => Object.entries(wanted[section] || {}).every(([name, spec]) => spec.version === installed[section]?.[name]?.version));
	if (sameLock && await exists(path.join(original, "node_modules"))) {
		await fs.symlink(path.join(original, "node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
	} else {
		log("安装与待发布版本匹配的依赖…\n");
		await pnpm(root, ["install", "--frozen-lockfile"], log);
	}
	await pnpm(root, ["check"], log);
	await pnpm(root, ["build"], log);
}

export async function verifyBuiltLinks(root, plan) {
	const cache = new Map();
	const readPage = async href => {
		const url = new URL(href, "https://local.invalid");
		const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
		const file = path.resolve(root, "dist", relative, relative.endsWith(".html") ? "" : "index.html");
		if (!file.startsWith(`${path.resolve(root, "dist")}${path.sep}`)) throw new Error("引用路径超出网站目录");
		if (!await exists(file)) throw new Error(`构建后引用页面不存在：${href}`);
		if (!cache.has(file)) cache.set(file, parseHtml(await fs.readFile(file, "utf8")));
		const page = cache.get(file);
		const anchor = decodeURIComponent(url.hash.slice(1));
		if (anchor && !page.querySelectorAll("[id]").some(node => node.id === anchor)) throw new Error(`构建后引用锚点不存在：${href}`);
		return page;
	};
	for (const post of plan.posts.filter(p => !p.draft)) {
		const page = await readPage(`/posts/${postSlug(post.target)}/`);
		if (page.querySelector(".wiki-link-broken")) throw new Error(`${post.id} 的网站预览中存在断开的双链`);
		for (const link of page.querySelectorAll("a.wiki-link")) await readPage(link.getAttribute("href"));
	}
}

export async function discard(root, prepared) {
	if (!prepared?.directory) return;
	const workspace = path.resolve(root, ".blog-manager/previews");
	const directory = path.resolve(prepared.directory);
	if (path.dirname(directory) !== workspace) throw new Error("拒绝清理非预览目录");
	const modules = path.join(directory, "node_modules");
	if (await exists(modules) && (await fs.lstat(modules)).isSymbolicLink()) await fs.unlink(modules);
	await git(root, ["worktree", "remove", "--force", directory]);
}

export async function prepare(root, source, plan, log, verify = verifySite) {
	log("读取网站最新版本…\n");
	await git(root, ["fetch", "origin", "main"], log);
	const base = await git(root, ["rev-parse", "origin/main"]);
	// Recover an interrupted response after a successful push.
	const state = await readState(root);
	if (state.pending) {
		try {
			await git(root, ["merge-base", "--is-ancestor", state.pending.commit, base]);
			for (const post of state.pending.posts) {
				for (const id of post.supersededIds || []) delete state.entries[id];
				state.entries[post.id] = post;
			}
			delete state.pending;
			await saveState(root, state);
		} catch { /* A failed/unpushed commit remains pending for a later retry. */ }
	}
	const directory = path.join(root, ".blog-manager/previews", randomUUID());
	await fs.mkdir(path.dirname(directory), { recursive: true });
	await git(root, ["worktree", "add", "--detach", directory, base], log);
	const prepared = { id: randomUUID(), directory, base, plan, source, commit: null };
	try {
		for (const post of plan.posts) {
			const target = path.join(directory, post.target);
			if (await exists(target)) {
				const existingHash = textHash(await fs.readFile(target, "utf8"));
				const previousHash = state.entries[post.id]?.outputHash || post.previousHash;
				if (existingHash !== post.outputHash && existingHash !== previousHash) throw new Error(`网站上的 ${post.target} 已被其他方式修改；请先核对内容，程序不会覆盖。`);
			}
		}
		for (const [file, content] of plan.writes) {
			const target = path.join(directory, file);
			if (file.startsWith("public/") && await exists(target) && hash(await fs.readFile(target)) !== hash(content)) throw new Error(`附件冲突：${file}`);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, content);
		}
		log("检查 frontmatter、类型与网站构建…\n");
		await verify(directory, root, log);
		if (verify === verifySite) {
			await verifyBuiltLinks(directory, plan);
			log("已确认构建后的双链页面与锚点存在。\n");
		}
		// Stage only the reviewed documents and referenced attachments.
		for (const file of plan.writes.keys()) await git(directory, ["add", "--", file]);
		prepared.changes = await git(directory, ["diff", "--cached", "--stat"]);
		prepared.tree = await git(directory, ["write-tree"]);
		log(prepared.changes ? `${prepared.changes}\n检查通过，等待点击发布。\n` : "网站内容已经一致，无需再次推送。\n");
		return prepared;
	} catch (e) {
		await discard(root, prepared).catch(error => log(`预览目录保留：${error.message}\n`));
		throw e;
	}
}

export async function publish(root, prepared, log) {
	for (const post of prepared.plan.posts) {
		if (hash(await fs.readFile(await inside(prepared.source, post.id), "utf8")) !== post.sourceHash) throw new Error(`${post.id} 已变化，请重新检查。`);
	}
	for (const [file, bytes] of prepared.plan.writes) {
		if (hash(await fs.readFile(path.join(prepared.directory, file))) !== hash(bytes)) throw new Error("待发布文件已变化，请重新检查。");
	}
	if (await git(prepared.directory, ["write-tree"]) !== prepared.tree) throw new Error("暂存内容已变化，请重新检查。");
	await git(root, ["fetch", "origin", "main"], log);
	const remote = await git(root, ["rev-parse", "origin/main"]);
	const alreadyPushed = prepared.commit && remote === prepared.commit;
	if (remote !== prepared.base && !alreadyPushed) throw new Error("网站有新的更新，请重新点击“检查发布”，合并最新版本后再发布。");
	if (prepared.changes && !prepared.commit) {
		await git(prepared.directory, ["commit", "-m", `docs: publish ${prepared.plan.posts.length} blog post(s)`], log);
		prepared.commit = await git(prepared.directory, ["rev-parse", "HEAD"]);
	}
	const state = await readState(root);
	const records = prepared.plan.posts.map(({ content, body, previousHash, ...post }) => ({ ...post, publishedAt: new Date().toISOString() }));
	if (prepared.commit && !alreadyPushed) {
		state.pending = { commit: prepared.commit, posts: records };
		await saveState(root, state);
		await git(prepared.directory, ["push", "origin", "HEAD:refs/heads/main"], log);
	}
	for (const post of records) {
		for (const id of post.supersededIds || []) delete state.entries[id];
		state.entries[post.id] = post;
	}
	delete state.pending;
	await saveState(root, state);
	// Keep the user's checkout current when a normal fast-forward is possible.
	if (prepared.commit) {
		try {
			if (await git(root, ["branch", "--show-current"]) === "main") await git(root, ["merge", "--ff-only", prepared.commit], log);
		} catch { log("已推送；本地有其他修改，未自动更新主目录。提交记录已保存。\n"); }
	}
	return { commit: prepared.commit, unchanged: !prepared.changes, status: prepared.changes ? "pushed" : "unchanged",
		message: prepared.changes ? "已推送到 GitHub，网站正在部署。请在部署记录中确认结果。" : "内容与网站一致，无需重复发布。" };
}
