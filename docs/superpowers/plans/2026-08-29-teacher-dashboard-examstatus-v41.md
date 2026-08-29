# 教师端考情管理改版 v4.1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v4.1 迭代——考试管理按 3 类小框分开（正式考试/错题练习/日常作业）、首页考情总览去全局统计框并换分数段直方图、下发首次分发时间。

**Architecture:** 前端零依赖 SVG 直方图；后端 papers 表加 `is_wrong_push` 列（幂等迁移）区分错题推送与手动练习卷；`GET /api/papers` 增量下发 `is_wrong_push` 与 `first_distributed_at`。

**Tech Stack:** FastAPI（后端仅 db.py + platform_routes.py 增量）、原生 JS（charts.js/teacher.js/index.html）、纯 SVG、style.css、smoke_test.py。

## Global Constraints

- G1 `score_visible = (is_practice == 1) OR (published == 1)` 不变。
- G2 教师隔离不变；新增字段同受隔离约束，前端只消费当前老师列表。
- G3 练习卷（含错题练习 is_wrong_push=1）不可发布成绩：前端无发布按钮、不显示发布徽标。
- G4 零第三方依赖：直方图纯 SVG（charts.js 内新增，`bp-` 前缀内联样式）。
- **V41-1** 考试管理 tab 下 3 个小框：`正式考试`(!is_practice) / `错题练习`(is_wrong_push) / `日常作业`(is_practice 且 !is_wrong_push)，只在考试管理。
- **V41-2** 考试管理默认小框 = 正式考试。
- **V41-3** 首页考情总览仅展示正式考试（!is_practice），无顶部 4 统计框；每卷卡片含 分发时间 + 四字段大数字(带圆环) + 直方图。
- **V41-4** 首页直方图 = 分数段分组柱（5 段均分 [0,total_score]），柱高=段内已批改人数，柱顶标人数。
- 后端只改 `web/db.py` 与 `web/platform_routes.py`；不得动学生端/辅导员端/学情/出卷/题库路由。
- `svgBoxPlot` 保留但不被首页使用（防回归，不删）。
- 环境注记（继承 v3/v4）：git 根 = `/tmp/blood_cell/exam_maker`（工作目录是子目录）；`pkill -f "[u]vicorn app:app"` 方括号技巧必须**单独一条命令**，再**单独** nohup 启动；「Tool permission stream closed」= 通信层抖动，重试或走 Edit。
- 服务器当前运行中（pid 见 `ps aux|grep "[u]vicorn"`）；后端改动后必须重启 uvicorn 才生效。

---

### Task 1: 后端——papers 加 `is_wrong_push` 列 + `first_distributed_at` 下发

**Files:**
- Modify: `web/db.py`（迁移块 ~L111 后、create_paper ~L290、list_distributions ~L385）
- Modify: `web/platform_routes.py`（GET /api/papers ~L91、错题推送 endpoint ~L528）

**Interfaces:**
- Produces: papers 表新增 `is_wrong_push INTEGER DEFAULT 0`；`create_paper({..., is_wrong_push})` 接受并落库；`list_distributions()` 每行新增 `distributed_at`；`GET /api/papers` 每卷新增 `is_wrong_push: bool` 与 `first_distributed_at: str|None`（= min(distributions[].distributed_at)）。

- [ ] **Step 1: db.py 加幂等迁移**（插在 `published_at` 迁移块之后）

在 `web/db.py` 的迁移区（现有 `published_at` 迁移后）追加：

```python
    # 迁移：旧库补 is_wrong_push 列（错题推送标记，幂等）
    pcols3 = [r["name"] for r in conn.execute("PRAGMA table_info(papers)").fetchall()]
    if "is_wrong_push" not in pcols3:
        conn.execute("ALTER TABLE papers ADD COLUMN is_wrong_push INTEGER DEFAULT 0")
```

- [ ] **Step 2: create_paper 支持 is_wrong_push**

`web/db.py` `create_paper()` 的 INSERT 列清单加 `is_wrong_push`，VALUES 加 `1 if p.get("is_wrong_push") else 0`：

