"""鉴权 — 密码哈希（标准库）、token 签发/校验、依赖注入。"""
import hashlib
import os
import secrets

from fastapi import HTTPException, Request

_ITERATIONS = 100000


def hash_password(password: str, salt: bytes = None) -> str:
    if salt is None:
        salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return salt.hex() + "$" + h.hex()


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, h_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
        return secrets.compare_digest(h.hex(), h_hex)
    except Exception:
        return False


# 内存态 token -> user 摘要（demo 够用；重启需重新登录）
_tokens: dict = {}


def issue_token(user: dict) -> str:
    token = secrets.token_hex(32)
    _tokens[token] = {
        "id": user["id"],
        "role": user["role"],
        "name": user["name"],
        "student_no": user.get("student_no"),
        "class_name": user.get("class_name"),
        "major": user.get("major"),
    }
    return token


def revoke_token(token: str) -> None:
    _tokens.pop(token, None)


def require_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        user = _tokens.get(auth[7:])
        if user:
            return user
    raise HTTPException(status_code=401, detail="未登录或登录已过期")


def require_role(request: Request, role: str) -> dict:
    user = require_user(request)
    if user["role"] != role:
        raise HTTPException(status_code=403, detail="无权限")
    return user


def require_any_role(request: Request, roles) -> dict:
    """要求用户属于给定角色集合之一（如教师/辅导员共用学情）。"""
    user = require_user(request)
    if user["role"] not in roles:
        raise HTTPException(status_code=403, detail="无权限")
    return user
