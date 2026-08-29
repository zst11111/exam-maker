# 教师端考情管理改版（v4）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教师端信息架构改版——首页改考情总览（只读，含每卷箱线图）、考试管理改考情管理（字段放大+圆环+点击卡片展开详情、点学生进批改）、「我的试卷」独立成顶部 tab。

**Architecture:** 纯前端重构 + 冒烟测试追加。**零后端接口改动**：`GET /api/papers` 已返回全部所需字段（`distributed_count`/`submitted_count`/`graded_count`/`published`/`published_at`/`distributions[]`），箱线图分数与考试详情学生名单都从 `distributions` 派生。新增 `charts.js` 提供零依赖 SVG 圆环图/箱线图纯函数。

**Tech Stack:** 原生 JS（无框架）、原生 SVG（零 CDN 依赖）、FastAPI（后端不动）、stdlib urllib 冒烟脚本。

## Global Constraints

- **G1** `score_visible = (is_practice==1) OR (published==1)` — 学生端可见性规则，本次**不碰**。
- **G2** 教师数据隔离：任何 `teacher` 角色接口不得返回/操作非本教师 `teacher_id` 的试卷数据。后端已隔离（`db.py:317` 列表过滤；`platform_routes.py:119,130,147,158,184,194,290,483,503` 单卷 404），本次只补**冒烟断言**，不改后端。
- **G3** 练习卷（`is_practice=1`）不可「发布成绩」：后端 400 门控不变；前端无发布按钮。
- **G4** 零第三方依赖：箱线图/圆环图纯 SVG 手绘；不得引入任何 JS/CSS 库。
- **G5** 锁定技术栈：FastAPI 0.99.1 + pydantic 1.10.26 **绝不单独升级**。
- **G6** 环境注记（继承 ledger）：
  - 重启服务必须用 `pkill -f "[u]vicorn app:app"`（方括号技巧，防自匹配）**单独一条命令**，再单独一条 `nohup ... &` 启动命令，两者严格分开（合并会 rc=144，旧进程关新进程不起）。
  - curl 带中文 query 需 `--data-urlencode`；浏览器 `URLSearchParams` 自动编码，前端代码不受影响。
  - 「Tool permission stream closed before response received」= 通信层间歇抖动，非代码错误，重试/走稳定通道即可，不要怀疑内容逻辑。
- **G7** 未提交 = `distributed_count − submitted_count`；未批改 = `submitted_count − graded_count`。提交率 = `submitted/distributed`；批改率 = `graded/submitted`（submitted=0 时批改率取 0）。
- **G8** 首页考情列表口径 = **已分发试卷（正式+练习，`distributed_count > 0`）**，与考试管理一致。箱线图仅统计已批改分数，**≥5 人**才绘制，否则显示「数据不足，已批改 N 人」。
- **G9** 每条终端命令前先说明要干什么（CLAUDE.md 规则 7）；JS 改动用 `node --check` 校验。
- **G10** 考试管理卡片点击 → **内联展开详情**（考试信息+学生名单），**禁止** `onclick="openGrade(...)"` 直接跳批改；点学生行才 `openGrade(pid, sid)` 进该生批改。

**前置：本计划从 master（bd942db）出发，SDD 执行时建分支 `feat/teacher-dashboard-v4`。**

---

### Task 1: charts.js — 零依赖 SVG 图表纯函数（圆环图 + 箱线图）

**Files:**
- Create: `web/static/js/charts.js`

**Interfaces:**
- Produces（全局，供 Task 4/5 使用）：
  - `svgDonut(ratio: number, opts?: {size?, stroke?, bg?, fg?, label?})` → SVG 圆环字符串。ratio∈[0,1]。
  - `svgBoxPlot(scores: number[], opts?: {width?, height?, max?})` → SVG 箱线图字符串（min/Q1/中位/Q3/max 箱须 + 刻度轴 + 数值标注）。

- [ ] **Step 1: 创建 `web/static/js/charts.js`**

```js
// charts.js —— 零依赖 SVG 图表工具（圆环图 + 箱线图）。
// 所有函数返回 SVG 字符串，纯函数、不依赖 DOM。样式类名前缀 bp- 防冲突。

// 圆环图：ratio 0..1，中心显示 label（默认百分比）。用 stroke-dasharray 画弧。
function svgDonut(ratio, opts = {}) {
    const size = opts.size || 84;
    const stroke = opts.stroke || 10;
    const bg = opts.bg || '#e2e8f0';
    const fg = opts.fg || '#3b82f6';
    const clamped = Math.max(0, Math.min(1, ratio));
    const label = opts.label != null ? String(opts.label) : Math.round(clamped * 100) + '%';
    const r = (size - stroke) / 2;
    const C = 2 * Math.PI * r;
    const c = size / 2;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${bg}" stroke-width="${stroke}"></circle>
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${fg}" stroke-width="${stroke}"
            stroke-dasharray="${(clamped * C).toFixed(2)} ${C.toFixed(2)}"
            stroke-dashoffset="${C / 4}" stroke-linecap="round"></circle>
        <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central"
            font-size="${Math.round(size / 4)}" font-weight="700" fill="#334155">${label}</text>
    </svg>`;
}

