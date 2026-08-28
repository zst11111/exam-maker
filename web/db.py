"""数据层 — SQLite 单文件（标准库 sqlite3，零依赖）。

表：questions（题库）、users（师生账号）、papers（我的试卷）、
distributions（分发）、submissions（答题+批改）。
"""
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
            source     TEXT DEFAULT 'teacher',
            exam_ref   TEXT,
            created_by TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL,
            name          TEXT NOT NULL,
            student_no    TEXT,
            class_name    TEXT,
            major         TEXT,
            created_at    TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS papers (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id     INTEGER NOT NULL,
            title          TEXT NOT NULL,
            subject        TEXT NOT NULL,
            duration       INTEGER,
            total_score    REAL,
            questions_json TEXT NOT NULL,
            created_at     TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS distributions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            paper_id   INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            created_at TEXT,
            UNIQUE(paper_id, student_id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            paper_id         INTEGER NOT NULL,
            student_id       INTEGER NOT NULL,
            answers_json     TEXT,
            photos_json      TEXT,
            status           TEXT NOT NULL DEFAULT 'submitted',
            total_score      REAL,
            ai_feedback_json TEXT,
            comment          TEXT,
            submitted_at     TEXT,
            graded_at        TEXT,
            UNIQUE(paper_id, student_id)
        )
    """)
    # 迁移：旧库补 comment 列（幂等）
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(submissions)").fetchall()]
    if "comment" not in cols:
        conn.execute("ALTER TABLE submissions ADD COLUMN comment TEXT")
    # 迁移：旧库补 is_practice 列（区分考试卷/练习卷，幂等）
    pcols = [r["name"] for r in conn.execute("PRAGMA table_info(papers)").fetchall()]
    if "is_practice" not in pcols:
        conn.execute("ALTER TABLE papers ADD COLUMN is_practice INTEGER DEFAULT 0")
    # 迁移：旧库补 remark / published / published_at（教师备注 + 成绩发布状态，幂等）
    pcols2 = [r["name"] for r in conn.execute("PRAGMA table_info(papers)").fetchall()]
    if "remark" not in pcols2:
        conn.execute("ALTER TABLE papers ADD COLUMN remark TEXT")
    if "published" not in pcols2:
        conn.execute("ALTER TABLE papers ADD COLUMN published INTEGER DEFAULT 0")
    if "published_at" not in pcols2:
        conn.execute("ALTER TABLE papers ADD COLUMN published_at TEXT")
    # 辅导员：旷课 / 请假 / 学业警告
    conn.execute("""
        CREATE TABLE IF NOT EXISTS attendance_records (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id  INTEGER NOT NULL,
            record_date TEXT NOT NULL,
            note        TEXT,
            created_by  TEXT,
            created_at  TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS leave_records (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id  INTEGER NOT NULL,
            start_date  TEXT NOT NULL,
            end_date    TEXT,
            reason      TEXT,
            created_by  TEXT,
            created_at  TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS warnings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id  INTEGER NOT NULL,
            reason      TEXT NOT NULL,
            level       TEXT DEFAULT '一般',
            source      TEXT DEFAULT 'manual',
            created_by  TEXT,
            created_at  TEXT
        )
    """)
    conn.commit()
    conn.close()


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


# ═══════════════════════════════════════════════════════════
# 题库（原有）
# ═══════════════════════════════════════════════════════════

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
        q.get("answer"), q.get("analysis"), q.get("source", "teacher"),
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
        q.get("answer"), q.get("analysis"), q.get("source", "teacher"),
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
    for key in ("subject", "type", "difficulty", "source"):
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


# ═══════════════════════════════════════════════════════════
# 账号（师生）
# ═══════════════════════════════════════════════════════════

def create_user(u: Dict[str, Any]) -> int:
    conn = get_conn()
    cur = conn.execute("""
        INSERT INTO users (username, password_hash, role, name, student_no, class_name, major, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        u["username"], u["password_hash"], u["role"], u["name"],
        u.get("student_no"), u.get("class_name"), u.get("major"), _now(),
    ))
    conn.commit()
    uid = cur.lastrowid
    conn.close()
    return uid


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def get_user(uid: int) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def list_students(class_name: str = "", major: str = "") -> List[Dict[str, Any]]:
    where, params = ["role = ?"], ["student"]
    if class_name:
        where.append("class_name = ?")
        params.append(class_name)
    if major:
        where.append("major = ?")
        params.append(major)
    sql = "SELECT id, username, name, student_no, class_name, major FROM users WHERE " + " AND ".join(where) + " ORDER BY class_name, student_no"
    conn = get_conn()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def count_students() -> int:
    conn = get_conn()
    row = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'student'").fetchone()
    conn.close()
    return row["c"]


# ═══════════════════════════════════════════════════════════
# 我的试卷
# ═══════════════════════════════════════════════════════════

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


def get_paper(pid: int) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM papers WHERE id = ?", (pid,)).fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def list_papers(teacher_id: int) -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM papers WHERE teacher_id = ? ORDER BY id DESC", (teacher_id,)
    ).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def delete_paper(pid: int) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM papers WHERE id = ?", (pid,))
    conn.execute("DELETE FROM distributions WHERE paper_id = ?", (pid,))
    conn.execute("DELETE FROM submissions WHERE paper_id = ?", (pid,))
    conn.commit()
    conn.close()


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