```python
        INSERT INTO papers (teacher_id, title, subject, duration, total_score, questions_json, is_practice, is_wrong_push, remark, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```
参数元组改为：
```python
    (
        p["teacher_id"], p.get("title", ""), p.get("subject", ""),
        p.get("duration", 120), p.get("total_score", 0),
        p.get("questions_json", "[]"), 1 if p.get("is_practice") else 0,
        1 if p.get("is_wrong_push") else 0,
        p.get("remark"), _now(),
    )
```

- [ ] **Step 3: list_distributions 补 distributed_at**

`web/db.py` `list_distributions()` 的 SELECT 增加 `d.created_at AS distributed_at`（在 `s.submitted_at` 之后）：

```python
        SELECT u.id AS student_id, u.name, u.student_no, u.class_name, u.major,
               s.id AS sub_id, s.status, s.total_score, s.submitted_at,
               d.created_at AS distributed_at
```

- [ ] **Step 4: GET /api/papers 下发 is_wrong_push + first_distributed_at**

`web/platform_routes.py` `list_papers()` 的 out.append 字典增加两个字段（`is_practice` 之后加 `is_wrong_push`，`distributions` 之后加 `first_distributed_at`）：

```python
            "is_wrong_push": bool(p.get("is_wrong_push")),
            ...
            "distributions": dists,
            "first_distributed_at": min((x.get("distributed_at") for x in dists if x.get("distributed_at")), default=None),
```

- [ ] **Step 5: 错题推送 endpoint 置 is_wrong_push=1**

`web/platform_routes.py` 错题推送 endpoint 的 `db.create_paper({...})` 字典加 `"is_wrong_push": 1`（现有 `"is_practice": 1` 旁）：

```python
        "is_practice": 1,
        "is_wrong_push": 1,
    })
```

- [ ] **Step 6: 语法与迁移验证**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && python -m py_compile db.py platform_routes.py && python - <<'PY'
import db
db.init_db()
cols = [r["name"] for r in db.get_conn().execute("PRAGMA table_info(papers)").fetchall()]
assert "is_wrong_push" in cols, cols
print("migration OK")
PY
```

- [ ] **Step 7: 重启 uvicorn（单独两条命令）**

```bash
pkill -f "[u]vicorn app:app"
```
再（第二条命令）：
```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && nohup /root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --host 0.0.0.0 --port 2342 > /tmp/uvicorn.log 2>&1 &
```
确认：`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:2342/` → 200。

- [ ] **Step 8: 提交**

```bash
git add web/db.py web/platform_routes.py && git commit -m "feat(backend): papers 加 is_wrong_push 列、/api/papers 下发 first_distributed_at"
```

---

### Task 2: charts.js 新增 `svgHistogram`（分数段直方图）

**Files:**
- Modify: `web/static/js/charts.js`（文件末尾追加）

**Interfaces:**
- Produces: `svgHistogram(scores, {width, height, max, bins=5})` → SVG 字符串或 `''`（空/无效）。Task 3 首页用它替换 `svgBoxPlot`。

- [ ] **Step 1: 追加 svgHistogram 函数**（charts.js 末尾，复用 `bp-` 前缀内联 `<style>`）

```javascript
// 分数段直方图：把 [0,max] 均分 bins 段，柱高 = 段内分数个数，柱顶标人数，底部标分段界点。
function svgHistogram(scores, opts = {}) {
    const width = opts.width || 380;
    const height = opts.height || 160;
    const max = opts.max ?? 100;   // ?? 使显式 max:0 保持 0（触发空态），不落到 100
    const bins = opts.bins || 5;
    const padL = 40, padR = 10, padT = 14, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    if (!scores || !scores.length || max <= 0) return '';
    const counts = new Array(bins).fill(0);
    // 右闭区间分桶：ceil-1 使 60→[40,60)、80→[60,80)、100→[80,100]（spec 示例 [0,0,1,2,4]）
    scores.forEach(s => { const b = Math.min(bins - 1, Math.max(0, Math.ceil((s / max) * bins) - 1)); counts[b]++; });
    const peak = Math.max.apply(null, counts) || 1;
    const barW = plotW / bins;
    const step = max / bins;
    const parts = [];
    for (let i = 0; i < bins; i++) {
        const h = Math.round((counts[i] / peak) * plotH);
        const x = padL + i * barW;
        const y = padT + plotH - h;
        parts.push(`<rect class="bp-bar" x="${x + 2}" y="${y}" width="${barW - 4}" height="${h}" rx="3"></rect>`);
        if (counts[i]) parts.push(`<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" class="bp-count">${counts[i]}</text>`);
        parts.push(`<text x="${x + barW / 2}" y="${height - 8}" text-anchor="middle" class="bp-ticklabel">${Math.round(i * step)}</text>`);
    }
    parts.push(`<text x="${width - padR}" y="${height - 8}" text-anchor="end" class="bp-ticklabel">${Math.round(max)}</text>`);
    parts.push(`<line class="bp-axis" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}"></line>`);
    return `<svg class="bp-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}">
        <style>
            .bp-bar{fill:#93c5fd;stroke:#2563eb;stroke-width:1}
            .bp-count{font-size:11px;fill:#1d4ed8;font-weight:700}
            .bp-ticklabel{font-size:10px;fill:#94a3b8}
            .bp-axis{stroke:#94a3b8;stroke-width:1}
        </style>
        ${parts.join('')}
    </svg>`;
}
```

- [ ] **Step 2: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/charts.js && echo "syntax OK"
```

