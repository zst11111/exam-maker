"""题库路由 /api/questionbank/* — 增删改查 + 筛选 + 批量导入。"""
from typing import List

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
    source: str = "teacher"
    exam_ref: str = None


class ImportIn(BaseModel):
    questions: List[QuestionIn]


@router.get("/list")
async def list_questions(subject: str = "", type: str = "", difficulty: str = "", chapter: str = "", topic: str = "", source: str = ""):
    filters = {"subject": subject, "type": type, "difficulty": difficulty, "chapter": chapter, "topic": topic, "source": source}
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
