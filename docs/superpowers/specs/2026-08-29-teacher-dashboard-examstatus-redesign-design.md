# 教师端考情管理改版 设计文档（v4）

> 日期：2026-08-29
> 状态：已获用户批准（设计层面）
> 关联：本 spec 是 `2026-08-27-teacher-dashboard-redesign-design.md` 的后续迭代，前一轮（v3）已合并到 master（bd942db）。

## 1. 背景与目标

用户在上一轮（v3）合并后提出 4 条教师端 UI 反馈，并经 3 个澄清问题确认方向：

1. **考试管理 → 考情管理**：已提交/未提交、已批改/未批改 字段要**放大**，配圆环/进度可视化，让老师一眼看清每场考试的状态。✅ 用户确认可用圆环图。
2. **考试管理卡片点击行为**：当前点击卡片直接 `openGrade(pid)` 跳进批改视图——**禁止**。改为点击显示考试详情（哪套卷、何时发布等）。✅ 用户确认详情内容 = 考试信息 + 学生名单，点学生可进该生批改。
3. **首页改版**：显示 什么考试 + 已提交/未提交/已批改/未批改 + 学生成绩箱线图。✅ 用户确认箱线图维度 = 按考试每卷一个。
4. **「我的试卷」独立成顶部 tab**，与考试管理并列；首页只放考情内容。✅ 用户确认首页=总览只读，考试管理=操作。

**新增硬性约束（用户 2026-08-29 补充）**：老师只能看到自己发布的考试，不能看到别人的。核实现状：**后端已按 `teacher_id` 隔离**（见 §8），新功能必须继承该隔离并纳入验收测试。

## 2. 全局硬规则（继承 + 新增）

| # | 规则 | 说明 |
|---|---|---|
| G1 | `score_visible = (is_practice == 1) OR (published == 1)` | v3 全局规则，**不变**。学生端可见性不受本次改版影响 |
| G2 | **教师数据隔离（新增验收项）** | 任何 `teacher` 角色接口（含新加的列表、考情、详情）不得返回/操作非本教师 `teacher_id` 的试卷数据。列表经 `db.list_papers(teacher_id)` 过滤；单卷/分发/批改/发布/练习入口均 `p["teacher_id"] != u["id"] → 404` |
| G3 | 练习卷（`is_practice=1`）不可「发布成绩」 | 后端 400 门控不变；前端无发布按钮 |
| G4 | 零第三方依赖 | 箱线图/圆环图用纯 SVG 手绘；不引入任何 JS/CSS 库 |

## 3. 新信息架构（顶部 tab）

当前 5 个 tab：`首页 | 出试卷 | 题库 | 学情 | 考试管理`

改为 **6 个 tab**：

```
首页（考情总览·只读） | 考试管理（考情操作） | 我的试卷（独立卷库） | 出试卷 | 题库 | 学情
```

- `_T_TABS` 增加 `mypapers: 'tabMyPapers'`，顺序：home → exam → mypapers → wizard → bank → analytics。
- 首页中 `renderPapersTabs` / `switchPapersTab` / `myPapersFormal` / `myPapersPractice` / `papersTabFormal` / `papersTabPractice` 全部迁移到新视图 `myPapersView`。
- 首页不再渲染卷库。

## 4. 首页 = 考情总览（只读）

数据源：`GET /api/papers`（一次取全，教师隔离由后端保证）。

**4.1 全局统计行**（4 个紧凑 stat）：总已分发、总已提交、总已批改、进行中的考试数。
- 进行中 = 非练习 且 已分发 且 未发布。口径与 v3 一致。

**4.2 考试考情列表**（每场考试一张卡）：
- 头部：📄 卷名 · 科目 · 题数/总分 · 发布时间徽标（`✅ 已发布 {时间}` / `⏳ 未发布`）+ 练习卷加「练习」tag。
- **四字段大数字 + 进度可视化**：
  - 已提交 `sub` / 未提交 `dist − sub`
  - 已批改 `graded` / 未批改 `sub − graded`
  - 每个字段用**大号数字** + 圆环或进度条（提交率圆环、批改率圆环），一眼看清进度。
- **只读**：无任何按钮/点击跳转（去批改/发布成绩统一在考试管理）。