- [ ] **Step 3: 统计目验（brief 校验命令）**

```bash
node -e '
const fs=require("fs");eval(fs.readFileSync("static/js/charts.js","utf8"));
const s=svgHistogram([60,70,80,85,90,95,100],{max:100,bins:5});
// 7 点样本分 5 段（右闭区间）：0-20:0 / 20-40:0 / 40-60:1 / 60-80:2 / 80-100:4
if(!s.includes(">4<")||!s.includes(">2<")||!s.includes(">1<")){console.error("count 标签错误");process.exit(1)}
// 只认 count 标签：不能用 s.includes(">0<")——bin0 底部刻度标签本身就是 ">0<"（恒真误报）
if(/class="bp-count">0</.test(s)){console.error("空段不应有 count 标签");process.exit(1)}
if(svgHistogram([],{max:100})!==""||svgHistogram([50],{max:0})!==""){console.error("空态应返回空串");process.exit(1)}
console.log("histogram OK");
'
```

- [ ] **Step 4: 提交**

```bash
git add web/static/js/charts.js && git commit -m "feat(charts): svgHistogram 分数段直方图纯函数"
```

---

### Task 3: 前端——考试管理 3 小框 + 首页考情总览重排

**Files:**
- Modify: `web/templates/index.html`（考试管理区 ~L407、首页 ~L58-67）
- Modify: `web/static/js/teacher.js`

**Interfaces:**
- Consumes: Task 2 `svgHistogram(scores, {max, bins})`；Task 1 `GET /api/papers` 的 `is_wrong_push` / `first_distributed_at`。
- Produces: `switchExamSubTab(name)`（formal|wrong|homework）、`renderExamManageList()`、`matchExamSubTab(p)`、`renderScoreHistograms()`；DOM id `examSubFormal/examSubWrong/examSubHomework`。

- [ ] **Step 1: index.html 考试管理加 3 小框**

`web/templates/index.html` 考试管理区（`<div id="examManageView">` 内、`<div id="examManageList">` 之前）插入：

```html
            <div class="exam-subtabs">
                <button id="examSubFormal" class="exam-subtab active" onclick="switchExamSubTab('formal')">正式考试</button>
                <button id="examSubWrong" class="exam-subtab" onclick="switchExamSubTab('wrong')">错题练习</button>
                <button id="examSubHomework" class="exam-subtab" onclick="switchExamSubTab('homework')">日常作业</button>
            </div>
```

