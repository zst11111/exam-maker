# 教师端考情管理改版 v4.1 设计文档（迭代）

> 日期：2026-08-29
> 状态：待用户批准
> 关联：v4（`2026-08-29-teacher-dashboard-examstatus-redesign-design.md`，已合并 5a53c7f）的迭代。本 spec 只写**增量改动**，v4 已定稿的规则（G1/G3/G4、口径、交互、sub_id 契约）全部继承不变。

## 1. 背景与目标

用户在浏览器验收 v4 后提出 3 点调整：

1. **「张三·错题巩固（数学1）」不是考试考情**——它是错题推送（is_practice=1、仅分发给该生、后端按标题自动生成），不应混在考情列表里。用户选择：**类别分开，老师可自选看哪类**。
2. **首页箱线图换直方图**——每次考试常只有 3-4 人，箱线图太稀疏。用户选择：**分数段分组柱状直方图**。
3. **首页考情总览去掉顶部 4 个全局统计框**——按考试分组织：每场考试卡片里直接看到「哪几次考试、学生成绩、分发时间」等具体信息。用户选择：每卷卡片保留 **状态大数字 + 直方图 + 时间**。

## 2. 全局硬规则（继承 v4，不变）

| # | 规则 | 说明 |
|---|---|---|
| G1 | `score_visible = (is_practice == 1) OR (published == 1)` | 不变 |
| G2 | 教师数据隔离 | 不变；新增字段同受隔离约束 |
| G3 | 练习卷不可发布成绩 | 不变；错题推送（is_wrong_push=1）同样无发布按钮/徽标 |
| G4 | 零第三方依赖 | 直方图仍用纯 SVG |

**本迭代新增硬规则：**

| # | 规则 |
|---|---|
| V41-1 | **考情视图分类**：考情视图（首页考情总览 + 考试管理）把试卷分成三类——`正式考试`(is_practice=0)、`练习卷`(is_practice=1 且非错题推送)、`错题推送`(is_wrong_push=1)，提供筛选 chips 让老师自选查看 |
| V41-2 | **默认筛选**：考情两视图**默认显示「正式考试」**；可选 全部 / 正式考试 / 练习卷 / 错题推送 |
| V41-3 | 首页考情总览**不再显示顶部 4 个全局统计框**；每卷卡片显示 卷名·科目 · 分发时间 · 四字段大数字(带圆环) · 成绩直方图 |
| V41-4 | 首页直方图为**分数段分组柱**（默认 5 段均分 `[0, total_score]`），柱高=该段已批改人数，柱顶标人数 |

## 3. 后端改动（本次有少量后端改动，均为增量、不破坏 v4 契约）

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
- 逻辑：将 `[0, max]` 均分 `bins` 段；`scores` 中每个已批改总分落入对应段，柱高 = 段内人数；柱顶标人数；底部画分数段刻度标签；`max=0` 或 `scores` 空返回空态提示。
- `svgBoxPlot` **保留但不再被首页使用**（不动其实现，防破坏）。
- 示例：7 人 `[60,70,80,85,90,95,100]`, max=100, bins=5 → 段 `[0-20,20-40,40-60,60-80,80-100]` → 各段人数 `[0,0,1,2,4]`。

### 4.2 teacher.js：首页考情总览重排 + 分类筛选

- **移除** `loadHome` 里 `statCards`（4 个全局框）的渲染。
- `loadHome` 每卷卡片（`examOverviewCard`）内容改为：卷名·科目 · **分发时间**（`first_distributed_at`，未分发显示「未分发」）· 发布徽标/练习tag · 四字段大数字(带圆环) · **成绩直方图**（`renderScoreHistograms` 用 `svgHistogram`）。
- 新增**分类筛选 chips**（`filterPaperCategory`），作用于 `loadHome`（首页）与 `loadExamManage`（考试管理）两视图：`全部 | 正式考试 | 练习卷 | 错题推送`，默认「正式考试」。切换时只重渲染列表，不重新请求。
- 筛选口径：正式考试=`!is_practice`；练习卷=`is_practice && !is_wrong_push`；错题推送=`is_wrong_push`；全部=不过滤。
- 首页列表范围不变（所有试卷），仅按选中分类过滤展示。
- `renderBoxPlots` 改造为直方图（`renderScoreHistograms`），`boxplot-note` 文案改直方图说明。
- 考试管理（`loadExamManage`/`examRow`）加同一分类筛选；范围从「distributed_count>0 全部」改为「按当前分类过滤」。
- **注意**：首页与考试管理各自独立维护当前选中分类（或共享一个，实现时二选一，spec 倾向共享同一筛选状态）。

