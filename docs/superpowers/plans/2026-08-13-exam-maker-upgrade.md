# exam-maker 网页升级（阶段一）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 exam-maker 出卷向导升级为：题目级试卷结构（替代双向细目表）、HTML+KaTeX 试卷成品渲染与每题替换、以及一个可筛选可增删改的 SQLite 题库。

**Architecture:** 后端新增 `db.py`（sqlite3 数据层）+ `questionbank.py`（题库路由），`app.py` 改造 Step 4/5 为结构化输出；前端从单文件 `index.html` 拆出 `static/js/` 四个模块，顶部导航改为「出卷向导 / 题库」两个 tab，试卷用预置 HTML 模板 + KaTeX 客户端渲染。

**Tech Stack:** FastAPI <0.100（pydantic v1）、uvicorn、OpenAI SDK（DeepSeek）、Python 标准库 sqlite3、原生 JS、KaTeX（CDN）。

## Global Constraints

- 运行环境：`exam_env`（Python 3.11），启动走 `web/start.sh`（端口 2342）。
- **零新增 pip 依赖**：题库用标准库 `sqlite3`；KaTeX 走 CDN，无构建步骤。
- FastAPI <0.100 → pydantic v1；`Query`/`Form`/`Request` 从 `fastapi` 导入（现有 import 已含）。
- **非 git 仓库**：计划中「Commit」步骤改为「验证通过」检查点（curl/python 冒烟测试确认无误即通过），不做 git commit。
- 遵循现有代码风格：前端全局作用域原生 JS、全局 `S` 状态对象、`$` 选择器；后端 `stream_sse(event, data)`、`parse_json_block(raw)`、`load_session`/`save_session`。
- SSE 错误处理统一沿用 `try/except ... yield stream_sse("error", str(e))`。
- UI 文案中文；题目题干/答案中的公式用 LaTeX 字符串（前端 KaTeX 渲染）。
- 题目级知识点粒度：**一题一知识点**（`chapter` + `topic` 两列）。
- 阶段二后门：`questions` 表含可空 `created_by` 列，本次恒为 null。

---

## File Structure

**后端：**
- `web/db.py`（新建）— SQLite 数据层：建表 + CRUD + 筛选 + 批量导入。
- `web/questionbank.py`（新建）— FastAPI 题库路由 `/api/questionbank/*`。
- `web/app.py`（修改）— include 题库路由、Step 1 加 subject、Step 4 改 `preview-structure`、Step 5 改结构化命题 + 新增 `/step5/alternatives`。

**前端：**
- `web/static/js/api.js`（新建）— 基座：`S` 状态、`$`/`esc`/`addLogEl`、fetch/SSE 封装。
- `web/static/js/wizard.js`（新建）— 5 步向导逻辑（从 index.html 内联 JS 迁入并改造）。
- `web/static/js/renderer.js`（新建）— 试卷渲染 + 每题替换。
- `web/static/js/questionbank.js`（新建）— 题库页。
- `web/static/papers/standard.html`（新建）— 试卷模板 A（密封线）。
- `web/static/papers/simple.html`（新建）— 试卷模板 B（简洁）。
- `web/templates/index.html`（修改）— 顶部 tab、Step 1 subject、Step 4 结构表、Step 5 渲染区、题库面板、KaTeX 引入、script 引用改为外链。
- `web/static/style.css`（修改）— 新增结构表/渲染/题库样式。

---

## Task 1: SQLite 数据层 `db.py`

**Files:**
- Create: `web/db.py`

**Interfaces:**
- Produces（后续任务依赖，签名以本任务为准）：
  - `init_db() -> None`
  - `create_question(q: dict) -> int`（返回新 id）
  - `get_question(qid: int) -> dict | None`
  - `update_question(qid: int, q: dict) -> None`
  - `delete_question(qid: int) -> None`
  - `list_questions(filters: dict) -> list[dict]`（filters 可选键：`subject`/`type`/`difficulty`/`chapter`/`topic`）
  - `import_questions(items: list[dict]) -> int`（返回导入条数）

- [ ] **Step 1: 写 `web/db.py`**

```python
"""题库数据层 — SQLite 单文件（标准库 sqlite3，零依赖）。"""
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH = Path(__file__).resolve().parent / "data" / "questionbank.db"


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS questions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            subject    TEXT NOT NULL,
            type       TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            chapter    TEXT,
            topic      TEXT,
            content    TEXT NOT NULL,
            answer     TEXT,
            analysis   TEXT,
            source     TEXT DEFAULT 'manual',
            exam_ref   TEXT,
            created_by TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    conn.commit()
    conn.close()


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


def create_question(q: Dict[str, Any]) -> int:
    conn = get_conn()
    now = _now()
    cur = conn.execute("""
        INSERT INTO questions
            (subject, type, difficulty, chapter, topic, content, answer, analysis, source, exam_ref, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        q.get("subject", ""), q.get("type", ""), q.get("difficulty", "中等"),
        q.get("chapter"), q.get("topic"), q.get("content", ""),
        q.get("answer"), q.get("analysis"), q.get("source", "manual"),
        q.get("exam_ref"), q.get("created_by"), now, now,
    ))
    conn.commit()
    qid = cur.lastrowid
    conn.close()
    return qid


def get_question(qid: int) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def update_question(qid: int, q: Dict[str, Any]) -> None:
    conn = get_conn()
    conn.execute("""
        UPDATE questions SET
            subject=?, type=?, difficulty=?, chapter=?, topic=?, content=?, answer=?, analysis=?, source=?, exam_ref=?, updated_at=?
        WHERE id=?
    """, (
        q.get("subject", ""), q.get("type", ""), q.get("difficulty", "中等"),
        q.get("chapter"), q.get("topic"), q.get("content", ""),
        q.get("answer"), q.get("analysis"), q.get("source", "manual"),
        q.get("exam_ref"), _now(), qid,
    ))
    conn.commit()
    conn.close()


def delete_question(qid: int) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM questions WHERE id = ?", (qid,))
    conn.commit()
    conn.close()


def list_questions(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    where, params = [], []
    for key in ("subject", "type", "difficulty"):
        if filters.get(key):
            where.append(f"{key} = ?")
            params.append(filters[key])
    for key in ("chapter", "topic"):
        if filters.get(key):
            where.append(f"{key} LIKE ?")
            params.append(f"%{filters[key]}%")
    sql = "SELECT * FROM questions" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id DESC"
    conn = get_conn()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def import_questions(items: List[Dict[str, Any]]) -> int:
    count = 0
    for item in items:
        create_question(item)
        count += 1
    return count
```