# ═══════════════════════════════════════════════════════════
# 分发
# ═══════════════════════════════════════════════════════════

def distribute(paper_id: int, student_ids: List[int]) -> int:
    conn = get_conn()
    now = _now()
    count = 0
    for sid in student_ids:
        cur = conn.execute(
            "INSERT OR IGNORE INTO distributions (paper_id, student_id, created_at) VALUES (?, ?, ?)",
            (paper_id, sid, now),
        )
        count += cur.rowcount
    conn.commit()
    conn.close()
    return count


def has_distribution(paper_id: int, student_id: int) -> bool:
    conn = get_conn()
    row = conn.execute(
        "SELECT 1 FROM distributions WHERE paper_id = ? AND student_id = ?", (paper_id, student_id)
    ).fetchone()
    conn.close()
    return row is not None


def list_distributions(paper_id: int) -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT u.id AS student_id, u.name, u.student_no, u.class_name, u.major,
               s.id AS sub_id, s.status, s.total_score, s.submitted_at
        FROM distributions d
        JOIN users u ON u.id = d.student_id
        LEFT JOIN submissions s ON s.paper_id = d.paper_id AND s.student_id = d.student_id
        WHERE d.paper_id = ?
        ORDER BY u.class_name, u.student_no
    """, (paper_id,)).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def list_student_papers(student_id: int) -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT p.id, p.title, p.subject, p.duration, p.total_score, p.created_at,
               p.is_practice, p.published,
               s.id AS sub_id, s.status AS sub_status, s.total_score AS score, s.submitted_at
        FROM distributions d
        JOIN papers p ON p.id = d.paper_id
        LEFT JOIN submissions s ON s.paper_id = p.id AND s.student_id = d.student_id
        WHERE d.student_id = ?
        ORDER BY d.id DESC
    """, (student_id,)).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


# ═══════════════════════════════════════════════════════════
# 答题 + 批改
# ═══════════════════════════════════════════════════════════

def create_submission(sub: Dict[str, Any]) -> int:
    conn = get_conn()
    cur = conn.execute("""
        INSERT INTO submissions (paper_id, student_id, answers_json, photos_json, status, submitted_at)
        VALUES (?, ?, ?, ?, 'submitted', ?)
    """, (
        sub["paper_id"], sub["student_id"], sub.get("answers_json", "[]"),
        sub.get("photos_json", "{}"), _now(),
    ))
    conn.commit()
    sid = cur.lastrowid
    conn.close()
    return sid