**4.3 学生成绩箱线图区**：
- 每卷**一张横向箱线图**（分数沿横轴 0..total_score），考试间**纵向堆叠**（每卷一行），行内左侧为卷名标签，右侧为图。数据 = 该卷**已批改**学生总分：`distributions.filter(d => d.status === 'graded').map(d => d.total_score)`。
- 图表内容：min / Q1 / 中位数 / Q3 / max 的箱须图 + 中位线标注 + 均值点（可选）+ 图例说明。
- 少于 5 个已批改分数 → 显示「数据不足，已批改 N 人」（不画箱）。

## 5. 考试管理 = 考情管理（可操作）

数据源：`GET /api/papers`。列表范围 = 已分发试卷（正式 + 练习），保持 v3 口径（`distributed_count > 0`）。

**5.1 卡片**：
- 头部同首页（卷名/科目/题数/总分/发布时间徽标）。
- **四字段放大** + 提交率/批改率两个圆环（环心百分比），与首页一致的可视化语言。
- **点击整卡 → 内联展开详情**（禁止 `openGrade(pid)` 跳批改）。

**5.2 展开详情区**（新增 `exam-detail` 区块，卡片内展开/收起）：
1. **考试信息**：卷名 · 科目 · 题数 · 总分 · 时长 · 创建时间 · 发布时间（未发布显示「未发布」）。
2. **学生名单**（来自 `p.distributions`，已含姓名/班级/学号/状态/得分）：
   - 每行：`姓名 · 班级 · 学号` + 状态徽标（未作答 / 已提交 / 已批改）+ 得分（已批改显示总分，未批改显示「—」）。
   - **点某学生 → `openGrade(pid, studentId)`**：进批改视图并聚焦到该生批改卡（自动滚动 + 高亮）。
3. **操作按钮**：
   - `✍️ 去批改`：`openGrade(pid)`（全部学生批改总览）。
   - `📣 发布成绩`：仅正式卷且未发布时显示，`publishPaper(pid)`。
   - 练习卷不显示发布按钮（G3）。

**5.3 状态口径**（与 v3 一致）：
- 未提交 = `distributed_count − submitted_count`
- 未批改 = `submitted_count − graded_count`

## 6. 我的试卷 = 独立 tab

- 新视图 `myPapersView`，tab 标签 `我的试卷`。
- 内容 = 原首页卷库整体迁入：正式/错题推送两组 tab（`papersTabFormal`/`papersTabPractice`）+ `paperCard`/`practiceCard` 卡片及全部操作（改名备注、分发、批改、删除、错题推练习）。
- `loadHome` 不再调用 `renderPapersTabs`；切到 `mypapers` tab 时渲染卷库。
- 空态文案保留。

## 7. 数据契约（无后端改动）

本次改版**不需要任何后端接口改动**：

| 数据 | 来源 | 字段 |
|---|---|---|
| 每卷考情计数 | `GET /api/papers` | `distributed_count` / `submitted_count` / `graded_count` |
| 发布时间 | `GET /api/papers` | `published` / `published_at` |
| 学生名单 + 状态 + 得分 | `GET /api/papers` | `distributions[]`：`student_id` / `name` / `student_no` / `class_name` / `major` / `sub_id`(空=未作答) / `status`(`submitted`/`graded`) / `total_score` |
| 箱线图分数 | 前端派生 | `distributions.filter(d => d.status === 'graded').map(d => d.total_score)` |
| 卷元信息 | `GET /api/papers` | `title` / `subject` / `question_count` / `total_score` / `duration` / `created_at` |

**派生口径**：`status === null`（sub_id 空）= 未作答；`status === 'submitted'` = 已提交未批改；`status === 'graded'` = 已批改。

## 8. 教师隔离（已核实 + 验收）

**现状（代码已隔离，本次不改）：**
- 列表：`db.py:317` `list_papers(teacher_id)` → `WHERE teacher_id = ?`。
- 单卷/分发/批改/发布/练习：`platform_routes.py:119,130,147,158,184,194,290,483,503` 均校验 `p["teacher_id"] != u["id"] → 404`。
- 学生端：`platform_routes.py:242` pop `teacher_id`，不泄漏归属。
- 删除级联：`db.py:659` 仅清该老师名下数据。

