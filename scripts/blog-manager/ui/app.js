const $ = selector => document.querySelector(selector);
const token = $('meta[name="manager-token"]').content;
let items = [];
let categories = [];
let activeId = null;
let busy = false;
let preparedId = null;
const selected = new Set();
const settings = new Map();
const escape = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

async function api(url, data) {
  const response = await fetch(`/api/${url}`, { method: data ? "POST" : "GET", headers: { "x-manager-token": token, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}
function message(text = "") { $("#message").textContent = text; $("#message").hidden = !text; }
function invalidate() { preparedId = null; $("#publish-confirm").hidden = true; $("#review").hidden = true; }
function updateCount() {
  $("#selected-count").textContent = `已选 ${selected.size} 篇`;
  $("#footer-count").textContent = selected.size ? `本次提交 ${selected.size} 篇文档` : "尚未选择文档";
  $("#preview").disabled = $("#prepare").disabled = busy || !selected.size;
  $("#select-all").checked = items.filter(i => !i.error).length > 0 && selected.size === items.filter(i => !i.error).length;
  $("#select-all").indeterminate = !!selected.size && !$("#select-all").checked;
}
function renderList() {
  const search = $("#search").value.toLowerCase();
  const visible = items.filter(i => i.id.toLowerCase().includes(search));
  $("#file-list").innerHTML = visible.map(item => `<div class="file-row ${activeId === item.id ? "active" : ""}"><input type="checkbox" data-select="${escape(item.id)}" aria-label="选择 ${escape(item.id)}" ${selected.has(item.id) ? "checked" : ""} ${item.error || busy ? "disabled" : ""}><span class="file-icon">▤</span><button data-open="${escape(item.id)}"><span class="file-name">${escape(item.id.split("/").at(-1))}</span><span class="file-detail">${escape(item.error || `${item.id.includes("/") ? item.id.slice(0, item.id.lastIndexOf("/")) + " · " : ""}${item.status}`)}</span></button></div>`).join("") || '<p class="note">没有找到文档。</p>';
  updateCount();
}
function openEditor(id) {
  activeId = id;
  const item = items.find(i => i.id === id);
  $("#editor-title").textContent = item.id.split("/").at(-1);
  $("#file-status").textContent = item.status || "格式有误";
  $("#file-status").title = item.target ? `更新原文章：${item.target}` : "首次发布";
  $("#empty").hidden = !item.error;
  $("#editor-content").hidden = !!item.error;
  if (item.error) { message(`${item.id}：${item.error}。请在源文件中修正后重新扫描。`); renderList(); return; }
  const config = settings.get(id);
  $("#archive-mode").value = config.archiveMode;
  $("#manual-archive").hidden = config.archiveMode === "directory";
  $("#directory-archive").textContent = `源目录归档：${item.directoryArchive.categoryPath.join(" → ")}。以文档库为根目录，保留全部文件夹层级；文章地址保持稳定。`;
  $("#category").value = config.category;
  $("#parent-category").value = config.parentCategory;
  const match = categories.findIndex(c => c.category === config.category && c.parentCategory === config.parentCategory && JSON.stringify(c.categoryPath || []) === JSON.stringify(config.categoryPath || []));
  $("#category-choice").value = match < 0 ? (config.category ? "new" : "") : String(match);
  $(`input[name="mode"][value="${config.mode}"]`).checked = true;
  $("#frontmatter").value = config.mode === "auto" ? item.suggestion : config.frontmatter;
  $("#frontmatter").readOnly = config.mode === "auto";
  $("#body-preview").textContent = item.body;
  renderList();
}
function saveEditor() {
  if (!activeId || !settings.has(activeId)) return;
  const config = settings.get(activeId);
  if (config.category !== $("#category").value || config.parentCategory !== $("#parent-category").value) config.categoryPath = [];
  config.category = $("#category").value;
  config.parentCategory = $("#parent-category").value;
  if (config.mode === "manual") config.frontmatter = $("#frontmatter").value;
  invalidate();
}
function selections() { saveEditor(); return items.filter(i => selected.has(i.id)).map(item => ({ id: item.id, hash: item.hash, ...settings.get(item.id) })); }
async function load() {
  message();
  const data = await api("scan");
  items = data.items;
  categories = data.categories;
  for (const item of items) if (!item.error && !settings.has(item.id)) settings.set(item.id, { archiveMode: item.archiveMode, categoryPath: item.categoryPath, category: item.category || item.suggestedCategory, parentCategory: item.parentCategory, mode: item.savedMode || "auto", frontmatter: item.savedFrontmatter || item.original || item.suggestion });
  for (const id of selected) if (!items.some(i => i.id === id && !i.error)) selected.delete(id);
  $("#count").textContent = items.length;
  $("#source").textContent = data.source;
  $("#category-choice").innerHTML = '<option value="">选择已有归档</option>' + categories.map((c, i) => `<option value="${i}">${escape((c.categoryPath?.length ? c.categoryPath : [c.parentCategory, c.category].filter(Boolean)).join(" / "))}</option>`).join("") + '<option value="new">＋ 创建新档</option>';
  $("#category-suggestions").innerHTML = [...new Set([...categories.map(c => c.category), ...items.map(i => i.suggestedCategory).filter(Boolean)])].map(c => `<option value="${escape(c)}">`).join("");
  $("#parent-suggestions").innerHTML = [...new Set(categories.map(c => c.parentCategory).filter(Boolean))].map(c => `<option value="${escape(c)}">`).join("");
  $("#unsupported").textContent = data.unsupported.length ? `暂不支持以下文件格式：${data.unsupported.join("、")}。可先转换为 Markdown 或 TXT。` : "支持 Markdown、MDX、TXT。自动跳过隐藏配置；随文导入引用的图片与附件。";
  if (data.warnings.length) message(data.warnings.join("\n"));
  invalidate();
  if (items.some(i => i.id === activeId)) openEditor(activeId);
  else if (items.length) openEditor(items[0].id);
  else { activeId = null; $("#editor-content").hidden = true; $("#empty").hidden = false; renderList(); }
}
function setBusy(value) {
  busy = value;
  for (const el of document.querySelectorAll("#editor-content input, #editor-content select, #editor-content textarea, #editor-content button, #refresh, #select-all")) el.disabled = value;
  renderList();
}
async function preview() {
  const result = await api("preview", { selections: selections() });
  $("#review-posts").innerHTML = result.posts.map(post => `<article><h3>${escape(post.title)} ${post.draft ? '<span class="badge">草稿</span>' : ""} ${post.mathText ? '<span class="badge">数学文本 · 英文句点</span>' : ""}</h3><p class="note">${escape((post.categoryPath?.length ? post.categoryPath : [post.parentCategory, post.category].filter(Boolean)).join(" / "))}</p><details><summary>查看 frontmatter</summary><pre>${escape(post.frontmatter)}</pre></details><div class="rendered-body">${post.html}</div></article>`).join("");
  $("#review-count").textContent = `${result.posts.length} 篇文章`;
  $("#review-files").textContent = result.posts.map(p => `${p.previousHash ? "更新原文章" : "新建文章"}：${p.id} → ${p.target}`).join("\n") + "\n\n" + result.files.join("\n");
  $("#references").textContent = result.references?.length ? result.references.map(ref => `${ref.from} → ${ref.target}${ref.suffix}`).join("\n") : "本批文档没有内部引用。";
  $("#review").hidden = false;
  return result;
}
async function poll(kind) {
  try {
    while (true) {
      const job = await api("job");
      $("#log").textContent = job.log;
      $("#log").scrollTop = $("#log").scrollHeight;
      if (job.status === "error") throw new Error(job.error);
      if (job.status === "done") {
        if (kind === "prepare") {
          preparedId = job.result.preparedId;
          $("#progress-title").textContent = "检查通过 · 可以发布";
          $("#publish-confirm").hidden = false;
          $("#confirm").checked = false;
          $("#publish").disabled = true;
        } else {
          $("#progress-title").textContent = job.result.message;
          $("#publish-confirm").hidden = true;
          preparedId = null;
          message(job.result.message);
          await load();
        }
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  } catch (error) {
    $("#progress-title").textContent = "任务未完成";
    message(error.message);
  } finally { setBusy(false); }
}
const safely = fn => async (...args) => { try { message(); await fn(...args); } catch (e) { message(e.message); setBusy(false); } };
$("#refresh").onclick = safely(load);
$("#search").oninput = renderList;
$("#file-list").onclick = event => { const open = event.target.closest("[data-open]"); if (open) { saveEditor(); openEditor(open.dataset.open); } };
$("#file-list").onchange = event => { const id = event.target.dataset.select; if (!id) return; event.target.checked ? selected.add(id) : selected.delete(id); invalidate(); openEditor(id); };
$("#select-all").onchange = event => { for (const item of items.filter(i => !i.error)) event.target.checked ? selected.add(item.id) : selected.delete(item.id); invalidate(); renderList(); };
$("#archive-mode").onchange = () => { saveEditor(); settings.get(activeId).archiveMode = $("#archive-mode").value; openEditor(activeId); };
$("#category-choice").onchange = () => { const value = $("#category-choice").value; if (value !== "" && value !== "new") { $("#category").value = categories[Number(value)].category; $("#parent-category").value = categories[Number(value)].parentCategory; } else if (value === "new") { $("#category").value = ""; $("#category").focus(); } saveEditor(); settings.get(activeId).categoryPath = categories[Number(value)]?.categoryPath || []; };
for (const selector of ["#category", "#parent-category", "#frontmatter"]) $(selector).oninput = saveEditor;
for (const radio of document.querySelectorAll('input[name="mode"]')) radio.onchange = () => { saveEditor(); settings.get(activeId).mode = radio.value; openEditor(activeId); };
$("#apply-category").onclick = () => { saveEditor(); const config = settings.get(activeId); for (const id of selected) Object.assign(settings.get(id), { archiveMode: config.archiveMode, categoryPath: config.categoryPath, category: config.category, parentCategory: config.parentCategory }); invalidate(); message(config.archiveMode === "directory" ? `已将 ${selected.size} 篇已选文档设为各自按源目录归档。` : `已将归档应用到 ${selected.size} 篇已选文档。`); };
$("#apply-mode").onclick = () => { saveEditor(); const mode = settings.get(activeId).mode; for (const id of selected) settings.get(id).mode = mode; message(`已将 ${selected.size} 篇文档切换为${mode === "auto" ? "自动补全" : "自己填写"}。每篇文档分别保留自己的字段。`); };
$("#preview").onclick = safely(async () => { setBusy(true); await preview(); $("#review").scrollIntoView({ behavior: "smooth", block: "start" }); setBusy(false); });
$("#prepare").onclick = safely(async () => {
  const chosen = selections();
  setBusy(true);
  await preview();
  $("#progress").hidden = false;
  $("#progress-title").textContent = "正在检查引用与构建网站…";
  $("#log").textContent = "正在准备…";
  await api("prepare", { selections: chosen });
  $("#progress").scrollIntoView({ behavior: "smooth", block: "start" });
  await poll("prepare");
});
$("#confirm").onchange = () => { $("#publish").disabled = !$("#confirm").checked || !preparedId || busy; };
$("#publish").onclick = safely(async () => { if (!preparedId || !$("#confirm").checked) return; const id = preparedId; setBusy(true); $("#publish").disabled = true; $("#publish-confirm").hidden = true; $("#progress-title").textContent = "正在提交到 GitHub…"; await api("publish", { preparedId: id, confirm: true }); await poll("publish"); });
await safely(load)();
