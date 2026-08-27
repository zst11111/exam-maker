#!/bin/bash
# exam-maker 启动脚本
# 用法: bash start.sh

# conda 环境 exam_env 的 python
PYTHON="/root/miniconda3/envs/exam_env/bin/python"

if [ ! -x "$PYTHON" ]; then
    echo "错误: 找不到 conda 环境 exam_env 的 Python（$PYTHON）"
    echo "请先创建并安装依赖："
    echo "  conda create -n exam_env python=3.11 -y"
    echo "  conda activate exam_env && pip install -r requirements.txt"
    exit 1
fi

echo "使用 Python: $PYTHON"
echo "启动 exam-maker 服务: http://localhost:2342"
echo "按 Ctrl+C 停止"
echo ""

cd "$(dirname "$0")"
exec "$PYTHON" -m uvicorn app:app --host 0.0.0.0 --port 2342