- [ ] **Step 2: 冒烟测试数据层**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web
/root/miniconda3/envs/exam_env/bin/python -c "
import db
db.init_db()
qid = db.create_question({'subject':'数学','type':'选择题','difficulty':'基础','chapter':'第一章 行列式','topic':'行列式计算','content':'计算 $$\\\\det A$$','answer':'x','source':'manual'})
assert qid > 0
assert db.get_question(qid)['topic'] == '行列式计算'
assert len(db.list_questions({'subject':'数学','difficulty':'基础'})) >= 1
assert len(db.list_questions({'topic':'行列式'})) >= 1
db.update_question(qid, {'subject':'数学','type':'选择题','difficulty':'中等','chapter':'第一章 行列式','topic':'行列式计算','content':'计算 $$\\\\det B$$','answer':'y','source':'manual'})
assert db.get_question(qid)['difficulty'] == '中等'
n = db.import_questions([{'subject':'物理','type':'填空题','difficulty':'难','chapter':'力学','topic':'牛顿定律','content':'F=ma','source':'exam','exam_ref':'2024期末'}])
assert n == 1
db.delete_question(qid)
assert db.get_question(qid) is None
print('db.py OK')
"
```

- [ ] **Step 3: 验证通过**

预期输出：`db.py OK`。若报错按报错信息修 `db.py`。

---

## Task 2: 题库路由 `questionbank.py`

**Files:**
- Create: `web/questionbank.py`
- Modify: `web/app.py`（import + include router + `init_db()`）

**Interfaces:**
- Consumes: `db.py` 的 `init_db` / `create_question` / `get_question` / `update_question` / `delete_question` / `list_questions` / `import_questions`。
- Produces：5 个接口（见下），供 Task 10/11/12 前端调用。

- [ ] **Step 1: 写 `web/questionbank.py`**

```python
"""题库路由 /api/questionbank/* — 增删改查 + 筛选 + 批量导入。"""
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db

router = APIRouter(prefix="/api/questionbank", tags=["questionbank"])


class QuestionIn(BaseModel):
    subject: str = ""
    type: str = ""
    difficulty: str = "中等"
    chapter: str = None
    topic: str = None
    content: str = ""
    answer: str = None
    analysis: str = None
    source: str = "manual"
    exam_ref: str = None


class ImportIn(BaseModel):
    questions: List[QuestionIn]


@router.get("/list")
async def list_questions(subject: str = "", type: str = "", difficulty: str = "", chapter: str = "", topic: str = ""):
    filters = {"subject": subject, "type": type, "difficulty": difficulty, "chapter": chapter, "topic": topic}
    return {"questions": db.list_questions(filters)}


@router.get("/{qid}")
async def get_question(qid: int):
    q = db.get_question(qid)
    if q is None:
        raise HTTPException(status_code=404, detail="题目不存在")
    return q


@router.post("/")
async def create_question(q: QuestionIn):
    qid = db.create_question(q.dict())
    return {"id": qid}


@router.put("/{qid}")
async def update_question(qid: int, q: QuestionIn):
    if db.get_question(qid) is None:
        raise HTTPException(status_code=404, detail="题目不存在")
    db.update_question(qid, q.dict())
    return {"ok": True}


@router.delete("/{qid}")
async def delete_question(qid: int):
    if db.get_question(qid) is None:
        raise HTTPException(status_code=404, detail="题目不存在")
    db.delete_question(qid)
    return {"ok": True}


@router.post("/import")
async def import_questions(body: ImportIn):
    n = db.import_questions([q.dict() for q in body.questions])
    return {"imported": n}
```

- [ ] **Step 2: 在 `web/app.py` 接入路由**

在 `app.py` 顶部 import 区（`from openai import OpenAI` 之后）加：

```python
import db
from questionbank import router as questionbank_router
```

在 `app = FastAPI(...)` 与 CORS 中间件之后、`static_dir` mount 之前，加：

```python
db.init_db()
app.include_router(questionbank_router)
```

- [ ] **Step 3: 冒烟测试接口**

启动服务（先确保没在跑，或另开端口）：

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web
/root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --port 2342 &
sleep 3
curl -s -X POST http://127.0.0.1:2342/api/questionbank/ -H 'Content-Type: application/json' \
  -d '{"subject":"数学","type":"选择题","difficulty":"基础","chapter":"第一章 行列式","topic":"行列式计算","content":"$$\\\\det A$$","answer":"A"}'
# 预期：{"id":1}
curl -s 'http://127.0.0.1:2342/api/questionbank/list?subject=%E6%95%B0%E5%AD%A6&difficulty=%E5%9F%BA%E7%A1%80'
# 预期：{"questions":[{... id=1 ...}]}
curl -s -X POST http://127.0.0.1:2342/api/questionbank/import -H 'Content-Type: application/json' \
  -d '{"questions":[{"subject":"物理","type":"填空题","difficulty":"难","chapter":"力学","topic":"牛顿定律","content":"F=ma","source":"exam","exam_ref":"2024期末"}]}'
# 预期：{"imported":1}
curl -s -X PUT http://127.0.0.1:2342/api/questionbank/1 -H 'Content-Type: application/json' \
  -d '{"subject":"数学","type":"选择题","difficulty":"中等","chapter":"第一章 行列式","topic":"行列式计算","content":"$$\\\\det B$$","answer":"B"}'
# 预期：{"ok":true}
curl -s -X DELETE http://127.0.0.1:2342/api/questionbank/1
# 预期：{"ok":true}
kill %1
```

- [ ] **Step 4: 验证通过**

预期各响应如上注释。若 500 报错，重点查 `QuestionIn` 与 `db.py` 字段名是否一致。

---

## Task 3: 前端拆分（纯迁移，无行为变化）

**Files:**
- Create: `web/static/js/api.js`
- Create: `web/static/js/wizard.js`
- Modify: `web/templates/index.html`（内联 `<script>` 改为外链引用）
- Modify: `web/static/js/wizard.js` 内含（见下）

**Interfaces:**
- `api.js` Produces：全局 `S`、`$`、`esc`、`addLogEl`、`parseSSE`、`streamSSE`、`apiFetch`、`postForm`、`postJson`。
- `wizard.js` Consumes：上述全局符号（由 api.js 先加载）。

- [ ] **Step 1: 写 `web/static/js/api.js`**

```js
// 基座：全局状态 + DOM/fetch/SSE 工具（其余模块依赖本文件先加载）
const S = { sessionId: null, currentStep: 1, uploadedFiles: [], knowledge: null, structure: null, questions: [], paperTemplate: 'standard', generatedFiles: [] };
const $ = id => document.getElementById(id);

function esc(s) {
    if (!s) return '';
    const el = document.createElement('span');
    el.textContent = String(s);
    return el.innerHTML;
}

function addLogEl(parent, msg) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = msg;
    parent.appendChild(div);
    parent.parentElement.scrollTop = parent.parentElement.scrollHeight;
}

function parseSSE(raw) {
    return raw.split('\n\n').filter(Boolean).map(frame => {
        const lines = frame.split('\n');
        let evt = 'message', data = '';
        for (const line of lines) {
            if (line.startsWith('event: ')) evt = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
        }
        return { event: evt, data };
    }).filter(f => f.data);
}

async function streamSSE(url, handlers) {
    const resp = await fetch(url);
    const raw = await resp.text();
    for (const { event, data } of parseSSE(raw)) {
        if (handlers[event]) handlers[event](data);
    }
}

async function apiFetch(url, opts) {
    const r = await fetch(url, opts);
    return await r.json();
}

function postForm(url, obj) {
    const fd = new FormData();
    for (const k in obj) fd.append(k, obj[k]);
    return apiFetch(url, { method: 'POST', body: fd });
}

function postJson(url, obj) {
    return apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
}
```

- [ ] **Step 2: 把现有内联 JS 迁到 `web/static/js/wizard.js`**

从 `index.html` 第 236–756 行的 `<script>` 内**原样搬移**以下内容到 `wizard.js`（不含 `<script>`/`</script>` 标签），并做三处改动：

