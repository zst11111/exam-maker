"""
exam-maker Web v2 — 5步交互式命题工作台
向导式流程：基本信息 → 上传真题+AI解析 → 知识点确认 → 命题设置 → 预览下载
AI 后端：DeepSeek API（OpenAI 兼容接口，deepseek-chat 模型）
"""
import os
import re
import json
import uuid
import shutil
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, File, Form, UploadFile, Request, Query
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from openai import OpenAI
import db
import seed
from questionbank import router as questionbank_router
from platform_routes import router as platform_router

# ─── API 配置 ────────────────────────────────────────────
# 从 Claude Code settings.json 读取 API Key，用 DeepSeek 免费模型 deepseek-chat

def _load_api_config() -> Dict[str, str]:
    """
    加载 API 配置。优先级：环境变量 > settings.json > 默认值
    DeepSeek 免费 API 使用 OpenAI 兼容接口。
    """
    config = {
        "api_key": "",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    }

    # 1. 环境变量
    for env_name in ("DEEPSEEK_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"):
        val = os.environ.get(env_name, "")
        if val:
            config["api_key"] = val
            break

    if os.environ.get("DEEPSEEK_BASE_URL"):
        config["base_url"] = os.environ["DEEPSEEK_BASE_URL"]
    if os.environ.get("DEEPSEEK_MODEL"):
        config["model"] = os.environ["DEEPSEEK_MODEL"]

    # 2. 从 Claude Code settings.json 读取 Key
    settings_paths = [
        Path.home() / ".claude" / "settings.json",
        Path("/root/.claude/settings.json"),
    ]
    for sp in settings_paths:
        if sp.exists():
            try:
                data = json.loads(sp.read_text("utf-8"))
                env = data.get("env", {})
                if not config["api_key"]:
                    config["api_key"] = (
                        env.get("ANTHROPIC_AUTH_TOKEN")
                        or env.get("ANTHROPIC_API_KEY")
                        or ""
                    )
            except Exception:
                pass

    return config

_api_config = _load_api_config()

# ─── 路径配置 ───────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
SKILL_MD_PATH = BASE_DIR.parent / "SKILL-copy.md"
ASSETS_DIR = BASE_DIR.parent / "assets"
SESSIONS_DIR = BASE_DIR / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

# ─── FastAPI app ─────────────────────────────────────────
app = FastAPI(title="数智命题师 · exam-maker v2 (DeepSeek)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

db.init_db()
seed.seed()
app.include_router(questionbank_router)
app.include_router(platform_router)

static_dir = BASE_DIR / "static"
static_dir.mkdir(exist_ok=True)
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

uploads_dir = BASE_DIR / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


# ═══════════════════════════════════════════════════════════
# 工具函数
# ═══════════════════════════════════════════════════════════

def get_client() -> OpenAI:
    """创建 OpenAI 客户端（指向 DeepSeek）"""
    kwargs = {
        "api_key": _api_config["api_key"],
        "base_url": _api_config["base_url"],
    }
    return OpenAI(**kwargs)


def get_model() -> str:
    return _api_config["model"]


def read_skill_md() -> str:
    """读取 SKILL-copy.md 作为 system prompt"""
    if SKILL_MD_PATH.exists():
        content = SKILL_MD_PATH.read_text(encoding="utf-8")
        content = re.sub(r'^---\n.*?\n---\n', '', content, flags=re.DOTALL)
        return content.strip()
    return "你是一个专业的命题智能体。"


def extract_text_from_file(filepath: Path, filename: str) -> str:
    """从上传文件中提取文本"""
    suffix = filename.lower().split('.')[-1] if '.' in filename else ''
    if suffix in ('tex', 'md', 'txt'):
        return filepath.read_text(encoding='utf-8', errors='ignore')
    if suffix == 'pdf':
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(str(filepath))
            text = "\n\n".join(p.extract_text() or "" for p in reader.pages)
            return text or f"[PDF 文本提取为空，共 {len(reader.pages)} 页]"
        except Exception as e:
            return f"[PDF 解析失败: {e}]"
    if suffix == 'docx':
        try:
            from docx import Document
            doc = Document(str(filepath))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            return f"[DOCX 解析失败: {e}]"
    return f"[不支持的文件格式: {suffix}]"


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


def load_session(session_id: str) -> Dict:
    state_path = SESSIONS_DIR / session_id / "state.json"
    if state_path.exists():
        return json.loads(state_path.read_text("utf-8"))
    return {}


def save_session(session_id: str, state: Dict):
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2), "utf-8"
    )


