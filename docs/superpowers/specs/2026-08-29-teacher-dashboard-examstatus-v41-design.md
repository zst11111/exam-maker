# 教师端考情管理改版 v4.1 设计文档（迭代）

> 日期：2026-08-29
> 状态：待用户批准
> 关联：v4（`2026-08-29-teacher-dashboard-examstatus-redesign-design.md`，已合并 5a53c7f）的迭代。本 spec 只写**增量改动**，v4 已定稿的规则（G1/G3/G4、口径、交互、sub_id 契约）全部继承不变。

## 1. 背景与目标

用户在浏览器验收 v4 后提出 3 点调整：

1. **「张三·错题巩固（数学1）」不是考试考情**——它是错题推送（is_practice=1、仅分发给该生、后端自动生成）。用户拍板：考试管理 tab 下设 **3 个小框** `正式考试 | 错题练习 | 日常作业` 分开查看，默认「正式考试」。
2. **首页箱线图换直方图**——每次考试常只有 3-4 人，箱线图太稀疏。用户选择：**分数段分组柱状直方图**。
3. **首页考情总览去掉顶部 4 个全局统计框**——按考试分组织：每场考试卡片里直接看到「哪几次考试、学生成绩、分发时间」。用户选择：每卷卡片保留 **状态大数字 + 直方图 + 时间**。

## 2. 全局硬规则（继承 v4，不变）

| # | 规则 | 说明 |
|---|---|---|
| G1 | `score_visible = (is_practice == 1) OR (published == 1)` | 不变 |
| G2 | 教师数据隔离 | 不变；新增字段同受隔离约束 |
| G3 | 练习卷不可发布成绩 | 不变；错题练习（is_wrong_push=1）同样无发布按钮/徽标 |
| G4 | 零第三方依赖 | 直方图仍用纯 SVG |

**本迭代新增硬规则：**

| # | 规则 |
|---|---|
| V41-1 | **考试管理 3 个小框**：考试管理 tab 下分 `正式考试`(!is_practice) / `错题练习`(is_wrong_push=1) / `日常作业`(is_practice=1 且非错题推送)，老师切换查看；**只在考试管理**，首页考情总览不设小框 |
| V41-2 | **默认小框 = 正式考试**（用户拍板） |
| V41-3 | 首页考情总览**仅展示正式考试**（`!is_practice`）——「考试总览」看的是哪几次正式考试，错题练习/日常作业在考试管理对应小框里看；**无顶部 4 个全局统计框**；每卷卡片显示 卷名·科目 · 分发时间 · 四字段大数字(带圆环) · 成绩直方图 |
| V41-4 | 首页直方图为**分数段分组柱**（默认 5 段均分 `[0, total_score]`），柱高=该段已批改人数，柱顶标人数 |

## 3. 后端改动（少量增量，不破坏 v4 契约）

### 3.1 识别错题推送：papers 加 `is_wrong_push` 列

- db.py 迁移（复用现有幂等模式，`ALTER TABLE` + 列存在性检查）：`papers ADD COLUMN is_wrong_push INTEGER DEFAULT 0`。
- `create_paper()` 入参支持 `is_wrong_push`（缺省 0，向后兼容）。
- `platform_routes.py` 错题推送 endpoint（约 L528 附近）`create_paper` 调用加 `"is_wrong_push": 1`。
- `GET /api/papers` 每卷返回 `is_wrong_push: bool`。

### 3.2 分发时间：distributions 补 `d.created_at` 并下发首次分发时间

- `db.list_distributions()` SELECT 增加 `d.created_at AS distributed_at`（每行下发，不影响现有字段）。
- `GET /api/papers` 每卷新增 `first_distributed_at` = `min(distributions[].distributed_at)`（无分发则 None）。
- 前端未分发显示「未分发」。

### 3.3 数据契约增量（v4.1）

| 数据 | 来源 | 字段 |
|---|---|---|
| 分类标记 | `GET /api/papers` | `is_practice` / `is_wrong_push` |
| 首次分发时间 | `GET /api/papers` | `first_distributed_at`（min of `distributions[].distributed_at`，可 None） |
| 直方图分数 | 前端派生 | `distributions.filter(d=>d.status==='graded').map(d=>d.total_score)`（不变） |

**后端只改**：`db.py`（迁移 + create_paper + list_distributions）、`platform_routes.py`（push endpoint + GET /api/papers）。不动学生端/辅导员端/学情路由。

## 4. 前端改动

### 4.1 charts.js：新增 `svgHistogram(scores, opts)`（首页直方图）

- 签名：`svgHistogram(scores, {width, height, max, bins=5})` → SVG 字符串（零依赖，`bp-` 前缀内联样式）。
- 逻辑：将 `[0, max]` 均分 `bins` 段；`scores` 中每个已批改总分落入对应段，柱高 = 段内人数；柱顶标人数；底部画分数段刻度标签；`max<=0` 或 `scores` 空返回空态提示。
- `svgBoxPlot` **保留但不再被首页使用**（不动其实现，防回归）。
- 示例：7 人 `[60,70,80,85,90,95,100]`, max=100, bins=5 → 段 `[0-20,20-40,40-60,60-80,80-100]` → 各段人数 `[0,0,1,2,4]`。