- [ ] **Step 2: index.html 首页去统计框、改标题**

首页 `teacherHome` 内：**删除** `<div class="stat-cards" id="statCards"></div>`；把 `<h2>学生成绩箱线图</h2>` 改为 `<h2>学生成绩分布</h2>`（`examOverviewList` 与 `boxPlotList` 两个容器保留）。

- [ ] **Step 3: teacher.js loadHome 去 statCards**

`web/static/js/teacher.js` `loadHome()` 改为：只 fetch 缓存，不再计算/渲染 4 个统计框：

```javascript
async function loadHome() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    renderExamOverview();
    renderScoreHistograms();
}
```
（删除原 `stat` 计算与 `$('statCards').innerHTML = ...` 段；`_papersCache` 定义行保留。）

- [ ] **Step 4: renderExamOverview 仅正式考试**

`renderExamOverview()` 过滤器改为：

```javascript
function renderExamOverview() {
    const exams = _papersCache.filter(p => !p.is_practice && (p.distributed_count || 0) > 0);
    $('examOverviewList').innerHTML = exams.length
        ? exams.map(examOverviewCard).join('')
        : '<p class="empty-row">暂无已分发的正式考试（先在「我的试卷」中分发）</p>';
}
```

- [ ] **Step 5: examOverviewCard 加分发时间、去练习 tag**

`examOverviewCard(p)` 中：删除 `p.is_practice ? '<span class="tag">🏷️ 练习</span>' : ''` 这一行；在四字段区（`exam-stats-grid`）之前加一行分发时间：

```html
        <div class="paper-card-meta">分发时间：${p.first_distributed_at ? esc(p.first_distributed_at.slice(0, 16)) : '未分发'}</div>
```
（card 其余部分逐字保留。）

- [ ] **Step 6: renderBoxPlots → renderScoreHistograms**

把 `renderBoxPlots()` 整体替换为（只统计正式考试、≥1 已批改即出直方图、0 人显示空态）：

```javascript
// ── 首页成绩分布（每卷一张直方图，仅正式考试）──
function renderScoreHistograms() {
    const rows = [];
    _papersCache.forEach(p => {
        if (p.is_practice || (p.distributed_count || 0) === 0) return;
        const scores = (p.distributions || [])
            .filter(d => d.status === 'graded')
            .map(d => Number(d.total_score))
            .filter(Number.isFinite);
        if (!scores.length) {
            rows.push(`<div class="histogram-row">
                <span class="histogram-title">📄 ${esc(p.title)}</span>
                <span class="histogram-note">暂无已批改成绩</span>
            </div>`);
            return;
        }
        rows.push(`<div class="histogram-row">
            <span class="histogram-title">📄 ${esc(p.title)}</span>
            ${svgHistogram(scores, { max: p.total_score || 100, bins: 5 })}
        </div>`);
    });
    $('boxPlotList').innerHTML = rows.length
        ? rows.join('')
        : '<p class="empty-row">暂无已批改成绩</p>';
}
```

- [ ] **Step 7: 考试管理加 3 小框状态与渲染**

`teacher.js` 在 `loadExamManage` 附近新增：

```javascript
let _examSubTab = 'formal'; // formal | wrong | homework

function matchExamSubTab(p) {
    if (_examSubTab === 'formal') return !p.is_practice;
    if (_examSubTab === 'wrong') return !!p.is_wrong_push;
    return p.is_practice && !p.is_wrong_push; // homework
}

function switchExamSubTab(name) {
    _examSubTab = name;
    const map = { formal: 'examSubFormal', wrong: 'examSubWrong', homework: 'examSubHomework' };
    Object.entries(map).forEach(([k, id]) => { const el = $(id); if (el) el.classList.toggle('active', k === name); });
    renderExamManageList();
}
```

`loadExamManage()` 改为：

```javascript
async function loadExamManage() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    renderExamManageList();
}

function renderExamManageList() {
    const list = _papersCache.filter(p => (p.distributed_count || 0) > 0 && matchExamSubTab(p));
    $('examManageList').innerHTML = list.length
        ? list.map(examRow).join('')
        : '<p class="empty-row">该分类下暂无已分发的试卷</p>';
}
```

