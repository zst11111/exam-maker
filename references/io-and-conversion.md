# 输入解析 · 输出转换 · 环境探测

支撑 SKILL.md 步骤 0、1、6：把各种真题格式**读进来变 LaTeX**、把成卷 LaTeX **转成 `docx/md`**，以及开工前的**工具探测与降级**。所有命令以本机默认可用的 **pandoc**（`C:\Program Files\Pandoc`）为主力。

---

## 一、环境探测（步骤 0，先跑一遍，缺什么告诉用户）

```bash
pandoc --version | head -1                                  # 转换主力（必需）
python --version && python -c "import numpy,docx" 2>&1       # numpy / python-docx
python -c "import sympy; print(sympy.__version__)" 2>&1      # 符号验算（可计算学科需要）
xelatex --version 2>&1 | head -1 || echo NO-XELATEX          # LaTeX 引擎（编译用）
latexmk -v 2>&1 | head -1 || echo NO-LATEXMK
tectonic --version 2>&1 || echo NO-TECTONIC
where soffice 2>&1 || echo NO-LIBREOFFICE                    # 转 .doc 需要
```

**降级规则（探测到缺失时当场说明）：**
- **无 `sympy`**：`pip install sympy`（或写入项目 `.venv`）；来不及则可计算学科退到 **numpy 数值验算**（浮点近似 + 容差），符号断言降级为数值断言。
- **无 LaTeX 引擎**：**跳过本地编译**，只交付可在 **Overleaf(XeLaTeX)** 编译的 `.tex` 源；结构/分值改用自检脚本把关。如需本地编译，建议装 MiKTeX 或 `tectonic`（单文件、免配置）。
- **无 `soffice`**：`.doc` 旧格式无法直接转 → 请用户用 Word 另存为 `.docx` 后再来，或改交 `.docx/.pdf`。
- **无 `pandoc`**：`docx/md/tex` 互转失效 → 请先安装 pandoc（本机已安装，通常无需）。

> 不要把过期的硬编码路径写进流程（例如某台机器的 `C:\CTEX\MiKTeX` 可能已不存在）——**每次探测、按实际结果走**。

---

## 二、真题 → LaTeX（步骤 1，按格式分派）

统一产物：`exam-build/source-<name>.tex`，忠实还原题面（题号、题干、公式、表格、图注、**分值标注**都要）。

### PDF（视觉 OCR，最通用）
用 **Read 工具逐页识读**（它能"看"扫描/排版/公式/表格），让**转写子代理**把每页转成 LaTeX，长文档按页码区间分片并行（每次 ≤20 页）。再派**校对子代理**逐页把 LaTeX 与原图比对，重点核公式下标/上标、矩阵、正负号、分值。
- 公式排版化、数字模糊或手写导致把握不准时，**标注 `% TODO 存疑` 并交教师**，不臆造。
- 需要更高精度的数学 OCR 时可选 Mathpix / `tesseract`（非必需，默认用 Read 视觉即可）。

### DOCX
```bash
pandoc "in.docx" -o "exam-build/source-in.tex"     # 公式(OMML)→LaTeX、表格一并转
```
结构复杂（分栏、文本框、题号是图片编号）时，辅以 `python-docx` 读段落/表格核对。

### DOC（旧二进制格式，pandoc 读不了）
先转 docx 再走上一条：
```bash
soffice --headless --convert-to docx --outdir "exam-build" "in.doc"   # 需 LibreOffice
```
无 `soffice` 时请用户在 Word 里"另存为 .docx"。

### TEX
已是 LaTeX：**抽出正文**，套用本技能 `assets/preamble.tex` 导言区确认能编译；剔除原文档私有宏或补上等价定义。

### MD
```bash
pandoc "in.md" -o "exam-build/source-in.tex"       # md 里的 $..$ 数学直接保留
```
（md 也可直接读取，其数学本就是 LaTeX。）

---

## 三、成卷 LaTeX → 目标格式（步骤 6）

