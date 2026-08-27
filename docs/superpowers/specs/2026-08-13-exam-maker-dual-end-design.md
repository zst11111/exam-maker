# 教师端 + 学生端（双端平台）设计文档

> exam-maker 从「单页出卷工具」升级为「教师端 4 页 + 学生端答题」的迷你教学平台。

**Goal:** 在现有出卷向导基础上，新增账号鉴权、我的试卷、题库来源管理、试卷分发、学生答题（拍照上传 + 题目总览）、AI 辅助批改、学生学情，形成教师-学生双端闭环。

**Architecture:** FastAPI 单一后端扩展多组路由 + SQLite 多表；前端仍为 vanilla JS，从单页 SPA 扩成「登录 → 按角色进入教师端/学生端」的视图路由。AI 继续复用 DeepSeek-chat（OpenAI 兼容），批改用 AI 判文字 + 老师复核。

**Tech Stack:** FastAPI(<0.100, pydantic v1) + sqlite3（标准库）+ vanilla JS + KaTeX CDN。零新增 pip 依赖。

---

## 一、关键决策（已与用户逐条确认）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 登录方式 | 用户名 + 密码（密码哈希 + token） |
| 2 | 学生拿卷方式 | 学生账号登录后**自动可见**分发给自己的试卷 |
| 3 | 批改方式 | **AI 辅助批改**（客观题自动判、主观题 AI 判文字、照片老师看），老师复核 |
| 4 | 班级/学生数据 | 先由系统**种子数据**直接给出（见 §七），后续再交给辅导员维护 |
| 5 | 拍照答案 | **存图给老师看，AI 只判文字**（DeepSeek-chat 纯文本，看不了图） |
| 6 | 学情页内容 | 学生列表 + 成绩 + 逐题下钻 |
| 7 | 题库「来源」 | 标准化为三值：`teacher`(老师) / `paper`(试卷) / `ai`(AI) |
| 8 | 题库「latex 格式」问题 | 题库列表当前用 `esc(content)` 显示 LaTeX 源码，改为 `renderMath(escMath(...))` 渲染公式 |

## 二、鉴权

