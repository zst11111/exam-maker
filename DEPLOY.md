# 部署说明（阿里云 ECS）

exam-maker 命题平台部署在**阿里云 ECS**（Ubuntu），用 **systemd 常驻** + **端口 80**，开机自启、崩溃自动重启。

## 访问地址

- **http://120.26.28.147**（公网，无需端口后缀）
- 局域网/本机：`http://<服务器IP>:80`

> 前端 API 全部走相对路径，无写死 IP/端口，任意主机访问都正常。

## 服务管理（SSH 到服务器后执行）

```bash
systemctl status  exam-maker      # 查看状态（active = 运行中）
systemctl restart exam-maker      # 重启
systemctl stop    exam-maker      # 停止
systemctl start   exam-maker      # 启动
journalctl -u exam-maker -f       # 实时日志
journalctl -u exam-maker -n 50    # 最近 50 行日志
```

- 服务定义：`/etc/systemd/system/exam-maker.service`
- 启动脚本：`web/start.sh`（自动探测 python：conda exam_env > 项目 web/.venv > 系统 python3）

## 端口配置

- 默认监听 **0.0.0.0:80**。
- 换端口：改 `/etc/systemd/system/exam-maker.service` 里的 `Environment=PORT=xxxx`，然后 `systemctl daemon-reload && systemctl restart exam-maker`。
- 直接跑（调试用）：`PORT=8080 bash web/start.sh` 或 `python app.py`。

## 阿里云安全组（访问不了时查这里）

服务器内防火墙（ufw/iptables）不影响入站，**阿里云安全组**才是关键：

1. 阿里云控制台 → ECS 实例 `i-bp1idp6l58nbwuwibptr` → 安全组
2. 入方向规则 → 手动添加：**协议 TCP，端口 80，来源 0.0.0.0/0**（80 通常默认已放行）
3. 若改用其他端口，把对应端口也放行

## AI 接口（DeepSeek）

- app 启动时自动从 `/root/.claude/settings.json` 读取 `ANTHROPIC_AUTH_TOKEN` 作为 DeepSeek API key，走 OpenAI 兼容接口 `api.deepseek.com`，模型 `deepseek-chat`。
- 也可用环境变量覆盖：`DEEPSEEK_API_KEY`（key）、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。

## 数据与测试

- 数据库：SQLite `web/data/`（含题库 `questionbank.db`）；上传在 `web/uploads/`，会话在 `web/sessions/`。均不入 git。
- 冒烟测试（需服务运行中）：
  ```bash
  cd web && .venv/bin/python scripts/smoke_test.py   # 默认 http://localhost:80
  EXAM_BASE=http://localhost:8080 .venv/bin/python scripts/smoke_test.py  # 自定义地址
  ```
