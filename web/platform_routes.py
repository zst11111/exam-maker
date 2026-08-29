"""平台路由 — 鉴权 + 我的试卷 + 分发 + 学生端 + 批改 + 学情 + 拍照上传。"""
import json
import re
import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

import auth
import db

router = APIRouter(prefix="/api", tags=["platform"])

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
MAX_UPLOAD = 5 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _json_loads(s, default):
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default


# ═══════════════════════════════════════════════════════════
# 鉴权
# ═══════════════════════════════════════════════════════════

class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
async def login(body: LoginIn):
    u = db.get_user_by_username(body.username)
    if not u or not auth.verify_password(body.password, u["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = auth.issue_token(u)
    return {
        "token": token, "role": u["role"], "name": u["name"], "user_id": u["id"],
        "student_no": u.get("student_no"), "class_name": u.get("class_name"), "major": u.get("major"),
    }


@router.post("/auth/logout")
async def logout(request: Request):
    h = request.headers.get("authorization", "")
    if h.startswith("Bearer "):
        auth.revoke_token(h[7:])
    return {"ok": True}


@router.get("/auth/me")
async def me(request: Request):
    return auth.require_user(request)


# ═══════════════════════════════════════════════════════════
# 我的试卷（教师）
# ═══════════════════════════════════════════════════════════

class PaperIn(BaseModel):
    title: str = ""
    subject: str = ""
    duration: int = 120
    total_score: float = 0
    questions: List[dict] = []
    remark: str = ""


@router.post("/papers")
async def create_paper(body: PaperIn, request: Request):
    u = auth.require_role(request, "teacher")
    pid = db.create_paper({
        "teacher_id": u["id"], "title": body.title, "subject": body.subject,
        "duration": body.duration, "total_score": body.total_score,
        "questions_json": json.dumps(body.questions, ensure_ascii=False),
        "remark": body.remark,
    })
    return {"id": pid}


@router.get("/papers")
async def list_papers(request: Request):
    u = auth.require_role(request, "teacher")
    papers = db.list_papers(u["id"])
    out = []
    for p in papers:
        qs = _json_loads(p["questions_json"], [])
        dists = db.list_distributions(p["id"])
        subs = db.list_submissions(p["id"])
        out.append({
            "id": p["id"], "title": p["title"], "subject": p["subject"],
            "duration": p["duration"], "total_score": p["total_score"],
            "created_at": p["created_at"], "is_practice": bool(p.get("is_practice")),
            "is_wrong_push": bool(p.get("is_wrong_push")),
            "remark": p.get("remark"),
            "published": bool(p.get("published")),
            "published_at": p.get("published_at"),
            "question_count": len(qs),
            "distributed_count": len(dists),
            "submitted_count": len(subs),
            "graded_count": sum(1 for s in subs if s["status"] == "graded"),
            "distributions": dists,
            "first_distributed_at": min((x.get("distributed_at") for x in dists if x.get("distributed_at")), default=None),
        })
    return {"papers": out}


@router.get("/papers/{pid}")
async def get_paper(pid: int, request: Request):
    u = auth.require_role(request, "teacher")
    p = db.get_paper(pid)
    if not p or p["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    p["questions"] = _json_loads(p["questions_json"], [])
    p.pop("questions_json", None)
    return p


@router.delete("/papers/{pid}")
async def delete_paper(pid: int, request: Request):
    u = auth.require_role(request, "teacher")
    p = db.get_paper(pid)
    if not p or p["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    db.delete_paper(pid)
    return {"ok": True}


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


# ═══════════════════════════════════════════════════════════
# 学生 + 分发（教师）
# ═══════════════════════════════════════════════════════════

@router.get("/students")
async def list_students(class_name: str = "", major: str = "", request: Request = None):
    auth.require_role(request, "teacher")
    return {"students": db.list_students(class_name, major)}


class DistributeIn(BaseModel):
    student_ids: List[int] = []


@router.post("/papers/{pid}/distribute")
async def distribute(pid: int, body: DistributeIn, request: Request):
    u = auth.require_role(request, "teacher")
    p = db.get_paper(pid)
    if not p or p["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    n = db.distribute(pid, body.student_ids)
    return {"distributed": n}


@router.get("/papers/{pid}/distributions")
async def list_distributions(pid: int, request: Request):
    u = auth.require_role(request, "teacher")
    p = db.get_paper(pid)
    if not p or p["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    return {"distributions": db.list_distributions(pid)}


# ═══════════════════════════════════════════════════════════
# 学生端
# ═══════════════════════════════════════════════════════════

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


@router.get("/student/papers/{pid}")
async def student_get_paper(pid: int, request: Request):
    u = auth.require_role(request, "student")
    if not db.has_distribution(pid, u["id"]):
        raise HTTPException(status_code=404, detail="该试卷未分发给你")
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
            "ai_feedback": _json_loads(sub["ai_feedback_json"], []) if score_visible else [],
            "answers": _json_loads(sub["answers_json"], []),
            "photos": _json_loads(sub["photos_json"], {}),
            "comment": (sub.get("comment") or "") if score_visible else "",
            "submitted_at": sub["submitted_at"],
        }
    else:
        p["submission"] = None
    p.pop("remark", None)
    p.pop("published_at", None)
    p.pop("teacher_id", None)
    return p


class SubmitIn(BaseModel):
    answers: List[dict] = []
    photos: dict = {}


@router.post("/student/papers/{pid}/submit")
async def student_submit(pid: int, body: SubmitIn, request: Request):
    u = auth.require_role(request, "student")
    if not db.has_distribution(pid, u["id"]):
        raise HTTPException(status_code=404, detail="该试卷未分发给你")
    if db.get_submission(pid, u["id"]):
        raise HTTPException(status_code=409, detail="已提交，请等待批改")
    sid = db.create_submission({
        "paper_id": pid, "student_id": u["id"],
        "answers_json": json.dumps(body.answers, ensure_ascii=False),
        "photos_json": json.dumps(body.photos, ensure_ascii=False),
    })
    return {"id": sid, "status": "submitted"}


@router.post("/upload")
async def upload_photo(file: UploadFile = File(...), request: Request = None):
    auth.require_role(request, "student")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 jpg/png/webp 图片")
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=400, detail="图片不能超过 5MB")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[file.content_type]
    stu_dir = UPLOAD_DIR / str(auth.require_user(request)["id"])
    stu_dir.mkdir(exist_ok=True)
    fname = f"{uuid.uuid4().hex}.{ext}"
    (stu_dir / fname).write_bytes(data)
    return {"path": f"/uploads/{auth.require_user(request)['id']}/{fname}"}


# ═══════════════════════════════════════════════════════════
# 批改（教师）
# ═══════════════════════════════════════════════════════════

@router.get("/papers/{pid}/submissions")
async def list_submissions(pid: int, request: Request):
    u = auth.require_role(request, "teacher")
    p = db.get_paper(pid)
    if not p or p["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    subs = db.list_submissions(pid)
    for s in subs:
        s["answers"] = _json_loads(s["answers_json"], [])
        s["photos"] = _json_loads(s["photos_json"], {})
        s["ai_feedback"] = _json_loads(s["ai_feedback_json"], [])
        s.pop("answers_json", None)
        s.pop("photos_json", None)
        s.pop("ai_feedback_json", None)
    return {"questions": _json_loads(p["questions_json"], []), "submissions": subs}


def _obj_correct(a, ref):
    a = (a or "").strip()
    ref = (ref or "").strip()
    if not a:
        return False
    if a == ref:
        return True
    if len(a) <= 2 and ref:
        return a[0].upper() == ref[0].upper()
    return False


def _ai_grade_subjective(items):
    from app import get_client, get_model, parse_json_block
    client = get_client()
    model = get_model()
    user_prompt = f"""请批改以下主观题。每题给出：得分（0 到满分，整数或一位小数）、简短评语、是否正确(bool)。

## 题目与学生文字答案
```json
{json.dumps(items, ensure_ascii=False)}
```

严格按 JSON 返回（不要其他文字）：
```json
{{"results": [{{"no": 1, "score": 3.5, "comment": "评语", "correct": true}}]}}
```"""
    resp = client.chat.completions.create(
        model=model, max_tokens=8000, temperature=0.3,
        messages=[
            {"role": "system", "content": "你是严谨的阅卷老师。只对文字答案判分，给出客观分数与简短评语。"},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw = resp.choices[0].message.content or ""
    parsed = parse_json_block(raw)
    return parsed.get("results", []) if isinstance(parsed, dict) else []


@router.post("/submissions/{sid}/grade")
async def grade_submission(sid: int, request: Request):
    auth.require_role(request, "teacher")
    sub = db.get_submission_by_id(sid)
    if not sub:
        raise HTTPException(status_code=404, detail="提交不存在")
    paper = db.get_paper(sub["paper_id"])
    questions = _json_loads(paper["questions_json"], [])
    answers = _json_loads(sub["answers_json"], [])
    photos = _json_loads(sub["photos_json"], {})
    amap = {str(a.get("no")): a for a in answers}

    feedback = []
    subjective = []
    for q in questions:
        no = q.get("no")
        a = amap.get(str(no), {})
        atext = (a.get("answer_text") or "").strip()
        has_photo = bool((photos or {}).get(str(no)))
        qtype = q.get("type", "")
        max_score = q.get("score", 0)
        if qtype in ("选择题", "填空题"):
            correct = _obj_correct(atext, q.get("answer", ""))
            feedback.append({"no": no, "score": max_score if correct else 0, "max": max_score,
                             "comment": "正确" if correct else "错误",
                             "correct": correct, "graded_by": "auto"})
        else:
            if atext:
                subjective.append({"no": no, "max": max_score, "content": q.get("content", ""),
                                   "answer": q.get("answer", ""), "student_answer": atext})
            elif has_photo:
                feedback.append({"no": no, "score": None, "max": max_score,
                                 "comment": "拍照作答，请老师手动评分", "correct": None, "graded_by": "manual"})
            else:
                feedback.append({"no": no, "score": 0, "max": max_score,
                                 "comment": "未作答", "correct": False, "graded_by": "auto"})

    if subjective:
        try:
            ai_results = _ai_grade_subjective(subjective)
        except Exception as e:
            ai_results = []
            for it in subjective:
                feedback.append({"no": it["no"], "score": None, "max": it["max"],
                                 "comment": f"AI 判分失败：{e}", "correct": None, "graded_by": "manual"})
        by_no = {str(r.get("no")): r for r in ai_results}
        for it in subjective:
            r = by_no.get(str(it["no"]), {})
            score = r.get("score")
            if score is not None:
                try:
                    score = float(score)
                except (TypeError, ValueError):
                    score = None
            feedback.append({"no": it["no"], "score": score, "max": it["max"],
                             "comment": r.get("comment", ""), "correct": r.get("correct"),
                             "graded_by": "ai"})

    total = sum((f.get("score") or 0) for f in feedback)
    db.update_submission_feedback(sid, feedback, total)
    return {"feedback": feedback, "total_score": total}


class FinalizeIn(BaseModel):
    feedback: List[dict] = []
    total_score: float = 0
    comment: str = ""


@router.post("/submissions/{sid}/finalize")
async def finalize_submission(sid: int, body: FinalizeIn, request: Request):
    auth.require_role(request, "teacher")
    if not db.get_submission_by_id(sid):
        raise HTTPException(status_code=404, detail="提交不存在")
    db.finalize_submission(sid, body.feedback, body.total_score, body.comment)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
# 按错题知识点推题（教师）
# ═══════════════════════════════════════════════════════════

class PracticeIn(BaseModel):
    question_ids: List[int] = []


def _topic_keywords(topic):
    """从知识点文本提取关键词集合（核心词 + 括号内分词），用于模糊匹配。"""
    if not topic:
        return set()
    s = str(topic).strip()
    kws = set()
    core = re.split(r'[（(]', s)[0]
    parts = [core] + re.findall(r'[（(](.*?)[)）]', s)
    for p in parts:
        for tok in re.split(r'[、，,/·与及和\s]+', p):
            tok = tok.strip()
            if len(tok) >= 2:
                kws.add(tok)
    return kws


def _practice_wrong_topics(sub, paper):
    """从批改反馈里找出错题对应的知识点，返回 (wrong_nos, topics, subject, candidates)。"""
    questions = _json_loads(paper["questions_json"], [])
    feedback = _json_loads(sub["ai_feedback_json"], [])
    wrong_nos = set()
    for f in feedback:
        score, maxs = f.get("score"), f.get("max")
        try:
            got = float(score) if score is not None else None
            full = float(maxs) if maxs is not None else None
        except (TypeError, ValueError):
            got, full = None, None
        if f.get("correct") is False or (got is not None and full and got < full):
            wrong_nos.add(str(f.get("no")))
    qmap = {str(q.get("no")): q for q in questions}
    topics = sorted({qmap[no].get("topic") for no in wrong_nos if no in qmap and qmap[no].get("topic")})
    subject = (questions[0].get("subject") or "") if questions else ""

    # 关键词模糊匹配：错题知识点与题库知识点只要共享关键词即视为相关
    kws = set()
    for t in topics:
        kws |= _topic_keywords(t)
    seen_content = {q.get("content") for q in questions}  # 排除试卷里原题
    candidates = []
    if kws:
        for q in db.list_questions({}):
            bt = (q.get("topic") or "").strip()
            if bt and (_topic_keywords(bt) & kws) and q.get("content") not in seen_content:
                candidates.append(q)
    return wrong_nos, topics, subject, candidates


@router.get("/submissions/{sid}/practice")
async def practice_candidates(sid: int, request: Request):
    u = auth.require_role(request, "teacher")
    sub = db.get_submission_by_id(sid)
    if not sub:
        raise HTTPException(status_code=404, detail="提交不存在")
    paper = db.get_paper(sub["paper_id"])
    if not paper or paper["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    wrong_nos, topics, subject, candidates = _practice_wrong_topics(sub, paper)
    student = db.get_user(sub["student_id"])
    return {
        "student": {"id": student["id"], "name": student["name"], "class_name": student.get("class_name")},
        "subject": subject,
        "wrong_topics": topics,
        "wrong_count": len(wrong_nos),
        "candidates": candidates,
    }


@router.post("/submissions/{sid}/practice")
async def create_practice(sid: int, body: PracticeIn, request: Request):
    u = auth.require_role(request, "teacher")
    sub = db.get_submission_by_id(sid)
    if not sub:
        raise HTTPException(status_code=404, detail="提交不存在")
    paper = db.get_paper(sub["paper_id"])
    if not paper or paper["teacher_id"] != u["id"]:
        raise HTTPException(status_code=404, detail="试卷不存在")
    if not body.question_ids:
        raise HTTPException(status_code=400, detail="请至少选择一道题")
    student = db.get_user(sub["student_id"])
    score_by_type = {"选择题": 5, "填空题": 5, "计算题": 10, "证明题": 10, "简答题": 10}
    pquestions = []
    for qid in body.question_ids:
        q = db.get_question(qid)
        if not q:
            continue
        pquestions.append({
            "no": len(pquestions) + 1,
            "type": q["type"],
            "score": score_by_type.get(q["type"], 10),
            "chapter": q.get("chapter"),
            "topic": q.get("topic"),
            "difficulty": q.get("difficulty"),
            "content": q["content"],
            "answer": q.get("answer"),
            "analysis": q.get("analysis"),
        })
    if not pquestions:
        raise HTTPException(status_code=400, detail="所选题目不存在")
    total = sum(pq["score"] for pq in pquestions)
    title = f"{student['name']}·错题巩固（{paper['subject']}）"
    pid = db.create_paper({
        "teacher_id": u["id"], "title": title, "subject": paper["subject"],
        "duration": 60, "total_score": total,
        "questions_json": json.dumps(pquestions, ensure_ascii=False),
        "is_practice": 1,
        "is_wrong_push": 1,
    })
    db.distribute(pid, [sub["student_id"]])
    return {"id": pid, "title": title, "count": len(pquestions), "total_score": total}


# ═══════════════════════════════════════════════════════════
# 学情（教师）
# ═══════════════════════════════════════════════════════════

@router.get("/analytics")
async def analytics(class_name: str = "", major: str = "", paper_id: int = 0, request: Request = None):
    auth.require_any_role(request, ["teacher", "counselor"])
    # 按试卷筛选：只返回被分发该卷的学生，及其在该卷的完成状态
    if paper_id:
        dists = db.list_distributions(paper_id)
        return {"students": [
            {
                "id": d["student_id"], "name": d["name"], "student_no": d["student_no"],
                "class_name": d["class_name"], "major": d["major"],
                "paper_status": d["status"] or "none",
                "paper_score": d["total_score"],
                "paper_submitted_at": d["submitted_at"],
            }
            for d in dists
        ], "paper_id": paper_id}

    students = db.list_students(class_name, major)
    for st in students:
        subs = db.list_student_submissions(st["id"])
        graded = [s for s in subs if s["status"] == "graded"]
        scores = [s["total_score"] for s in graded if s["total_score"] is not None]
        st["submitted_count"] = len(subs)
        st["avg_score"] = round(sum(scores) / len(scores), 1) if scores else None
        st["last_score"] = scores[0] if scores else None
        st["submissions"] = [
            {"id": s["id"], "paper_id": s["paper_id"], "title": s["title"], "subject": s["subject"],
             "status": s["status"], "total_score": s["total_score"], "paper_total": s["paper_total"],
             "ai_feedback": _json_loads(s["ai_feedback_json"], []), "submitted_at": s["submitted_at"]}
            for s in subs
        ]
        st["practice"] = db.list_student_practice(st["id"])
        st["attendance_count"] = db.count_attendance(st["id"])
        st["leave_count"] = db.count_leave(st["id"])
        st["warning_count"] = db.count_warnings(st["id"])
    return {"students": students}


@router.get("/counselor/exam-overview")
async def counselor_exam_overview(request: Request):
    """辅导员学业管理：全部正式考试按班级聚合（均分 / 提交人数 / 总人数）。"""
    auth.require_role(request, "counselor")
    out = []
    for p in db.list_all_papers():
        if p.get("is_practice"):
            continue
        dists = db.list_distributions(p["id"])
        if not dists:
            continue
        groups: Dict[str, List] = {}
        for d in dists:
            key = (d.get("class_name") or "未分班", d.get("major") or "")
            groups.setdefault(key, []).append(d)
        classes = []
        for (cn, mj), rows in groups.items():
            scores = [r["total_score"] for r in rows
                      if r["status"] == "graded" and r["total_score"] is not None]
            classes.append({
                "class_name": cn,
                "major": mj,
                "total": len(rows),
                "submitted": sum(1 for r in rows if r["status"]),
                "graded": sum(1 for r in rows if r["status"] == "graded"),
                "avg": round(sum(scores) / len(scores), 1) if scores else None,
            })
        out.append({
            "paper_id": p["id"], "title": p["title"], "subject": p["subject"],
            "total_score": p["total_score"], "published": bool(p.get("published")),
            "classes": classes,
        })
    return {"papers": out}


# ═══════════════════════════════════════════════════════════
# 学生端：考勤 / 请假 / 学业警告（本人可见）
# ═══════════════════════════════════════════════════════════

@router.get("/student/records")
async def student_records(request: Request):
    u = auth.require_role(request, "student")
    return {
        "attendance": db.list_attendance(u["id"]),
        "leave": db.list_leave(u["id"]),
        "warnings": db.list_warnings(u["id"]),
    }


# ═══════════════════════════════════════════════════════════
# 辅导员：账号管理 + 考勤/请假/警告 + 自动检测
# ═══════════════════════════════════════════════════════════

class CounselorUserIn(BaseModel):
    role: str = "student"          # student / teacher
    username: str = ""
    name: str = ""
    password: str = ""
    student_no: str = ""
    class_name: str = ""
    major: str = ""


class CounselorUserUpdate(BaseModel):
    username: str = ""
    name: str = ""
    student_no: str = ""
    class_name: str = ""
    major: str = ""


class ResetPasswordIn(BaseModel):
    password: str = ""


class AttendanceIn(BaseModel):
    record_date: str = ""
    note: str = ""


class LeaveIn(BaseModel):
    start_date: str = ""
    end_date: str = ""
    reason: str = ""


class WarningIn(BaseModel):
    reason: str = ""
    level: str = "一般"


@router.get("/counselor/users")
async def counselor_users(request: Request):
    auth.require_role(request, "counselor")
    return {"users": db.list_all_users()}


@router.post("/counselor/users")
async def counselor_create_user(body: CounselorUserIn, request: Request):
    auth.require_role(request, "counselor")
    if body.role not in ("student", "teacher"):
        raise HTTPException(status_code=400, detail="角色只能是 student 或 teacher")
    if not body.username or not body.name or not body.password:
        raise HTTPException(status_code=400, detail="用户名、姓名、密码必填")
    if db.get_user_by_username(body.username):
        raise HTTPException(status_code=409, detail="用户名已存在")
    uid = db.create_user({
        "username": body.username, "password_hash": auth.hash_password(body.password),
        "role": body.role, "name": body.name,
        "student_no": body.student_no or (body.username if body.role == "student" else ""),
        "class_name": body.class_name, "major": body.major,
    })
    return {"id": uid}


@router.put("/counselor/users/{uid}")
async def counselor_update_user(uid: int, body: CounselorUserUpdate, request: Request):
    auth.require_role(request, "counselor")
    target = db.get_user(uid)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if body.username and body.username != target["username"] and db.get_user_by_username(body.username):
        raise HTTPException(status_code=409, detail="用户名已存在")
    db.update_user(uid, {
        "username": body.username or target["username"],
        "name": body.name or target["name"],
        "student_no": body.student_no,
        "class_name": body.class_name,
        "major": body.major,
    })
    return {"ok": True}


@router.post("/counselor/users/{uid}/reset-password")
async def counselor_reset_password(uid: int, body: ResetPasswordIn, request: Request):
    auth.require_role(request, "counselor")
    if not db.get_user(uid):
        raise HTTPException(status_code=404, detail="用户不存在")
    if not body.password or len(body.password) < 4:
        raise HTTPException(status_code=400, detail="密码至少 4 位")
    db.update_user_password(uid, auth.hash_password(body.password))
    return {"ok": True}


@router.delete("/counselor/users/{uid}")
async def counselor_delete_user(uid: int, request: Request):
    me = auth.require_role(request, "counselor")
    if uid == me["id"]:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")
    target = db.get_user(uid)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target["role"] == "counselor":
        raise HTTPException(status_code=400, detail="不能删除辅导员账号")
    db.delete_user(uid)
    return {"ok": True}


@router.get("/counselor/students/{uid}/records")
async def counselor_student_records(uid: int, request: Request):
    auth.require_role(request, "counselor")
    if not db.get_user(uid):
        raise HTTPException(status_code=404, detail="学生不存在")
    return {
        "attendance": db.list_attendance(uid),
        "leave": db.list_leave(uid),
        "warnings": db.list_warnings(uid),
    }


@router.post("/counselor/students/{uid}/attendance")
async def counselor_add_attendance(uid: int, body: AttendanceIn, request: Request):
    u = auth.require_role(request, "counselor")
    if not db.get_user(uid):
        raise HTTPException(status_code=404, detail="学生不存在")
    if not body.record_date:
        raise HTTPException(status_code=400, detail="请填写日期")
    return {"id": db.create_attendance(uid, body.record_date, body.note, u["name"])}


@router.post("/counselor/students/{uid}/leave")
async def counselor_add_leave(uid: int, body: LeaveIn, request: Request):
    u = auth.require_role(request, "counselor")
    if not db.get_user(uid):
        raise HTTPException(status_code=404, detail="学生不存在")
    if not body.start_date:
        raise HTTPException(status_code=400, detail="请填写开始日期")
    return {"id": db.create_leave(uid, body.start_date, body.end_date, body.reason, u["name"])}


@router.post("/counselor/students/{uid}/warning")
async def counselor_add_warning(uid: int, body: WarningIn, request: Request):
    u = auth.require_role(request, "counselor")
    if not db.get_user(uid):
        raise HTTPException(status_code=404, detail="学生不存在")
    if not body.reason:
        raise HTTPException(status_code=400, detail="请填写警告原因")
    return {"id": db.create_warning(uid, body.reason, body.level or "一般", "manual", u["name"])}


@router.delete("/counselor/records/{table}/{rid}")
async def counselor_delete_record(table: str, rid: int, request: Request):
    auth.require_role(request, "counselor")
    try:
        db.delete_record(table, rid)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法记录类型")
    return {"ok": True}


@router.post("/counselor/auto-detect")
async def counselor_auto_detect(request: Request):
    u = auth.require_role(request, "counselor")
    created = []
    for st in db.list_students():
        # 规则1：旷课 >= 3 次
        att = db.count_attendance(st["id"])
        if att >= 3:
            reason = f"旷课达 {att} 次，触发学业警告"
            if db.create_warning_if_absent(st["id"], reason, "较重", "auto", u["name"]):
                created.append({"student": st["name"], "reason": reason})
        # 规则2：已批改均分 < 60
        subs = db.list_student_submissions(st["id"])
        graded = [s for s in subs if s["status"] == "graded" and s["total_score"] is not None]
        if graded:
            avg = sum(s["total_score"] for s in graded) / len(graded)
            if avg < 60:
                reason = f"已批改试卷均分 {avg:.1f} 分，低于 60，触发学业警告"
                if db.create_warning_if_absent(st["id"], reason, "一般", "auto", u["name"]):
                    created.append({"student": st["name"], "reason": reason})
    return {"created": created}