1. 删除已上移到 `api.js` 的 `const S = ...`、`const $ = ...`（避免重复声明）。
2. 把 `wizard.js` 末尾的 `esc`、`addLogEl` 两个函数删除（已在 `api.js`）。
3. 其余函数（`goStep`/`updateNavHint`/`handleNextStep`/Step 2 上传解析/Step 3 表格/Step 4 滑条细目表/Step 5 命题/`updateSliders` 等）原样保留——后续任务再逐个改造。

> 说明：本任务是纯机械搬迁，内容即现有代码，故不重复粘贴 500 行；搬移后浏览器行为应与改造前完全一致。

- [ ] **Step 3: 修改 `index.html` 引入外链**

把第 236–756 行的 `<script>...</script>` 整块替换为（放在 `</body>` 前）：

```html
<script src="/static/js/api.js"></script>
<script src="/static/js/renderer.js"></script>
<script src="/static/js/questionbank.js"></script>
<script src="/static/js/wizard.js"></script>
```

（`renderer.js`、`questionbank.js` 尚未创建，本任务先各建一个空文件占位，内容在后续任务填。）

- [ ] **Step 4: 建空占位文件**

```bash
touch /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web/static/js/renderer.js
touch /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web/static/js/questionbank.js
```

- [ ] **Step 5: 验证通过**

浏览器打开 `http://localhost:2342`，确认 5 步向导流程与改造前一致（Step 1 填课程名 → Step 2 上传 → 解析 → Step 3 知识点 → Step 4 细目表 → Step 5 生成），控制台无 `S is not defined` 或重复声明报错。

---

## Task 4: Step 1 增加「学科」字段

**Files:**
- Modify: `web/app.py`（`session_start`、`step1_save`）
- Modify: `web/templates/index.html`（Step 1 面板）
- Modify: `web/static/js/wizard.js`（`handleNextStep` case 1、`btnUpload` 建会话处）

**Interfaces:**
- Consumes: `postForm`（api.js）。
- Produces: 会话状态新增 `state["subject"]`，供 Step 5 入库与题库 `subject` 列使用。

- [ ] **Step 1: 后端加 subject**

`app.py` 的 `session_start` 签名与 state 初始化：

```python
@app.post("/api/session/start")
async def session_start(course: str = Form(""), scope: str = Form(""), subject: str = Form("")):
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    state = {
        "session_id": session_id, "course": course, "scope": scope, "subject": subject,
        "current_step": 1, "papers": [], "knowledge": None,
        "difficulty": "基础60% 中等30% 难10%", "n_sets": "2", "output_type": "latex",
    }
    save_session(session_id, state)
    return {"session_id": session_id, "state": state}
```

`step1_save` 同步：

```python
@app.post("/api/session/{session_id}/step1")
async def step1_save(session_id: str, course: str = Form(""), scope: str = Form(""), subject: str = Form("")):
    state = load_session(session_id)
    if not state:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    state["course"] = course
    state["scope"] = scope
    state["subject"] = subject
    state["current_step"] = 1
    save_session(session_id, state)
    return {"ok": True}
```

- [ ] **Step 2: 前端 Step 1 加学科输入框**

在 `index.html` Step 1 面板 `course` 输入框之前插入：

```html
<div class="form-group">
    <label for="subject">学科 <span class="hint">如：数学 / 物理 / 化学</span></label>
    <input type="text" id="subject" placeholder="如：数学">
</div>
```

- [ ] **Step 3: 前端 JS 带上 subject**

`wizard.js` 的 `handleNextStep` case 1 两处 `fd.append('course', ...)` 后各加一行 `fd.append('subject', $('subject').value);`；`btnUpload` 建会话处（`postForm` 前）同样 `postForm` 里带上 subject——即把这两处的建会话表单改为：

```js
await postForm('/api/session/start', {
    course: $('course').value, scope: $('scope').value, subject: $('subject').value,
});
```

（`handleNextStep` case 1 的 `else` 分支 step1_save 同样带 `subject`。）

- [ ] **Step 4: 验证通过**

浏览器填学科「数学」→ 下一步 → 打开浏览器 DevTools Network，确认 `/api/session/start` 或 `/api/session/{id}/step1` 请求体含 `subject=数学`；`/api/session/{id}/state` 返回含 `"subject":"数学"`。

---

## Task 5: Step 3 删除行下标 bug 修复

**Files:**
- Modify: `web/static/js/wizard.js`（`deleteKPRow`、`btnAddRow`）

- [ ] **Step 1: 修复删除后下标不连续**

现状：`syncTableToKnowledge` 用 `row.dataset.index` 反查原 `knowledge_points[i]`，删除中间行后 `dataset.index` 与数组下标错位。改为删除后**重排剩余行**：

把 `deleteKPRow` 改为：

```js
function deleteKPRow(btn) {
    if (!confirm('确定删除这个知识点？')) return;
    btn.closest('tr').remove();
    reindexKPRows();
}

function reindexKPRows() {
    document.querySelectorAll('#kpTableBody tr').forEach((tr, i) => {
        tr.dataset.index = String(i);
    });
}
```

`btnAddRow` 里 `row.dataset.index = String(idx)` 之后调用 `reindexKPRows()`（新行 idx 已正确，重排无副作用；或直接复用 `reindexKPRows` 逻辑）。

- [ ] **Step 2: 验证通过**

浏览器：Step 3 先点「＋添加知识点」加 2 行，再删除中间一行，再编辑任意单元格 → 点「确认知识点」进 Step 4 → 返回 Step 3 看数据是否正确对应（重点：删除后剩余行的 chapter/topic 不错位）。

---

## Task 6: Step 4 后端 — 生成题目级试卷结构

**Files:**
- Modify: `web/app.py`（`step4_preview_blueprint` → `step4_preview_structure`）

**Interfaces:**
- Consumes: `state["knowledge"]["knowledge_points"]`、`state["difficulty"]`、`state["n_sets"]`。
- Produces: `state["structure"]` = `list[{no,type,score,chapter,topic,difficulty}]`；SSE 事件 `status/log/text/result/done/error`。

- [ ] **Step 1: 改写端点**

把 `app.py` 第 405–494 行的 `step4_preview_blueprint` 整体替换为：

