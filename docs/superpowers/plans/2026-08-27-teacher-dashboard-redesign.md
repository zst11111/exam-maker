# 教师端改造实施计划（exam-maker v3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把教师端从「单一出卷工具」升级为两大功能块——生成试卷 + 考试/作业管理，落地 spec 的 8 条需求（A1-A4 出卷流程、B1-B4 首页/考试管理）。

**Architecture:** 后端 FastAPI（app.py 出卷向导 SSE 流式 + platform_routes.py 平台路由）分层增量改造：先扩展数据层（papers 加 remark/published/published_at），再补平台路由（改名、发布成绩、学生可见性），最后改 AI 出卷 prompt（教科书大纲、完整备选）。前端 teacher.js / wizard.js / grade.js / student.js 按首页信息架构重排，不改学生/辅导员核心流程。

**Tech Stack:** FastAPI 0.99.1 + pydantic 1.10.26（锁定组合）、SQLite 标准库数据层（db.py）、原生 JS（无框架，模板字符串渲染）、DeepSeek OpenAI 兼容 API（SSE 流式）。

## Global Constraints

- **依赖锁定**：fastapi==0.99.1 与 pydantic==1.10.26 是一组兼容组合，**切勿单独升级任一**。全项目不得新增 Python 依赖。
- **AI 后端**：统一走 `app.py` 的 `get_client()` / `get_model()` / `parse_json_block()`；DeepSeek base_url，模型 deepseek-chat。
- **SSE 约定**：出卷向导 AI 端点全部用 `stream_sse(event, data)` 流式；前端用 `api.js` 的 `streamSSE(url, {log,result,done,error})` 消费。
- **鉴权**：内存 token（auth.py）。新端点一律 `auth.require_role(request, "teacher")`，且校验 `paper["teacher_id"] == u["id"]` 归属。
- **成绩可见性规则**（全局硬约束）：`score_visible = (paper.is_practice == 1) OR (paper.published == 1)`。练习卷学生做完即见分；正式卷必须教师点「发布」后学生才见分。所有学生端返回成绩的地方都要套这条规则。
- **UI 文案**：全中文。新 UI 文案用 spec 中的表述（如「成绩待发布」「进行中的考试」「错题推送卷」）。
- **git**：仓库当前 0 提交、未配置 user.name/email。实施者需先配置一次本地身份（如 `git config user.name "exam-maker" && git config user.email "exam-maker@local"`），或征询用户后配置；若拒绝配置则跳过 commit 步骤并口头汇报。
- **代码风格**：沿用现有风格——db.py 函数式、platform_routes 顶层 `@router`、前端模板字符串 + `esc()`/`renderMath(escMath())` 转义。文件行号以本计划撰写时（2026-08-27）为准。

---

## 任务总览

| # | 文件 | 内容 |
|---|---|---|
| 1 | `web/db.py` | papers 迁移（remark/published/published_at）+ `update_paper_meta`/`publish_paper` |
| 2 | `web/platform_routes.py` | PUT 改名备注 + POST 发布成绩 + GET /papers 扩展（remark/published/distributions） |
| 3 | `web/db.py` + `web/platform_routes.py` | 学生端成绩可见性（score_visible） |
| 4 | `web/app.py` | step2 教科书上传 + generate-syllabus 学科/教科书 |
| 5 | `web/app.py` | step5/alternatives 完整题目（全字段 + 归一化） |
| 6 | `web/templates/index.html` | 首页结构：考试管理 tab、卷库两组、改名备注弹窗、step2 学科/教科书、批改总览视图 |
| 7 | `web/static/style.css` | 新增卷库 tab/发布徽标/分发展开/替换备选/教科书块样式 |
| 8 | `web/static/js/teacher.js` | 首页四框 + 卷库两组 + 分发展开 + 改名备注 + 考试管理 + 批改总览 |
| 9 | `web/static/js/wizard.js` | step2 学科+教科书、step4 上移下移、step5 保存弹窗 |
| 10 | `web/static/js/renderer.js` | AI 备选完整渲染 + applyAlt 全字段 |
| 11 | `web/static/js/grade.js` | 「定稿」改名 + 整卷发布按钮 + hide 列表补全 |
| 12 | `web/static/js/student.js` | 成绩待发布（列表/结果/答题门禁） |
| 13 | `web/scripts/smoke_test.py`（新增）+ 手动清单 | 集成冒烟 + 浏览器手动验证 |

---

### Task 1: db.py — papers 新字段迁移 + 元信息/发布函数

**Files:**
- Modify: `web/db.py:96-103`（迁移区）、`web/db.py:282-311`（papers 区）

**Interfaces:**
- Consumes: 无（本任务只动数据层）
- Produces（后续任务依赖这些签名）:
  - `db.create_paper(p)` —— p 支持 `remark` 键
  - `db.update_paper_meta(pid: int, title=None, remark=None, subject=None, duration=None)` —— 只更新传入的非 None 字段
  - `db.publish_paper(pid: int)` —— 置 `published=1, published_at=now`
  - `db.get_paper` / `db.list_papers` 返回的 dict 自动带 `remark`/`published`/`published_at`（SELECT * 已包含）

- [ ] **Step 1: 写失败探针（预期失败——列还不存在）**

在 `web/` 下用 exam_env 的 python 内联执行：

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && /root/miniconda3/envs/exam_env/bin/python - <<'PY'
import db
db.init_db()
conn = db.get_conn()
cols = {r["name"] for r in conn.execute("PRAGMA table_info(papers)").fetchall()}
conn.close()
assert {"remark", "published", "published_at"} <= cols, f"缺列: {cols}"
print("cols OK")
PY
```

Expected: `AssertionError: 缺列: {...}`（当前只有 is_practice 等列）。

- [ ] **Step 2: 加迁移**

在 `web/db.py` 的 `is_practice` 迁移块（100-103 行）之后追加：

```python
    # 迁移：旧库补 remark / published / published_at（教师备注 + 成绩发布状态，幂等）
    pcols2 = [r["name"] for r in conn.execute("PRAGMA table_info(papers)").fetchall()]
    if "remark" not in pcols2:
        conn.execute("ALTER TABLE papers ADD COLUMN remark TEXT")
    if "published" not in pcols2:
        conn.execute("ALTER TABLE papers ADD COLUMN published INTEGER DEFAULT 0")
    if "published_at" not in pcols2:
        conn.execute("ALTER TABLE papers ADD COLUMN published_at TEXT")
