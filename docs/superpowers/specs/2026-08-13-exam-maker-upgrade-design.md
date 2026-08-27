# exam-maker 网页升级设计（阶段一：四大功能）

- 日期：2026-08-13
- 状态：待用户 review
- 项目：`/tmp/blood_cell/exam_maker/智能体大赛/exam-maker/`
- 技术栈：FastAPI（<0.100，pydantic v1）+ 单文件 `index.html`（原生 JS）+ SSE 流式 + DeepSeek API（deepseek-chat）

---

## 1. 背景与目标

现有 exam-maker 是一个 5 步出卷向导：基本信息 → 上传真题 + AI 解析 → 知识点确认 → 命题设置（双向细目表）→ 预览下载（列文件）。本次升级目标：

1. **知识点确认**（Step 3）：确认现有增删改能力够用，仅收尾。
2. **命题设置**（Step 4）：取消双向细目表，改为直接展示「试卷结构」（题目级）。
3. **预览下载**（Step 5）：直接渲染试卷成品（固定模板可选 + 打印样式 + 每题可替换）。
4. **题库**（新增）：持久化，按知识点/学科/题型/难度筛选，试卷题目一键入库。

## 2. 范围（分阶段）

- **阶段一（本次）**：上述 4 个功能，**不加登录**。
- **阶段二（将来）**：多身份登录（老师端 / 学生端 / 管理员端），单独 brainstorm。
- 两阶段的衔接点：题库 `questions` 表预留可空 `created_by` 列，阶段二 `ALTER TABLE ADD COLUMN` 补齐，零迁移。

## 3. 已确认决策汇总

| 决策点 | 结论 |
|---|---|
| 对应知识点粒度 | **题目级**（一题一知识点） |
| 试卷结构来源 | AI 生成初稿，老师可调整 |
| 渲染技术 | HTML + KaTeX + 浏览器 `@media print` 打印/存 PDF |
| 替换题目来源 | **题库为主 + AI 即时备选为辅** |
| 学科维度 | 多学科通用，Step 1 增加「学科」字段 |
| 题库入口 | 手动新增 + 编辑/删除 + 试卷一键入库（**不做**批量导入/导出） |
| 存储 | SQLite 单文件（`sqlite3` 标准库） |
| 前端组织 | 从单文件拆出独立 JS 模块 |
| 题库位置 | 顶部独立 tab，非向导第 6 步 |
| 登录 | 阶段一不做，阶段二做 |

## 4. 数据层：SQLite 题库

单文件库 `web/data/questionbank.db`（加入 `.gitignore`），WAL 模式，每请求连接（避免跨线程问题）。

```sql
CREATE TABLE questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject    TEXT NOT NULL,          -- 学科
  type       TEXT NOT NULL,          -- 题型
  difficulty TEXT NOT NULL,          -- 基础 / 中等 / 难
  chapter    TEXT,                   -- 章节
  topic      TEXT,                   -- 知识点（题目级，一题一个知识点）
  content    TEXT NOT NULL,          -- 题干（可含 LaTeX）
  answer     TEXT,                   -- 答案（可含 LaTeX）
  analysis   TEXT,                   -- 解析
  source     TEXT DEFAULT 'manual',  -- manual / ai / exam
  exam_ref   TEXT,                   -- 来源试卷名（source=exam 时）
  created_by TEXT,                   -- ⭐阶段二后门，当前恒为 null
  created_at TEXT,
  updated_at TEXT
);
```

- 知识点用 `chapter + topic` 两列，贴合现有 `knowledge_points` 结构。多知识点需求出现时再迁 JSON，当前不预设。
- 筛选 = 若干 `WHERE`：`subject` / `type` / `difficulty` / `topic`（LIKE）/ `chapter`，全部可选。
- 现有会话状态（内存 `state` dict）保持不变，仅题目落库。

## 5. 后端接口

### 5.1 新增题库路由 `/api/questionbank/*`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/list?subject=&type=&difficulty=&chapter=&topic=` | 多条件筛选，全部可选 |
| POST | `/` | 手动新增一题 |
| PUT | `/{id}` | 编辑 |
| DELETE | `/{id}` | 删除 |
| POST | `/import` | 试卷题目批量入库（Step 5 调用） |

后端组织：新增 `web/db.py`（sqlite3 数据层）+ `web/questionbank.py`（路由），`app.py` include 该 router，避免 app.py 继续膨胀。

### 5.2 改动现有端点