```python
@app.get("/api/session/{session_id}/step4/preview-structure")
async def step4_preview_structure(session_id: str):
    """SSE — 生成题目级试卷结构（替代双向细目表）"""
    state = load_session(session_id)
    if not state:
        return StreamingResponse(
            iter([stream_sse("error", "会话不存在")]),
            media_type="text/event-stream",
        )

    knowledge = state.get("knowledge", {})
    knowledge_points = knowledge.get("knowledge_points", [])
    question_types = knowledge.get("exam_structure", {}).get("question_types", [])
    difficulty = state.get("difficulty", "基础60% 中等30% 难10%")
    n_sets = state.get("n_sets", "2")
    system_prompt = read_skill_md()

    user_prompt = f"""你正在执行 **步骤 4：生成题目级试卷结构**（不再生成双向细目表）。

根据题型结构和知识点清单，把试卷结构展开到**每道题**：每题分配题型、分值、对应知识点（一题一知识点）、难度。

## 题型结构
```json
{json.dumps(question_types, ensure_ascii=False, indent=2)[:10000]}
```

## 知识点清单
```json
{json.dumps(knowledge_points, ensure_ascii=False, indent=2)[:20000]}
```

## 参数
- 难度配比（按分值）：{difficulty}
- 生成套数：{n_sets}

请严格按 JSON 返回（不要其他文字）：

```json
{{
  "total_score": 100, "duration_minutes": 120,
  "questions": [
    {{"no": 1, "type": "选择题", "score": 3, "chapter": "第一章 行列式", "topic": "行列式计算", "difficulty": "基础"}}
  ]
}}
```"""

    async def event_stream():
        try:
            client = get_client()
            model = get_model()
            yield stream_sse("status", "generating_structure")
            yield stream_sse("log", f"[系统] 使用 {model} 生成试卷结构...")

            full_response = ""
            stream = client.chat.completions.create(
                model=model,
                max_tokens=16000,
                temperature=0.3,
                messages=[
                    {"role": "system", "content": system_prompt + "\n\n当前任务：仅生成试卷结构，不要命题。按JSON格式返回。"},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else ""
                if delta:
                    full_response += delta
                    yield stream_sse("text", delta)

            parsed = parse_json_block(full_response)
            structure = parsed.get("questions", []) if isinstance(parsed, dict) else []
            state["structure"] = structure
            state["structure_raw"] = full_response
            state["current_step"] = 4
            save_session(session_id, state)

            yield stream_sse("result", json.dumps(parsed, ensure_ascii=False))
            yield stream_sse("done", "structure_ready")

        except Exception as e:
            yield stream_sse("error", str(e))

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] **Step 2: 验证通过（暂用 curl 手动触发）**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web
/root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --port 2342 &
sleep 3
# 先造一个含 knowledge 的会话：直接写 state.json
mkdir -p sessions/_smoke && cat > sessions/_smoke/state.json <<'EOF'
{"session_id":"_smoke","course":"线性代数","scope":"","subject":"数学","current_step":3,"papers":[],"knowledge":{"exam_structure":{"total_score":100,"duration_minutes":120,"question_types":[{"type":"选择题","count":2,"score_per_question":5,"total":10},{"type":"填空题","count":2,"score_per_question":10,"total":20}]},"knowledge_points":[{"chapter":"第一章 行列式","topic":"行列式计算","difficulty":"基础"},{"chapter":"第二章 矩阵","topic":"矩阵乘法","difficulty":"中等"}]},"difficulty":"基础60% 中等30% 难10%","n_sets":"2"}
EOF
curl -sN http://127.0.0.1:2342/api/session/_smoke/step4/preview-structure | grep -E '^event: (result|error)'
# 预期：event: result（含 "questions" 数组）
kill %1
```

（注：该端点会真实调用 DeepSeek API，需 Key 已配置；若无 Key，确认到 `event: error` 中含 API 配置错误即可视为接线正确。）

- [ ] **Step 3: 验证通过**

预期 `event: result` 且 data 里 `questions` 为题目级数组。若 `questions` 为空，检查 `parse_json_block` 能否命中 ```` ```json ```` 块。

---

## Task 7: Step 4 前端 — 结构表

**Files:**
- Modify: `web/templates/index.html`（Step 4 面板）
- Modify: `web/static/js/wizard.js`（Step 4 逻辑）
- Modify: `web/static/style.css`（结构表样式）

**Interfaces:**
- Consumes: `streamSSE`、`S.structure`、`S.knowledge.knowledge_points`（知识点下拉来源）。
- Produces: 前端 `S.structure` 数组，供 Step 5 命题与入库。

- [ ] **Step 1: 替换 Step 4 面板 HTML**

把 `index.html` Step 4 面板中「预览双向细目表」按钮与其后的 `blueprint-box` 整块，替换为：

```html
<button type="button" class="btn-secondary" id="btnPreviewStructure">
    🤖 AI 生成试卷结构
</button>

<div class="structure-box hidden" id="structureBox">
    <div class="log-box"><div class="log-entries" id="structureLog"></div></div>
    <div class="structure-toolbar">
        <button class="btn-small" id="btnAddQuestion">＋ 添加题目</button>
        <span class="kp-hint">💡 知识点列可从下拉选择；双击单元格可编辑</span>
    </div>
    <div class="kp-table-wrapper">
        <table class="structure-table" id="structureTable">
            <thead>
                <tr>
                    <th style="width:8%">题号</th>
                    <th style="width:12%">题型</th>
                    <th style="width:8%">分值</th>
                    <th style="width:14%">章节</th>
                    <th style="width:20%">知识点</th>
                    <th style="width:10%">难度</th>
                    <th style="width:8%">操作</th>
                </tr>
            </thead>
            <tbody id="structureBody"></tbody>
        </table>
    </div>
</div>
```

- [ ] **Step 2: 写结构表渲染与生成逻辑**

`wizard.js` 中把 `btnPreviewBlueprint` 的点击处理器整体替换为：

```js
function renderStructureTable() {
    const tbody = $('structureBody');
    const qs = S.structure || [];
    if (qs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">暂无结构，点击"AI 生成试卷结构"</td></tr>';
        return;
    }
    const kpOptions = (S.knowledge?.knowledge_points || [])
        .map(k => `<option value="${esc(k.chapter + ' | ' + k.topic)}" ${''}>${esc(k.chapter + ' | ' + k.topic)}</option>`)
        .join('');
    tbody.innerHTML = qs.map((q, i) => `
        <tr data-index="${i}">
            <td class="cell-no">${q.no || i + 1}</td>
            <td contenteditable="true" class="cell-type">${esc(q.type || '')}</td>
            <td contenteditable="true" class="cell-score">${q.score || 0}</td>
            <td contenteditable="true" class="cell-chapter">${esc(q.chapter || '')}</td>
            <td><select class="cell-topic">${kpOptions.replace(`value="${esc(q.chapter + ' | ' + q.topic)}"`, `value="${esc(q.chapter + ' | ' + q.topic)}" selected`)}</select></td>
            <td>
                <select class="cell-difficulty">
                    <option value="基础" ${q.difficulty==='基础'?'selected':''}>基础</option>
                    <option value="中等" ${q.difficulty==='中等'?'selected':''}>中等</option>
                    <option value="难" ${q.difficulty==='难'?'selected':''}>难</option>
                </select>
            </td>
            <td><button class="btn-del-row" onclick="deleteQuestionRow(this)">×</button></td>
        </tr>
    `).join('');
}

function syncStructureFromTable() {
    const rows = document.querySelectorAll('#structureBody tr');
    const qs = [];
    rows.forEach((row, i) => {
        const chapterTopic = row.querySelector('.cell-topic')?.value || '';
        const [chapter, topic] = chapterTopic.split(' | ');
        qs.push({
            no: i + 1,
            type: row.querySelector('.cell-type')?.textContent?.trim() || '',
            score: parseInt(row.querySelector('.cell-score')?.textContent?.trim()) || 0,
            chapter: chapter?.trim() || '',
            topic: topic?.trim() || '',
            difficulty: row.querySelector('.cell-difficulty')?.value || '基础',
        });
    });
    S.structure = qs;
}

function deleteQuestionRow(btn) {
    btn.closest('tr').remove();
    syncStructureFromTable();
    renderStructureTable();
}

$('btnAddQuestion').addEventListener('click', () => {
    S.structure = S.structure || [];
    S.structure.push({ no: S.structure.length + 1, type: '选择题', score: 5, chapter: '', topic: '', difficulty: '基础' });
    renderStructureTable();
});