- [ ] **Step 8: examRow 分类 tag**

`examRow(p)` 中，把 `${p.is_practice ? '<span class="tag">🏷️ 练习</span>' : ''}` 替换为：

```javascript
            ${p.is_wrong_push ? '<span class="tag">🎯 错题练习</span>' : (p.is_practice ? '<span class="tag">📚 日常作业</span>' : '')}
```
（发布徽标/发布按钮的 `p.is_practice` 门控保持不动，错题练习/日常作业均无发布。）

- [ ] **Step 9: 校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/teacher.js && echo "syntax OK"
grep -n "switchExamSubTab\|examSubFormal\|examSubWrong\|examSubHomework\|renderScoreHistograms\|statCards" templates/index.html static/js/teacher.js
```
期望：index.html 有 3 个 sub-tab 按钮 + 无 `statCards`；teacher.js 有 `switchExamSubTab`/`renderScoreHistograms`、无 `renderBoxPlots`/`statCards` 引用。

- [ ] **Step 10: 提交**

```bash
git add web/templates/index.html web/static/js/teacher.js && git commit -m "feat(teacher): 考试管理3小框(正式/错题练习/日常作业)；首页去统计框、直方图、分发时间"
```

---

### Task 4: style.css——考试管理 3 小框 + 首页直方图样式

**Files:**
- Modify: `web/static/style.css`（文件末尾追加）

- [ ] **Step 1: 追加样式块**

`web/static/style.css` 末尾追加（复用既有 `--border`/`--text-muted` 等变量，若变量名不同则按文件内实际变量对齐；现有 `.ok` 绿 `#047857`、主色 `#2563eb` 作参考）：

```css
/* v4.1：考试管理 3 小框 */
.exam-subtabs{display:flex;gap:8px;margin:8px 0 12px;flex-wrap:wrap}
.exam-subtab{padding:6px 14px;border:1px solid var(--border,#e2e8f0);border-radius:8px;background:transparent;color:var(--text-muted,#64748b);cursor:pointer;font-size:14px;transition:all .15s}
.exam-subtab:hover{border-color:#2563eb;color:#2563eb}
.exam-subtab.active{background:#2563eb;color:#fff;border-color:#2563eb}
/* v4.1：首页成绩分布直方图 */
.histogram-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border,#e2e8f0);border-radius:10px;margin-bottom:8px}
.histogram-title{min-width:120px;font-size:13px;color:var(--text,#1e293b);flex-shrink:0}
.histogram-note{font-size:12px;color:var(--text-muted,#64748b)}
.histogram-row .bp-svg{flex:1;min-width:0}
```

- [ ] **Step 2: 校验（大括号配对 + 选择器存在）**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && python - <<'PY'
css=open('static/style.css').read()
assert css.count('{')==css.count('}'), 'brace mismatch'
for sel in ['.exam-subtabs','.exam-subtab','.exam-subtab.active','.histogram-row','.histogram-title','.histogram-note']:
    assert sel in css, f'缺少 {sel}'