// 线性插值分位数：sorted 升序数组，q∈[0,1]
function _quantile(sorted, q) {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function _fmt(v) { return Math.round(v * 10) / 10; }

// 横向箱线图：横轴分数 0..max；绘制 min/Q1/中位/Q3/max 箱须 + 中位线 + 刻度轴。
function svgBoxPlot(scores, opts = {}) {
    const width = opts.width || 380;
    const height = opts.height || 80;
    const max = opts.max || 100;
    const padL = 10, padR = 10, padT = 20, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const sorted = scores.slice().sort((a, b) => a - b);
    const min = sorted[0], maxV = sorted[sorted.length - 1];
    const q1 = _quantile(sorted, 0.25), med = _quantile(sorted, 0.5), q3 = _quantile(sorted, 0.75);
    const X = (v) => padL + (Math.max(0, Math.min(max, v)) / max) * plotW;
    const yTop = padT, yBot = padT + plotH, yMid = padT + plotH / 2;
    const boxX1 = X(q1), boxX2 = X(q3), medX = X(med);
    const parts = [];
    const line = (x1, y1, x2, y2, cls) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"></line>`;
    // 须 + 端点
    parts.push(line(X(min), yMid, X(q1), yMid, 'bp-whisker'));
    parts.push(line(X(q3), yMid, X(maxV), yMid, 'bp-whisker'));
    parts.push(line(X(min), yTop + 4, X(min), yBot - 4, 'bp-whisker'));
    parts.push(line(X(maxV), yTop + 4, X(maxV), yBot - 4, 'bp-whisker'));
    // 箱 + 中位线
    parts.push(`<rect x="${boxX1}" y="${yTop}" width="${boxX2 - boxX1}" height="${plotH}" rx="3" class="bp-box"></rect>`);
    parts.push(line(medX, yTop, medX, yBot, 'bp-median'));
    // 数值标注
    parts.push(`<text x="${padL}" y="${yTop - 6}" class="bp-label">min ${_fmt(min)}</text>`);
    parts.push(`<text x="${boxX1}" y="${yTop - 6}" text-anchor="middle" class="bp-label">Q1 ${_fmt(q1)}</text>`);
    parts.push(`<text x="${boxX2}" y="${yTop - 6}" text-anchor="middle" class="bp-label">Q3 ${_fmt(q3)}</text>`);
    parts.push(`<text x="${medX}" y="${yBot + 16}" text-anchor="middle" class="bp-medlabel">中位 ${_fmt(med)}</text>`);
    // 轴 + 刻度（0 / ½max / max）
    [0, max / 2, max].forEach(t => {
        parts.push(line(X(t), yBot, X(t), yBot + 5, 'bp-tick'));
        parts.push(`<text x="${X(t)}" y="${yBot + 18}" text-anchor="middle" class="bp-ticklabel">${_fmt(t)}</text>`);
    });
    parts.push(line(padL, yBot, width - padR, yBot, 'bp-axis'));
    return `<svg class="bp-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}">
        <style>
            .bp-box{fill:#bfdbfe;stroke:#2563eb;stroke-width:1.5}
            .bp-median{stroke:#1d4ed8;stroke-width:2}
            .bp-whisker{stroke:#64748b;stroke-width:1.5}
            .bp-axis{stroke:#94a3b8;stroke-width:1}
            .bp-tick{stroke:#94a3b8;stroke-width:1}
            .bp-label{font-size:10px;fill:#475569}
            .bp-medlabel{font-size:10px;fill:#1d4ed8;font-weight:700}
            .bp-ticklabel{font-size:10px;fill:#94a3b8}
        </style>
        ${parts.join('')}
    </svg>`;
}
```

- [ ] **Step 2: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/charts.js && echo "syntax OK"
```

Expected: `syntax OK`。

- [ ] **Step 3: 快速目验**（可选，node 单测：统计正确性）

```bash
node -e '
const fs=require("fs");eval(fs.readFileSync("static/js/charts.js","utf8"));
const s=svgBoxPlot([60,70,80,85,90,95,100],{max:100});
if(!s.includes("min 60")||!s.includes("中位 85")||!s.includes("Q1 70")||!s.includes("Q3 95")){console.error("箱线图统计错误");process.exit(1)}
const d=svgDonut(0.5);if(!d.includes("50%")){console.error("圆环 label 错误");process.exit(1)}
console.log("charts OK");
'
```

Expected: `charts OK`。（Q1=70、Q3=95 由 7 个等距点线性插值得到；如实现有偏差以此命令为准修正。）

- [ ] **Step 4: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/charts.js
git commit -m "feat(charts): 零依赖 SVG 圆环图 + 箱线图纯函数"
```

---

### Task 2: index.html — 新信息架构容器（tabMyPapers / myPapersView / 首页考情容器 / 引入 charts.js）

**Files:**
- Modify: `web/templates/index.html`

**Interfaces:**
- Produces（DOM id，供 Task 3/4/5 使用）：
  - `tabMyPapers`（新顶部 tab 按钮）
  - `myPapersView`（新 tab-panel，承载卷库两组 tab 与列表）
  - `examOverviewList`（首页考情列表容器）
  - `boxPlotList`（首页箱线图容器）
  - `charts.js` 脚本引入

- [ ] **Step 1: 顶部 tab 加「我的试卷」，顺序 首页|考试管理|我的试卷|出试卷|题库|学情**

把 `<nav class="top-tabs">` 内 5 个按钮改为 6 个（`tabExam` 移到 `tabHome` 之后）：

```html
        <nav class="top-tabs">
            <button class="top-tab" id="tabHome" onclick="switchTeacherTab('home')">🏠 首页</button>
            <button class="top-tab" id="tabExam" onclick="switchTeacherTab('exam')">🏫 考试管理</button>
            <button class="top-tab" id="tabMyPapers" onclick="switchTeacherTab('mypapers')">📚 我的试卷</button>
            <button class="top-tab" id="tabWizard" onclick="switchTeacherTab('wizard')">📝 出试卷</button>
            <button class="top-tab" id="tabBank" onclick="switchTeacherTab('bank')">🗂️ 题库管理</button>
            <button class="top-tab" id="tabAnalytics" onclick="switchTeacherTab('analytics')">📊 学生学情</button>
        </nav>
```

- [ ] **Step 2: 首页 `teacherHome` 改为考情总览（去掉卷库）**

把整个 `teacherHome` 面板（当前 59-70 行）替换为：

```html
        <!-- 首页：考情总览（只读） -->
        <div class="tab-panel" id="teacherHome">
            <div class="section-head"><h2>考情总览</h2></div>
            <div class="stat-cards" id="statCards"></div>
            <div class="section-head"><h2>考试考情</h2></div>
            <div id="examOverviewList" class="paper-list"></div>
            <div class="section-head"><h2>学生成绩箱线图</h2></div>
            <div id="boxPlotList" class="paper-list"></div>
        </div>
```

（`statCards` 保留；`examOverviewList`、`boxPlotList` 为新增容器。）

- [ ] **Step 3: 新增 `myPapersView` 面板（卷库从首页迁入）**

在 `teacherHome` 面板之后（`wizardWrap` 之前）插入：

```html
        <!-- 我的试卷：独立卷库 -->
        <div class="tab-panel hidden" id="myPapersView">
            <div class="section-head"><h2>我的试卷</h2></div>
            <div class="papers-tabs">
                <button class="papers-tab active" id="papersTabFormal" onclick="switchPapersTab('formal')">正式试卷</button>
                <button class="papers-tab" id="papersTabPractice" onclick="switchPapersTab('practice')">错题推送卷</button>
            </div>
            <div id="myPapersFormal" class="paper-list"></div>
            <div id="myPapersPractice" class="paper-list hidden"></div>
        </div>
```

- [ ] **Step 4: 批改/分发视图返回按钮文案改为「返回首页」**

- `gradeView`（426-431 行）内 `← 返回我的试卷` → `← 返回首页`
- `distributeView`（413-415 行）内 `← 返回我的试卷` → `← 返回首页`

- [ ] **Step 5: 引入 charts.js**

在 `</body>` 前的 script 区，`teacher.js` 之前加入：

```html
<script src="/static/js/charts.js"></script>
```

- [ ] **Step 6: 校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && python - <<'PY'
from html.parser import HTMLParser
class P(HTMLParser):
    def __init__(self): super().__init__(); self.ids=[]
    def handle_starttag(self, t, a):
        if t in ('div','button'): self.ids.append(dict(a).get('id'))
p=P(); p.feed(open('templates/index.html').read())
for i in ['tabMyPapers','myPapersView','examOverviewList','boxPlotList']:
    assert i in p.ids, f'缺少 {i}'
assert open('templates/index.html').read().count('id="teacherHome"')==1
print('index OK')
PY
```

Expected: `index OK`。

- [ ] **Step 7: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/templates/index.html
git commit -m "feat(html): 新 IA——我的试卷独立 tab、首页考情总览容器、引入 charts.js"
```

---

### Task 3: grade.js — openGrade 支持学生聚焦 + 视图隐藏列表补全

**Files:**
- Modify: `web/static/js/grade.js`

**Interfaces:**
- Consumes: `myPapersView`（Task 2 新增 DOM id）
- Produces: `openGrade(pid, focusSid?)` —— 供 Task 5 考试详情「点学生进批改」调用；`renderGradeList` 的卡片带 `id="grade-card-{sid}"`。

- [ ] **Step 1: openGrade 增加 focusSid 参数，隐藏列表加入 myPapersView**

改 `openGrade` 签名与 hide 列表（当前 4-30 行）：

```js
async function openGrade(pid, focusSid) {
    _gradePaperId = pid;
    const d = await authedJson(`/api/papers/${pid}/submissions`);
    // ……（中间 fetch/初始化逻辑保持不变）……
    ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView', 'examManageView', 'gradeOverviewView', 'myPapersView']
        .forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    $('gradeView').classList.remove('hidden');
    _gradePaperId = pid;
    _gradePaper = paper;
    const btnPub = $('btnPublishPaper');
    if (btnPub) btnPub.classList.toggle('hidden', !!paper.is_practice || !!paper.published);
    renderGradeList();
    if (focusSid) focusStudentCard(focusSid);
}
```

（hide 列表**在现有 8 个 id 后追加 `'myPapersView'`**，共 9 个；其余行不动。）

- [ ] **Step 2: 新增 focusStudentCard（滚动 + 临时高亮）**

在 `renderGradeList` 之后新增：

```js
function focusStudentCard(sid) {
    const card = document.getElementById('grade-card-' + sid);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('grade-card-focus');
    setTimeout(() => card.classList.remove('grade-card-focus'), 2200);
}
```

- [ ] **Step 3: gradeCard 卡片加 id（滚动目标）**

`gradeCard` 内 `<div class="paper-card grade-card">` 改为：

```js
    <div class="paper-card grade-card" id="grade-card-${s.id}">
```

- [ ] **Step 4: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/grade.js && echo "syntax OK"
```

Expected: `syntax OK`。

- [ ] **Step 5: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/grade.js
git commit -m "feat(grade): openGrade 支持指定学生聚焦，隐藏列表补 myPapersView"
```

---

### Task 4: teacher.js — 首页考情总览 + 我的试卷独立 tab（只读）

**Files:**
- Modify: `web/static/js/teacher.js`

**Interfaces:**
- Consumes: `svgDonut`/`svgBoxPlot`（Task 1）、`tabMyPapers`/`myPapersView`/`examOverviewList`/`boxPlotList`（Task 2）
- Produces:
  - `_T_TABS` 增加 `mypapers`；`_ALL_VIEWS` 增加 `'myPapersView'`
  - `loadMyPapers()`（mypapers tab 入口）
  - `renderExamOverview()` / `examOverviewCard(p)`（首页考情列表）
  - `renderBoxPlots()`（首页箱线图区）
  - `refreshMyPapers()`（卷库刷新辅助，供 pmSave/deleteMyPaper/publishPaper 复用）
  - `publishPaper` 末尾改为**停留原地**（不再 `openGrade(pid)`）

- [ ] **Step 1: tab 表 + 视图表 + switchTeacherTab 接线**

改文件头（1-3 行）：

```js
// 教师端：首页（考情总览）、考试管理、我的试卷、分发、学情
const _T_TABS = { home: 'tabHome', exam: 'tabExam', mypapers: 'tabMyPapers', wizard: 'tabWizard', bank: 'tabBank', analytics: 'tabAnalytics' };
const _ALL_VIEWS = ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView', 'examManageView', 'gradeOverviewView', 'myPapersView'];
```

改 `switchTeacherTab`（5-15 行）增加 mypapers 分支（**保持其余分支不变**）：

```js
    if (tab === 'home') { $('teacherHome').classList.remove('hidden'); loadHome(); }
    else if (tab === 'exam') { $('examManageView').classList.remove('hidden'); loadExamManage(); }
    else if (tab === 'mypapers') { $('myPapersView').classList.remove('hidden'); loadMyPapers(); }
    else if (tab === 'wizard') { $('wizardWrap').classList.remove('hidden'); }
    else if (tab === 'bank') { $('bankView').classList.remove('hidden'); loadBankList(); }
    else if (tab === 'analytics') { $('teacherAnalytics').classList.remove('hidden'); loadAnalytics(); }
```

（`_ALL_VIEWS` 已含 myPapersView，hide 循环自动覆盖。）

- [ ] **Step 2: loadHome 重写为考情总览（去掉卷库渲染）**

把 `loadHome`（22-46 行）整体替换为：

```js
async function loadHome() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    const stat = { dist: 0, sub: 0, graded: 0, ongoing: 0 };
    _papersCache.forEach(p => {
        stat.dist += p.distributed_count || 0;
        stat.sub += p.submitted_count || 0;
        stat.graded += p.graded_count || 0;
        if (!p.is_practice && (p.distributed_count || 0) > 0 && !p.published) stat.ongoing++;
    });
    $('statCards').innerHTML = `
        <div class="stat-card"><div class="stat-num">${stat.dist}</div><div class="stat-label">总已分发</div></div>
        <div class="stat-card"><div class="stat-num">${stat.sub}</div><div class="stat-label">总已提交</div></div>
        <div class="stat-card"><div class="stat-num">${stat.graded}</div><div class="stat-label">总已批改</div></div>
        <div class="stat-card"><div class="stat-num">${stat.ongoing}</div><div class="stat-label">进行中的考试</div></div>`;
    renderExamOverview();
    renderBoxPlots();
}
```

（注意：stat 卡**不带 onclick**——首页只读。旧 `openGradeOverview('...')` 入口随之移除，`gradeOverviewView` 留为休眠视图，记为 deferred minor。）

- [ ] **Step 3: 新增 loadMyPapers + renderExamOverview + renderBoxPlots**

在 `renderPapersTabs`（48 行）之前插入 `loadMyPapers`，在其后插入两个首页渲染函数：

```js
async function loadMyPapers() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    renderPapersTabs();
}

