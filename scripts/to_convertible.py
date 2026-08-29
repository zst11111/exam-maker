# -*- coding: utf-8 -*-
"""把出卷 LaTeX 变成 pandoc 安全副本（原件不动）。用法：python to_convertible.py paper-1.tex
应用 io-and-conversion.md 的替换表：\\score{n}→（n分）、pingfen→评分说明+itemize、\\xlongequal→\\overset、\\blank→下划线。"""
import re, sys, pathlib

def convert(text: str) -> str:
    text = re.sub(r'\\score\{(\d+)\}', r'（\1分）', text)          # 行末步骤分
    text = text.replace(r'\begin{pingfen}', r'\textbf{评分说明：}\begin{itemize}')
    text = text.replace(r'\end{pingfen}', r'\end{itemize}')
    text = re.sub(r'\\xlongequal\{([^}]*)\}', r'\\overset{\1}{=}', text)  # docx OMML 不识别
    text = re.sub(r'\\blank\b', r'\\underline{\\hspace{2.8cm}}', text)
    return text

for arg in sys.argv[1:]:
    p = pathlib.Path(arg)
    out = p.with_suffix('.conv.tex')
    out.write_text(convert(p.read_text(encoding='utf-8')), encoding='utf-8')
    print(f'{p.name} -> {out.name}')