```

- [ ] **Step 3: create_paper 支持 remark**

改 `create_paper`（282-295 行）INSERT 与参数：

```python
def create_paper(p: Dict[str, Any]) -> int:
    conn = get_conn()
    cur = conn.execute("""
        INSERT INTO papers (teacher_id, title, subject, duration, total_score, questions_json, is_practice, remark, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        p["teacher_id"], p.get("title", ""), p.get("subject", ""),
        p.get("duration", 120), p.get("total_score", 0),
        p.get("questions_json", "[]"), 1 if p.get("is_practice") else 0,
        p.get("remark"), _now(),
    ))
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return pid
```

- [ ] **Step 4: 新增 update_paper_meta 与 publish_paper**

在 `delete_paper`（314-320 行）之后、`# 分发` 分区注释之前追加：

```python
def update_paper_meta(pid: int, title: str = None, remark: str = None,
                      subject: str = None, duration: int = None) -> None:
    """只更新传入的非 None 字段（教师改名 / 备注 / 学科 / 时长）。"""
    sets, params = [], []
    for key, val in (("title", title), ("remark", remark), ("subject", subject), ("duration", duration)):
        if val is not None:
            sets.append(f"{key} = ?")
            params.append(val)
    if not sets:
        return
    conn = get_conn()
    params.append(pid)
    conn.execute(f"UPDATE papers SET {', '.join(sets)} WHERE id = ?", params)
    conn.commit()
    conn.close()


def publish_paper(pid: int) -> None:
    """发布整卷成绩：published=1, published_at=now（学生端才可见分数）。"""
    conn = get_conn()
    conn.execute("UPDATE papers SET published = 1, published_at = ? WHERE id = ?", (_now(), pid))
    conn.commit()
    conn.close()
```

- [ ] **Step 5: 跑探针——应通过**

重复 Step 1 命令。Expected: `cols OK`（无 AssertionError）。

- [ ] **Step 6: 补行为探针**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && /root/miniconda3/envs/exam_env/bin/python - <<'PY'
import db
pid = db.create_paper({"teacher_id": 999, "title": "__smoke__", "subject": "数学",
                       "duration": 60, "total_score": 100, "questions_json": "[]", "remark": "smoke"})
db.update_paper_meta(pid, title="__smoke2__", remark="r2")
p = db.get_paper(pid)
assert p["title"] == "__smoke2__" and p["remark"] == "r2", p
db.publish_paper(pid)
p = db.get_paper(pid)
assert p["published"] == 1 and p["published_at"], p
db.delete_paper(pid)
print("db funcs OK")
PY
```

Expected: `db funcs OK`。

- [ ] **Step 7: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/db.py
git commit -m "feat(db): papers 增加 remark/published/published_at 及元信息/发布函数"
```
（若未配置 git 身份，先配置一次，见 Global Constraints。）

---

### Task 2: platform_routes.py — 改名备注 PUT + 发布成绩 POST + GET /papers 扩展

**Files:**
- Modify: `web/platform_routes.py:69-106`（PaperIn / create_paper / list_papers）

**Interfaces:**
- Consumes: `db.update_paper_meta(pid, title, remark, subject, duration)`、`db.publish_paper(pid)`、`db.get_paper(pid)`（Task 1）
- Produces（后续任务依赖）:
  - `PUT /api/papers/{pid}` body `{title?, remark?, subject?, duration?}` → `{"ok": true}`
  - `POST /api/papers/{pid}/publish` → `{"ok": true, "published": true}`（练习卷 400）
  - `GET /api/papers` 每卷新增 `remark` / `published` / `published_at` / `distributions`（明细含 `student_id/name/class_name/major/student_no/status/total_score/submitted_at`）

- [ ] **Step 1: PaperIn 增加 remark**

改 `PaperIn`（69-74 行）：

```python
class PaperIn(BaseModel):
    title: str = ""
    subject: str = ""
    duration: int = 120
    total_score: float = 0
    questions: List[dict] = []
    remark: str = ""
```

`create_paper`（77-85 行）传入 remark：

```python
    pid = db.create_paper({
        "teacher_id": u["id"], "title": body.title, "subject": body.subject,
        "duration": body.duration, "total_score": body.total_score,
        "questions_json": json.dumps(body.questions, ensure_ascii=False),
        "remark": body.remark,
    })
```

- [ ] **Step 2: GET /api/papers 扩展**

改 `list_papers`（88-106 行）out 字典，追加：

```python
        out.append({
            "id": p["id"], "title": p["title"], "subject": p["subject"],
            "duration": p["duration"], "total_score": p["total_score"],
            "created_at": p["created_at"], "is_practice": bool(p.get("is_practice")),
            "remark": p.get("remark"),
            "published": bool(p.get("published")),
            "published_at": p.get("published_at"),
            "question_count": len(qs),
            "distributed_count": len(dists),
            "submitted_count": len(subs),
            "graded_count": sum(1 for s in subs if s["status"] == "graded"),
            "distributions": dists,
        })
```

（`dists = db.list_distributions(p["id"])` 已在上方算好，直接复用。其行结构即 spec 要求的分发明细。）

- [ ] **Step 3: 新增 PUT 改名备注 + POST 发布成绩**

在 `delete_paper`（120-127 行）之后追加：

```python
class PaperUpdateIn(BaseModel):
    title: str = None
    remark: str = None
    subject: str = None
    duration: int = None


@router.put("/papers/{pid}")
async def update_paper_meta(pid: int, body: PaperUpdateIn, request: Request):
    u = auth.require_role(request, "teacher")
    p = db.get_paper(pid)
    if not p or p["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    db.update_paper_meta(pid, title=body.title, remark=body.remark,
                         subject=body.subject, duration=body.duration)
    return {"ok": True}


@router.post("/papers/{pid}/publish")
async def publish_paper(pid: int, request: Request):
    u = auth.require_role(request, "teacher")
    p = db.get_paper(pid)
    if not p or p["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    if p.get("is_practice"):
        raise HTTPException(status_code=400, detail="练习卷无需发布成绩")
    db.publish_paper(pid)
    return {"ok": True, "published": True}
```

注意：PUT 用 `str = None`（pydantic 1.x）而非 `Optional[str] = None`，与文件顶部已 import 的 BaseModel 一致；`None` 默认值 = 「不更新该字段」由 db 层保证。

- [ ] **Step 4: 语法 + 冒烟**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && /root/miniconda3/envs/exam_env/bin/python -c "import platform_routes; print('import OK')"
pkill -f "uvicorn app:app" 2>/dev/null; sleep 1
nohup /root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --host 0.0.0.0 --port 2342 > /tmp/exam_server.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "home:%{http_code}\n" http://localhost:2342/
```

Expected: `import OK`、`home:200`。

- [ ] **Step 5: curl 断言（建卷→改名→发布→列表字段）**

```bash
TOKEN=$(curl -s -X POST http://localhost:2342/api/auth/login -H 'Content-Type: application/json' -d '{"username":"teacher","password":"123456"}' | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json;print(json.load(sys.stdin)['token'])")
PID=$(curl -s -X POST http://localhost:2342/api/papers -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"冒烟卷","subject":"数学","duration":120,"total_score":100,"questions":[{"no":1,"type":"选择题","score":5,"content":"1+1=?"}]}' | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -X PUT http://localhost:2342/api/papers/$PID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"改名卷","remark":"期中备用"}'
curl -s -X POST http://localhost:2342/api/papers/$PID/publish -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:2342/api/papers -H "Authorization: Bearer $TOKEN" | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json; d=json.load(sys.stdin); p=[x for x in d['papers'] if x['id']==$PID][0]; assert p['title']=='改名卷' and p['remark']=='期中备用' and p['published'] is True and 'distributions' in p; print('routes OK', p['published_at'])"
```

Expected: `routes OK <发布时刻字符串>`。清理：`curl -s -X DELETE http://localhost:2342/api/papers/$PID -H "Authorization: Bearer $TOKEN"`。

- [ ] **Step 6: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/platform_routes.py
git commit -m "feat(routes): 试卷改名备注 PUT、发布成绩 POST、GET /papers 扩展分发明细"
```

---

### Task 3: 学生端成绩可见性（score_visible）

**Files:**
- Modify: `web/db.py:366-379`（list_student_papers）、`web/platform_routes.py:167-193`（student_papers / student_get_paper）

**Interfaces:**
- Consumes: `db.list_student_papers`（Task 1 后 SELECT * 列含 published）、`db.get_paper`
- Produces（Task 12 前端依赖）:
  - `/api/student/papers` 每行新增 `score_visible: bool`；不可见时 `score = null`
  - `/api/student/papers/{pid}` 返回 `published` / `is_practice` / `score_visible`；不可见时 `submission.total_score = null`

- [ ] **Step 1: db.list_student_papers 带出 published**

改 `list_student_papers`（366-379 行）SELECT：

```python
        SELECT p.id, p.title, p.subject, p.duration, p.total_score, p.created_at,
               p.is_practice, p.published,
               s.id AS sub_id, s.status AS sub_status, s.total_score AS score, s.submitted_at
```

- [ ] **Step 2: student_papers 列表加 score_visible**

改 `student_papers`（167-170 行）：

```python
@router.get("/student/papers")
async def student_papers(request: Request):
    u = auth.require_role(request, "student")
    papers = db.list_student_papers(u["id"])
    for p in papers:
        visible = bool(p.get("is_practice")) or bool(p.get("published"))
        p["score_visible"] = visible
        if not visible:
            p["score"] = None
    return {"papers": papers}
```

- [ ] **Step 3: student_get_paper 加可见性与发布态**

改 `student_get_paper`（173-193 行），在 `p["questions"] = ...` 之前插入可见性计算，并改 submission 返回：

```python
    p = db.get_paper(pid)
    score_visible = bool(p.get("is_practice")) or bool(p.get("published"))
    p["published"] = bool(p.get("published"))
    p["is_practice"] = bool(p.get("is_practice"))
    p["score_visible"] = score_visible
    p["questions"] = _json_loads(p["questions_json"], [])
    p.pop("questions_json", None)
    sub = db.get_submission(pid, u["id"])
    if sub:
        p["submission"] = {
            "id": sub["id"], "status": sub["status"],
            "total_score": sub["total_score"] if score_visible else None,
            "ai_feedback": _json_loads(sub["ai_feedback_json"], []),
            "answers": _json_loads(sub["answers_json"], []),
            "photos": _json_loads(sub["photos_json"], {}),
            "comment": sub.get("comment") or "",
            "submitted_at": sub["submitted_at"],
        }
    else:
        p["submission"] = None
    return p
```

（注意：`total_score` 不可见时置 `None`，但 `ai_feedback`/`comment` 同样不应下发——学生不应在发布前看到逐题反馈。Task 12 的冒烟会断言 total_score 与 ai_feedback 都为 None。）

- [ ] **Step 4: 冒烟（学生登录查列表，需先有一条正式卷分发）**

```bash
pkill -f "uvicorn app:app" 2>/dev/null; sleep 1
nohup /root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --host 0.0.0.0 --port 2342 > /tmp/exam_server.log 2>&1 &
sleep 3
TOKEN=$(curl -s -X POST http://localhost:2342/api/auth/login -H 'Content-Type: application/json' -d '{"username":"teacher","password":"123456"}' | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json;print(json.load(sys.stdin)['token'])")
PID=$(curl -s -X POST http://localhost:2342/api/papers -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"可见性冒烟","subject":"数学","total_score":100,"questions":[{"no":1,"type":"选择题","score":5,"content":"1+1=?","answer":"2"}]}' | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json;print(json.load(sys.stdin)['id'])")
SID=$(curl -s http://localhost:2342/api/students -H "Authorization: Bearer $TOKEN" | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json;print(json.load(sys.stdin)['students'][0]['id'])")
curl -s -X POST http://localhost:2342/api/papers/$PID/distribute -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"student_ids\":[$SID]}"
STOKEN=$(curl -s -X POST http://localhost:2342/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"$(curl -s http://localhost:2342/api/students -H \"Authorization: Bearer $TOKEN\" | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json;print(json.load(sys.stdin)['students'][0]['username'])\")\",\"password\":\"123456\"}" | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s http://localhost:2342/api/student/papers -H "Authorization: Bearer $STOKEN" | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json; d=json.load(sys.stdin); p=[x for x in d['papers'] if x['id']==$PID][0]; assert p['score_visible'] is False and p['score'] is None; print('visibility OK')"
```

Expected: `visibility OK`。清理：`curl -s -X DELETE http://localhost:2342/api/papers/$PID -H "Authorization: Bearer $TOKEN"`。

- [ ] **Step 5: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/db.py web/platform_routes.py
git commit -m "feat(routes): 学生端成绩可见性——未发布正式卷不下发分数/反馈"
```

---

### Task 4: app.py — step2 教科书上传 + generate-syllabus 学科/教科书

**Files:**
- Modify: `web/app.py:367-460`（generate-syllabus）、新增教科书上传端点与目录提取助手

**Interfaces:**
- Consumes: `extract_text_from_file(filepath, filename)`（app.py 已有）、`load_session`/`save_session`/`stream_sse`
- Produces（Task 8 前端依赖）:
  - `POST /api/session/{sid}/step2/upload-textbook`（FormData `textbook` 文件）→ `{ok, filename, text_length, outline}`
  - session state 新增 `state["textbook"] = {filename, text, outline}`
  - `GET /api/session/{sid}/step2/generate-syllabus` 入参加 `subject: str = ""`

- [ ] **Step 1: 新增目录提取助手 `_build_textbook_outline`**

在 `extract_text_from_file`（146 行）之后追加：

```python
def _build_textbook_outline(text: str, filename: str) -> str:
    """从教科书全文提取「目录 + 节选正文」：识别章节标题行 + 正文开头节选。"""
    heading_re = re.compile(
        r'^(第[0-9一二三四五六七八九十百千]+[章篇章节]'
        r'|[0-9]+(\.[0-9]+)*[、.．\s]'
        r'|[一二三四五六七八九十]+[、])'
    )
    headings = []
    for ln in text.splitlines():
        s = ln.strip()
        if s and len(s) < 40 and heading_re.match(s):
            headings.append(s)
    toc = "\n".join(headings[:80]) if headings else "（未识别到目录标题，以下为正文开头）"
    excerpt = "\n".join(text.splitlines()[:120])
    return (f"### 教科书目录\n{toc}\n\n"
            f"### 正文节选（开头部分，供理解内容范围）\n{excerpt[:6000]}")
```

- [ ] **Step 2: 新增教科书上传端点**

在 `step2_generate_syllabus`（367 行）之前追加：

```python
@app.post("/api/session/{session_id}/step2/upload-textbook")
async def step2_upload_textbook(session_id: str, textbook: UploadFile = File(...)):
    state = load_session(session_id)
    if not state:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    content_bytes = await textbook.read()
    if len(content_bytes) > 20 * 1024 * 1024:
        return JSONResponse({"error": "教科书文件不能超过 20MB"}, status_code=400)
    safe_name = textbook.filename or "unknown"
    upload_dir = SESSIONS_DIR / session_id / "uploads"
    upload_dir.mkdir(exist_ok=True)
    filepath = upload_dir / f"textbook_{safe_name}"
    filepath.write_bytes(content_bytes)
    text = extract_text_from_file(filepath, safe_name)
    outline = _build_textbook_outline(text, safe_name)
    state["textbook"] = {"filename": safe_name, "text": text, "outline": outline}
    state["current_step"] = 2
    save_session(session_id, state)
    return {"ok": True, "filename": safe_name, "text_length": len(text), "outline": outline[:2000]}
```

- [ ] **Step 3: generate-syllabus 加 subject 入参 + 教科书并入 prompt**

改 `step2_generate_syllabus`（367-368 行）签名与 385-395 行的课程信息块：

```python
@app.get("/api/session/{session_id}/step2/generate-syllabus")
async def step2_generate_syllabus(session_id: str, subject: str = "", major: str = "",
                                  grade: str = "", phase: str = ""):
```

```python
    system_prompt = read_skill_md()
    phase_label = {"期中": "期中", "期末": "期末"}.get(phase, phase or "期中/期末")

    textbook = state.get("textbook")
    textbook_text = ""
    if textbook:
        textbook_text = (
            f"\n\n## 教科书大纲（已上传：{textbook['filename']}）\n"
            f"```\n{textbook['outline'][:12000]}\n```\n"
            f"请**以上述教科书的目录与节选为准**，据此生成知识点大纲，章节名称尽量贴合教科书。"
        )

    user_prompt = f"""你正在执行 **步骤 2：按教学大纲直接生成知识点清单**（不依赖真题）。

请根据下面的课程信息，直接生成该课程在对应阶段的**知识点大纲**（章节 + 知识点 + 难度 + 考查频率），并给出典型题型结构建议。

## 课程信息
- 专业：{major}
- 年级：{grade or '未指定'}
- 考试阶段：{phase_label}
- 学科：{subject or state.get('subject') or '未指定'}
- 课程：{state.get('course') or '未指定'}
- 命题范围（如有）：{state.get('scope') or '未指定'}
{textbook_text}
```

（其余 prompt 骨架与 event_stream 不变；`subject` 优先级 = 本次显式传入 > session 里 step1 的学科。）

- [ ] **Step 4: 语法 + 冒烟**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && /root/miniconda3/envs/exam_env/bin/python -c "import app; print('import OK')"
# 教科书上传端点不调用 AI，可 curl 直接验证
SID=$(curl -s -X POST 'http://localhost:2342/api/session/start' -F 'course=微积分' -F 'subject=数学' | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
printf '第一章 函数\n1.1 极限\n1.2 连续\n第二章 导数\n2.1 求导法则\n' > /tmp/tb.txt
curl -s -X POST "http://localhost:2342/api/session/$SID/step2/upload-textbook" -F 'textbook=@/tmp/tb.txt' | /root/miniconda3/envs/exam_env/bin/python -c "import sys,json; d=json.load(sys.stdin); assert d['ok'] and d['text_length']>0 and '目录' in d['outline']; print('textbook OK')"
curl -s "http://localhost:2342/api/session/$SID/step2/generate-syllabus?subject=数学&major=数学&grade=大二&phase=期中" | head -c 300
```

Expected: `import OK`、`textbook OK`、SSE 输出以 `event:` 开头（AI 调用成功与否取决于 API key；若 `error` 事件只说明 key 问题，端点本身已工作）。

- [ ] **Step 5: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/app.py
git commit -m "feat(app): step2 教科书上传（目录+节选）并入大纲生成，generate-syllabus 支持学科"
```

---

### Task 5: app.py — step5/alternatives 完整题目（A3）

**Files:**
- Modify: `web/app.py:706-764`（step5_alternatives）

**Interfaces:**
- Consumes: `state["questions"]`、`parse_json_block`
- Produces（Task 10 前端依赖）:
  - `GET /api/session/{sid}/step5/alternatives?no=N` 返回 `{"alternatives": [完整题目…]}`
  - 每个备选含 `no/type/score/chapter/topic/difficulty/content/answer/analysis` 全字段；缺 content 的备选被过滤

- [ ] **Step 1: 重写 prompt（要求全字段完整题）**

改 `step5_alternatives` 的 `user_prompt`（720-735 行）：

```python
    user_prompt = f"""请针对下面这道题，生成 3 个**同考点、同题型、同难度、同分值**的完整备选题（换情境/换数据，公式用 LaTeX $$...$$）。

每个备选必须是**可直接替换进试卷的完整题目**——含题干、答案、解析、题型、分值、章节、知识点、难度全部字段，**绝不允许只写"计算xx"这类残题**。

## 原题
```json
{json.dumps(question, ensure_ascii=False, indent=2)}
```

严格按 JSON 返回（不要其他文字）：
```json
{{
  "alternatives": [
    {{"no": 1, "type": "选择题", "score": 5, "chapter": "第一章 行列式", "topic": "行列式计算", "difficulty": "基础",
      "content": "完整题干（LaTeX 用 $$...$$）", "answer": "完整答案", "analysis": "完整解析"}}
  ]
}}
```"""
```

- [ ] **Step 2: 服务端归一化（缺字段回填 + 残题过滤）**

改 `event_stream` 内 758 行 `alts = parsed.get(...)` 之后的逻辑：

```python
            parsed = parse_json_block(full_response)
            alts = parsed.get("alternatives", []) if isinstance(parsed, dict) else []
            # 归一化：缺失字段从原题回填；无题干的残题直接丢弃
            clean = []
            for a in alts:
                if not (a.get("content") or "").strip():
                    continue
                clean.append({
                    "no": question.get("no"),
                    "type": a.get("type") or question.get("type") or "",
                    "score": a.get("score") or question.get("score") or 0,
                    "chapter": a.get("chapter") or question.get("chapter") or "",
                    "topic": a.get("topic") or question.get("topic") or "",
                    "difficulty": a.get("difficulty") or question.get("difficulty") or "",
                    "content": a["content"],
                    "answer": a.get("answer") or "",
                    "analysis": a.get("analysis") or "",
                })
            yield stream_sse("result", json.dumps({"alternatives": clean}, ensure_ascii=False))
            yield stream_sse("done", "alternatives_ready")
```

- [ ] **Step 3: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && /root/miniconda3/envs/exam_env/bin/python -c "import app; print('import OK')"
```

Expected: `import OK`。

- [ ] **Step 4: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/app.py
git commit -m "fix(app): step5 备选题返回完整字段，服务端回填缺失字段并过滤残题"
```

---

### Task 6: index.html — 首页结构 + 弹窗 + step2 学科/教科书 + 批改总览视图

**Files:**
- Modify: `web/templates/index.html`

**Interfaces:**
- Consumes: 无
- Produces（Task 8-11 前端依赖的 DOM id）:
  - 顶部 tab：`tabExam`（考试管理）
  - 首页：`statCards`（保留）、`papersTabFormal` / `papersTabPractice` / `myPapersFormal` / `myPapersPractice`
  - 新视图：`examManageView` + `examManageList`；`gradeOverviewView` + `gradeOverviewTitle` + `gradeOverviewList`
  - 弹窗：`paperMetaModal` + `paperMetaTitle`/`pmTitle`/`pmRemark`/`pmSave`
  - step2：`sylSubject` + `subjectList`（datalist）；教科书块 `textbookDropZone`/`textbookInput`/`textbookFileList`/`btnUploadTextbook`/`textbookStatus`
  - 批改视图：`btnPublishPaper`（整卷发布）

- [ ] **Step 1: 顶部 tab 加「考试管理」**

在 `index.html:54`（`tabAnalytics` 那行）之后加：

```html
            <button class="top-tab" id="tabExam" onclick="switchTeacherTab('exam')">🏫 考试管理</button>
```

- [ ] **Step 2: 首页「我的试卷」改两组 tab**

替换 60-63 行：

```html
            <div class="section-head">
                <h2>我的试卷</h2>
            </div>
            <div class="papers-tabs">
                <button class="papers-tab active" id="papersTabFormal" onclick="switchPapersTab('formal')">正式试卷</button>
                <button class="papers-tab" id="papersTabPractice" onclick="switchPapersTab('practice')">错题推送卷</button>
            </div>
            <div id="myPapersFormal" class="paper-list"></div>
            <div id="myPapersPractice" class="paper-list hidden"></div>
```

（删除原 `#myPapers` div。）

- [ ] **Step 3: 新增「考试管理」视图**

在 `index.html:371`（`distributeView` 之前）插入：

```html
        <!-- 考试管理：已分发正式考试实时跟踪 -->
        <div class="tab-panel hidden" id="examManageView">
            <h2>🏫 考试管理</h2>
            <p class="hint">已分发的正式考试实时跟踪：用的哪套卷、提交/批改进度、成绩发布</p>
            <div id="examManageList" class="paper-list"></div>
        </div>

        <!-- 批改总览：统计框下钻 -->
        <div class="tab-panel hidden" id="gradeOverviewView">
            <button class="btn-small" onclick="backToHome()">← 返回首页</button>
            <h2 id="gradeOverviewTitle">批改总览</h2>
            <div id="gradeOverviewList" class="paper-list"></div>
        </div>
```

- [ ] **Step 4: 批改视图头部加「发布整卷成绩」按钮**

在 `index.html:386`（`<h2 id="gradeTitle">` 之后）加：

```html
            <button class="btn-small hidden" id="btnPublishPaper" onclick="publishPaper(_gradePaperId)">📣 发布整卷成绩</button>
```

- [ ] **Step 5: 新增「试卷信息」弹窗（改名+备注）**

在 `index.html:483`（`bankFormModal` 之后）插入：

```html
    <!-- 试卷信息（保存时命名 + 卡片改名备注） -->
    <div class="modal hidden" id="paperMetaModal">
        <div class="modal-backdrop" onclick="closePaperMeta()"></div>
        <div class="modal-card">
            <h3 id="paperMetaTitle">试卷信息</h3>
            <div class="form-group">
                <label for="pmTitle">试卷标题</label>
                <input type="text" id="pmTitle" placeholder="试卷名称">
            </div>
            <div class="form-group">
                <label for="pmRemark">备注 <span class="hint">教师内部备注，学生不可见</span></label>
                <textarea id="pmRemark" rows="2" placeholder="可选，如：期中卷 / 用于A班"></textarea>
            </div>
            <div class="modal-actions">
                <button class="btn-small" onclick="closePaperMeta()">取消</button>
                <button class="btn-primary modal-save" id="pmSave">保存</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 6: step2「直接生成大纲」加学科 + 教科书上传**

替换 149-157 行的 `sylMajor` form-group，在其前插入学科：

```html
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="sylSubject">学科</label>
                                    <input type="text" id="sylSubject" placeholder="如：数学" list="subjectList">
                                    <datalist id="subjectList">
                                        <option>数学</option><option>物理</option><option>化学</option>
                                        <option>计算机</option><option>英语</option><option>临床医学</option>
                                    </datalist>
                                </div>
                                <div class="form-group">
                                    <label for="sylMajor">专业</label>
                                    <input type="text" id="sylMajor" placeholder="如：数学 / 物理 / 化学" list="majorList">
                                    <datalist id="majorList">
                                        <option>数学</option><option>物理</option><option>化学</option>
                                        <option>计算机</option><option>英语</option><option>临床医学</option>
                                    </datalist>
                                </div>
```

在 `btnGenSyllabus` 按钮（172-174 行）之后插入教科书上传块：

```html
                            <div class="textbook-block">
                                <div class="syllabus-divider">或：上传教科书（PDF/DOCX）生成大纲</div>
                                <div class="drop-zone" id="textbookDropZone">
                                    <div class="drop-zone-inner">
                                        <span class="drop-icon">📖</span>
                                        <p>点击选择教科书文件</p>
                                        <p class="hint">支持 PDF / DOCX，提取目录+节选作为出题大纲依据</p>
                                    </div>
                                    <input type="file" id="textbookInput" accept=".pdf,.docx,.doc,.txt" hidden>
                                </div>
                                <div class="file-list" id="textbookFileList"></div>
                                <button type="button" class="btn-secondary" id="btnUploadTextbook" style="margin-top:8px">📤 上传教科书</button>
                                <div class="hint" id="textbookStatus"></div>
                            </div>
```

- [ ] **Step 7: 校验 DOM id 齐全**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && grep -c 'id="tabExam"\|id="papersTabFormal"\|id="myPapersFormal"\|id="myPapersPractice"\|id="examManageView"\|id="gradeOverviewView"\|id="paperMetaModal"\|id="sylSubject"\|id="textbookDropZone"\|id="btnPublishPaper"' templates/index.html
```

Expected: 输出 `10`（每个 id 各出现一次）。

- [ ] **Step 8: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/templates/index.html
git commit -m "feat(html): 教师端首页结构——考试管理tab、卷库两组、改名备注弹窗、step2学科/教科书"
```

---

### Task 7: style.css — 新增样式

**Files:**
- Modify: `web/static/style.css`

- [ ] **Step 1: 追加新类**

在文件末尾追加：

```css
/* ─── 教师端改造 v3：卷库 tab / 发布徽标 / 分发展开 / 备选完整题 / 教科书块 ─── */
.papers-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.papers-tab { padding: 8px 18px; border: 1px solid var(--border); background: var(--surface); border-radius: 10px; cursor: pointer; font-size: .86rem; color: var(--text-muted); font-weight: 500; transition: all .15s; }
.papers-tab:hover { color: var(--primary); border-color: var(--primary); }
.papers-tab.active { background: var(--primary); color: #fff; border-color: var(--primary); }

.tag.pub-yes { background: #ecfdf5; color: #047857; }
.tag.pub-no { background: #fef3c7; color: #b45309; }

.dist-link { cursor: pointer; color: var(--primary); }
.dist-detail { margin: 2px 0 10px; padding: 10px 12px; background: #f8fafc; border: 1px dashed var(--border); border-radius: 10px; display: flex; flex-direction: column; gap: 6px; }
.dist-row { display: flex; align-items: center; gap: 8px; font-size: .82rem; flex-wrap: wrap; }

.replace-item-full { flex-direction: column; align-items: flex-start; }
.replace-item-full .replace-item-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.replace-item-full .hint { font-size: .78rem; color: var(--text-muted); }

.textbook-block { margin-top: 16px; padding: 14px 16px; border: 1px dashed #c7cbe0; border-radius: 12px; background: #fbfcfe; }
.textbook-block .btn-secondary { width: auto; padding: 8px 18px; margin-top: 8px; }
```

- [ ] **Step 2: 校验**

```bash
grep -c 'papers-tab\|pub-yes\|dist-detail\|replace-item-full\|textbook-block' /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web/static/style.css
```

Expected: 输出 `>= 5`。

- [ ] **Step 3: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/style.css
git commit -m "style(css): 卷库tab/发布徽标/分发展开/备选完整题/教科书块样式"
```

---

### Task 8: teacher.js — 首页四框 + 卷库两组 + 分发展开 + 改名备注 + 考试管理 + 批改总览（B 组）

**Files:**
- Modify: `web/static/js/teacher.js`（整体重写首页部分，1-55 行 + 新增函数）

**Interfaces:**
- Consumes:
  - `GET /api/papers`（Task 2 后带 remark/published/distributions）
  - `GET /api/papers/{pid}/submissions`（练习卷展开逐题）
  - `PUT /api/papers/{pid}`、`POST /api/papers/{pid}/publish`（Task 2）
  - `openPaperMeta` / `currentPaperMeta` / `S.questions`（wizard.js / api.js 全局）
- Produces（Task 9-11 依赖）:
  - `switchTeacherTab('exam')` 进入考试管理
  - `switchPapersTab(tab)` 切换正式/错题推送
  - `toggleDistList(pid)` 展开分发名单（练习卷懒加载逐题）
  - `openPaperMeta(mode, pid)` / `closePaperMeta()` / 弹窗保存逻辑（save 模式建卷 / edit 模式 PUT）
  - `openGradeOverview(filter)` / `renderGradeOverview()` 批改总览（submitted/graded/ungraded）
  - `loadExamManage()` / `publishPaper(pid)` 考试管理 + 发布成绩
  - `_gradePaperId`（grade.js 用）保持定义在 grade.js

- [ ] **Step 1: 重写头部 tab 表 + switchTeacherTab + loadHome + 卷库渲染**

替换 `teacher.js` 第 1-55 行，并追加 B 组全部新函数。完整新文件如下（保留 56 行起的分发/学情代码不动）：

```js
// 教师端：首页（统计+卷库）、考试管理、分发、学情
const _T_TABS = { home: 'tabHome', wizard: 'tabWizard', bank: 'tabBank', analytics: 'tabAnalytics', exam: 'tabExam' };
const _ALL_VIEWS = ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView', 'examManageView', 'gradeOverviewView'];

function switchTeacherTab(tab) {
    _ALL_VIEWS.forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    Object.entries(_T_TABS).forEach(([k, id]) => {
        const el = $(id); if (el) el.classList.toggle('active', k === tab);
    });
    if (tab === 'home') { $('teacherHome').classList.remove('hidden'); loadHome(); }
    else if (tab === 'wizard') { $('wizardWrap').classList.remove('hidden'); }
    else if (tab === 'bank') { $('bankView').classList.remove('hidden'); loadBankList(); }
    else if (tab === 'analytics') { $('teacherAnalytics').classList.remove('hidden'); loadAnalytics(); }
    else if (tab === 'exam') { $('examManageView').classList.remove('hidden'); loadExamManage(); }
}

function backToHome() { switchTeacherTab('home'); }

let _papersCache = [];
let _papersTab = 'formal';

async function loadHome() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    const stat = { sub: 0, graded: 0, ongoing: 0 };
    _papersCache.forEach(p => {
        stat.sub += p.submitted_count || 0;
        stat.graded += p.graded_count || 0;
        if (!p.is_practice && (p.distributed_count || 0) > 0 && !p.published) stat.ongoing++;
    });
    const ungraded = Math.max(0, stat.sub - stat.graded);
    $('statCards').innerHTML = `
        <div class="stat-card" onclick="openGradeOverview('submitted')">
            <div class="stat-num">${stat.sub}</div><div class="stat-label">已提交</div>
        </div>
        <div class="stat-card" onclick="openGradeOverview('graded')">
            <div class="stat-num">${stat.graded}</div><div class="stat-label">已批改</div>
        </div>
        <div class="stat-card" onclick="openGradeOverview('ungraded')">
            <div class="stat-num">${ungraded}</div><div class="stat-label">未批改</div>
        </div>
        <div class="stat-card" onclick="switchTeacherTab('exam')">
            <div class="stat-num">${stat.ongoing}</div><div class="stat-label">进行中的考试</div>
        </div>`;
    renderPapersTabs();
}

function renderPapersTabs() {
    const formal = _papersCache.filter(p => !p.is_practice);
    const practice = _papersCache.filter(p => p.is_practice);
    $('myPapersFormal').innerHTML = formal.length
        ? formal.map(paperCard).join('')
        : '<p class="empty-row">还没有正式试卷，去「出试卷」页创建一张吧</p>';
    $('myPapersPractice').innerHTML = practice.length
        ? practice.map(practiceCard).join('')
        : '<p class="empty-row">还没有错题推送卷（批改后点「🎯 按错题推练习」生成）</p>';
}

function switchPapersTab(tab) {
    _papersTab = tab;
    $('papersTabFormal').classList.toggle('active', tab === 'formal');
    $('papersTabPractice').classList.toggle('active', tab === 'practice');
    $('myPapersFormal').classList.toggle('hidden', tab !== 'formal');
    $('myPapersPractice').classList.toggle('hidden', tab !== 'practice');
}

// ── 正式试卷卡片 ──
function paperCard(p) {
    return `
    <div class="paper-card">
        <div class="paper-card-head">
            <span class="paper-card-title" style="cursor:pointer" onclick="openPaperMeta('edit', ${p.id})" title="点击改名">📄 ${esc(p.title)}</span>
            <span class="tag">${esc(p.subject || '未指定学科')}</span>
            <span class="tag">${p.question_count} 题</span>
            <span class="tag ${p.published ? 'pub-yes' : 'pub-no'}">${p.published ? '✅ 已发布' : '⏳ 未发布'}</span>
        </div>
        <div class="paper-card-meta">
            创建于 ${esc((p.created_at || '').slice(0, 16))} · 时长 ${p.duration || 120} 分钟 · 总分 ${p.total_score ?? 0}
            ${p.remark ? ` · 📝 ${esc(p.remark)}` : ''}
        </div>
        <div class="paper-card-stats">
            <span class="dist-link" onclick="toggleDistList(${p.id})">📤 分发 ${p.distributed_count}${p.distributed_count ? ' ▾' : ''}</span>
            <span>📥 提交 ${p.submitted_count}</span>
            <span>✅ 批改 ${p.graded_count}</span>
        </div>
        <div class="dist-detail hidden" id="distDetail_${p.id}">
            ${(p.distributions || []).length ? p.distributions.map(d => `
                <div class="dist-row">
                    <span>${esc(d.name)}</span>
                    <span class="tag">${esc(d.class_name || '')}</span>
                    <span class="hint">${esc(d.student_no || '')}</span>
                    <span class="tag status-${esc(d.status || 'none')}">${d.status === 'graded' ? '已批改' : (d.status === 'submitted' ? '已提交' : '未作答')}</span>
                    ${d.status === 'graded' ? `<span>得分 ${d.total_score ?? '—'}</span>` : ''}
                </div>`).join('') : '<span class="hint">未分发</span>'}
        </div>
        <div class="paper-card-actions">
            <button class="btn-small" onclick="openDistribute(${p.id})">📤 分发</button>
            <button class="btn-small" onclick="openGrade(${p.id})">✍️ 批改</button>
            <button class="btn-small" onclick="openPaperMeta('edit', ${p.id})">✏️ 编辑</button>
            <button class="btn-small btn-danger" onclick="deleteMyPaper(${p.id})">🗑 删除</button>
        </div>
    </div>`;
}

// ── 错题推送卷卡片（无发布成绩层）──
function practiceCard(p) {
    const d = (p.distributions || [])[0] || {};
    const st = d.status || 'none';
    const stLabel = { graded: '✅ 已批改', submitted: '⏳ 已提交待批改', none: '📝 未作答' }[st] || '📝 未作答';
    return `
    <div class="paper-card">
        <div class="paper-card-head">
            <span class="paper-card-title">📄 ${esc(p.title)}</span>
            <span class="tag">🏷️ 练习卷</span>
            <span class="tag">${esc(p.subject || '')}</span>
            <span class="tag status-${esc(st)}">${stLabel}</span>
        </div>
        <div class="paper-card-meta">
            创建于 ${esc((p.created_at || '').slice(0, 16))} · 共 ${p.question_count} 题
            ${d.name ? ` · 学生：${esc(d.name)}（${esc(d.class_name || '')}）` : ''}
        </div>
        <div class="paper-card-stats">
            <span class="dist-link" onclick="toggleDistList(${p.id})">作答详情${st !== 'none' ? ' ▾' : ''}</span>
        </div>
        <div class="dist-detail hidden" id="distDetail_${p.id}"></div>
        <div class="paper-card-actions">
            <button class="btn-small" onclick="openGrade(${p.id})">✍️ 批改</button>
            <button class="btn-small btn-danger" onclick="deleteMyPaper(${p.id})">🗑 删除</button>
        </div>
    </div>`;
}

// ── 分发名单展开（正式卷内联；练习卷懒加载逐题作答）──
async function toggleDistList(pid) {
    const el = $('distDetail_' + pid);
    if (!el) return;
    const p = _papersCache.find(x => x.id === pid);
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (p && p.is_practice) {
        el.innerHTML = '加载中…';
        try {
            const d = await authedJson(`/api/papers/${pid}/submissions`);
            const sub = (d.submissions || [])[0];
            if (!sub) { el.innerHTML = '<span class="hint">学生尚未作答</span>'; return; }
            const fmap = {}; (sub.ai_feedback || []).forEach(f => fmap[f.no] = f);
            const amap = {}; (sub.answers || []).forEach(a => amap[a.no] = a);
            el.innerHTML = (d.questions || []).length ? d.questions.map(q => {
                const f = fmap[q.no] || {};
                const a = amap[q.no] || {};
                const got = f.score != null ? (f.score + ' / ' + (f.max ?? q.score)) : '未评';
                const ans = a.answer_text ? esc(String(a.answer_text).slice(0, 40)) : '未作答';
                return `<div class="dist-row">
                    <span class="tag">第 ${q.no} 题</span>
                    <span class="hint">${ans}</span>
                    <span class="${f.correct ? 'ok' : (f.correct === false ? 'bad' : '')}">${got}</span>
                </div>`;
            }).join('') : '<span class="hint">学生尚未作答</span>';
        } catch (e) { el.innerHTML = '<span class="hint">加载失败</span>'; }
    }
}

// ── 批改总览（统计框下钻）──
const _GRADE_LABEL = { submitted: '已提交', graded: '已批改', ungraded: '未批改' };
let _gradeOverviewFilter = 'submitted';

function openGradeOverview(filter) {
    _gradeOverviewFilter = filter;
    _ALL_VIEWS.forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    $('gradeOverviewView').classList.remove('hidden');
    renderGradeOverview();
}

function renderGradeOverview() {
    $('gradeOverviewTitle').textContent = '批改总览：' + _GRADE_LABEL[_gradeOverviewFilter];
    const rows = [];
    _papersCache.forEach(p => {
        const match = (p.distributions || []).filter(d => {
            if (_gradeOverviewFilter === 'graded') return d.status === 'graded';
            if (_gradeOverviewFilter === 'ungraded') return d.status === 'submitted';
            return d.status != null;
        });
        if (!match.length) return;
        rows.push(`<div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">📄 ${esc(p.title)}</span>
                <span class="tag">${esc(p.subject || '')}</span>
                <span class="tag">${p.question_count} 题</span>
            </div>
            ${match.map(d => `
                <div class="dist-row">
                    <span>${esc(d.name)}</span>
                    <span class="tag">${esc(d.class_name || '')}</span>
                    <span class="hint">${esc(d.student_no || '')}</span>
                    <span class="tag status-${esc(d.status)}">${d.status === 'graded' ? '已批改' : '已提交'}</span>
                    ${d.status === 'graded' ? `<span>得分 ${d.total_score ?? '—'}</span>` : ''}
                    <button class="btn-small" onclick="openGrade(${p.id})">✍️ 去批改</button>
                </div>`).join('')}
        </div>`);
    });
    $('gradeOverviewList').innerHTML = rows.join('') || '<p class="empty-row">该状态下暂无提交</p>';
}

// ── 考试管理 ──
async function loadExamManage() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    const exams = _papersCache.filter(p => !p.is_practice && (p.distributed_count || 0) > 0);
    $('examManageList').innerHTML = exams.length
        ? exams.map(examRow).join('')
        : '<p class="empty-row">暂无已分发的正式考试</p>';
}

function examRow(p) {
    const dist = p.distributed_count || 0, sub = p.submitted_count || 0, graded = p.graded_count || 0;
    return `
    <div class="paper-card" style="cursor:pointer" onclick="openGrade(${p.id})">
        <div class="paper-card-head">
            <span class="paper-card-title">📄 ${esc(p.title)}</span>
            <span class="tag">${p.question_count} 题 / 总分 ${p.total_score ?? 0}</span>
            <span class="tag ${p.published ? 'pub-yes' : 'pub-no'}">${p.published ? '✅ 已发布' : '⏳ 未发布'}</span>
        </div>
        <div class="paper-card-stats">
            <span>分发 ${dist} 人</span>
            <span>已交 ${sub} / 未交 ${dist - sub}</span>
            <span>已批改 ${graded} / 未批改 ${sub - graded}</span>
        </div>
        <div class="paper-card-actions">
            <button class="btn-small" onclick="event.stopPropagation(); openGrade(${p.id})">✍️ 去批改</button>
            ${p.published ? '' : `<button class="btn-small btn-primary-inline" onclick="event.stopPropagation(); publishPaper(${p.id})">📣 发布成绩</button>`}
        </div>
    </div>`;
}

async function publishPaper(pid) {
    if (!confirm('确定发布整卷成绩？发布后学生端将可见所有已批改分数与反馈。')) return;
    await authedJson(`/api/papers/${pid}/publish`, { method: 'POST' });
    alert('成绩已发布，学生端现在可以查看分数');
    await loadExamManage();
    await loadHome();
    openGrade(pid);
}

// ── 改名/备注弹窗 ──
let _paperMetaMode = 'edit', _paperMetaId = null;

function openPaperMeta(mode, pid) {
    _paperMetaMode = mode; _paperMetaId = pid || null;
    const p = pid ? (_papersCache.find(x => x.id === pid) || {}) : {};
    $('paperMetaTitle').textContent = pid ? '编辑试卷信息' : '保存试卷';
    $('pmTitle').value = pid ? (p.title || '') : ((typeof currentPaperMeta === 'function' ? currentPaperMeta().title : '') || '');
    $('pmRemark').value = pid ? (p.remark || '') : '';
    $('paperMetaModal').classList.remove('hidden');
    $('pmTitle').focus();
}

function closePaperMeta() { $('paperMetaModal').classList.add('hidden'); }

$('pmSave').addEventListener('click', async () => {
    const title = $('pmTitle').value.trim();
    const remark = $('pmRemark').value.trim();
    if (!title) { alert('试卷标题不能为空'); return; }
    if (_paperMetaMode === 'save') {
        await saveNewPaper(title, remark);
    } else if (_paperMetaId) {
        await authedJson(`/api/papers/${_paperMetaId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, remark }),
        });
        closePaperMeta();
        loadHome();
    }
});