def stream_sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


def parse_json_block(raw: str) -> Dict:
    """从 AI 回复中提取 JSON 块"""
    # ```json ... ```
    m = re.search(r'```json\s*\n(.*?)\n\s*```', raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # bare { ... }（通用对象提取，兼容 questions/alternatives/exam_structure 等任意顶层键）
    m = re.search(r'\{.*\}', raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return {
        "exam_structure": {}, "knowledge_points": [],
        "difficulty_summary": {}, "high_frequency_topics": [],
        "summary": raw[:500], "_parse_error": True,
    }


# ═══════════════════════════════════════════════════════════
# 页面
# ═══════════════════════════════════════════════════════════

@app.get("/", response_class=HTMLResponse)
async def index():
    html_path = BASE_DIR / "templates" / "index.html"
    if html_path.exists():
        return html_path.read_text(encoding="utf-8")
    return "<h1>index.html not found</h1>"


# ═══════════════════════════════════════════════════════════
# Step 1: 创建会话 + 保存基本信息
# ═══════════════════════════════════════════════════════════

@app.post("/api/session/start")
async def session_start(course: str = Form(""), scope: str = Form(""), subject: str = Form("")):
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    state = {
        "session_id": session_id, "course": course, "scope": scope, "subject": subject,
        "current_step": 1, "papers": [], "knowledge": None,
        "difficulty": "基础60% 中等30% 难10%", "n_sets": "2",
    }
    save_session(session_id, state)
    return {"session_id": session_id, "state": state}


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


# ═══════════════════════════════════════════════════════════
# Step 2: 上传真题 + AI 解析
# ═══════════════════════════════════════════════════════════

@app.post("/api/session/{session_id}/step2/upload")
async def step2_upload(session_id: str, past_papers: List[UploadFile] = File(...)):
    state = load_session(session_id)
    if not state:
        return JSONResponse({"error": "会话不存在"}, status_code=404)

    upload_dir = SESSIONS_DIR / session_id / "uploads"
    upload_dir.mkdir(exist_ok=True)

    papers = []
    for f in past_papers:
        safe_name = f.filename or "unknown"
        filepath = upload_dir / safe_name
        content_bytes = await f.read()
        filepath.write_bytes(content_bytes)
        text = extract_text_from_file(filepath, safe_name)
        papers.append({
            "filename": safe_name, "size": len(content_bytes),
            "text_length": len(text), "text": text, "path": str(filepath),
        })

    state["papers"] = papers
    state["current_step"] = 2
    save_session(session_id, state)

    return {
        "ok": True,
        "papers": [{"filename": p["filename"], "size": p["size"], "text_length": p["text_length"]} for p in papers],
    }


@app.get("/api/session/{session_id}/step2/analyze")
async def step2_analyze(session_id: str):
    """SSE — AI 解析真题，提取知识点"""
    state = load_session(session_id)
    if not state or not state.get("papers"):
        return StreamingResponse(
            iter([stream_sse("error", "请先上传真题文件")]),
            media_type="text/event-stream",
        )

    papers = state["papers"]
    system_prompt = read_skill_md()

    papers_text = ""
    for p in papers:
        papers_text += f"\n### 真题文件: {p['filename']}\n```\n{p['text'][:15000]}\n```\n"
        if len(p.get("text", "")) > 15000:
            papers_text += f"(内容过长，已截断。原文件共{len(p['text'])}字符)\n"

    user_prompt = f"""你正在执行 **步骤 2：真题解析 → 考点分类**。

请分析以下往年真题，提取：
1. **题型结构** — 题型、题量、每题分值、总分、考试时长
2. **知识点归类** — 每题考查的知识点（章节+知识点名），按章节归类
3. **难度分布** — 每题难度（基础/中等/难），含判断依据
4. **高频考点** — 历年出现最多的知识点 TOP 5

{papers_text}

请严格按 JSON 格式返回（不要包含其他文字）：

```json
{{
  "exam_structure": {{
    "total_score": 100, "duration_minutes": 120,
    "question_types": [
      {{"type": "选择题", "count": 10, "score_per_question": 3, "total": 30}}
    ]
  }},
  "knowledge_points": [
    {{
      "chapter": "第一章 行列式", "topic": "行列式计算",
      "difficulty": "基础", "question_refs": ["选择题第1题"],
      "frequency": 3, "notes": "每年必考"
    }}
  ],
  "difficulty_summary": {{
    "基础": {{"count": 5, "score": 30}},
    "中等": {{"count": 6, "score": 45}},
    "难": {{"count": 3, "score": 25}}
  }},
  "high_frequency_topics": [
    {{"topic": "特征值", "frequency": 4, "avg_difficulty": "中等"}}
  ],
  "summary": "整体分析（200字内）"
}}
```"""

    async def event_stream():
        try:
            client = get_client()
            model = get_model()
            yield stream_sse("status", "analyzing")
            yield stream_sse("log", f"[系统] 使用 {model} 开始解析真题...")

            full_response = ""
            stream = client.chat.completions.create(
                model=model,
                max_tokens=16000,
                temperature=0.3,
                messages=[
                    {"role": "system", "content": system_prompt + "\n\n当前任务：仅做真题解析和考点分类，不要命题。按JSON格式返回。"},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else ""
                if delta:
                    full_response += delta
                    yield stream_sse("text", delta)

            yield stream_sse("log", "")
            yield stream_sse("log", "[系统] AI 解析完成，正在提取结构化数据...")

            parsed = parse_json_block(full_response)
            state["knowledge"] = parsed
            state["knowledge_raw"] = full_response
            state["current_step"] = 2
            save_session(session_id, state)

            yield stream_sse("result", json.dumps(parsed, ensure_ascii=False))
            yield stream_sse("done", "analysis_complete")

        except Exception as e:
            yield stream_sse("error", str(e))

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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


@app.get("/api/session/{session_id}/step2/generate-syllabus")
async def step2_generate_syllabus(session_id: str, subject: str = "", major: str = "",
                                  grade: str = "", phase: str = ""):
    """SSE — 不上传真题，按「专业+年级+期中/期末」直接生成知识点大纲。"""
    state = load_session(session_id)
    if not state:
        return StreamingResponse(
            iter([stream_sse("error", "会话不存在")]),
            media_type="text/event-stream",
        )
    if not major:
        return StreamingResponse(
            iter([stream_sse("error", "请填写专业")]),
            media_type="text/event-stream",
        )

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

请严格按 JSON 返回（不要其他文字）：

```json
{{
  "exam_structure": {{
    "total_score": 100, "duration_minutes": 120,
    "question_types": [
      {{"type": "选择题", "count": 10, "score_per_question": 3, "total": 30}}
    ]
  }},
  "knowledge_points": [
    {{
      "chapter": "第一章 行列式", "topic": "行列式计算",
      "difficulty": "基础", "question_refs": [], "frequency": 3, "notes": ""
    }}
  ],
  "difficulty_summary": {{
    "基础": {{"count": 5, "score": 30}},
    "中等": {{"count": 6, "score": 45}},
    "难": {{"count": 3, "score": 25}}
  }},
  "high_frequency_topics": [
    {{"topic": "特征值", "frequency": 4, "avg_difficulty": "中等"}}
  ],
  "summary": "整体说明（200字内）"
}}
```"""

    async def event_stream():
        try:
            client = get_client()
            model = get_model()
            yield stream_sse("log", f"[系统] 使用 {model} 为「{major}{grade or ''}·{phase_label}」生成知识点大纲...")

            full_response = ""
            stream = client.chat.completions.create(
                model=model,
                max_tokens=16000,
                temperature=0.3,
                messages=[
                    {"role": "system", "content": system_prompt + "\n\n当前任务：仅生成知识点大纲，不要命题。按JSON格式返回。"},
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
            state["knowledge"] = parsed
            state["syllabus_meta"] = {"major": major, "grade": grade, "phase": phase_label}
            state["current_step"] = 2
            save_session(session_id, state)

            yield stream_sse("result", json.dumps(parsed, ensure_ascii=False))
            yield stream_sse("done", "syllabus_ready")

        except Exception as e:
            yield stream_sse("error", str(e))

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ═══════════════════════════════════════════════════════════
# Step 3: 知识点确认
# ═══════════════════════════════════════════════════════════

@app.get("/api/session/{session_id}/knowledge")
async def get_knowledge(session_id: str):
    state = load_session(session_id)
    if not state:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    return {
        "knowledge": state.get("knowledge"),
        "papers_summary": [
            {"filename": p["filename"], "text_length": p["text_length"]}
            for p in state.get("papers", [])
        ],
    }


@app.post("/api/session/{session_id}/step3/save")
async def step3_save(session_id: str, request: Request):
    state = load_session(session_id)
    if not state:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    body = await request.json()
    state["knowledge"] = body.get("knowledge", state.get("knowledge"))
    state["current_step"] = 3
    save_session(session_id, state)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
# Step 4: 命题设置 + 双向细目表预览
# ═══════════════════════════════════════════════════════════

@app.post("/api/session/{session_id}/step4/settings")
async def step4_settings(
    session_id: str,
    difficulty: str = Form("基础60% 中等30% 难10%"),
    n_sets: str = Form("2"),
):
    state = load_session(session_id)
    if not state:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    state["difficulty"] = difficulty
    state["n_sets"] = n_sets
    state["current_step"] = 4
    save_session(session_id, state)
    return {"ok": True}


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


@app.post("/api/session/{session_id}/step4/save-structure")
async def step4_save_structure(session_id: str, request: Request):
    """持久化教师对试卷结构的调整（增删改题号/分值/章节/知识点/难度）。"""
    state = load_session(session_id)
    if not state:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    body = await request.json()
    state["structure"] = body.get("structure", [])
    state["current_step"] = 4
    save_session(session_id, state)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
# Step 5: 命题生成 + 流式输出
# ═══════════════════════════════════════════════════════════

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

    papers_summary = ""
    for p in state.get("papers", []):
        papers_summary += f"\n### 真题: {p['filename']}\n```\n{p['text'][:6000]}\n```\n"

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
{papers_summary[:20000]}

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


@app.get("/api/session/{session_id}/step5/alternatives")
async def step5_alternatives(session_id: str, no: int = 0):
    """SSE — 针对某题 AI 生成 2~3 个备选变体。"""
    state = load_session(session_id)
    if not state:
        return StreamingResponse(
            iter([stream_sse("error", "会话不存在")]),
            media_type="text/event-stream",
        )

    questions = state.get("questions", [])
    question = next((q for q in questions if str(q.get("no")) == str(no)), {})
    system_prompt = read_skill_md()

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
        except Exception as e:
            yield stream_sse("error", str(e))

    return StreamingResponse(event_stream(), media_type="text/event-stream")

# ═══════════════════════════════════════════════════════════
# 文件下载
# ═══════════════════════════════════════════════════════════

@app.get("/api/session/{session_id}/download/{filename:path}")
async def download_file(session_id: str, filename: str):
    filepath = SESSIONS_DIR / session_id / "outputs" / filename
    if filepath.exists():
        return FileResponse(filepath, filename=filepath.name)
    return JSONResponse({"error": "文件不存在"}, status_code=404)


@app.get("/api/session/{session_id}/state")
async def get_state(session_id: str):
    state = load_session(session_id)
    if not state:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    clean = {k: v for k, v in state.items() if k not in ("knowledge_raw", "blueprint_raw")}
    if "papers" in clean:
        clean["papers"] = [
            {"filename": p["filename"], "size": p.get("size", 0), "text_length": p.get("text_length", 0)}
            for p in clean["papers"]
        ]
    return clean


# ═══════════════════════════════════════════════════════════
# 启动
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=2342, reload=True)
