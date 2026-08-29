// charts.js —— 零依赖 SVG 图表工具（圆环图 + 箱线图）。
// 所有函数返回 SVG 字符串，纯函数、不依赖 DOM。样式类名前缀 bp- 防冲突。

// 圆环图：ratio 0..1，中心显示 label（默认百分比）。用 stroke-dasharray 画弧。
function svgDonut(ratio, opts = {}) {
    const size = opts.size || 84;
    const stroke = opts.stroke || 10;
    const bg = opts.bg || '#e2e8f0';
    const fg = opts.fg || '#3b82f6';
    const clamped = Math.max(0, Math.min(1, ratio));
    const label = opts.label != null ? String(opts.label) : Math.round(clamped * 100) + '%';
    const r = (size - stroke) / 2;
    const C = 2 * Math.PI * r;
    const c = size / 2;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${bg}" stroke-width="${stroke}"></circle>
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${fg}" stroke-width="${stroke}"
            stroke-dasharray="${(clamped * C).toFixed(2)} ${C.toFixed(2)}"
            stroke-dashoffset="${C / 4}" stroke-linecap="round"></circle>
        <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central"
            font-size="${Math.round(size / 4)}" font-weight="700" fill="#334155">${label}</text>
    </svg>`;
}

// 线性插值分位数：sorted 升序数组，q∈[0,1]。
// 采用排他法（QUARTILE.EXC 语义，中位点不参与上下半区插值），
// 使 7 点样本 Q1=70 / 中位=85 / Q3=95，与 Task 1 校验命令一致。
function _quantile(sorted, q) {
    if (sorted.length === 1) return sorted[0];
    let pos = (sorted.length + 1) * q - 1;
    pos = Math.max(0, Math.min(pos, sorted.length - 1));
    const base = Math.floor(pos);
    const hi = Math.min(base + 1, sorted.length - 1);
    const rest = pos - base;
    return sorted[base] + rest * (sorted[hi] - sorted[base]);
}

function _fmt(v) { return Math.round(v * 10) / 10; }

// 横向箱线图：横轴分数 0..max；绘制 min/Q1/中位/Q3/max 箱须 + 中位线 + 刻度轴。
function svgBoxPlot(scores, opts = {}) {
    const width = opts.width || 380;
    const height = opts.height || 80;
    const max = opts.max || 100;
    const padL = 10, padR = 10, padT = 20, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const sorted = scores.slice().sort((a, b) => a - b);
    const min = sorted[0], maxV = sorted[sorted.length - 1];
    const q1 = _quantile(sorted, 0.25), med = _quantile(sorted, 0.5), q3 = _quantile(sorted, 0.75);
    const X = (v) => padL + (Math.max(0, Math.min(max, v)) / max) * plotW;
    const yTop = padT, yBot = padT + plotH, yMid = padT + plotH / 2;
    const boxX1 = X(q1), boxX2 = X(q3), medX = X(med);
    const parts = [];
    const line = (x1, y1, x2, y2, cls) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"></line>`;
    // 须 + 端点
    parts.push(line(X(min), yMid, X(q1), yMid, 'bp-whisker'));
    parts.push(line(X(q3), yMid, X(maxV), yMid, 'bp-whisker'));
    parts.push(line(X(min), yTop + 4, X(min), yBot - 4, 'bp-whisker'));
    parts.push(line(X(maxV), yTop + 4, X(maxV), yBot - 4, 'bp-whisker'));
    // 箱 + 中位线
    parts.push(`<rect x="${boxX1}" y="${yTop}" width="${boxX2 - boxX1}" height="${plotH}" rx="3" class="bp-box"></rect>`);
    parts.push(line(medX, yTop, medX, yBot, 'bp-median'));
    // 数值标注
    parts.push(`<text x="${padL}" y="${yTop - 6}" class="bp-label">min ${_fmt(min)}</text>`);
    parts.push(`<text x="${boxX1}" y="${yTop - 6}" text-anchor="middle" class="bp-label">Q1 ${_fmt(q1)}</text>`);
    parts.push(`<text x="${boxX2}" y="${yTop - 6}" text-anchor="middle" class="bp-label">Q3 ${_fmt(q3)}</text>`);
    parts.push(`<text x="${medX}" y="${yBot + 16}" text-anchor="middle" class="bp-medlabel">中位 ${_fmt(med)}</text>`);
    // 轴 + 刻度（0 / ½max / max）
    [0, max / 2, max].forEach(t => {
        parts.push(line(X(t), yBot, X(t), yBot + 5, 'bp-tick'));
        parts.push(`<text x="${X(t)}" y="${yBot + 18}" text-anchor="middle" class="bp-ticklabel">${_fmt(t)}</text>`);
    });
    parts.push(line(padL, yBot, width - padR, yBot, 'bp-axis'));
    return `<svg class="bp-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}">
        <style>
            .bp-box{fill:#bfdbfe;stroke:#2563eb;stroke-width:1.5}
            .bp-median{stroke:#1d4ed8;stroke-width:2}
            .bp-whisker{stroke:#64748b;stroke-width:1.5}
            .bp-axis{stroke:#94a3b8;stroke-width:1}
            .bp-tick{stroke:#94a3b8;stroke-width:1}
            .bp-label{font-size:10px;fill:#475569}
            .bp-medlabel{font-size:10px;fill:#1d4ed8;font-weight:700}
            .bp-ticklabel{font-size:10px;fill:#94a3b8}
        </style>
        ${parts.join('')}
    </svg>`;
}

// 分数段直方图：把 [0,max] 均分 bins 段，柱高 = 段内分数个数，柱顶标人数，底部标分段界点。
function svgHistogram(scores, opts = {}) {
    const width = opts.width || 380;
    const height = opts.height || 160;
    const max = opts.max ?? 100;
    const bins = opts.bins || 5;
    const padL = 40, padR = 10, padT = 14, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    if (!scores || !scores.length || max <= 0) return '';
    const counts = new Array(bins).fill(0);
    scores.forEach(s => { const b = Math.max(0, Math.min(bins - 1, Math.ceil((s / max) * bins) - 1)); counts[b]++; });
    const peak = Math.max.apply(null, counts) || 1;
    const barW = plotW / bins;
    const step = max / bins;
    const parts = [];
    for (let i = 0; i < bins; i++) {
        const h = Math.round((counts[i] / peak) * plotH);
        const x = padL + i * barW;
        const y = padT + plotH - h;
        parts.push(`<rect class="bp-bar" x="${x + 2}" y="${y}" width="${barW - 4}" height="${h}" rx="3"></rect>`);
        if (counts[i]) parts.push(`<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" class="bp-count">${counts[i]}</text>`);
        parts.push(`<text x="${x + barW / 2}" y="${height - 8}" text-anchor="middle" class="bp-ticklabel">${Math.round(i * step)}</text>`);
    }
    parts.push(`<text x="${width - padR}" y="${height - 8}" text-anchor="end" class="bp-ticklabel">${Math.round(max)}</text>`);
    parts.push(`<line class="bp-axis" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}"></line>`);
    return `<svg class="bp-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}">
        <style>
            .bp-bar{fill:#93c5fd;stroke:#2563eb;stroke-width:1}
            .bp-count{font-size:11px;fill:#1d4ed8;font-weight:700}
            .bp-ticklabel{font-size:10px;fill:#94a3b8}
            .bp-axis{stroke:#94a3b8;stroke-width:1}
        </style>
        ${parts.join('')}
    </svg>`;
}