function refreshMyPapers() { renderPapersTabs(); }
```

```js
// ── 首页考情列表（只读）──
function renderExamOverview() {
    const exams = _papersCache.filter(p => (p.distributed_count || 0) > 0);
    $('examOverviewList').innerHTML = exams.length
        ? exams.map(examOverviewCard).join('')
        : '<p class="empty-row">暂无已分发的考试（先在「我的试卷」中分发试卷）</p>';
}

function examOverviewCard(p) {
    const dist = p.distributed_count || 0, sub = p.submitted_count || 0, graded = p.graded_count || 0;
    const unsub = dist - sub, ungraded = sub - graded;
    const subRatio = dist ? sub / dist : 0;
    const gradeRatio = sub ? graded / sub : 0;
    return `
    <div class="paper-card exam-overview-card">
        <div class="paper-card-head">
            <span class="paper-card-title">📄 ${esc(p.title)}</span>
            <span class="tag">${esc(p.subject || '未指定学科')}</span>
            ${p.is_practice ? '<span class="tag">🏷️ 练习</span>' : ''}
            <span class="tag">${p.question_count} 题 / 总分 ${p.total_score ?? 0}</span>
            ${p.is_practice ? '' : `<span class="tag ${p.published ? 'pub-yes' : 'pub-no'}">${p.published ? '✅ 已发布' : '⏳ 未发布'}</span>`}
        </div>
        <div class="exam-stats-grid">
            <div class="exam-stat"><div class="stat-num-lg ok">${sub}</div><div class="stat-label">已提交</div></div>
            <div class="exam-stat"><div class="stat-num-lg warn">${unsub}</div><div class="stat-label">未提交</div></div>
            <div class="exam-stat"><div class="stat-num-lg ok">${graded}</div><div class="stat-label">已批改</div></div>
            <div class="exam-stat"><div class="stat-num-lg warn">${ungraded}</div><div class="stat-label">未批改</div></div>
            <div class="exam-donuts">
                <div class="donut-item">${svgDonut(subRatio, { label: Math.round(subRatio * 100) + '%' })}<div class="stat-label">提交率</div></div>
                <div class="donut-item">${svgDonut(gradeRatio, { fg: '#10b981', label: Math.round(gradeRatio * 100) + '%' })}<div class="stat-label">批改率</div></div>
            </div>
        </div>
    </div>`;
}