def get_submission(paper_id: int, student_id: int) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM submissions WHERE paper_id = ? AND student_id = ?", (paper_id, student_id)
    ).fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def get_submission_by_id(sid: int) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM submissions WHERE id = ?", (sid,)).fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def list_submissions(paper_id: int) -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT s.*, u.name, u.student_no, u.class_name, u.major
        FROM submissions s JOIN users u ON u.id = s.student_id
        WHERE s.paper_id = ?
        ORDER BY u.class_name, u.student_no
    """, (paper_id,)).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def update_submission_feedback(sid: int, feedback: List[Dict], total: float) -> None:
    import json as _json
    conn = get_conn()
    conn.execute("UPDATE submissions SET ai_feedback_json = ?, total_score = ? WHERE id = ?",
                 (_json.dumps(feedback, ensure_ascii=False), total, sid))
    conn.commit()
    conn.close()


def finalize_submission(sid: int, feedback: List[Dict], total: float, comment: str = "") -> None:
    import json as _json
    conn = get_conn()
    conn.execute("UPDATE submissions SET ai_feedback_json = ?, total_score = ?, comment = ?, status = 'graded', graded_at = ? WHERE id = ?",
                 (_json.dumps(feedback, ensure_ascii=False), total, comment, _now(), sid))
    conn.commit()
    conn.close()


def list_student_submissions(student_id: int) -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT s.*, p.title, p.subject
        FROM submissions s JOIN papers p ON p.id = s.paper_id
        WHERE s.student_id = ?
        ORDER BY s.id DESC
    """, (student_id,)).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


# ═══════════════════════════════════════════════════════════
# 练习卷
# ═══════════════════════════════════════════════════════════

def list_student_practice(student_id: int) -> List[Dict[str, Any]]:
    """学生被分发的练习卷（is_practice=1）及其完成状态。"""
    conn = get_conn()
    rows = conn.execute("""
        SELECT p.id AS paper_id, p.title, p.subject,
               s.id AS sub_id, s.status AS sub_status, s.total_score AS score
        FROM distributions d
        JOIN papers p ON p.id = d.paper_id AND p.is_practice = 1
        LEFT JOIN submissions s ON s.paper_id = p.id AND s.student_id = d.student_id
        WHERE d.student_id = ?
        ORDER BY d.id DESC
    """, (student_id,)).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


# ═══════════════════════════════════════════════════════════
# 考勤 / 请假 / 学业警告（辅导员）
# ═══════════════════════════════════════════════════════════

def create_attendance(student_id: int, record_date: str, note: str = "", created_by: str = "") -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO attendance_records (student_id, record_date, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
        (student_id, record_date, note, created_by, _now()))
    conn.commit()
    rid = cur.lastrowid
    conn.close()
    return rid


def list_attendance(student_id: int) -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM attendance_records WHERE student_id = ? ORDER BY record_date DESC, id DESC",
        (student_id,)).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def count_attendance(student_id: int) -> int:
    conn = get_conn()
    row = conn.execute("SELECT COUNT(*) AS c FROM attendance_records WHERE student_id = ?", (student_id,)).fetchone()
    conn.close()
    return row["c"]


def create_leave(student_id: int, start_date: str, end_date: str = "", reason: str = "", created_by: str = "") -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO leave_records (student_id, start_date, end_date, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (student_id, start_date, end_date, reason, created_by, _now()))
    conn.commit()
    rid = cur.lastrowid
    conn.close()
    return rid


def list_leave(student_id: int) -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM leave_records WHERE student_id = ? ORDER BY start_date DESC, id DESC",
        (student_id,)).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def count_leave(student_id: int) -> int:
    conn = get_conn()
    row = conn.execute("SELECT COUNT(*) AS c FROM leave_records WHERE student_id = ?", (student_id,)).fetchone()
    conn.close()
    return row["c"]


