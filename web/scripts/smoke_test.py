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