async function saveNewPaper(title, remark) {
    if (!S.questions || S.questions.length === 0) { alert('请先生成试卷'); return; }
    const meta = currentPaperMeta();
    const total = S.questions.reduce((s, q) => s + (q.score || 0), 0);
    try {
        await authedJson('/api/papers', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title, remark, subject: meta.subject, duration: meta.duration,
                total_score: total, questions: S.questions,
            }),
        });
        closePaperMeta();
        alert('已保存到「我的试卷」');
    } catch (e) { alert('保存失败：' + (e && e.message ? e.message : e)); }
}

async function deleteMyPaper(pid) {
    if (!confirm('确定删除该试卷？将同时删除其分发与提交记录。')) return;
    await authedJson(`/api/papers/${pid}`, { method: 'DELETE' });
    await loadHome();
    await loadExamManage();
}
```

（替换原 1-55 行；原 `deleteMyPaper`（51-55 行）一并被上面的新版本取代，删除旧定义避免重复。）

- [ ] **Step 1.5: openDistribute 隐藏列表补全**

改 `openDistribute`（62-79 行）里的 hide 列表（原为 6 个视图），替换为完整列表：

```js
    ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView', 'examManageView', 'gradeOverviewView']
        .forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    $('distributeView').classList.remove('hidden');
```

（其余分发逻辑不动。）

- [ ] **Step 2: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/teacher.js && echo "syntax OK"
```