def create_warning(student_id: int, reason: str, level: str = "一般", source: str = "manual", created_by: str = "") -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO warnings (student_id, reason, level, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (student_id, reason, level, source, created_by, _now()))
    conn.commit()
    rid = cur.lastrowid
    conn.close()
    return rid


def create_warning_if_absent(student_id: int, reason: str, level: str, source: str, created_by: str = "") -> bool:
    """同学生+同原因+同来源的警告已存在则跳过，返回是否新建。"""
    conn = get_conn()
    row = conn.execute(
        "SELECT 1 FROM warnings WHERE student_id = ? AND reason = ? AND source = ?",
        (student_id, reason, source)).fetchone()
    if row:
        conn.close()
        return False
    conn.execute(
        "INSERT INTO warnings (student_id, reason, level, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (student_id, reason, level, source, created_by, _now()))
    conn.commit()
    conn.close()
    return True


def list_warnings(student_id: int) -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM warnings WHERE student_id = ? ORDER BY id DESC", (student_id,)).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def count_warnings(student_id: int) -> int:
    conn = get_conn()
    row = conn.execute("SELECT COUNT(*) AS c FROM warnings WHERE student_id = ?", (student_id,)).fetchone()
    conn.close()
    return row["c"]


def delete_record(table: str, rid: int) -> None:
    """删除考勤/请假/警告记录（table 白名单：attendance/leave/warning）。"""
    tbl = {"attendance": "attendance_records", "leave": "leave_records", "warning": "warnings"}.get(table)
    if not tbl:
        raise ValueError("非法记录类型")
    conn = get_conn()
    conn.execute(f"DELETE FROM {tbl} WHERE id = ?", (rid,))
    conn.commit()
    conn.close()


# ═══════════════════════════════════════════════════════════
# 用户管理（辅导员）
# ═══════════════════════════════════════════════════════════

def list_all_users() -> List[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT id, username, name, role, student_no, class_name, major, created_at
        FROM users ORDER BY CASE role WHEN 'teacher' THEN 0 WHEN 'counselor' THEN 1 ELSE 2 END, class_name, student_no, username
    """).fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def update_user(uid: int, u: Dict[str, Any]) -> None:
    conn = get_conn()
    conn.execute("UPDATE users SET username = ?, name = ?, student_no = ?, class_name = ?, major = ? WHERE id = ?",
                 (u["username"], u["name"], u.get("student_no"), u.get("class_name"), u.get("major"), uid))
    conn.commit()
    conn.close()


def update_user_password(uid: int, password_hash: str) -> None:
    conn = get_conn()
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, uid))
    conn.commit()
    conn.close()


def delete_user(uid: int) -> None:
    conn = get_conn()
    u = conn.execute("SELECT role FROM users WHERE id = ?", (uid,)).fetchone()
    if u and u["role"] == "teacher":
        # 教师删除时级联删除其名下试卷及关联分发/提交
        pids = [r["id"] for r in conn.execute("SELECT id FROM papers WHERE teacher_id = ?", (uid,)).fetchall()]
        for pid in pids:
            conn.execute("DELETE FROM papers WHERE id = ?", (pid,))
            conn.execute("DELETE FROM distributions WHERE paper_id = ?", (pid,))
            conn.execute("DELETE FROM submissions WHERE paper_id = ?", (pid,))
    conn.execute("DELETE FROM distributions WHERE student_id = ?", (uid,))
    conn.execute("DELETE FROM submissions WHERE student_id = ?", (uid,))
    conn.execute("DELETE FROM attendance_records WHERE student_id = ?", (uid,))
    conn.execute("DELETE FROM leave_records WHERE student_id = ?", (uid,))
    conn.execute("DELETE FROM warnings WHERE student_id = ?", (uid,))
    conn.execute("DELETE FROM users WHERE id = ?", (uid,))
    conn.commit()
    conn.close()
