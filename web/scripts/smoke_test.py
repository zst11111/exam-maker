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
import auth  # teacher_b 造号用（hash_password 生成 password_hash）

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
        "is_wrong_push": 1,
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

    # 7) 教师隔离（G2）：teacher_b 看不到 teacher 的卷
    tb_id = db.create_user({
        "username": "teacher_b_smoke", "password_hash": auth.hash_password("123456"),
        "role": "teacher", "name": "老师乙",
    })
    try:
        tb = login({"username": "teacher_b_smoke", "password": "123456"})
        plb = req("GET", "/api/papers", tb)["papers"]
        assert all(x["id"] != pid for x in plb), "teacher_b 不应看到 teacher 的正式卷"
        assert all(x["id"] != prac for x in plb), "teacher_b 不应看到 teacher 的练习卷"
        try:
            req("GET", f"/api/papers/{pid}", tb)
            raise AssertionError("teacher_b 访问他人正式卷应 404")
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        db.delete_user(tb_id)

    # 8) 数据契约（考情/详情/箱线图依赖）：distributions 含状态与得分
    #    确定性造第二名学生并分发，覆盖「未作答行 sub_id 为 None」契约（不 fail-open）
    sb_id = db.create_user({
        "username": "smoke_student_b", "password_hash": auth.hash_password("123456"),
        "role": "student", "name": "冒烟学生乙",
        "student_no": "SMOKE002", "class_name": "冒烟班", "major": "冒烟",
    })
    try:
        req("POST", f"/api/papers/{pid}/distribute", t, body={"student_ids": [sb_id]})
        pl3 = req("GET", "/api/papers", t)["papers"]
        p3 = next(x for x in pl3 if x["id"] == pid)
        dists = p3["distributions"]
        assert dists, "distributions 应非空"
        for d in dists:
            assert d.get("student_id") and d.get("name"), "distributions 行缺 student_id/name"
            assert "student_no" in d and "class_name" in d and "major" in d, "distributions 行缺字段"
            assert "sub_id" in d and "status" in d and "total_score" in d, "distributions 行缺状态字段"
            if d["status"] == "graded":
                assert d["sub_id"] is not None and d["total_score"] == 5.0, "已批改行 sub_id/score 契约不符"
            elif d["status"] is None:
                assert d["sub_id"] is None and d["total_score"] is None, "未作答行 sub_id/score 契约不符"
        scored = [d["total_score"] for d in dists if d["status"] == "graded"]
        assert len(scored) == 1, "已批改人数应为 1"
        graded_row = next(d for d in dists if d["status"] == "graded")
        assert graded_row["sub_id"] == subid, "distributions.sub_id 应与 submissions.id 一致（批改卡 id 契约）"
        # submitted（已提交未批改）：练习卷 prac 已提交未批改，sub_id 非空、total_score 为 None
        p3p = next(x for x in pl3 if x["id"] == prac)
        sub_rows = [d for d in p3p["distributions"] if d["status"] == "submitted"]
        assert sub_rows, "练习卷应存在 status=='submitted'（已提交未批改）行"
        assert all(d["sub_id"] is not None and d["total_score"] is None for d in sub_rows), "submitted 行契约不符"
    finally:
        db.delete_user(sb_id)

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

    # 清理
    req("DELETE", f"/api/papers/{pid}", t)
    req("DELETE", f"/api/papers/{prac}", t)
    print("SMOKE OK: 全部断言通过")


if __name__ == "__main__":
    main()
