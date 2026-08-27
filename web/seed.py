"""种子数据 — 教师 1 名 + 学生 6 名（3 班 × 每班 2 人，3 个不同专业）。

学号 = 2026 + 班级(2位) + 序号(2位)。幂等：已存在则跳过。
"""
import auth
import db

_STUDENTS = [
    ("20260101", "张三", "1班", "数学"),
    ("20260102", "李四", "1班", "数学"),
    ("20260201", "王五", "2班", "物理"),
    ("20260202", "赵六", "2班", "物理"),
    ("20260301", "孙七", "3班", "化学"),
    ("20260302", "周八", "3班", "化学"),
]


def seed() -> None:
    if not db.get_user_by_username("teacher"):
        db.create_user({
            "username": "teacher", "password_hash": auth.hash_password("123456"),
            "role": "teacher", "name": "张老师",
        })
    if not db.get_user_by_username("counselor"):
        db.create_user({
            "username": "counselor", "password_hash": auth.hash_password("123456"),
            "role": "counselor", "name": "辅导员",
        })
    for no, name, cls, major in _STUDENTS:
        if not db.get_user_by_username(no):
            db.create_user({
                "username": no, "password_hash": auth.hash_password("123456"),
                "role": "student", "name": name,
                "student_no": no, "class_name": cls, "major": major,
            })


if __name__ == "__main__":
    db.init_db()
    seed()
    print("seed done")