Expected: `syntax OK`（node 24 已安装）。

- [ ] **Step 3: 检查函数引用闭环**

```bash
grep -n "function openDistribute\|function backToHome\|function deleteMyPaper" static/js/teacher.js
```

Expected: 三个函数都存在且各出现一次（分发/学情代码保持原样未删）。

- [ ] **Step 4: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/teacher.js
git commit -m "feat(teacher): 首页四框下钻、卷库两组tab、分发展开、改名备注、考试管理"
```

---

### Task 9: wizard.js — step2 学科/教科书 + step4 上移下移 + step5 保存弹窗（A 组）

**Files:**
- Modify: `web/static/js/wizard.js`

**Interfaces:**
- Consumes:
  - `POST /api/session/{sid}/step2/upload-textbook`（Task 4）
  - `GET /api/session/{sid}/step2/generate-syllabus?subject=&major=&grade=&phase=`（Task 4）
  - `openPaperMeta('save', null)`（Task 8）
- Produces:
  - `moveStructureRow(btn, delta)` —— step4 结构表格上移/下移
  - `S.textbookFile`（会话态，api.js 的 S 对象动态挂载）

- [ ] **Step 1: step2 教科书上传绑定**

在 `$('btnGenSyllabus')` 监听器（241-302 行）之前插入：

```js
// 教科书上传（出题大纲依据）
const tbDrop = $('textbookDropZone'), tbInput = $('textbookInput');
tbDrop.addEventListener('click', () => tbInput.click());
tbInput.addEventListener('change', () => {
    if (!tbInput.files[0]) return;
    S.textbookFile = tbInput.files[0];
    $('textbookFileList').innerHTML = `<span class="file-tag">📖 ${esc(S.textbookFile.name)}</span>`;
    $('textbookStatus').textContent = '已选择，点击「上传教科书」提取目录';
});
$('btnUploadTextbook').addEventListener('click', async () => {
    if (!S.textbookFile) { alert('请先选择教科书文件'); return; }
    if (!S.sessionId) {
        const fd = new FormData();
        fd.append('course', $('course').value); fd.append('scope', $('scope').value); fd.append('subject', $('subject').value);
        const r = await fetch('/api/session/start', { method: 'POST', body: fd });
        S.sessionId = (await r.json()).session_id;
    }
    const fd = new FormData(); fd.append('textbook', S.textbookFile);
    const r = await fetch(`/api/session/${S.sessionId}/step2/upload-textbook`, { method: 'POST', body: fd });
    const d = await r.json();
    if (d.ok) {
        S.textbook = d;
        $('textbookStatus').textContent = `✅ 已上传：${d.filename}（${d.text_length} 字符），目录${d.outline ? '已提取' : '未识别'}。生成大纲时将以此为准。`;
    } else {
        alert('上传失败：' + JSON.stringify(d));
    }
});
```

- [ ] **Step 2: btnGenSyllabus 加学科 + 校验改「学科或专业」**

改 `$('btnGenSyllabus')` 监听器开头（241-245 行）与请求构造（271 行）：

```js
$('btnGenSyllabus').addEventListener('click', async () => {
    const subject = $('sylSubject').value.trim();
    const major = $('sylMajor').value.trim();
    const grade = $('sylGrade').value;
    const phase = document.querySelector('input[name="sylPhase"]:checked')?.value || '期中';
    if (!subject && !major) { alert('请先填写学科或专业'); return; }
```

```js
    const qs = new URLSearchParams({ subject, major, grade, phase });
```

- [ ] **Step 3: step4 结构表格上移/下移**

改 `renderStructureTable`（457-485 行）操作列 cell 与行模板，把原 `<td><button class="btn-del-row" onclick="deleteQuestionRow(this)">×</button></td>` 换成：

```js
            <td>
                <button class="btn-small" onclick="moveStructureRow(this, -1)">↑</button>
                <button class="btn-small" onclick="moveStructureRow(this, 1)">↓</button>
                <button class="btn-del-row" onclick="deleteQuestionRow(this)">×</button>
            </td>
```

在 `deleteQuestionRow`（509-513 行）之后追加：

```js
function moveStructureRow(btn, delta) {
    const tr = btn.closest('tr');
    const rows = [...document.querySelectorAll('#structureBody tr')];
    const idx = rows.indexOf(tr);
    const j = idx + delta;
    if (j < 0 || j >= rows.length) return;
    tr.parentNode.insertBefore(tr, j < idx ? rows[j] : rows[j].nextSibling);
    syncStructureFromTable();
    renderStructureTable();
}
```

- [ ] **Step 4: step5 保存改为弹窗命名**

替换 `$('btnSavePaper')` 监听器（633-649 行）整体为：

```js
$('btnSavePaper').addEventListener('click', () => {
    if (!S.questions || S.questions.length === 0) { alert('请先生成试卷'); return; }
    openPaperMeta('save', null);   // 弹窗填标题+备注，确认后 saveNewPaper POST
});
```

（原监听器里直接 POST 的逻辑移入 teacher.js 的 `saveNewPaper`。）

- [ ] **Step 5: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/wizard.js && echo "syntax OK"
```

Expected: `syntax OK`。

- [ ] **Step 6: 引用闭环检查**

```bash
grep -c "openPaperMeta('save'" static/js/wizard.js
grep -c "moveStructureRow" static/js/wizard.js
```

Expected: 第一个输出 `1`，第二个输出 `3`（1 处定义 + 2 处调用）。

- [ ] **Step 7: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/wizard.js
git commit -m "feat(wizard): step2学科/教科书上传、step4结构上移下移、step5保存命名弹窗"
```

---

### Task 10: renderer.js — AI 备选完整渲染 + applyAlt 全字段（A3 前端）

**Files:**
- Modify: `web/static/js/renderer.js`

**Interfaces:**
- Consumes: `GET /api/session/{sid}/step5/alternatives`（Task 5 后全字段）
- Produces: 无新接口（纯渲染）

- [ ] **Step 1: genReplaceAlt 渲染完整备选**

改 `genReplaceAlt` 的 result 分支（106-118 行）与 AI 面板渲染：

```js
            result: (d) => {
                let alts = [];
                try { alts = JSON.parse(d).alternatives || []; } catch (e) { alts = []; }
                window._alts = alts;
                list.innerHTML = alts.length
                    ? alts.map((a, i) => `
                        <div class="replace-item replace-item-full">
                            <div class="replace-item-meta">
                                <span class="tag">${esc(a.type)}</span>
                                <span class="tag">${a.score ?? 0} 分</span>
                                <span class="tag">${esc(a.difficulty)}</span>
                                ${a.topic ? `<span class="tag source-tag">${esc(a.topic)}</span>` : ''}
                            </div>
                            <div>${renderMath(escMath(a.content))}</div>
                            ${a.answer ? `<div class="hint" style="margin-top:4px">答案：${renderMath(escMath(a.answer))}</div>` : ''}
                            <div style="display:flex;gap:8px;margin-top:8px">
                                <button class="btn-small" onclick="applyAlt(${_replaceNo}, ${i})">替换</button>
                                <button class="btn-small" onclick="saveAlt(${_replaceNo}, ${i})">入库</button>
                            </div>
                        </div>`).join('')
                    : '<p class="empty-row">未生成备选（可重试）</p>';
            },
```

- [ ] **Step 2: applyAlt 全字段覆盖**

改 `applyAlt`（135-142 行）：

```js
function applyAlt(no, altIndex) {
    const q = (S.questions || []).find(x => String(x.no) === String(no));
    const a = window._alts?.[altIndex];
    if (!q || !a) return;
    q.type = a.type; q.score = a.score; q.chapter = a.chapter; q.topic = a.topic; q.difficulty = a.difficulty;
    q.content = a.content; q.answer = a.answer; q.analysis = a.analysis;
    renderPaper(S.questions, $('paperTemplate').value, currentPaperMeta());
    closeReplace();
}
```

- [ ] **Step 3: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/renderer.js && echo "syntax OK"
```

Expected: `syntax OK`。

- [ ] **Step 4: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/renderer.js
git commit -m "feat(renderer): 备选完整题渲染（题型/分值/难度/答案），替换时全字段覆盖"
```

---

### Task 11: grade.js — 「定稿」改名 + 整卷发布按钮 + hide 列表补全

**Files:**
- Modify: `web/static/js/grade.js`

**Interfaces:**
- Consumes: `publishPaper(pid)`（Task 8，全局）
- Produces: `openGrade` 对 `btnPublishPaper` 的显隐控制

- [ ] **Step 1: 声明全局 + openGrade 隐藏列表补全 + 发布按钮显隐**

文件顶部声明全局（供 index.html 的 `btnPublishPaper` onclick 用）：

```js
let _gradePaperId = null, _gradePaper = null;
```

改 `openGrade`（19-21 行）hide 列表、记录当前卷、控制发布按钮：

```js
    ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView', 'examManageView', 'gradeOverviewView']
        .forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    $('gradeView').classList.remove('hidden');
    _gradePaperId = pid;
    _gradePaper = paper;   // 当前 openGrade 已 fetch 的 paper 对象
    const btnPub = $('btnPublishPaper');
    if (btnPub) btnPub.classList.toggle('hidden', !!paper.is_practice || !!paper.published);
    renderGradeList();
```

（`paper` 即 `openGrade` 开头 `authedJson('/api/papers/' + pid)` 的返回值，Task 2 后已带 `is_practice`/`published`。）

- [ ] **Step 2: finalize 按钮与提示改名**

改 `gradeCard`（80 行）按钮文案，与 `finalizeGrade`（124 行）alert：

```js
            <button class="btn-small btn-primary-inline" onclick="finalizeGrade(${s.id})">✅ 定稿</button>
```

```js
    alert('已定稿（结果已存，学生端将在你「发布整卷成绩」后可见）');
```

（`finalizeGrade` 其余逻辑不变——`/finalize` 只存结果，发布是整卷动作。）

- [ ] **Step 3: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/grade.js && echo "syntax OK"
```

Expected: `syntax OK`。

- [ ] **Step 4: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/grade.js
git commit -m "feat(grade): finalize改名定稿，批改视图可整卷发布成绩，视图切换补全"
```

---

### Task 12: student.js — 成绩待发布（学生端可见性）

**Files:**
- Modify: `web/static/js/student.js`

**Interfaces:**
- Consumes: `/api/student/papers` 与 `/api/student/papers/{pid}` 的 `score_visible`（Task 3）
- Produces: 无（纯渲染/门禁）

- [ ] **Step 1: 列表「成绩待发布」**

改 `loadStudentPapers`（59 行）得分显示：

```js
                ${p.sub_status === 'graded' ? (p.score_visible
                    ? `<span>得分 ${p.score}</span>`
                    : `<span class="tag">⏳ 成绩待发布</span>`) : ''}
```

- [ ] **Step 2: 结果页只列已发布**

改 `loadStudentResults`（71 行）过滤条件：

```js
    const graded = (d.papers || []).filter(p => p.sub_status === 'graded' && p.score_visible);
```

- [ ] **Step 3: 答题/结果门禁**

改 `openStudentPaper`（90 行）与 `showResult`（185 行开头）加门禁：

```js
    if (p.submission && p.submission.status === 'graded' && !p.score_visible) {
        alert('成绩待发布，请耐心等待老师发布');
        return;
    }
    if (p.submission && p.submission.status === 'graded') { showResult(pid); return; }
```

（`showResult` 第一行同样加 `if (p.submission && p.submission.status === 'graded' && !p.score_visible) { alert('成绩待发布'); return; }`，防直接 `showResult(pid)` 路径。）

- [ ] **Step 4: 语法校验**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web && node --check static/js/student.js && echo "syntax OK"
```

Expected: `syntax OK`。

- [ ] **Step 5: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/static/js/student.js
git commit -m "feat(student): 未发布正式卷显示成绩待发布，结果页仅列已发布成绩"
```

---

### Task 13: 集成冒烟 + 浏览器手动验证

**Files:**
- Create: `web/scripts/smoke_test.py`（stdlib urllib，零依赖）
- Modify: 无

- [ ] **Step 1: 写冒烟脚本**

创建 `web/scripts/smoke_test.py`（覆盖全部新后端端点与可见性规则）：

```python
#!/usr/bin/env python3
"""exam-maker 教师端改造冒烟测试（stdlib urllib + db 引导，零依赖）。

用法：先启动服务，再：
  cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web
  /root/miniconda3/envs/exam_env/bin/python scripts/smoke_test.py
通过则打印 SMOKE OK；失败抛 AssertionError。
"""
import json
import os
import sys
import urllib.error
import urllib.request

# 把 web/ 加进 sys.path（本脚本在 web/scripts/ 下，import db 需要 web/ 在路径上）
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db  # 仅引导练习卷：练习卷只能经"已批改提交"链路生成，HTTP 复刻太重

BASE = "http://localhost:2342"
TEACHER = {"username": "teacher", "password": "123456"}
STUDENT = {"username": "20260101", "password": "123456"}


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode("utf-8"))


def login(u):
    return req("POST", "/api/auth/login", body=u)["token"]


def main():
    db.init_db()
    t = login(TEACHER)
    s = login(STUDENT)
    tid = req("GET", "/api/auth/me", t)["id"]

    # 1) 建正式卷 + 改名 + 备注 + 发布
    pid = req("POST", "/api/papers", t, body={
        "title": "冒烟正式卷", "subject": "数学", "duration": 120, "total_score": 100,
        "questions": [{"no": 1, "type": "选择题", "score": 5, "content": "1+1=?", "answer": "2"}],
        "remark": "冒烟备注",
    })["id"]
    req("PUT", f"/api/papers/{pid}", t, body={"title": "冒烟正式卷·改名", "remark": "备注v2"})
    pl = req("GET", "/api/papers", t)["papers"]
    p = next(x for x in pl if x["id"] == pid)
    assert p["title"] == "冒烟正式卷·改名" and p["remark"] == "备注v2"
    assert p["published"] is False and "distributions" in p
    assert p["is_practice"] is False

    # 2) 分发给学生，未发布时学生看不到分数/反馈
    students = req("GET", "/api/students", t)["students"]
    sid = students[0]["id"]
    req("POST", f"/api/papers/{pid}/distribute", t, body={"student_ids": [sid]})
    sp = req("GET", "/api/student/papers", s)["papers"]
    sp = next(x for x in sp if x["id"] == pid)
    assert sp["score_visible"] is False and sp["score"] is None
    sget = req("GET", f"/api/student/papers/{pid}", s)
    assert sget["score_visible"] is False and sget["published"] is False

    # 3) 学生提交 → 教师批改定稿 → 仍不可见
    req("POST", f"/api/student/papers/{pid}/submit", s, body={"answers": [{"no": 1, "answer_text": "2"}], "photos": {}})
    subs = req("GET", f"/api/papers/{pid}/submissions", t)["submissions"]
    subid = subs[0]["id"]
    req("POST", f"/api/submissions/{subid}/grade", t)
    req("POST", f"/api/submissions/{subid}/finalize", t, body={
        "feedback": [{"no": 1, "score": 5, "max": 5, "comment": "对", "correct": True}],
        "total_score": 5, "comment": "",
    })
    sget2 = req("GET", f"/api/student/papers/{pid}", s)
    assert sget2["submission"]["total_score"] is None and sget2["submission"]["ai_feedback"] == []

    # 4) 发布整卷 → 学生可见
    req("POST", f"/api/papers/{pid}/publish", t)
    sget3 = req("GET", f"/api/student/papers/{pid}", s)
    assert sget3["published"] is True and sget3["submission"]["total_score"] == 5.0
    assert len(sget3["submission"]["ai_feedback"]) == 1

    # 5) 考试管理口径
    pl2 = req("GET", "/api/papers", t)["papers"]
    p2 = next(x for x in pl2 if x["id"] == pid)
    assert p2["published"] is True and p2["distributed_count"] == 1
    assert p2["submitted_count"] == 1 and p2["graded_count"] == 1

    # 6) 练习卷：db 引导创建（is_practice=1）→ 学生始终可见 → 拒绝发布
    prac = db.create_paper({
        "teacher_id": tid, "title": "张三·错题巩固（数学）", "subject": "数学",
        "duration": 60, "total_score": 10,
        "questions_json": json.dumps([{"no": 1, "type": "选择题", "score": 5,
                                       "content": "2+2=?", "answer": "4"}], ensure_ascii=False),
        "is_practice": 1,
    })
    req("POST", f"/api/papers/{prac}/distribute", t, body={"student_ids": [sid]})
    req("POST", f"/api/student/papers/{prac}/submit", s, body={"answers": [{"no": 1, "answer_text": "4"}], "photos": {}})
    sgetp = req("GET", f"/api/student/papers/{prac}", s)
    assert sgetp["is_practice"] is True and sgetp["score_visible"] is True
    try:
        req("POST", f"/api/papers/{prac}/publish", t)
        raise AssertionError("练习卷发布应被拒绝")
    except urllib.error.HTTPError as e:
        assert e.code == 400

    # 清理
    req("DELETE", f"/api/papers/{pid}", t)
    req("DELETE", f"/api/papers/{prac}", t)
    print("SMOKE OK: 全部断言通过")


if __name__ == "__main__":
    main()
```

（教科书上传端点在 Task 4 Step 4 已用 curl 验证过；本冒烟脚本专注可见性规则、改名备注、发布、考试管理口径的 1-6 步断言，不重复测教科书。）

- [ ] **Step 2: 重启服务跑冒烟**

```bash
pkill -f "uvicorn app:app" 2>/dev/null; sleep 1
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker/web
nohup /root/miniconda3/envs/exam_env/bin/python -m uvicorn app:app --host 0.0.0.0 --port 2342 > /tmp/exam_server.log 2>&1 &
sleep 3
/root/miniconda3/envs/exam_env/bin/python scripts/smoke_test.py
```

Expected: `SMOKE OK: 全部断言通过`。若抛错，按堆栈回到对应 Task 修复后重跑。

- [ ] **Step 3: 浏览器手动验证清单（每个教师端主流程走一遍）**

| # | 操作 | 预期 |
|---|---|---|
| 1 | 教师登录 → 首页 | 四框数字正确：已提交/已批改/未批改/进行中的考试 |
| 2 | 点「已提交/已批改/未批改」框 | 进批改总览，行内学生+状态+「去批改」 |
| 3 | 卷库「正式试卷」tab | 卡片有发布徽标（灰未发布/绿已发布）、「已分发 N」可展开名单 |
| 4 | 卷库「错题推送卷」tab | 显示「张三·错题巩固」、学生名+班级、作答状态；展开可见逐题对错得分；**无发布成绩按钮** |
| 5 | 卡片标题点击 / 「✏️ 编辑」 | 改名+备注弹窗，保存后卡片更新 |
| 6 | 「考试管理」tab | 列出已分发正式考试；已交/未交/已批改/未批改数字正确；点行进批改 |
| 7 | 考试管理点「📣 发布成绩」 | 确认后徽标变绿；学生端可见分数 |
| 8 | 出卷向导 step2 | 学科下拉可改；上传教科书后提示目录已提取 |
| 9 | 出卷向导 step4 | 结构表格每行 ↑↓ 可移动，题号随之重排 |
| 10 | 出卷向导 step5 替换题 → AI 生成备选 | 备选显示题型/分值/难度/完整题干/答案；替换后题型分值同步 |
| 11 | 出卷向导 step5「💾 保存到我的试卷」 | 弹出标题+备注，默认课程名，保存成功 |
| 12 | 学生端登录 | 未发布正式卷：列表显示「⏳ 成绩待发布」，不显示分数；发布后正常显示 |

- [ ] **Step 4: 补一个教师端已确认的回归点**

确认原功能未破坏：分发（勾选学生→确认）、AI 批改→定稿、按错题推练习生成练习卷、题库管理、学情页。跑一遍即可，有问题按堆栈回 Task 1-12 修。

- [ ] **Step 5: Commit**

```bash
cd /tmp/blood_cell/exam_maker/智能体大赛/exam-maker
git add web/scripts/smoke_test.py
git commit -m "test(smoke): 教师端改造集成冒烟——可见性规则/考试管理口径/改名发布"
```

---

## Self-Review（已对照 spec 核查）

**Spec 覆盖：**
- A1 学科下拉+专业+教科书 → Task 4（后端）+ Task 6/9（前端）
- A2 题目顺序调整 → Task 9（step4 ↑↓）
- A3 完整备选题 → Task 5（后端全字段+归一化）+ Task 10（前端渲染/替换全字段）
- A4 保存命名+备注+可改名 → Task 1/2（后端）+ Task 6/8（弹窗）
- B1 卷库两组 tab（is_practice）→ Task 6/8
- B2 已分发可见+发布状态 → Task 2（GET /papers 明细）+ Task 8（卡片展开/徽标）
- B3 四框改「已提交/已批改/未批改/进行中」全部可点 → Task 8（openGradeOverview）
- B4 考试管理 → Task 8（examManageView）
- 学生可见性规则（published 门控 + 练习卷无门槛）→ Task 3/12/13
- 错题推送卷无发布按钮 → Task 8（practiceCard 无发布入口）+ Task 2（练习卷 publish 400）

**已消除的歧义（写死在计划里）：**
- 「已提交」统计口径 = 所有提交数（submitted_count）；「未批改」= 已提交−已批改。Task 8 loadHome。
- 统计框下钻无法进单卷批改视图 → 新增批改总览视图（gradeOverviewView）。Task 8。
- 学生发布前不仅看不到分数，`ai_feedback`/`comment` 也不下发。Task 3。
- 批量改写不留孤儿：teacher.js 旧 deleteMyPaper 被新定义替换；grade.js openGrade 隐藏列表加入 examManageView/gradeOverviewView。

**类型一致性：**
- `db.update_paper_meta(pid, title, remark, subject, duration)` 在 Task 1 定义、Task 2 调用，签名一致。
- `publishPaper(pid)` 在 Task 8 定义，Task 8 examRow / Task 11 grade.js 调用，签名一致。
- `openPaperMeta('save'|'edit', pid)` Task 8 定义，Task 9 btnSavePaper 调用，一致。
- 学生端 `score_visible` 由 Task 3 下发，Task 12 消费，一致。