- 密码：`hashlib.pbkdf2_hmac('sha256', pwd, salt, 100000)`，存 `salt$hash`（hex）。
- token：`secrets.token_hex(32)`，登录返回，前端存 localStorage，请求带 `Authorization: Bearer <token>`。
- 服务端内存维护 `token -> user_id` 映射（demo 够用；重启需重新登录，可接受）。
- 端点：
  - `POST /api/auth/login` `{username, password}` → `{token, role, name, user_id, ...}`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`（校验 token 返回当前用户）
- 依赖 `require_user(request, role=None)`：解析 header，未登录 401，角色不符 403。
- 前端新增 `authedFetch`（在 `apiFetch` 基础上自动加 header）。

## 三、数据模型（SQLite 新增表，沿用标准库 sqlite3）

在现有 `questions` 表之外新增 5 张表：

| 表 | 字段 | 说明 |
|---|---|---|
| `users` | id PK, username UNIQUE, password_hash, role(`teacher`/`student`), name, created_at | 登录账号，师生共用 |
| `students` | id PK, user_id UNIQUE FK→users, student_no UNIQUE, class_name, major | 学生档案 |
| `papers` | id PK, teacher_id FK→users, title, subject, duration, total_score, questions_json(TEXT), created_at | 我的试卷 |
| `distributions` | id PK, paper_id FK, student_id FK, created_at, UNIQUE(paper_id, student_id) | 分发记录（一学生一行） |
| `submissions` | id PK, paper_id FK, student_id FK, answers_json(TEXT), photos_json(TEXT), status, total_score, ai_feedback_json(TEXT), submitted_at, graded_at, UNIQUE(paper_id, student_id) | 答题 + 批改结果 |

`questions_json` 结构与现有 `S.questions` 一致（每题为 `{no,type,score,chapter,topic,difficulty,content,answer,analysis}`）。

`answers_json`：`[{no, answer_text, photo_path?, score?, correct?}]`。
`photos_json`：`{no: [path,...]}`（拍照上传的图片路径列表）。
`ai_feedback_json`：`[{no, score, comment, correct}]`（AI 逐题判分）。

`submissions.status`：`submitted`（已提交待批改）→ `graded`（已批改，学生可见）。

## 四、教师端 4 页

登录后按 role 进入教师端 SPA，顶部 4 个 tab：

1. **首页**：概览卡 — 我的试卷数 / 已分发试卷数 / 待批改提交数 / 学生数；快捷入口。
2. **出试卷**：现有 5 步向导原样搬入（逻辑不变），Step 5 加「保存到我的试卷」按钮。
3. **题库管理**：现有 bankView + 两处改造：
   - 列表渲染：`esc(q.content)` → `renderMath(escMath(q.content))`（公式渲染，与出卷预览一致）；
   - 「来源」字段：DB 已有 `source` 列，界面补上来源下拉（老师/试卷/AI）并展示标签；现有 `manual`→`teacher`、`ai` 保持；
   - 新增/编辑表单从 `prompt()` 升级为正式表单对话框（含 source 下拉）。
4. **学生学情**：按班级/学科筛选学生列表（姓名/学号/班级/专业/提交数/平均分/最近成绩），点开下钻到「各试卷成绩 + AI 逐题评语 + 逐题得分」。

## 五、我的试卷 + 分发

- **保存试卷**：`POST /api/papers` `{title, subject, duration, total_score, questions}` → 存 `papers`。Step 5 加按钮（与「导出 PDF」并列）。
- **我的试卷列表**：`GET /api/papers`（当前教师）→ 每张卷子可「查看/分发/删除」。
- **分发**：`GET /api/students?class_name=&major=` 筛选学生 → 勾选 → `POST /api/papers/{id}/distribute` `{student_ids:[...]}` 写 `distributions`。
- 教师可在批改前查看某张试卷的已分发学生及其提交状态。

## 六、学生端

学生登录后进入学生端 SPA：

- **试卷列表**：`GET /api/student/papers` → 分发给自己的试卷（含是否已提交/已批改、成绩）。
- **答题页**：`GET /api/student/papers/{paper_id}` → 题目 + 已有草稿。
  - **左上角题目小格子总览**：每题一格；答过的变绿色/已答色，未答灰色，点击跳转。
  - 每道题：选择题选项选择、填空题/主观题文本输入；主观题支持**拍照上传**（`POST /api/upload` 存图，返回 path，前端记入 photos）。
  - 草稿自动保存（可选，或提交时一次性保存）。
- **提交**：`POST /api/student/papers/{paper_id}/submit` 存 answers/photos，客观题（选择/填空）提交时即时自动判分，status→`submitted`。
- **查看结果**：批改完成（status=`graded`）后，学生看到总分 + 逐题得分 + AI/老师评语 + 解析。

## 七、AI 辅助批改 + 老师复核

- **客观题（选择/填空）**：提交时按 `answer` 精确匹配自动判分，写入 `answers_json[].score/correct`。
- **主观题（计算/证明/简答）**：
  - 文字答案 → AI 判分（DeepSeek，逐题给出 `{score, comment, correct}`）；
  - 拍照答案 → AI 不判，图片展示给老师，老师手动打分。
- **批改页（教师端）**：对某试卷，列出所有提交；每条提交可点「AI 辅助批改」触发 `GET /api/grade/{submission_id}`（SSE，同现有流式模式），AI 对文字主观题判分返回 `ai_feedback_json` + 总分；老师可逐题改分/写评语，点「发布」→ status→`graded`，学生即可见。

## 八、种子数据（§一 决策 4）

3 个班（不同专业）× 每班 2 人 = 6 人；学号 = `2026` + 班级(2位) + 序号(2位) = 8 位。

| 班级 | 专业(学科) | 学号 | 姓名 |
|---|---|---|---|
| 1班 | 数学 | 20260101 | 张三 |
| 1班 | 数学 | 20260102 | 李四 |
| 2班 | 物理 | 20260201 | 王五 |
| 2班 | 物理 | 20260202 | 赵六 |
| 3班 | 化学 | 20260301 | 孙七 |
| 3班 | 化学 | 20260302 | 周八 |

- 教师：`teacher / 123456`，姓名「张老师」。
- 学生：`学号 / 123456`。
- 初始化脚本：`seed.py`（幂等，`init_db()` 后调用），专业名可在脚本里改。

## 九、文件结构

后端：
- `web/app.py`（扩：鉴权 + papers/distributions/submissions/grade/students/upload 路由）
- `web/db.py`（扩：5 张新表 + 对应 CRUD）
- `web/seed.py`（新增：种子数据）
- `web/auth.py`（新增：哈希/token/依赖 `require_user`）

前端（新增文件，沿用现有顺序加载）：
- `web/templates/index.html`（重构为登录视图 + 教师端/学生端视图容器）
- `web/static/js/auth.js`（新增：登录/登出/token 管理/`authedFetch`）
- `web/static/js/teacher.js`（新增：首页/我的试卷/分发/学情）
- `web/static/js/student.js`（新增：试卷列表/答题/题目总览/拍照上传/提交/看结果）
- `web/static/js/grade.js`（新增：教师批改页，AI 判分 + 复核）
- 复用：`api.js`/`renderer.js`/`questionbank.js`/`wizard.js`（出卷向导、题库渲染改造）

## 十、风险与约束

1. **AI 判分不可见图片**：DeepSeek-chat 纯文本，拍照答案 AI 不判，仅老师人工判。已在决策 5 确认。
2. **AI 判分需可审**：AI 给出的主观题分/评语仅作「初评」，老师可改，最终以老师发布为准（延续「结果可验、过程可审」原则）。
3. **token 内存态**：重启失效，demo 可接受；不引入额外持久化。
4. **零新增 pip 依赖**：密码哈希用标准库 hashlib/secrets，不用 passlib/bcrypt。
5. **多用户并发**：`db.py` 每个操作独立连接 + WAL，够用；不做连接池。
6. **拍照上传**：图片存 `web/uploads/` 下按 submission 分目录，大小/类型在路由层限制（如 ≤5MB、jpg/png/webp）。

## 十一、非目标（本次不做）

- 辅导员班级/学生管理界面（种子数据先顶替）。
- 服务端一键生成 PDF 文件（导出仍走浏览器打印；KaTeX 客户端渲染，服务端 PDF 需 headless 浏览器）。
- 试卷码/链接临时分发（已定为账号自动可见）。
- 密码找回/邮箱验证/多因素。
- 接入学校统一认证 SSO。