**canonical（权威）产物永远是 `.tex`**（已编译/自检通过）。`OUTPUT_FILE_TYPE` 为 `docx/md` 时从 `.tex` 转，并**转完必查**。

### → Markdown
```bash
pandoc "paper-1.tex" -o "paper-1.md" -t gfm --wrap=none --from=latex+raw_tex
```
数学以 `$...$`/`$$...$$` 保留；表格转 GFM 表格。

### → DOCX
```bash
pandoc "paper-1.tex" -o "paper-1.docx"             # 数学→Word 原生公式(OMML)
```
**中文字体**：若默认字体不显示中文，做一个参考文档并指定字体（一次性）：
```bash
pandoc -o ref.docx --print-default-data-file reference.docx   # 导出模板
# 用 Word 打开 ref.docx，把 Normal/正文样式字体设为中文字体(如宋体/SimSun)，保存
pandoc "paper-1.tex" -o "paper-1.docx" --reference-doc=ref.docx
```

### 自定义宏会掉内容 → 用"转换安全副本"
本技能导言区有几个自定义命令，pandoc 从 LaTeX 转时会**丢弃或转不动**。**转换前**把 `paper.tex` 复制为 `paper.conv.tex`，做如下**纯文本替换**再转（保持 `.tex` 原件不动，可用一小段 `sed`/Python）。下表已用 **pandoc 3.9 实测**：

| 原构造 | 实测现象 | 替换为（pandoc 安全） |
|---|---|---|
| `\score{3}`（行末步骤分） | md/docx **整个丢弃** | 文本 `（3分）` |
| `\begin{pingfen}…\item…\end{pingfen}` | 环境体**整段丢弃**（评分说明消失） | `\textbf{评分说明：}` + 普通 `itemize` |
| `\blank`（填空横线） | md 里**消失**（填空线没了） | 文本 `\underline{\hspace{2.8cm}}` 前后留字，或直接写 `\_\_\_\_\_\_` |
| `\xlongequal{r_2-3r_1}` | docx **转不成公式**（warning，退化为裸 TeX） | `\overset{r_2-3r_1}{=}` |

**实测能正常转、无需改**：普通矩阵/行列式（`pmatrix/vmatrix/bmatrix/cases` 等）、`\xrightarrow{\substack{...}}`、`booktabs` 表格（`\toprule/\midrule/\bottomrule`）、章节与 `enumerate`、`\newcommand` 简单宏（如 `\T`,`\rank`,`\tr` 会被 pandoc 自动展开）、中文正文。所以替换只需盯上表四项。

> 做替换请用 **`scripts/to_convertible.py`**（`python to_convertible.py paper-1.tex` 生成 `paper-1.conv.tex`）。**不要用 sed**：Windows/Git Bash 下 sed、grep 对 `\score`、`\{ \}` 的反斜杠转义常静默失效（`\s` 被当空白类），Python `re` 才可靠。转换后务必核对：源 `\score{}` 数应等于目标 `（n分）` 数且无 `\score` 残留（`\begin/\end{pingfen}`、`\xlongequal` 同理清零）。

### 转完必查（派子代理抽查，SKILL 步骤 6）
对照 `.tex` 逐项核对转出的 `docx/md`：**每道题在不在、公式有没有变形/丢失、表格是否完整、`\score` 分值是否都在、评分说明是否保留、题号连续、总分合计**。发现丢失就（a）修转换安全副本的替换规则重转，或（b）手工补齐目标文件。宁可多一遍核对，不交半成品。

---

## 四、本地编译（步骤 6，若有引擎）

```bash
latexmk -xelatex -interaction=nonstopmode -halt-on-error "paper-1.tex"   # 首选，自动多趟
# 或： xelatex -interaction=nonstopmode -halt-on-error "paper-1.tex"（跑两遍）
```
编译成功后查超宽：日志里搜 `Overfull`，超过约 10pt 的把过长的矩阵/行列式变换链从中间拆成两个 `\[...\]` 块。目标：**编译零错误、零 Overfull**。无引擎则跳过本节，交 Overleaf 源并在交付说明里注明"编译器选 XeLaTeX"。