$('btnPreviewStructure').addEventListener('click', async () => {
    if (!S.sessionId) { alert('请先完成前面步骤'); return; }
    await saveSettings();
    const box = $('structureBox');
    const log = $('structureLog');
    box.classList.remove('hidden');
    log.innerHTML = '';
    addLogEl(log, '[系统] 正在生成试卷结构...');
    await streamSSE(`/api/session/${S.sessionId}/step4/preview-structure`, {
        log: (d) => addLogEl(log, d),
        result: (d) => {
            const parsed = JSON.parse(d);
            S.structure = parsed.questions || [];
            renderStructureTable();
            addLogEl(log, '[系统] ✅ 试卷结构生成完毕，可在下表调整');
        },
        error: (d) => addLogEl(log, '❌ ' + d),
    });
});
```

- [ ] **Step 3: 在 `handleNextStep` case 4 保存结构**

把 case 4 末尾（`step4/settings` fetch 之后）加：

```js
syncStructureFromTable();
```

并在 `handleNextStep` case 4 之前确保进入 Step 5 时 `S.structure` 已同步。

- [ ] **Step 4: 加样式**

`style.css` 追加：

```css
.structure-box { margin-top: 16px; }
.structure-toolbar { margin: 12px 0; display: flex; gap: 12px; align-items: center; }
.structure-table { width: 100%; border-collapse: collapse; }
.structure-table th, .structure-table td { border: 1px solid var(--border, #ddd); padding: 6px 8px; font-size: 14px; }
.structure-table td[contenteditable] { background: #fff; }
```

- [ ] **Step 5: 验证通过**

浏览器走到 Step 4 → 点「AI 生成试卷结构」→ 表格出现题目级行；手动「＋添加题目」、改题型/分值、从知识点下拉选、删行；点「下一步」进 Step 5 前，DevTools 看 `S.structure` 数组正确。

---

## Task 8: Step 5 后端 — 结构化命题

**Files:**
- Modify: `web/app.py`（`step5_generate`）

**Interfaces:**
- Consumes: `state["structure"]`（题目级结构）、`state["subject"]`、`state["course"]`、`state["papers"]`。
- Produces: `state["questions"]` = `list[{no,type,score,chapter,topic,difficulty,content,answer,analysis}]`；SSE 事件 `status/log/text/result/done/error`。

- [ ] **Step 1: 改写 `step5_generate`**

把 `app.py` 第 501–593 行的 `step5_generate` 整体替换为：

```python
@app.get("/api/session/{session_id}/step5/generate")
async def step5_generate(session_id: str):
    """SSE — 依据题目级结构命制结构化题目，供前端渲染与入库。"""
    state = load_session(session_id)
    if not state:
        return StreamingResponse(
            iter([stream_sse("error", "会话不存在")]),
            media_type="text/event-stream",
        )

    system_prompt = read_skill_md()
    structure = state.get("structure", [])
    subject = state.get("subject", "")
    course = state.get("course", "")

    user_prompt = f"""你正在执行 **步骤 5：依据试卷结构命题**。

逐题命制，返回结构化 JSON（每题含题干、答案、解析；公式用 LaTeX 写在 $$...$$ 内）。

## 课程 / 学科
- 课程：{course or '从真题推断'}
- 学科：{subject or '未指定'}

## 试卷结构（题目级）
```json
{json.dumps(structure, ensure_ascii=False, indent=2)[:20000]}
```

## 往年真题参考
{''.join(f"### {p['filename']}\n```\n{p['text'][:6000]}\n```\n" for p in state.get('papers', []))[:20000]}

请严格按 JSON 返回（不要其他文字，不要用 ``` 包裹外的说明）：

```json
{{
  "questions": [
    {{
      "no": 1, "type": "选择题", "score": 5,
      "chapter": "第一章 行列式", "topic": "行列式计算", "difficulty": "基础",
      "content": "题干（LaTeX 用 $$...$$）",
      "answer": "答案",
      "analysis": "解析"
    }}
  ]
}}
```"""

    async def event_stream():
        try:
            client = get_client()
            model = get_model()
            yield stream_sse("status", "generating")
            yield stream_sse("log", f"[系统] 使用 {model} 依据结构命制 {len(structure)} 道题...")

            full_response = ""
            stream = client.chat.completions.create(
                model=model,
                max_tokens=32000,
                temperature=0.7,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else ""
                if delta:
                    full_response += delta
                    yield stream_sse("text", delta)

            parsed = parse_json_block(full_response)
            questions = parsed.get("questions", []) if isinstance(parsed, dict) else []
            state["questions"] = questions
            state["generated_files"] = []
            save_session(session_id, state)

            yield stream_sse("result", json.dumps({"questions": questions}, ensure_ascii=False))
            yield stream_sse("done", "generation_complete")

        except Exception as e:
            yield stream_sse("error", str(e))

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

> 注：旧 `extract_files` 函数保留不动（不再被 `step5_generate` 调用），避免影响 `/download` 已有逻辑；如确认无用可在后续清理任务删除。

- [ ] **Step 2: 验证通过**

复用 Task 6 的 `_smoke` 会话，先给它塞 `structure`，再触发：

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web
/root/miniconda3/envs/exam_env/bin/python -c "
import json, pathlib
p = pathlib.Path('sessions/_smoke/state.json')
s = json.loads(p.read_text())
s['structure'] = [{'no':1,'type':'选择题','score':5,'chapter':'第一章 行列式','topic':'行列式计算','difficulty':'基础'},{'no':2,'type':'填空题','score':10,'chapter':'第二章 矩阵','topic':'矩阵乘法','difficulty':'中等'}]
p.write_text(json.dumps(s, ensure_ascii=False))
"
/root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --port 2342 &
sleep 3
curl -sN http://127.0.0.1:2342/api/session/_smoke/step5/generate | grep -E '^event: (result|error)'
# 预期：event: result（data 含 questions 数组，每题有 content/answer/analysis）
kill %1
```

- [ ] **Step 3: 验证通过**

预期 `event: result` 且 `questions` 数量 = 结构题数，每题含 `content`/`answer`/`analysis`。

---

## Task 9: 试卷渲染 + 模板

**Files:**
- Create: `web/static/papers/standard.html`
- Create: `web/static/papers/simple.html`
- Create: `web/static/js/renderer.js`（填充内容）
- Modify: `web/templates/index.html`（Step 5 渲染区 + 模板下拉 + KaTeX CDN）
- Modify: `web/static/js/wizard.js`（Step 5 `result` 处理器 → 渲染）
- Modify: `web/static/style.css`（试卷打印样式）

**Interfaces:**
- `renderer.js` Produces：`renderPaper(questions, templateName, meta) -> void`、`loadTemplate(name) -> Promise<string>`。
- Consumes: `S.questions`、`S.paperTemplate`、`S.subject`/`S.course`。

- [ ] **Step 1: 写模板 `standard.html`（带密封线）**

```html
<div class="paper paper-standard">
    <div class="paper-seal">
        <span>姓 名：___________</span>
        <span>学 号：___________</span>
        <span>班 级：___________</span>
    </div>
    <div class="paper-header">
        <h1 class="paper-title">{{TITLE}}</h1>
        <div class="paper-meta">
            <span>学科：{{SUBJECT}}</span>
            <span>满分：{{TOTAL_SCORE}} 分</span>
            <span>时长：{{DURATION}} 分钟</span>
        </div>
    </div>
    <ol class="paper-questions">
        {{QUESTIONS}}
    </ol>
</div>
```

- [ ] **Step 2: 写模板 `simple.html`（无密封线）**

```html
<div class="paper paper-simple">
    <div class="paper-header">
        <h1 class="paper-title">{{TITLE}}</h1>
        <div class="paper-meta">
            <span>学科：{{SUBJECT}}</span>
            <span>满分：{{TOTAL_SCORE}} 分</span>
        </div>
    </div>
    <ol class="paper-questions">
        {{QUESTIONS}}
    </ol>
</div>
```

- [ ] **Step 3: 写 `renderer.js`**

```js
// 试卷渲染 + 每题替换（KaTeX 由 index.html 通过 CDN 引入，全局 katex）
async function loadTemplate(name) {
    const resp = await fetch(`/static/papers/${name}.html`);
    return await resp.text();
}

function questionHTML(q) {
    const content = (q.content || '').replace(/\\\(/g, '$').replace(/\\\)/g, '$');
    return `
        <li class="paper-question" data-no="${q.no}" data-id="${q.id || ''}">
            <div class="paper-question-head">
                <span class="paper-qno">${q.no}.</span>
                <span class="paper-qtype">（${esc(q.type)}，${q.score} 分）</span>
                <button class="btn-replace" onclick="openReplace(${q.no})">🔄 替换</button>
            </div>
            <div class="paper-qcontent">${renderMath(content)}</div>
        </li>`;
}

function renderMath(text) {
    if (window.katex) {
        return text.replace(/\$\$([\s\S]+?)\$\$/g, (m, expr) =>
            katex.renderToString(expr.trim(), { throwOnError: false, displayMode: true })
        ).replace(/\$([^\$\n]+?)\$/g, (m, expr) =>
            katex.renderToString(expr.trim(), { throwOnError: false, displayMode: false })
        );
    }
    return text;
}

function renderPaper(questions, templateName, meta) {
    const qhtml = (questions || []).map(questionHTML).join('');
    const total = (questions || []).reduce((s, q) => s + (q.score || 0), 0);
    loadTemplate(templateName).then(tpl => {
        const html = tpl
            .replaceAll('{{TITLE}}', meta.title || '试卷')
            .replaceAll('{{SUBJECT}}', meta.subject || '')
            .replaceAll('{{TOTAL_SCORE}}', total)
            .replaceAll('{{DURATION}}', meta.duration || 120)
            .replaceAll('{{QUESTIONS}}', qhtml);
        const el = $('paperRender');
        el.innerHTML = html;
        el.classList.remove('hidden');
    });
}

function openReplace(no) {
    // Task 10 实现替换弹窗；先占位
    alert('替换功能见后续任务（no=' + no + '）');
}
```

- [ ] **Step 4: 加 KaTeX CDN**

`index.html` `<head>` 内加：

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
```

- [ ] **Step 5: Step 5 面板加渲染区与模板下拉**

`index.html` Step 5 面板在「开始命题」按钮之后、`generate-box` 之前插入：

```html
<div class="paper-toolbar">
    <label for="paperTemplate">试卷模板：</label>
    <select id="paperTemplate">
        <option value="standard" selected>标准卷（密封线）</option>
        <option value="simple">简洁卷</option>
    </select>
    <button class="btn-small" id="btnImportBank">📥 一键入库</button>
</div>
<div class="paper-render hidden" id="paperRender"></div>
```

- [ ] **Step 6: Step 5 生成后渲染**

`wizard.js` 的 Step 5 `result` 事件处理器中，把旧的文件下载展示改为：

```js
case 'result': {
    const parsed = JSON.parse(data);
    S.questions = parsed.questions || [];
    renderPaper(S.questions, $('paperTemplate').value, {
        title: $('course').value || '试卷',
        subject: $('subject').value || '',
        duration: S.knowledge?.exam_structure?.duration_minutes || 120,
    });
    break;
}
```

`$('paperTemplate').addEventListener('change', () => renderPaper(S.questions, $('paperTemplate').value, {...}));`（与上面 meta 相同，抽成 `currentPaperMeta()` 函数复用）。

- [ ] **Step 7: 加打印样式**

`style.css` 追加：

```css
.paper-render { background: #fff; padding: 24px; border: 1px solid #ddd; margin-top: 16px; }
.paper-seal { border: 1px solid #000; padding: 8px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.paper-title { text-align: center; margin: 8px 0; }
.paper-meta { display: flex; gap: 16px; justify-content: center; margin-bottom: 12px; font-size: 14px; }
.paper-question { margin: 12px 0; }
.paper-question-head { display: flex; align-items: center; gap: 8px; }
.paper-qtype { color: #666; font-size: 13px; }
.btn-replace { font-size: 12px; }
@media print {
    .btn-replace, .paper-toolbar, .wizard-nav, header, footer, .steps-bar { display: none !important; }
    .paper-render { border: none; }
}
```

- [ ] **Step 8: 验证通过**

浏览器完成 Step 2~4 后进 Step 5 → 点「开始命题」→ 试卷成品渲染出题号/分值/公式；切换「简洁卷」模板重新渲染；Ctrl+P 打印预览看不到「替换」按钮和导航。

---

## Task 10: 每题替换 + AI 备选

**Files:**
- Modify: `web/app.py`（新增 `/step5/alternatives`）
- Modify: `web/static/js/renderer.js`（替换弹窗）
- Modify: `web/static/style.css`（弹窗样式）

**Interfaces:**
- Consumes: `/api/questionbank/list`（题库匹配）、`/step5/alternatives`（AI 备选）、`renderPaper`。
- Produces: `openReplace(no)` 完整实现；替换后更新 `S.questions` 并重渲染。

- [ ] **Step 1: 后端新增 `/step5/alternatives`**

`app.py` 在 `step5_generate` 之后加：

```python
@app.post("/api/session/{session_id}/step5/alternatives")
async def step5_alternatives(session_id: str, request: Request):
    """SSE — 针对某题 AI 生成 2~3 个备选变体。"""
    body = await request.json()
    question = body.get("question", {})
    system_prompt = read_skill_md()

    user_prompt = f"""请针对下面这道题，生成 3 个**同考点、同题型、同难度**的备选变体（换情境/换数据，公式用 LaTeX $$...$$）。

## 原题
```json
{json.dumps(question, ensure_ascii=False, indent=2)}
```

严格按 JSON 返回（不要其他文字）：

```json
{{
  "alternatives": [
    {{"content": "变体1题干", "answer": "答案1", "analysis": "解析1"}}
  ]
}}
```"""

    async def event_stream():
        try:
            client = get_client()
            model = get_model()
            yield stream_sse("status", "generating_alternatives")
            yield stream_sse("log", "[系统] 正在生成备选题目...")
            full_response = ""
            stream = client.chat.completions.create(
                model=model, max_tokens=8000, temperature=0.9,
                messages=[
                    {"role": "system", "content": system_prompt + "\n\n当前任务：仅生成备选题目，不要其他输出。"},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else ""
                if delta:
                    full_response += delta
                    yield stream_sse("text", delta)
            parsed = parse_json_block(full_response)
            alts = parsed.get("alternatives", []) if isinstance(parsed, dict) else []
            yield stream_sse("result", json.dumps({"alternatives": alts}, ensure_ascii=False))
            yield stream_sse("done", "alternatives_ready")
        except Exception as e:
            yield stream_sse("error", str(e))

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] **Step 2: 写替换弹窗（`renderer.js`）**

把 `openReplace` 占位替换为：

```js
async function openReplace(no) {
    const q = (S.questions || []).find(x => x.no === no);
    if (!q) return;
    const modal = document.createElement('div');
    modal.className = 'replace-modal';
    modal.innerHTML = `
        <div class="replace-dialog">
            <h3>替换第 ${no} 题 <button class="btn-del-row" onclick="this.closest('.replace-modal').remove()">×</button></h3>
            <div class="replace-tabs">
                <button class="tab active" data-tab="bank">从题库</button>
                <button class="tab" data-tab="ai">AI 生成备选</button>
            </div>
            <div class="replace-panel" id="replaceBankPanel">
                <p class="hint">匹配条件：${esc(q.type)} / ${esc(q.topic)} / ${esc(q.difficulty)}</p>
                <div class="replace-list" id="replaceBankList">加载中…</div>
            </div>
            <div class="replace-panel hidden" id="replaceAiPanel">
                <button class="btn-small" id="replaceBtnGenAlt">🤖 生成 3 个备选</button>
                <div class="replace-list" id="replaceAiList"></div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const bankPanel = modal.querySelector('#replaceBankPanel');
    const aiPanel = modal.querySelector('#replaceAiPanel');
    modal.querySelectorAll('.tab').forEach(t => t.addEventListener('click', e => {
        modal.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        e.target.classList.add('active');
        bankPanel.classList.toggle('hidden', e.target.dataset.tab !== 'bank');
        aiPanel.classList.toggle('hidden', e.target.dataset.tab !== 'ai');
    }));

    // 题库匹配
    const params = new URLSearchParams({ subject: $('subject').value || '', type: q.type || '', difficulty: q.difficulty || '', topic: q.topic || '' });
    const resp = await apiFetch(`/api/questionbank/list?${params.toString()}`);
    const bankList = modal.querySelector('#replaceBankList');
    bankList.innerHTML = (resp.questions || []).length
        ? resp.questions.map(c => `
            <div class="replace-item">
                <div>${renderMath(esc(c.content)).slice(0, 120)}…</div>
                <button class="btn-small" onclick="applyReplace(${no}, ${c.id})">替换</button>
            </div>`).join('')
        : '<p class="empty-row">题库无匹配题目，可切到「AI 生成备选」</p>';

    // AI 备选
    const aiList = modal.querySelector('#replaceAiList');
    modal.querySelector('#replaceBtnGenAlt').addEventListener('click', async () => {
        aiList.innerHTML = '生成中…';
        await streamSSE(`/api/session/${S.sessionId}/step5/alternatives`, {
            result: (d) => {
                const alts = JSON.parse(d).alternatives || [];
                window._alts = alts;
                aiList.innerHTML = alts.map((a, i) => `
                    <div class="replace-item">
                        <div>${renderMath(esc(a.content)).slice(0, 120)}…</div>
                        <button class="btn-small" onclick="applyAlt(${no}, ${i})">替换</button>
                        <button class="btn-small" onclick="saveAlt(${no}, ${i})">入库</button>
                    </div>`).join('') || '<p class="empty-row">未生成备选</p>';
            },
            error: (d) => { aiList.innerHTML = '❌ ' + d; },
        });
    });
}

async function applyReplace(no, bankId) {
    const q = (S.questions || []).find(x => x.no === no);
    if (!q) return;
    const target = await apiFetch(`/api/questionbank/${bankId}`);
    q.content = target.content; q.answer = target.answer; q.analysis = target.analysis;
    renderPaper(S.questions, $('paperTemplate').value, currentPaperMeta());
    document.querySelector('.replace-modal')?.remove();
}

function applyAlt(no, altIndex) {
    const q = (S.questions || []).find(x => x.no === no);
    const a = window._alts?.[altIndex];
    if (!q || !a) return;
    q.content = a.content; q.answer = a.answer; q.analysis = a.analysis;
    renderPaper(S.questions, $('paperTemplate').value, currentPaperMeta());
    document.querySelector('.replace-modal')?.remove();
}

function saveAlt(no, altIndex) {
    const q = (S.questions || []).find(x => x.no === no);
    const a = window._alts?.[altIndex];
    if (!q || !a) return;
    postJson('/api/questionbank/', {
        subject: $('subject').value || '', type: q.type, difficulty: q.difficulty,
        chapter: q.chapter, topic: q.topic, content: a.content, answer: a.answer,
        analysis: a.analysis, source: 'ai',
    }).then(() => alert('已入库'));
}

function currentPaperMeta() {
    return {
        title: $('course').value || '试卷',
        subject: $('subject').value || '',
        duration: S.knowledge?.exam_structure?.duration_minutes || 120,
    };
}
```

- [ ] **Step 3: 加弹窗样式**

`style.css` 追加：

```css
.replace-modal { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.replace-dialog { background: #fff; width: 640px; max-height: 80vh; overflow: auto; border-radius: 8px; padding: 16px; }
.replace-tabs { display: flex; gap: 8px; margin: 12px 0; }
.replace-tabs .tab { cursor: pointer; padding: 6px 12px; border: 1px solid #ddd; background: #f5f5f5; }
.replace-tabs .tab.active { background: #2b6cb0; color: #fff; }
.replace-item { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px; border-bottom: 1px solid #eee; }
```

- [ ] **Step 4: 验证通过**

浏览器 Step 5 渲染出试卷后点某题「替换」→「从题库」tab 显示匹配题目（先在题库页手动录入 1~2 道同知识点题）；点「AI 生成备选」出现 3 个变体；点「替换」后该题内容原地更新且公式正常渲染。

---

## Task 11: 题库页 + 顶部 tab

**Files:**
- Modify: `web/templates/index.html`（顶部 tab + 题库面板）
- Create: `web/static/js/questionbank.js`（填充内容）
- Modify: `web/static/style.css`（题库样式）

**Interfaces:**
- Consumes: `/api/questionbank/list`、`/api/questionbank/`、`/api/questionbank/{id}`。
- Produces: `showBank()/showWizard()` 切换函数、题库列表/筛选/增删改。

- [ ] **Step 1: 顶部导航加 tab**

`index.html` `<main>` 顶部（`.wizard` 之前）插入：

```html
<nav class="top-tabs">
    <button class="top-tab active" id="tabWizard" onclick="showWizard()">📝 出卷向导</button>
    <button class="top-tab" id="tabBank" onclick="showBank()">🗂️ 题库</button>
</nav>
```

- [ ] **Step 2: 题库面板**

`index.html` `</main>` 前（`.wizard` 之后、`<footer>` 前）插入：

```html
<div class="bank-view hidden" id="bankView">
    <h2>🗂️ 题库</h2>
    <div class="bank-filter">
        <input type="text" id="fSubject" placeholder="学科">
        <input type="text" id="fTopic" placeholder="知识点">
        <select id="fType"><option value="">全部题型</option><option>选择题</option><option>填空题</option><option>计算题</option><option>证明题</option><option>简答题</option></select>
        <select id="fDifficulty"><option value="">全部难度</option><option>基础</option><option>中等</option><option>难</option></select>
        <button class="btn-small" onclick="loadBankList()">🔍 筛选</button>
        <button class="btn-small" onclick="openBankForm()">＋ 新增题目</button>
    </div>
    <div class="bank-list" id="bankList"></div>
</div>
```

- [ ] **Step 3: 写 `questionbank.js`**

```js
// 题库页逻辑
function showWizard() {
    $('tabWizard').classList.add('active'); $('tabBank').classList.remove('active');
    document.querySelector('.wizard').classList.remove('hidden');
    $('bankView').classList.add('hidden');
}
function showBank() {
    $('tabBank').classList.add('active'); $('tabWizard').classList.remove('active');
    document.querySelector('.wizard').classList.add('hidden');
    $('bankView').classList.remove('hidden');
    loadBankList();
}

async function loadBankList() {
    const params = new URLSearchParams({
        subject: $('fSubject').value, topic: $('fTopic').value,
        type: $('fType').value, difficulty: $('fDifficulty').value,
    });
    const d = await apiFetch(`/api/questionbank/list?${params.toString()}`);
    const list = $('bankList');
    const qs = d.questions || [];
    list.innerHTML = qs.length ? qs.map(q => `
        <div class="bank-item">
            <div class="bank-item-meta">
                <span class="tag">${esc(q.subject)}</span>
                <span class="tag">${esc(q.type)}</span>
                <span class="tag">${esc(q.difficulty)}</span>
                <span class="tag">${esc(q.topic || '')}</span>
            </div>
            <div class="bank-item-content">${esc(q.content).slice(0, 150)}…</div>
            <div class="bank-item-actions">
                <button class="btn-small" onclick="openBankForm(${q.id})">编辑</button>
                <button class="btn-small" onclick="deleteBankQuestion(${q.id})">删除</button>
            </div>
        </div>`).join('') : '<p class="empty-row">题库为空</p>';
}

function openBankForm(id) {
    // 编辑时先取回单题填表（简化：用 prompt 收集关键字段）
    const fields = ['subject','type','difficulty','chapter','topic','content','answer','analysis'];
    const q = id ? {} : {};
    for (const f of fields) {
        const v = prompt(`${f}：`, id ? '' : (f === 'difficulty' ? '中等' : ''));
        if (v === null) return;
        q[f] = v;
    }
    q.source = 'manual';
    if (id) {
        apiFetch(`/api/questionbank/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) })
            .then(() => loadBankList());
    } else {
        postJson('/api/questionbank/', q).then(() => loadBankList());
    }
}

