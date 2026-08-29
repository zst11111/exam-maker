# -*- coding: utf-8 -*-
"""
可计算学科（数/理/工/CS）出卷验算模板 —— 复制到 %TEMP% 或 exam-build/ 改写后运行：python verify_papers.py
要求：本次试卷每道题至少一条 chk() 断言；任何 FAIL 都改题面数据重验，禁止改口答案迁就。
下面是线性代数的一组已验证示例，展示"每类题怎么写断言"的范式——换学科时照此为你的题目写断言
（如物理：能量/动量守恒代入、量纲一致；概率：分布归一化、期望方差；算法：小样例跑期望输出）。
无 sympy 时可退到 numpy 数值断言（np.allclose / 判整数容差）。概念/文科学科不用本脚本，改走复核轨
（references/quality-gates.md 第三节）。
"""
import sys

import sympy as sp
from sympy import Matrix, symbols, factor, eye, zeros, Rational

if hasattr(sys.stdout, "reconfigure"):   # Windows GBK 控制台输出中文/上标
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

a, k, t, x, lam = symbols('a k t x lambda')
ok = []


def chk(name, cond, extra=""):
    status = "PASS" if cond else "FAIL"
    ok.append(bool(cond))
    print(f"[{status}] {name} {extra}")


# ---------- 填空：逆矩阵 ----------
A = Matrix([[1, 0, 0], [2, 1, 0], [0, 3, 1]])
chk("f1 逆矩阵", A.inv() == Matrix([[1, 0, 0], [-2, 1, 0], [6, -3, 1]]))

# ---------- 填空：秩 / 线性关系 ----------
V = Matrix([[1, 2, 3], [1, 3, 4], [2, 5, 7]])          # 列为 α1,α2,α3
chk("f2 秩=2", V.rank() == 2)

# ---------- 填空：非零解参数（det 关于参数为一次式且整根） ----------
A = Matrix([[1, 2, -1], [2, 5, a], [1, 1, -4]])
chk("f3 det=a-1", sp.expand(A.det()) == a - 1, f"det={sp.expand(A.det())}")

# ---------- 填空：特征值代入 ----------
chk("f5 |A^2-3I|=-2", (1 - 3) * (4 - 3) * (4 - 3) == -2)

# ---------- 填空：正定（顺序主子式） ----------
A = Matrix([[1, 1, 0], [1, 2, -1], [0, -1, k]])
chk("f6 Δ1,Δ2,Δ3", A[0, 0] == 1 and A[:2, :2].det() == 1
    and sp.expand(A.det()) == k - 1)

# ---------- 计算1：行列式 + 代数余子式组合（换列法），并打印候选系数 ----------
A = Matrix([[1, 1, 2, 1], [2, 3, 1, 0], [1, 2, 2, 1], [0, 1, 3, 2]])
print(f"  c1 |A|={A.det()}")
for c in [(1, 2, 1, 1), (1, 1, 2, 1), (2, 1, 1, 1)]:    # 打印候选挑整齐值
    B = A.copy(); B[:, 0] = Matrix(c)
    print(f"    col1->{c}: {B.det()}")
B = A.copy(); B[:, 0] = Matrix([1, 2, 1, 1])
chk("c1(2) 组合=1", B.det() == 1)

# ---------- 计算2：矩阵方程（关键矩阵 det=±1 ⇒ 整数解，双向验证） ----------
A = Matrix([[1, 2, 3], [2, 5, 7], [0, 1, 2]]); B = Matrix([[2, 1], [3, 2], [1, 1]])
chk("c2 detA=1", A.det() == 1)
X = A.inv() * B
chk("c2 X 整数", all(v.is_integer for v in X), str(X.tolist()))
chk("c2 代回 AX=B", sp.simplify(A * X - B) == zeros(3, 2))

# ---------- 计算3：极大无关组（rank + RREF 主元列 + 线性表示） ----------
M = Matrix([[1, 1, 2, 1], [2, 1, 3, 0], [0, 1, 1, 1], [1, 0, 1, 1]])  # 列为 α1..α4
chk("c3 rank=3 且主元(0,1,3)", M.rank() == 3 and M.rref()[1] == (0, 1, 3),
    f"rref={M.rref()[0].tolist()}")
chk("c3 α3=α1+α2", M[:, 2] == M[:, 0] + M[:, 1])

# ---------- 解答1：含参方程组（相容条件 + 特解/基础解系代回） ----------
A = Matrix([[1, 1, 2, 1], [2, 3, 1, 1], [3, 5, 0, 1], [3, 4, 3, 2]])
b = Matrix([2, 5, a, 7])
chk("s1 rankA=2", A.rank() == 2)
chk("s1 a=8 相容", A.row_join(b.subs(a, 8)).rank() == 2)
chk("s1 a≠8 矛盾", A.row_join(b.subs(a, 9)).rank() == 3)
chk("s1 特解", A * Matrix([1, 1, 0, 0]) == Matrix([2, 5, 8, 7]))
chk("s1 ξ1", A * Matrix([-5, 3, 1, 0]) == zeros(4, 1))
chk("s1 ξ2", A * Matrix([-2, 1, 0, 1]) == zeros(4, 1))

# ---------- 解答2：正交对角化（特征值重数 + 每个特征向量 + 正交性） ----------
A = Matrix([[1, -2, -2], [-2, 1, -2], [-2, -2, 1]])
chk("s2 特征值 {3:2,-3:1}", A.eigenvals() == {3: 2, -3: 1})
chk("s2 v(-3)=(1,1,1)", A * Matrix([1, 1, 1]) == -3 * Matrix([1, 1, 1]))
chk("s2 v(3)=(1,-1,0)", A * Matrix([1, -1, 0]) == 3 * Matrix([1, -1, 0]))
chk("s2 施密特结果(1,1,-2)", A * Matrix([1, 1, -2]) == 3 * Matrix([1, 1, -2])
    and Matrix([1, -1, 0]).dot(Matrix([1, 1, -2])) == 0)

# ---------- 解答3：特征多项式因式分解 / 可对角化判定 / 含参唯一性 ----------
A = Matrix([[1, -1, 2], [3, -3, 2], [-1, 2, -1]])
chk("s3 char=(λ+2)²(λ-1)",
    factor(A.charpoly(lam).as_expr()) == (lam - 1) * (lam + 2) ** 2)
chk("s3 几何重数1 ⇒ 不可对角化", (A + 2 * eye(3)).rank() == 2)
# 含参重根唯一性：char/(λ-1) 的商在 λ=1 处为零 ⇔ k=唯一值
Ak = Matrix([[2, 2, -1], [1, 3, -1], [3, 6, k]])
q, r = sp.div(sp.expand(Ak.charpoly(lam).as_expr()), lam - 1, lam)
chk("s3 (λ-1) 恒整除", sp.expand(r) == 0)
chk("s3 重根 ⇔ k=-2", sp.solve(q.subs(lam, 1), k) == [-2])

# ---------- 证明1：组合系数行列式非零 ----------
chk("p1 系数行列式=9", Matrix([[1, 0, 2], [2, 1, 0], [0, 2, 1]]).det() == 9)

print("=" * 60)
print(f"TOTAL: {sum(ok)}/{len(ok)} checks passed")
if not all(ok):
    raise SystemExit(1)