// ── 首页箱线图区（每卷一张，≥5 个已批改分数才绘制）──
function renderBoxPlots() {
    const rows = [];
    _papersCache.forEach(p => {
        const scores = (p.distributions || [])
            .filter(d => d.status === 'graded')
            .map(d => Number(d.total_score))
            .filter(Number.isFinite);
        if ((p.distributed_count || 0) === 0) return;
        if (scores.length < 5) {
            rows.push(`<div class="boxplot-row">
                <span class="boxplot-title">📄 ${esc(p.title)}</span>
                <span class="boxplot-note">数据不足，已批改 ${scores.length} 人（≥5 人才绘制箱线图）</span>
            </div>`);
            return;
        }
        rows.push(`<div class="boxplot-row">
            <span class="boxplot-title">📄 ${esc(p.title)}</span>
            ${svgBoxPlot(scores, { max: p.total_score || 100 })}
        </div>`);
    });
    $('boxPlotList').innerHTML = rows.length
        ? rows.join('')
        : '<p class="empty-row">暂无已批改数据，无法绘制箱线图</p>';
}
```

- [ ] **Step 4: pmSave 编辑分支 / deleteMyPaper / publishPaper 同步刷新卷库**

- `pmSave` 编辑分支：改为 `await loadHome(); refreshMyPapers();`（**必须 await**——否则 refreshMyPapers 用旧 `_papersCache` 渲染，改名结果要切 tab 才可见）
- `deleteMyPaper`（292-297 行）：在 `await loadHome(); await loadExamManage();` 后追加 `refreshMyPapers();`
- `publishPaper`（235-242 行）末尾：把 `await loadHome(); openGrade(pid);` 改为 `await loadHome(); await loadExamManage(); refreshMyPapers();`（**发布后停留原地**，不再跳批改视图）

```js
async function publishPaper(pid) {
    if (!confirm('确定发布整卷成绩？发布后学生端将可见所有已批改分数与反馈。')) return;
    await authedJson(`/api/papers/${pid}/publish`, { method: 'POST' });
    alert('成绩已发布，学生端现在可以查看分数');
    await loadExamManage();
    await loadHome();
    refreshMyPapers();
}
```

- [ ] **Step 5: openDistribute 隐藏列表补 myPapersView**

`openDistribute` 内 hide 列表（317-318 行）追加 `'myPapersView'`（共 9 个 id）。

- [ ] **Step 6: 语法校验 + 关键引用存在性**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/teacher.js && echo "syntax OK"
grep -c "myPapersView" static/js/teacher.js   # 期望 ≥3（_ALL_VIEWS/switchTeacherTab/openDistribute 各 1 处）
grep -c "renderPapersTabs();" static/js/teacher.js  # 期望 2（loadMyPapers + refreshMyPapers）
```