async function deleteBankQuestion(id) {
    if (!confirm('确定删除该题？')) return;
    await apiFetch(`/api/questionbank/${id}`, { method: 'DELETE' });
    loadBankList();
}
```

- [ ] **Step 4: 加样式**

`style.css` 追加：

```css
.top-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.top-tab { padding: 8px 16px; border: 1px solid #ddd; background: #f5f5f5; cursor: pointer; font-size: 15px; }
.top-tab.active { background: #2b6cb0; color: #fff; }
.bank-filter { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.bank-filter input, .bank-filter select { padding: 6px 8px; }
.bank-item { border: 1px solid #eee; padding: 12px; margin-bottom: 12px; border-radius: 6px; }
.bank-item-meta { display: flex; gap: 6px; margin-bottom: 6px; }
.tag { background: #eef2f7; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
.bank-item-actions { margin-top: 8px; display: flex; gap: 8px; }
```

- [ ] **Step 5: 验证通过**

浏览器点顶部「题库」tab → 筛选栏按学科/知识点/题型/难度筛选；「＋新增题目」录一道题 → 列表出现；「编辑」改字段 → 列表更新；「删除」→ 列表移除。

---

## Task 12: 一键入库

**Files:**
- Modify: `web/static/js/wizard.js`（`btnImportBank` 处理器）

**Interfaces:**
- Consumes: `S.questions`、`S.subject`、`/api/questionbank/import`。

- [ ] **Step 1: 绑定一键入库**

`wizard.js` 加：

```js
$('btnImportBank').addEventListener('click', async () => {
    if (!S.questions || S.questions.length === 0) { alert('请先生成试卷'); return; }
    const items = S.questions.map(q => ({
        subject: $('subject').value || '', type: q.type, difficulty: q.difficulty,
        chapter: q.chapter, topic: q.topic, content: q.content,
        answer: q.answer, analysis: q.analysis, source: 'exam',
    }));
    const d = await postJson('/api/questionbank/import', { questions: items });
    alert(`已入库 ${d.imported} 道题`);
});
```

- [ ] **Step 2: 验证通过**

浏览器 Step 5 生成试卷后点「📥 一键入库」→ 提示入库 N 道；切到「题库」tab 筛选对应学科，能看到刚入库的题。

---

## Task 13: 冒烟测试收尾 + 清理

**Files:**
- Modify: `web/static/js/wizard.js`（更新 navHint 文案、清掉已废弃的 blueprint 相关残留）
- 可能删除: `web/app.py` 的 `extract_files`（如确认无引用）

- [ ] **Step 1: 清理废弃蓝图逻辑**

`wizard.js` 中删除旧 `btnPreviewBlueprint` 相关残留（已在 Task 7 替换）、`blueprintBox`/`blueprintContent` 相关变量引用；`updateNavHint` 的步骤 4/5 文案改为：

```js
4: '生成并调整试卷结构（题型/分值/知识点）',
5: '命制试卷，切换模板、逐题替换、一键入库',
```

- [ ] **Step 2: 全流程冒烟测试**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web
/root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --port 2342 &
sleep 3
echo "--- 题库 CRUD ---"
curl -s -X POST http://127.0.0.1:2342/api/questionbank/ -H 'Content-Type: application/json' -d '{"subject":"数学","type":"选择题","difficulty":"基础","chapter":"第一章","topic":"行列式","content":"det A","answer":"1"}'
curl -s 'http://127.0.0.1:2342/api/questionbank/list?subject=%E6%95%B0%E5%AD%A6'
echo; echo "--- 结构生成端点可达 ---"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:2342/api/session/_smoke/step4/preview-structure
echo "--- 备选端点可达（POST 空题）---"
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2342/api/session/_smoke/step5/alternatives -H 'Content-Type: application/json' -d '{"question":{"type":"选择题"}}'
kill %1
```

预期：CRUD 返回正常 JSON；结构生成与备选端点返回 200（会真实调 AI，无 Key 时返回 SSE error 但 HTTP 200）。

- [ ] **Step 3: 验证通过**

全流程在浏览器手动走通：Step 1 填学科/课程 → Step 2 上传解析 → Step 3 增删改知识点 → Step 4 生成/调整结构 → Step 5 命题渲染、切模板、逐题替换、一键入库 → 题库页筛选/增删改。确认无控制台报错。

---

## Self-Review 记录

- **Spec 覆盖**：§4 数据层=Task 1；§5.1 题库路由=Task 2；§5.2 Step4=Task 6、Step5=Task 8、alternatives=Task 10；§6 前端拆分=Task 3、Step1=Task 4、Step3=Task 5、Step4=Task 7、题库页=Task 11；§7 渲染模板=Task 9、替换=Task 10、入库=Task 12；§8 冒烟测试=各任务 + Task 13；§10 created_by 已在 Task 1 schema 预留。
- **类型一致**：`db.list_questions(filters)` / `import_questions(items)` / `create_question(q)` 在 Task 1 定义、Task 2 消费，签名一致；前端 `S.structure`（Task 6/7/8）、`S.questions`（Task 8/9/10/12）、`renderPaper(qs, template, meta)`（Task 9/10）、`currentPaperMeta()`（Task 10）跨任务命名一致。
- **已知简化**：Task 11 编辑用 `prompt` 收集字段（够用，正式表单留待阶段二）。Task 10 替换链路已用单题 GET 接口 `/api/questionbank/{qid}`（Task 2 新增）+ `window._alts`（result 处理器内赋值）实现，无占位。
