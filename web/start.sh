#!/bin/bash
# exam-maker 启动脚本
# 用法: bash start.sh

# python 探测优先级：conda exam_env > 项目内 .venv > 系统 python3
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "/root/miniconda3/envs/exam_env/bin/python" ]; then
    PYTHON="/root/miniconda3/envs/exam_env/bin/python"
elif [ -x "$SCRIPT_DIR/.venv/bin/python" ]; then
    PYTHON="$SCRIPT_DIR/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON="$(command -v python3)"
else
    echo "错误: 找不到 python3"
    exit 1
fi

# 端口：默认 80（可 PORT=xxxx 覆盖），0.0.0.0 绑定使局域网/公网可访问
PORT="${PORT:-80}"

echo "使用 Python: $PYTHON"
echo "启动 exam-maker 服务: http://0.0.0.0:${PORT}"
echo "按 Ctrl+C 停止"
echo ""

cd "$(dirname "$0")"
exec "$PYTHON" -m uvicorn app:app --host 0.0.0.0 --port "$PORT"