- `/step4/preview-blueprint`（SSE）→ 改为 `/step4/preview-structure`：生成**题目级试卷结构**，不再生成细目表。输出形如：

  ```json
  [{ "no": 1, "type": "选择题", "score": 3, "chapter": "第一章 行列式", "topic": "行列式计算", "difficulty": "基础" }]
  ```

  由 Step 2 的题型级结构（`exam_structure.question_types`）展开而来，AI 生成初稿。总分/时长（`total_score`/`duration_minutes`）沿用 Step 2 解析值，作为试卷头部信息，不逐题展开。
- `/step5/generate`（SSE）→ 输入从 blueprint 改为**题目级结构**，逐题命制；返回结构化题目列表（题干/答案/解析/知识点/难度/题型），供前端渲染与入库。
- 新增 `/step5/alternatives`（SSE）→ 针对某题 AI 流式生成 2~3 个备选变体（替换用）。

## 6. 前端结构

- **顶部导航**改为两个 tab：**「出卷向导」**（5 步）+ **「题库」**（独立页）。
- **拆分**：`index.html` 内联 JS 抽到 `static/js/`，按模块组织：`api.js`（请求封装）、`wizard.js`（5 步）、`questionbank.js`（题库页）、`renderer.js`（试卷渲染/替换）。CSS 暂留在 `index.html`。
- **各步骤改动**：
  - Step 1：增加「学科」字段（多学科），随试卷数据流转到 Step 5 入库（`questions.subject`）。
  - Step 3：仅收尾（删除行下标 bug）。
  - Step 4：`双向细目表预览` → `试卷结构表`（可编辑，列＝题号/题型/分值/对应知识点/难度；AI 生成初稿后可增删行、改题型/分值、从 Step 3 已确认知识点下拉选）。**保留套数（n_sets）**；**难度配比滑条保留**作为全局约束（AI 据此分配每道题难度初稿），老师仍可在结构表逐题改难度。
  - Step 5：不再只列下载文件，改为直接渲染试卷。
- **题库页**：筛选栏（学科/知识点/题型/难度）+ 题目列表 + 新增/编辑弹窗 + 删除。

## 7. 试卷渲染与替换（Step 5 核心）

- **模板**：`static/papers/` 预置 2 个 HTML 模板（`standard.html` 密封线 + 标题 + 题号分值栏；`simple.html` 无密封线紧凑排版），下拉切换即重渲染；新模板 = 新增一个 HTML 文件。
- **公式**：题干/答案中的 LaTeX 用 KaTeX 客户端渲染（CDN 引入，无构建步骤）。
- **打印**：`@media print` 隐藏「替换」等交互元素，只留试卷本体，浏览器打印/另存 PDF。
- **每题替换**：每题一个「替换」按钮（打印时隐藏）→ 弹窗两个 tab：
  - 「从题库」：按该题 知识点+题型+难度+学科 匹配候选，点选即换。
  - 「AI 生成备选」：SSE 流式生成 2~3 个变体，每个可「替换」或「入库」。
  - 替换只改前端试卷状态与试卷数据，不落库（除非点入库）。
- **一键入库**：Step 5 按钮，把当前试卷所有题目批量 `POST /import`。

## 8. 错误处理与测试

- SSE 沿用现有 `try/except + stream_sse("error")`，覆盖结构生成、备选生成、导入。
- SQLite：WAL 模式 + 每请求连接；DB 文件 `.gitignore`。
- **测试**：现有项目无自动化测试，本次不上 pytest（YAGNI）。用**冒烟测试**替代——启动后 curl 打一遍题库 CRUD/筛选/导入、结构生成、渲染接口，验证关键路径；阶段二引入多身份时再补正式测试。

## 9. 环境与依赖

- 后端**零新增 pip 依赖**（`sqlite3` 标准库）。前端 KaTeX 走 CDN。
- 环境：`exam_env`（Python 3.11），启动走现有 `web/start.sh`。

## 10. 阶段二预留（多身份登录）

- `questions.created_by` 可空列已预留。
- 将来新增 `users`（账号/角色）、`sessions`（登录态）、学生端 `answers`（答题记录）等表，前端按角色分视图。本次不实现。

## 11. 非目标（YAGNI 明确排除）

- 题库批量导入/导出（用户未勾选）。
- 多用户并发、权限控制（阶段二）。
- 服务端 LaTeX/PDF 渲染、Word 生成（渲染方案已定 HTML+KaTeX）。
- 自动化测试套件（冒烟测试足够）。