print('css OK')
PY
```

- [ ] **Step 3: 提交**

```bash
git add web/static/style.css && git commit -m "style(css): 考试管理3小框 + 首页直方图样式"
```

---

### Task 5: smoke_test.py 断言 is_wrong_push / first_distributed_at + browser_checklist v4.1

**Files:**
- Modify: `web/scripts/smoke_test.py`
- Modify: `web/scripts/browser_checklist.md`

- [ ] **Step 1: 练习卷创建带 is_wrong_push=1**

`web/scripts/smoke_test.py` 中创建练习卷（`db.create_paper`，title 含「错题巩固」，约 L94）的字典加 `"is_wrong_push": 1`（模拟真实错题推送）。

- [ ] **Step 2: 新增数据契约断言**

在第 8 步数据契约断言（`finally: db.delete_user(sb_id)`）之后追加。**断言必须定位冒烟自建的 `pid`（正式卷）与 `prac`（错题练习卷）两卷**，不能用 `next(x for x in pl if not x["is_practice"])` 类首匹配——种子库可能含未分发正式卷导致 `first_distributed_at` 误判。**未分发契约用确定性构造覆盖（不 fail-open）**：

```python
    # v4.1: is_wrong_push 分类 + first_distributed_at
    pl4 = req("GET", "/api/papers", t)["papers"]
    f1 = next(x for x in pl4 if x["id"] == pid)   # 正式卷（已分发）
    f2 = next(x for x in pl4 if x["id"] == prac)  # 错题练习卷（已分发）
    assert f1["is_wrong_push"] is False
    assert f2["is_wrong_push"] is True and f2["is_practice"] is True, "错题练习卷必须同时是练习卷"
    assert f1["first_distributed_at"], "已分发的正式卷应有首次分发时间"
    assert f2["first_distributed_at"], "已分发的错题练习卷应有首次分发时间"
    # 未分发卷 first_distributed_at 应为 None（确定性构造）
    nd_pid = req("POST", "/api/papers", t, body={
        "title": "冒烟未分发卷", "subject": "数学", "duration": 120, "total_score": 100,
        "questions": [{"no": 1, "type": "选择题", "score": 5, "content": "?", "answer": "?"}],
    })["id"]
    try:
        f3 = next(x for x in req("GET", "/api/papers", t)["papers"] if x["id"] == nd_pid)
        assert f3["first_distributed_at"] is None, "未分发卷应无首次分发时间"
    finally:
        req("DELETE", f"/api/papers/{nd_pid}", t)
```

- [ ] **Step 3: 运行冒烟**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web/scripts && /root/miniconda3/envs/exam_env/bin/python smoke_test.py
```
期望：`SMOKE OK: 全部断言通过`。若首次因断言顺序/无未分发卷失败，按实际数据结构调整但保持断言语义。

- [ ] **Step 4: browser_checklist.md 追加 v4.1 人工验收项**

`web/scripts/browser_checklist.md` 末尾追加 4 条：
1. 考试管理默认「正式考试」；切「错题练习」只见错题推送卷、切「日常作业」只见手动练习卷；切换不刷新页面。
2. 首页考情总览无顶部 4 统计框；每卷卡片显示 分发时间 + 四字段大数字 + 分数段直方图。
3. 首页仅正式考试；错题练习/日常作业不出现在首页。
4. 直方图 5 段、柱高=人数、柱顶标人数；无已批改时显示「暂无已批改成绩」。

- [ ] **Step 5: 提交**

```bash
git add web/scripts/smoke_test.py web/scripts/browser_checklist.md && git commit -m "test(smoke): is_wrong_push 分类 + first_distributed_at 契约断言；browser_checklist v4.1"
```

---

## Self-Review

- **Spec 覆盖**：V41-1/2（3 小框）→ Task 3 + Task 4；V41-3（首页去统计框/分发时间/仅正式考试）→ Task 3；V41-4（直方图）→ Task 2 + Task 3；is_wrong_push 识别 → Task 1；first_distributed_at → Task 1；验收第 6 条冒烟 → Task 5。无缺口。
- **占位符扫描**：所有代码步骤含完整可执行内容；无「TBD/适当处理」。
- **类型一致性**：`is_wrong_push` 后端下发 bool、前端 `matchExamSubTab` 用 `!!p.is_wrong_push`；`first_distributed_at` 后端 str|None、前端 `.slice(0,16)` 前判空；`svgHistogram(scores,{max,total_score||100,bins:5})` 签名与 Task 2 一致；`switchExamSubTab` DOM id 与 Task 3 Step 1 一致；`renderScoreHistograms` 调用点与 loadHome 一致。
- **跨任务风险**：Task 3 依赖 Task 2（svgHistogram 已存在）与 Task 1（接口字段已下发）——执行顺序按 1→2→3；Task 5 依赖 Task 1 重启后的服务（Step 7 已含重启）。