Expected: `syntax OK`；`myPapersView` 计数 ≥4；`renderPapersTabs()` 恰 2 处（loadMyPapers 内 + refreshMyPapers 内）。若 `loadHome` 里还残留 `renderPapersTabs()` 调用则删除。

- [ ] **Step 7: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/teacher.js
git commit -m "feat(teacher): 首页改考情总览（只读+箱线图），我的试卷独立 tab，发布后停留原地"
```

---

### Task 5: teacher.js — 考试管理考情改版（字段放大 + 详情展开 + 点学生进批改）

**Files:**
- Modify: `web/static/js/teacher.js`

**Interfaces:**
- Consumes: `svgDonut`（Task 1）、`openGrade(pid, focusSid)`（Task 3）、`publishPaper`（Task 4）
- Produces:
  - `loadExamManage` 列表范围放宽为**所有已分发试卷（含练习卷）**
  - `examRow(p)` 重写：字段放大 + 圆环 + 整卡点击展开详情
  - `toggleExamDetail(pid)`（内联展开/收起）

**⚠️ 关键取值（Task 3 审查裁定，实现必读）**：`openGrade` 第二参必须是**提交 id**（`submissions.id`），不是学生 id。批改卡片的 `id="grade-card-{s.id}"` 中 `s.id` 是提交 id。学生行传 `d.sub_id`（distributions 里 `s.id AS sub_id`，未作答为 `null`）；`null` 时 `if(focusSid)` 短路 → 不聚焦（无提交本就无批改卡），行为正确。

- [ ] **Step 1: loadExamManage 放宽范围（正式+练习）**

`loadExamManage`（205-212 行）中：

```js
    const exams = _papersCache.filter(p => !p.is_practice && (p.distributed_count || 0) > 0);