### 4.3 style.css

- 新增：分类筛选 chips 样式（`.filter-chips` / `.filter-chip.active`）、直方图容器样式（`.histogram-row` / `.histogram-title` / `.histogram-note`）。
- 移除或闲置：首页 statCards 相关样式不再使用（可保留，不强制删）。
- 复用现有 `--border`/`--text-muted` 变量与语义色。

## 5. 首页考情总览最终形态（验收视图）

```
考情总览（只读）
[全部 | 正式考试 | 练习卷 | 错题推送] ← 筛选 chips，默认「正式考试」

────────────── 考试卡片（每卷一张，纵向堆叠）──────────────
📄 期中考试·数学（正式考试）         ✅ 已发布 2026-08-20 10:00
   分发时间：2026-08-18 09:00
   [已提交 5] [未提交 2] [已批改 4] [未批改 1]   [提交率圆环] [批改率圆环]
   成绩分布（已批改 4 人）：
   [直方图：0-20/20-40/40-60/60-80/80-100 分数段，柱高=人数]
────────────── 下一张卡 ──────────────
```

## 6. 考试管理（考情管理）形态

- 与首页共享同一分类筛选（默认「正式考试」）。
- 卡片本体不变（大数字+双圆环+整卡展开详情+学生名单+操作按钮），仅列表范围随筛选变化。
- 错题推送被默认滤除，但老师可切「错题推送」分类查看。

## 7. 验收标准

1. 首页：无顶部 4 统计框；每卷卡片含 卷名·分发时间·四字段大数字·直方图；筛选 chips 默认「正式考试」，「错题推送」类不出现在默认视图。
2. 考试管理：默认只列正式考试；切 chips 可见练习卷/错题推送/全部。
3. 直方图：≥1 已批改即出图，分数段正确，柱高=人数；0 已批改显示空态。
4. 隔离（G2）：错题推送是他人创建的卷同样不可见（沿用后端隔离，不新增绕过）。
5. 回归：分发/批改/发布/错题推送/学生端可见性（G1）不破坏；`SMOKE OK`；`node --check` 全 JS 通过。
6. 冒烟新增断言：`is_wrong_push` 字段（错题推送卷=1、普通卷=0）、`first_distributed_at`（已分发卷有值、未分发 None）。

## 8. 不改动范围

- 学生端、辅导员端、学情（analytics）、出卷向导、题库全部逻辑。
- 我的试卷 tab（正式/练习两组卷库照旧，错题推送仍在练习 tab 下）。
- v4 已定稿的交互（整卡展开详情、点学生聚焦、发布按钮门控、圆环口径、sub_id 契约）。

## 9. 已知裁定

- 直方图 bins 默认 5 段均分 `[0,total_score]`；分数段标签显示为「0-20」「20-40」…「80-100」形式的**相对 max 的百分比段**（total_score 变化时标签随动）。
- 「分发时间」= 该卷**最早一次**分发时间（`min(distributions[].distributed_at)`）。
- 首页与考试管理的筛选状态**共享同一变量**（切一个另一个同步），默认「正式考试」。
- `svgBoxPlot` 保留但不使用（防回归，不删）。
- 错题推送分类判定以 `is_wrong_push=1` 为准（新建即标记；历史错题推送标题含「·错题巩固」但旧库无此列，迁移默认 0——**历史错题推送会落到「练习卷」类**，可接受，仅影响展示分类不删数据）。
