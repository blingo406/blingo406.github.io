import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { scan, makePlan } from "./core.mjs";
import { prepare, publish, discard } from "./publisher.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = process.env.BLOG_MANAGER_SOURCE || path.join(os.homedir(), "Documents/Mizuki Blog");
const port = Number(process.env.BLOG_MANAGER_PORT || 4399);
const token = randomBytes(32).toString("hex");
const markdown = new MarkdownIt({ html: false, linkify: true });
let prepared = null;
let job = { status: "idle", log: "" };
const log = text => { job.log = (job.log + text).slice(-120000); };

function startJob(task) {
	if (job.status === "running") throw new Error("已有任务正在执行，请等待完成");
	job = { status: "running", log: "" };
	Promise.resolve().then(task).then(result => { job.result = result; job.status = "done"; }, error => {
		job.status = "error"; job.error = error.message; log(`\n${error.message}\n`);
	});
}

async function body(req) {
	let length = 0;
	const chunks = [];
	for await (const chunk of req) {
		length += chunk.length;
		if (length > 16 * 1024 * 1024) throw new Error("请求过大，请分批提交");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (req, res) => {
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Referrer-Policy", "no-referrer");
	res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
	const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
	try {
		if (req.headers.host !== `127.0.0.1:${port}`) return json({ error: "无效的访问地址" }, 403);
		const url = new URL(req.url, `http://127.0.0.1:${port}`);
		if (req.headers.origin && req.headers.origin !== url.origin) return json({ error: "拒绝跨站请求" }, 403);
		if (url.pathname.startsWith("/api/")) {
			if (req.headers["x-manager-token"] !== token) return json({ error: "会话已过期，请刷新页面" }, 403);
			if (req.method === "GET" && url.pathname === "/api/scan") return json({ ...await scan(root, source), source, root });
			if (req.method === "GET" && url.pathname === "/api/job") return json(job);
			if (req.method !== "POST") return json({ error: "接口不存在" }, 404);
			if (!req.headers["content-type"]?.startsWith("application/json")) return json({ error: "需要 JSON 请求" }, 415);
			if (job.status === "running") return json({ error: "已有任务正在执行" }, 409);
			const data = await body(req);
			if (url.pathname === "/api/preview") {
				const plan = await makePlan(root, source, data.selections);
				return json({ posts: plan.posts.map(p => ({ ...p, html: sanitizeHtml(markdown.render(p.body)) })), files: [...plan.writes.keys()], references: plan.references });
			}
			if (url.pathname === "/api/prepare") {
				const plan = await makePlan(root, source, data.selections);
				startJob(async () => {
					if (prepared) { await discard(root, prepared); prepared = null; }
					prepared = await prepare(root, source, plan, log);
					return { preparedId: prepared.id, changes: prepared.changes, count: plan.posts.length };
				});
				return json({ accepted: true }, 202);
			}
			if (url.pathname === "/api/publish") {
				if (!prepared || data.preparedId !== prepared.id || data.confirm !== true) throw new Error("请先完成检查并确认发布");
				startJob(async () => {
					const result = await publish(root, prepared, log);
					await discard(root, prepared).catch(e => log(`清理预览目录失败：${e.message}\n`));
					prepared = null;
					return result;
				});
				return json({ accepted: true }, 202);
			}
			return json({ error: "接口不存在" }, 404);
		}
		const staticFiles = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"] };
		const file = staticFiles[url.pathname];
		if (req.method !== "GET" || !file) return json({ error: "页面不存在" }, 404);
		let content = await fs.readFile(path.join(here, "ui", file[0]), "utf8");
		if (url.pathname === "/") content = content.replace("__SESSION_TOKEN__", token);
		res.writeHead(200, { "Content-Type": `${file[1]}; charset=utf-8` });
		res.end(content);
	} catch (error) { json({ error: error.message }, 400); }
});
server.listen(port, "127.0.0.1", () => console.log(`Mizuki Blog 管理器：http://127.0.0.1:${port}\n文档：${source}\n博客：${root}`));
server.on("error", error => { console.error(error.code === "EADDRINUSE" ? `端口 ${port} 已被占用；管理器可能已经启动。` : error); process.exitCode = 1; });