```

改为：

```js
    const exams = _papersCache.filter(p => (p.distributed_count || 0) > 0);
```

- [ ] **Step 2: 重写 examRow（放大字段 + 圆环 + 整卡点击展开）**

把 `examRow`（214-233 行）整体替换为：

```js
function examRow(p) {
    const dist = p.distributed_count || 0, sub = p.submitted_count || 0, graded = p.graded_count || 0;
    const unsub = dist - sub, ungraded = sub - graded;
    const subRatio = dist ? sub / dist : 0;
    const gradeRatio = sub ? graded / sub : 0;
    return `
    <div class="paper-card exam-manage-card exam-head" onclick="toggleExamDetail(${p.id})">
        <div class="paper-card-head">
            <span class="paper-card-title">📄 ${esc(p.title)}</span>
            <span class="tag">${esc(p.subject || '未指定学科')}</span>
            ${p.is_practice ? '<span class="tag">🏷️ 练习</span>' : ''}
            <span class="tag">${p.question_count} 题 / 总分 ${p.total_score ?? 0}</span>
            <span class="tag ${p.published ? 'pub-yes' : 'pub-no'}">${p.published ? '✅ 已发布' : '⏳ 未发布'}</span>
            <span class="hint" style="margin-left:auto" id="examArrow_${p.id}">▾ 点击查看详情</span>
        </div>
        <div class="exam-stats-grid">
            <div class="exam-stat"><div class="stat-num-lg ok">${sub}</div><div class="stat-label">已提交</div></div>
            <div class="exam-stat"><div class="stat-num-lg warn">${unsub}</div><div class="stat-label">未提交</div></div>
            <div class="exam-stat"><div class="stat-num-lg ok">${graded}</div><div class="stat-label">已批改</div></div>
            <div class="exam-stat"><div class="stat-num-lg warn">${ungraded}</div><div class="stat-label">未批改</div></div>
            <div class="exam-donuts">
                <div class="donut-item">${svgDonut(subRatio, { label: Math.round(subRatio * 100) + '%' })}<div class="stat-label">提交率</div></div>
                <div class="donut-item">${svgDonut(gradeRatio, { fg: '#10b981', label: Math.round(gradeRatio * 100) + '%' })}<div class="stat-label">批改率</div></div>
            </div>
        </div>
        <div class="exam-detail hidden" id="examDetail_${p.id}">
            <div class="exam-info-grid">
                <span>科目：${esc(p.subject || '—')}</span>
                <span>题数：${p.question_count}</span>
                <span>总分：${p.total_score ?? 0}</span>
                <span>时长：${p.duration || 120} 分钟</span>
                <span>创建：${esc((p.created_at || '').slice(0, 16))}</span>
                <span>发布：${p.published_at ? esc((p.published_at || '').slice(0, 16)) : '未发布'}</span>
                ${p.remark ? `<span>备注：${esc(p.remark)}</span>` : ''}
            </div>
            <div class="exam-students">
                <div class="exam-students-head">学生名单（${dist} 人）— 点击学生进入该生批改</div>
                ${(p.distributions || []).map(d => `
                    <div class="student-row" onclick="event.stopPropagation(); openGrade(${p.id}, ${d.sub_id})" title="进入该生批改">
                        <span>🧑‍🎓 ${esc(d.name)}</span>
                        <span class="tag">${esc(d.class_name || '')}</span>
                        <span class="hint">${esc(d.student_no || '')}</span>
                        <span class="tag status-${esc(d.status || 'none')}">${d.status === 'graded' ? '已批改' : (d.status === 'submitted' ? '已提交' : '未作答')}</span>
                        <span class="score-big" style="margin-left:auto">${d.status === 'graded' ? (d.total_score ?? '—') : '—'}</span>
                    </div>`).join('') || '<span class="hint">暂无学生</span>'}
            </div>
        </div>
        <div class="paper-card-actions">
            <button class="btn-small" onclick="event.stopPropagation(); openGrade(${p.id})">✍️ 去批改</button>
            ${p.is_practice ? '' : (p.published ? '' : `<button class="btn-small btn-primary-inline" onclick="event.stopPropagation(); publishPaper(${p.id})">📣 发布成绩</button>`)}
        </div>
    </div>`;
}

// 展开/收起考试详情（整卡点击切换；内层按钮/学生行已 stopPropagation，不会误触）
function toggleExamDetail(pid) {
    const el = $('examDetail_' + pid);
    const arrow = $('examArrow_' + pid);
    if (!el) return;
    const opening = el.classList.contains('hidden');
    el.classList.toggle('hidden');
    if (arrow) arrow.textContent = opening ? '▴ 收起' : '▾ 点击查看详情';
}
```

（G10：整卡只展开详情，**不触发** openGrade；点学生行才进批改。）

- [ ] **Step 3: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/teacher.js && echo "syntax OK"
```

Expected: `syntax OK`。

