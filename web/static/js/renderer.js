// 试卷渲染 + 每题替换（KaTeX 由 index.html 通过 CDN 引入，全局 katex）
async function loadTemplate(name) {
    const resp = await fetch(`/static/papers/${name}.html`);
    return await resp.text();
}

function questionHTML(q) {
    const content = (q.content || '').replace(/\\\(/g, '$').replace(/\\\)/g, '$');
    return `
        <li class="paper-question" data-no="${q.no}" data-id="${q.id || ''}">
            <div class="paper-question-head">
                <span class="paper-qno">${q.no}.</span>
                <span class="paper-qtype">（${esc(q.type)}，${q.score} 分）</span>
                <button class="btn-replace" onclick="openReplace(${q.no})">🔄 替换</button>
            </div>
            <div class="paper-qcontent">${renderMath(escMath(content))}</div>
        </li>`;
}

function renderMath(text) {
    if (window.katex) {
        return text.replace(/\$\$([\s\S]+?)\$\$/g, (m, expr) =>
            katex.renderToString(expr.trim(), { throwOnError: false, displayMode: true })
        ).replace(/\$([^\$\n]+?)\$/g, (m, expr) =>
            katex.renderToString(expr.trim(), { throwOnError: false, displayMode: false })
        );
    }
    return text;
}

function escMath(text) {
    // 分段转义：按数学段（$$...$$ / $...$）切分，数学段保留、非数学段 esc()，避免 LaTeX 被 HTML 转义破坏
    const s = String(text == null ? '' : text);
    return s.split(/(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g).map(part => {
        if (part.startsWith('$')) return part; // 数学段保留
        return esc(part);                       // 非数学段转义
    }).join('');
}

function renderPaper(questions, templateName, meta) {
    const qhtml = (questions || []).map(questionHTML).join('');
    const total = (questions || []).reduce((s, q) => s + (q.score || 0), 0);
    loadTemplate(templateName).then(tpl => {
        const html = tpl
            .replaceAll('{{TITLE}}', esc(meta.title || '试卷'))
            .replaceAll('{{SUBJECT}}', esc(meta.subject || ''))
            .replaceAll('{{TOTAL_SCORE}}', total)
            .replaceAll('{{DURATION}}', meta.duration || 120)
            .replaceAll('{{QUESTIONS}}', qhtml);
        const el = $('paperRender');
        el.innerHTML = html;
        el.classList.remove('hidden');
    });
}

let _replaceNo = null; // 当前正在替换的题号（侧栏常驻，不再每次弹窗）

function openReplace(no) {
    const q = (S.questions || []).find(x => String(x.no) === String(no));
    if (!q) return;
    _replaceNo = q.no;
    $('replaceTarget').textContent = `第 ${q.no} 题`;
    $('replaceMatchHint').textContent = `匹配条件：${q.type || ''} / ${q.topic || ''} / ${q.difficulty || ''}`;
    $('replaceSide').classList.remove('hidden');
    switchReplaceTab('bank');
    // 高亮试卷中当前被替换的题目
    document.querySelectorAll('.paper-question').forEach(el =>
        el.classList.toggle('selected', String(el.dataset.no) === String(q.no)));
    loadReplaceBank(q);
}

function closeReplace() {
    $('replaceSide').classList.add('hidden');
    _replaceNo = null;
    document.querySelectorAll('.paper-question').forEach(el => el.classList.remove('selected'));
}

function switchReplaceTab(tab) {
    document.querySelectorAll('#replaceSide .tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === tab));
    $('replaceBankPanel').classList.toggle('hidden', tab !== 'bank');
    $('replaceAiPanel').classList.toggle('hidden', tab !== 'ai');
}

async function loadReplaceBank(q) {
    const list = $('replaceBankList');
    list.innerHTML = '加载中…';
    const params = new URLSearchParams({ subject: $('subject').value || '', type: q.type || '', difficulty: q.difficulty || '', topic: q.topic || '' });
    const resp = await apiFetch(`/api/questionbank/list?${params.toString()}`);
    list.innerHTML = (resp.questions || []).length
        ? resp.questions.map(c => `
            <div class="replace-item">
                <div>${renderMath(esc(c.content)).slice(0, 120)}…</div>
                <button class="btn-small" onclick="applyReplace(${q.no}, ${c.id})">替换</button>
            </div>`).join('')
        : '<p class="empty-row">题库无匹配题目，可切到「AI 生成备选」</p>';
}

async function genReplaceAlt() {
    if (_replaceNo == null) return;
    const list = $('replaceAiList');
    list.innerHTML = '⏳ 生成中…';
    try {
        await streamSSE(`/api/session/${S.sessionId}/step5/alternatives?no=${_replaceNo}`, {
            log: (d) => { list.innerHTML = '⏳ ' + d; },
            result: (d) => {
                let alts = [];
                try { alts = JSON.parse(d).alternatives || []; } catch (e) { alts = []; }
                window._alts = alts;
                list.innerHTML = alts.length
                    ? alts.map((a, i) => `
                        <div class="replace-item">
                            <div>${renderMath(esc(a.content)).slice(0, 120)}…</div>
                            <button class="btn-small" onclick="applyAlt(${_replaceNo}, ${i})">替换</button>
                            <button class="btn-small" onclick="saveAlt(${_replaceNo}, ${i})">入库</button>
                        </div>`).join('')
                    : '<p class="empty-row">未生成备选（可重试）</p>';
            },
            error: (d) => { list.innerHTML = '❌ ' + d; },
        });
    } catch (err) {
        list.innerHTML = '❌ ' + (err && err.message ? err.message : err);
    }
}

async function applyReplace(no, bankId) {
    const q = (S.questions || []).find(x => String(x.no) === String(no));
    if (!q) return;
    const target = await apiFetch(`/api/questionbank/${bankId}`);
    q.content = target.content; q.answer = target.answer; q.analysis = target.analysis;
    renderPaper(S.questions, $('paperTemplate').value, currentPaperMeta());
    closeReplace();
}

function applyAlt(no, altIndex) {
    const q = (S.questions || []).find(x => String(x.no) === String(no));
    const a = window._alts?.[altIndex];
    if (!q || !a) return;
    q.content = a.content; q.answer = a.answer; q.analysis = a.analysis;
    renderPaper(S.questions, $('paperTemplate').value, currentPaperMeta());
    closeReplace();
}

function saveAlt(no, altIndex) {
    const q = (S.questions || []).find(x => String(x.no) === String(no));
    const a = window._alts?.[altIndex];
    if (!q || !a) return;
    postJson('/api/questionbank/', {
        subject: $('subject').value || '', type: q.type, difficulty: q.difficulty,
        chapter: q.chapter, topic: q.topic, content: a.content, answer: a.answer,
        analysis: a.analysis, source: 'ai',
    }).then(() => alert('已入库'));
}

// 侧栏一次性绑定（面板常驻，避免每次点替换重复绑定）
document.querySelectorAll('#replaceSide .tab').forEach(t =>
    t.addEventListener('click', () => switchReplaceTab(t.dataset.tab)));
$('replaceBtnGenAlt').addEventListener('click', genReplaceAlt);