### 4.2 teacher.js

**首页考情总览（loadHome）：**
- **移除** `statCards`（4 个全局框）。
- 每卷卡片（`examOverviewCard`）：卷名·科目 · **分发时间**（`first_distributed_at`，未分发显示「未分发」）· 发布徽标/练习tag · 四字段大数字(带圆环) · **成绩直方图**（`renderScoreHistograms` 用 `svgHistogram`）。
- **只渲染 `!is_practice` 的卷**（V41-3）；无正式考试时显示空态。
- `renderBoxPlots` 改造为 `renderScoreHistograms`（直方图），`boxplot-note` 文案改直方图说明。

**考试管理（考情管理，loadExamManage/examRow）：**
- 新增 **3 个小框** `switchExamSubTab(name)`：正式考试 / 错题练习 / 日常作业，默认「正式考试」；切换只重渲染列表，不重新请求。
- 筛选口径：正式考试=`!is_practice`；错题练习=`is_wrong_push`；日常作业=`is_practice && !is_wrong_push`。
- 列表范围随当前小框变化（不再无条件 `distributed_count>0` 全列——改为当前分类下 `distributed_count>0` 的卷，保证「已分发的才进考情」口径）。
- 卡片本体不变（大数字+双圆环+整卡展开详情+学生名单+操作按钮）。
- 小框 UI：样式为 tab 下的三个小按钮/卡片（`.exam-subtab`），见 style.css。

### 4.3 style.css

- 新增：`.exam-subtab` / `.exam-subtab.active`（考试管理 3 小框）、`.histogram-row` / `.histogram-title` / `.histogram-note`（首页直方图容器）。
- 移除或闲置：首页 statCards 相关样式不再使用（可保留，不强制删）。
- 复用现有 `--border`/`--text-muted` 变量与语义色。

## 5. 首页考情总览最终形态（验收视图）

```
考情总览（只读，仅正式考试）
────────────── 考试卡片（每卷一张，纵向堆叠）──────────────
📄 期中考试·数学        ✅ 已发布 2026-08-20 10:00
   分发时间：2026-08-18 09:00
   [已提交 5] [未提交 2] [已批改 4] [未批改 1]   [提交率圆环] [批改率圆环]
   成绩分布（已批改 4 人）：
   [直方图：0-20/20-40/40-60/60-80/80-100 分数段，柱高=人数]
────────────── 下一张卡 ──────────────
```

## 6. 考试管理（考情管理）形态

```
考试管理（考情管理，可操作）
[正式考试 | 错题练习 | 日常作业]   ← 3 小框，默认「正式考试」
────────────── 当前小框下的卡片列表 ──────────────
（卡片本体不变：四字段大数字+双圆环+整卡展开详情+学生名单+操作按钮）
```

## 7. 验收标准

1. 首页：无顶部 4 统计框；仅正式考试（`is_practice=0`）；每卷卡片含 卷名·分发时间·四字段大数字·直方图；错题练习/日常作业不出现在首页。
2. 考试管理：3 小框默认「正式考试」；切「错题练习」只见错题推送卷、切「日常作业」只见手动练习卷；切换不刷新页面。
3. 直方图：≥1 已批改即出图，分数段正确，柱高=人数；0 已批改显示空态。
4. 隔离（G2）：错题练习/日常作业属他人创建的卷同样不可见（沿用后端隔离）。
5. 回归：分发/批改/发布/错题推送/学生端可见性（G1）不破坏；`SMOKE OK`；`node --check` 全 JS 通过。
6. 冒烟新增断言：`is_wrong_push` 字段（错题推送卷=1、普通卷=0）、`first_distributed_at`（已分发卷有值、未分发 None）。

## 8. 不改动范围

- 学生端、辅导员端、学情（analytics）、出卷向导、题库全部逻辑。
- 我的试卷 tab（正式/练习两组卷库照旧，错题练习仍在练习 tab 下）。
- v4 已定稿的交互（整卡展开详情、点学生聚焦、发布按钮门控、圆环口径、sub_id 契约）。

## 9. 已知裁定

- 直方图 bins 默认 5 段均分 `[0,total_score]`；分数段标签显示为「0-20」「20-40」…「80-100」形式的**相对 max 的百分比段**（total_score 变化时标签随动）。
- 「分发时间」= 该卷**最早一次**分发时间（`min(distributions[].distributed_at)`）。
- 三小框**只在考试管理**，默认「正式考试」；首页不设小框且只展示正式考试。
- `svgBoxPlot` 保留但不使用（防回归，不删）。
- 错题练习判定以 `is_wrong_push=1` 为准（新建即标记；历史错题推送旧库无此列，迁移默认 0——**历史错题推送会落到「日常作业」类**，可接受，仅影响展示分类不删数据）。