- [ ] **Step 4: 浏览器级自查（API 层验证 distributions 形状，供详情渲染）**

```bash
TOKEN=$(curl -s -X POST http://localhost:2342/api/auth/login -H 'Content-Type: application/json' -d '{"username":"teacher","password":"123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:2342/api/papers | python3 -c '
import sys,json
d=json.load(sys.stdin)
for p in d["papers"]:
    if p.get("distributed_count",0)>0:
        for x in p["distributions"]:
            assert "status" in x and "total_score" in x and "name" in x, p["title"]
        print(p["title"], "distributions OK,", len(p["distributions"]), "人")
'
```

Expected: 每个已分发卷打印 `distributions OK`。若服务未运行，先按 G6 重启（或跳过，交给 Task 7 冒烟）。

- [ ] **Step 5: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/teacher.js
git commit -m "feat(teacher): 考试管理考情化——字段放大+圆环，点击卡片展开详情，点学生进该生批改"
```

---

### Task 6: style.css — 考情样式（大数字/圆环/详情区/箱线图/学生行高亮）

**Files:**
- Modify: `web/static/style.css`（末尾追加，共 532 行）

**Interfaces:**
- Produces: 样式类供 Task 4/5 的 DOM 使用（`exam-overview-card`/`exam-manage-card`/`exam-stats-grid`/`exam-stat`/`stat-num-lg`/`exam-donuts`/`donut-item`/`exam-detail`/`exam-info-grid`/`exam-students`/`exam-students-head`/`student-row`/`grade-card-focus`/`boxplot-row`/`boxplot-title`/`boxplot-note`/`exam-head`）

- [ ] **Step 1: 追加样式**

在文件末尾追加：

```css
/* ═══════════ 教师端考情管理（v4）═══════════ */
.exam-head { cursor: pointer; }
.exam-stats-grid { display: grid; grid-template-columns: repeat(4, minmax(64px, 1fr)) auto; gap: 14px; align-items: center; margin-bottom: 10px; }
.exam-stat { text-align: center; }
.stat-num-lg { font-size: 1.7rem; font-weight: 800; line-height: 1.1; }
.stat-num-lg.ok { color: #047857; }
.stat-num-lg.warn { color: #b45309; }
.exam-donuts { display: flex; gap: 14px; }
.donut-item { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.donut-item .stat-label { margin-top: 0; }
.exam-detail { margin: 4px 0 12px; padding: 14px; background: #f8fafc; border: 1px dashed var(--border); border-radius: 10px; }
.exam-info-grid { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: .82rem; color: var(--text-muted); margin-bottom: 12px; }
.exam-students-head { font-weight: 600; font-size: .85rem; margin-bottom: 6px; color: var(--text-muted); }
.student-row { display: flex; align-items: center; gap: 8px; font-size: .85rem; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
.student-row:hover { background: #eef2ff; }
.boxplot-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; flex-wrap: wrap; }
.boxplot-title { min-width: 180px; font-size: .85rem; font-weight: 600; }
.boxplot-note { font-size: .8rem; color: var(--text-muted); }
.boxplot-row .bp-svg { flex: 1; min-width: 280px; }
.grade-card-focus { outline: 3px solid #3b82f6; outline-offset: 2px; border-radius: 14px; transition: outline-color .2s; }
@media (max-width: 720px) {
    .exam-stats-grid { grid-template-columns: repeat(2, 1fr); }
    .exam-donuts { grid-column: 1 / -1; justify-content: center; }
}
```

- [ ] **Step 2: 校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && python - <<'PY'
css = open('static/style.css').read()
for c in ['exam-stats-grid','stat-num-lg','exam-detail','student-row','boxplot-row','grade-card-focus','donut-item']:
    assert c in css, f'缺少 {c}'
print('css OK,', len(css.splitlines()), 'lines')
PY
```

Expected: `css OK`。

- [ ] **Step 3: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/style.css
git commit -m "style(css): 考情大数字/圆环/考试详情/学生行/箱线图/批改聚焦样式"
```

---

### Task 7: smoke_test.py — 教师隔离断言 + 数据契约断言

**Files:**
- Modify: `web/scripts/smoke_test.py`

**Interfaces:**
- Consumes: `db.create_user`（需 `password_hash`）、`db.delete_user`、`auth.hash_password`
- Produces: 隔离与数据契约断言，全部通过打印 `SMOKE OK`

- [ ] **Step 1: 脚本头部引入 auth（teacher_b 造号用）**

`import db` 之后追加：

```python
import auth
```

- [ ] **Step 2: main() 内、清理之前插入隔离 + 契约断言**

在现有 `# 6) 练习卷...` 段之后、`# 清理` 之前插入：

```python
    # 7) 教师隔离（G2）：teacher_b 看不到 teacher 的卷
    tb_id = db.create_user({
        "username": "teacher_b_smoke", "password_hash": auth.hash_password("123456"),
        "role": "teacher", "name": "老师乙",
    })
    tb = login({"username": "teacher_b_smoke", "password": "123456"})
    plb = req("GET", "/api/papers", tb)["papers"]
    assert all(x["id"] != pid for x in plb), "teacher_b 不应看到 teacher 的正式卷"
    assert all(x["id"] != prac for x in plb), "teacher_b 不应看到 teacher 的练习卷"
    try:
        req("GET", f"/api/papers/{pid}", tb)
        raise AssertionError("teacher_b 访问他人正式卷应 404")
    except urllib.error.HTTPError as e:
        assert e.code == 404

    # 8) 数据契约（考情/详情/箱线图依赖）：distributions 含状态与得分
    pl3 = req("GET", "/api/papers", t)["papers"]
    p3 = next(x for x in pl3 if x["id"] == pid)
    d0 = p3["distributions"][0]
    assert d0["name"] and d0["status"] == "graded" and d0["total_score"] == 5.0
    assert d0.get("student_id") and "student_no" in d0 and "class_name" in d0
    scored = [d["total_score"] for d in p3["distributions"] if d["status"] == "graded"]
    assert len(scored) == 1

    # 清理 teacher_b
    db.delete_user(tb_id)
```

（`# 清理` 段保留原删除正式卷/练习卷逻辑，最后统一执行。）

- [ ] **Step 3: 重启服务 + 跑冒烟**

按 G6 分开执行（先说明）：

```bash
# 杀掉旧服务（防自匹配）
pkill -f "[u]vicorn app:app"
```
```bash
# 启动新服务
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && nohup /root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --host 0.0.0.0 --port 2342 > /tmp/exam_server.log 2>&1 &
```
```bash
# 等待启动后跑冒烟
sleep 3
/root/miniconda3/envs/exam_env/bin/python scripts/smoke_test.py
```

Expected: `SMOKE OK: 全部断言通过`（原有 1-6 步 + 新增 7-8 步全过）。

- [ ] **Step 4: 前端语法全量回归**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && for f in static/js/*.js; do node --check "$f" || exit 1; done; echo "all JS OK"
```

Expected: `all JS OK`。

- [ ] **Step 5: 浏览器人工验收清单追加**

在 `web/scripts/browser_checklist.md` 末尾追加 v4 区块：

```markdown
## v4 考情管理改版（2026-08-29）人工验收
- [ ] 教师登录 → 首页：无卷库；有全局统计行（总已分发/总已提交/总已批改/进行中）+ 每卷四字段大数字带圆环 + 每卷箱线图（≥5 人）或「数据不足」
- [ ] 首页全程无可点击的操作按钮（只读）
- [ ] 考试管理：点卡片 → 展开详情（卷名/科目/题数/总分/时长/创建/发布 + 学生名单）；不再直接跳批改
- [ ] 考试管理详情点某学生 → 批改视图滚动聚焦到该生卡片并高亮
- [ ] 「我的试卷」独立 tab：正式/错题推送两组正常；改名备注/分发/批改/删除可用；首页不再出现卷库
- [ ] 发布成绩后停留在考试管理（不再跳批改视图）；学生端可见分数（G1 回归）
- [ ] 教师隔离：注册第二个老师账号，登录后看不到/打不开第一个老师的卷
```

- [ ] **Step 6: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/scripts/smoke_test.py web/scripts/browser_checklist.md
git commit -m "test(smoke): 教师隔离断言 + distributions 数据契约断言 + v4 人工验收清单"
```

---

## Self-Review（写完后对照 spec 核查）

**Spec 覆盖：**
- 需求 ①（考试管理字段放大+圆环）→ Task 5（exam-stats-grid + svgDonut）
- 需求 ②（卡片点击显示详情，不跳批改）→ Task 5（examRow 整卡 toggleExamDetail，G10）
- 需求 ③（首页考情总览 + 箱线图）→ Task 2（容器）+ Task 4（loadHome/renderExamOverview/renderBoxPlots）
- 需求 ④（我的试卷独立 tab）→ Task 2（tabMyPapers/myPapersView）+ Task 4（_T_TABS/loadMyPapers）
- 新增隔离约束（G2）→ Task 7 断言（不依赖后端改动，后端已隔离）
- spec §13 裁定：未批改=已提交−已批改 → G7/Task 4-5；提交率/批改率分母 → G7；详情内联展开 → Task 5；点学生聚焦 → Task 3+5；练习卷进考情列表无发布按钮 → Task 5（loadExamManage 放宽 + 按钮条件）

**占位符扫描：** 无 TBD/TODO；每个任务含完整代码与校验命令。

**类型/接口一致性：**
- `svgDonut`/`svgBoxPlot` Task 1 定义，Task 4/5 调用（函数名/参数一致）。
- `openGrade(pid, focusSid?)` Task 3 定义，Task 5 学生行调用 `openGrade(${p.id}, ${d.student_id})`；Task 4/现有代码单参调用不受影响（focusSid 可空）。
- `publishPaper` Task 4 改末尾，Task 5 按钮继续调用——签名不变。
- `_ALL_VIEWS` 与 grade.js/openDistribute 的 hide 列表必须都含 `myPapersView`：Task 3（grade.js）、Task 4 Step 5（openDistribute）、Task 4 Step 1（_ALL_VIEWS）。三处一致。

**已知中间态（SDD 分任务可接受，分支未部署前无碍）：**
- Task 2 之后、Task 4 之前：点「我的试卷」tab 无响应（switchTeacherTab 尚无 mypapers 分支），属预期中间态。
- Task 4 之后、Task 5 之前：考试管理仍是旧 examRow（可跳批改），首页已是新总览。

**Deferred minors（本次不动，记入 ledger）：**
- `_papersTab` 死变量；`gradeOverviewView` 首页无入口（休眠视图，可后续删）；`esc()` 不转义双引号。