**新增验收（写入冒烟测试）**：
1. 用 `db.create_user()` 造第二个老师 `teacher_b`（role=teacher）。
2. `teacher_b` 登录后 `GET /api/papers` 不得包含 `teacher` 创建的试卷；`GET /api/papers/{pid}` 返回 404。
3. 前端渲染仅消费当前登录老师拿到的列表（隔离在接口层保证，前端不做二次过滤，但不得硬编码/写死他人 id）。

## 9. 技术约束

- **零依赖 SVG**：新增 `web/static/js/charts.js`，提供两个纯函数（字符串拼接生成 SVG，不依赖 DOM）：
  - `svgDonut(ratio, {size, stroke, bg, fg, label})` → 圆环 SVG 字符串（`stroke-dasharray` 实现）。
  - `svgBoxPlot(scores, {width, height, max})` → 箱线图 SVG 字符串（min/Q1/median/Q3/max 计算 + 箱须绘制 + 坐标轴 + 刻度）。
- 前端在 `<svg>` 内嵌显示；`index.html` 引入 `<script src="static/js/charts.js">`。
- 纯文本/Unicode 数学记号（CLAUDE.md 规则 10）——箱线图用文本标签而非 LaTeX。

## 10. 涉及文件

| 文件 | 改动 |
|---|---|
| `web/static/js/charts.js` | **新建**：svgDonut / svgBoxPlot |
| `web/static/js/teacher.js` | 新增 `mypapers` tab；重写 `loadHome`（考情列表+箱线图）；重写 `examRow`（放大字段+展开详情）；`renderPapersTabs`/`switchPapersTab` 迁往 mypapers；`openGrade` 增加学生聚焦参数支持（或在 grade.js） |
| `web/static/js/grade.js` | `openGrade(pid, studentId?)` 支持指定学生聚焦（滚动+高亮） |
| `web/templates/index.html` | 新 tab 按钮 `tabMyPapers`；新视图 `myPapersView`（卷库迁移）；考试详情展开容器；引入 charts.js |
| `web/static/css/...` | 大数字/圆环/详情区/高亮 样式 |
| `web/scripts/smoke_test.py` | 追加教师隔离断言（teacher_b） |
| `web/scripts/browser_checklist.md` | 追加人工验收项（首页箱线图/考试详情/我的试卷 tab/隔离） |

## 11. 不改动范围

- 出卷向导（wizard）、题库（bank）、学情（analytics）、学生端全部逻辑。
- 后端接口签名与数据层 schema。
- G1 `score_visible` 全局规则。

## 12. 验收标准

1. **首页**：无卷库；有全局统计行 + 每卷四字段大数字（带圆环）+ 每卷箱线图（≥5 人已批改）或「数据不足」；无任何可点击操作入口。
2. **考试管理**：卡片点击 → 展开详情（考试信息 + 学生名单），不再跳批改；点学生 → 批改视图聚焦该生；`✍️ 去批改`/`📣 发布成绩` 按钮行为正确；练习卷无发布按钮。
3. **我的试卷**：独立 tab 正常渲染两组卷库，全部操作可用；首页不再出现卷库。
4. **隔离**：teacher_b 看不到 teacher 的卷（列表空/404），冒烟断言通过。
5. 现有功能回归：分发、批改、定稿、发布、错题推练习、学生端可见性（G1）不破坏。
6. `node --check` 全部 JS 通过；冒烟 `SMOKE OK`。

## 13. 已知裁定（写死，避免实现歧义）

- 「未批改」= 已提交 − 已批改（不包含未提交，未提交单独成字段）。口径继承 v3。
- 首页与考试管理**共用同一份 GET /api/papers 数据**，不额外调接口。
- 箱线图仅统计**已批改**学生总分；未发布考试也可画（批改结果已存在），但首页只读展示无发布概念。
- 练习卷也出现在首页考情列表与考试管理（带「练习」tag），但无发布操作。
- 考试详情展开用**卡片内联展开**（非弹窗），与现有 `dist-detail` 交互一致。
- 点学生聚焦实现：`openGrade(pid, focusSid)`，renderGradeList 后 `scrollIntoView` + 临时高亮该生卡片。
- 圆环口径：**提交率 = `submitted_count / distributed_count`**；**批改率 = `graded_count / submitted_count`**（submitted=0 时批改率取 0）。环心显示百分比整数。
- 首页统计「总已提交/总已批改」为全部试卷求和（含练习卷）；「进行中的考试」仅正式卷（非练习、已分发、未发布）。
