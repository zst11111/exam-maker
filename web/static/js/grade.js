// 教师批改页：提交列表 + AI 批改 + 逐题改分/评语 + 总评 + 发布成绩 + 按错题推题
let _gradePaperId = null, _gradeQuestions = [], _gradeSubs = [], _feedbacks = {}, _summaries = {};

async function openGrade(pid) {
    _gradePaperId = pid;
    const d = await authedJson(`/api/papers/${pid}/submissions`);
    _gradeQuestions = d.questions || [];
    _gradeSubs = d.submissions || [];
    _feedbacks = {};
    _summaries = {};
    _gradeSubs.forEach(s => {
        _feedbacks[s.id] = (s.ai_feedback && s.ai_feedback.length)
            ? s.ai_feedback
            : _gradeQuestions.map(q => ({ no: q.no, score: null, max: q.score, comment: '', correct: null }));
        _summaries[s.id] = s.comment || '';
    });
    const paper = await authedJson(`/api/papers/${pid}`);
    $('gradeTitle').textContent = '批改试卷：' + paper.title;
    ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView']
        .forEach(id => $(id).classList.add('hidden'));
    $('gradeView').classList.remove('hidden');
    renderGradeList();
}

function renderGradeList() {
    $('gradeList').innerHTML = _gradeSubs.length
        ? _gradeSubs.map(s => gradeCard(s)).join('')
        : '<p class="empty-row">暂无学生提交（先「分发」试卷给学生）</p>';
}

function gradeCard(s) {
    const fb = _feedbacks[s.id] || [];
    const amap = {}; (s.answers || []).forEach(a => amap[a.no] = a);
    const total = fb.reduce((t, f) => t + ((f.score != null && !isNaN(f.score)) ? Number(f.score) : 0), 0);
    const shown = s.status === 'graded' ? (s.total_score ?? total) : (total || '—');
    return `
    <div class="paper-card grade-card">
        <div class="paper-card-head">
            <span class="paper-card-title">🧑‍🎓 ${esc(s.name)}</span>
            <span class="tag">${esc(s.class_name || '')}</span>
            <span class="hint">${esc(s.student_no || '')}</span>
            <span class="tag status-${esc(s.status)}">${statusLabel(s.status)}</span>
            <span class="score-big" style="margin-left:auto">${shown}</span>
        </div>
        <div class="grade-rows">
            ${_gradeQuestions.map(q => {
                const f = fb.find(x => String(x.no) === String(q.no)) || {};
                const a = amap[q.no] || {};
                const ph = (s.photos || {})[q.no];
                return `
                <div class="grade-row">
                    <div class="grade-row-main">
                        <div class="grade-q-title">
                            <span class="q-no-badge">第 ${q.no} 题</span>
                            <span class="tag">${esc(q.type)}</span>
                            <span class="q-score">${q.score} 分</span>
                        </div>
                        <div class="grade-q-content">${renderMath(escMath(q.content || ''))}</div>
                        <div class="grade-answer"><strong>答：</strong>${renderMath(escMath(a.answer_text || '')) || '<span class="hint">（未作答）</span>'}${ph ? `<img class="photo-thumb" src="${esc(ph)}">` : ''}</div>
                        ${q.answer ? `<div class="grade-ref"><strong>参考答案：</strong>${renderMath(escMath(q.answer))}</div>` : ''}
                        <div class="grade-comment-row">
                            <span class="hint">评语：</span>
                            <input class="comment-input" data-sid="${s.id}" data-no="${q.no}" value="${esc(f.comment || '')}" placeholder="可覆盖 AI 评语">
                        </div>
                    </div>
                    <div class="grade-score">
                        <input type="number" class="score-input" data-sid="${s.id}" data-no="${q.no}" value="${f.score != null ? f.score : ''}" placeholder="分" min="0" max="${q.score}" step="0.5">
                        <span class="hint">/ ${q.score}</span>
                    </div>
                </div>`;
            }).join('')}
        </div>
        <div class="grade-summary-row">
            <span class="hint">整份总评：</span>
            <textarea class="grade-summary" data-sid="${s.id}" rows="2" placeholder="给学生的总评（可选）">${esc(_summaries[s.id] || '')}</textarea>
        </div>
        <div class="paper-card-actions">
            <button class="btn-small" onclick="aiGrade(${s.id})">🤖 AI 批改</button>
            <button class="btn-small" onclick="openPractice(${s.id})">🎯 按错题推练习</button>
            <button class="btn-small btn-primary-inline" onclick="finalizeGrade(${s.id})">✅ 发布成绩</button>
        </div>
    </div>`;
}

$('gradeList').addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('score-input')) {
        const sid = parseInt(t.dataset.sid, 10);
        const no = t.dataset.no;
        const item = (_feedbacks[sid] || []).find(x => String(x.no) === no);
        if (item) item.score = t.value === '' ? null : Number(t.value);
    } else if (t.classList.contains('comment-input')) {
        const sid = parseInt(t.dataset.sid, 10);
        const no = t.dataset.no;
        const item = (_feedbacks[sid] || []).find(x => String(x.no) === no);
        if (item) item.comment = t.value;
    } else if (t.classList.contains('grade-summary')) {
        _summaries[parseInt(t.dataset.sid, 10)] = t.value;
    }
});

async function aiGrade(sid) {
    try {
        const d = await authedJson(`/api/submissions/${sid}/grade`, { method: 'POST' });
        _feedbacks[sid] = d.feedback || [];
        const sub = _gradeSubs.find(x => x.id === sid);
        if (sub) { sub.total_score = d.total_score; sub.ai_feedback = d.feedback; }
        renderGradeList();
    } catch (e) {
        alert('AI 批改失败：' + (e && e.message ? e.message : e));
    }
}

async function finalizeGrade(sid) {
    const fb = _feedbacks[sid] || [];
    const ungraded = fb.filter(f => f.score == null).length;
    if (ungraded && !confirm(`还有 ${ungraded} 题未评分，将按 0 分计，确认发布？`)) return;
    const clean = fb.map(f => Object.assign({}, f, { score: f.score == null ? 0 : Number(f.score) }));
    const total = clean.reduce((t, f) => t + (Number(f.score) || 0), 0);
    await authedJson(`/api/submissions/${sid}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: clean, total_score: total, comment: _summaries[sid] || '' }),
    });
    alert('成绩已发布');
    openGrade(_gradePaperId);
}

// ═══════════════════════════════════════════════════════════
// 按错题知识点推题（半自动勾选确认）
// ═══════════════════════════════════════════════════════════
let _practiceSid = null, _practiceCandidates = [];

async function openPractice(sid) {
    _practiceSid = sid;
    $('practiceList').innerHTML = '加载中…';
    $('practiceModal').classList.remove('hidden');
    try {
        const d = await authedJson(`/api/submissions/${sid}/practice`);
        _practiceCandidates = d.candidates || [];
        $('practiceTitle').textContent = `按错题知识点推题 — ${d.student.name}（${d.student.class_name || ''}）`;
        $('practiceHint').textContent = d.wrong_count
            ? `错题 ${d.wrong_count} 道，涉及知识点见下方标签`
            : '暂未检测到错题（请先点「🤖 AI 批改」）';
        $('practiceTopics').innerHTML = (d.wrong_topics || []).length
            ? (d.wrong_topics || []).map(t => `<span class="tag source-tag src-ai">${esc(t)}</span>`).join('')
            : '<span class="hint">（错题未标注知识点，按学科兜底匹配）</span>';
        renderPracticeList();
    } catch (e) {
        $('practiceList').innerHTML = '<p class="empty-row">加载失败：' + esc(e.message) + '</p>';
    }
}

function renderPracticeList() {
    $('practiceList').innerHTML = _practiceCandidates.length
        ? _practiceCandidates.map(q => `
            <label class="practice-item">
                <input type="checkbox" class="practice-cb" value="${q.id}">
                <div class="practice-item-body">
                    <div class="practice-item-meta">
                        <span class="tag">${esc(q.type)}</span>
                        <span class="tag">${esc(q.difficulty)}</span>
                        ${q.topic ? `<span class="tag source-tag src-teacher">${esc(q.topic)}</span>` : ''}
                        <span class="tag source-tag src-paper">${esc(sourceLabel(q.source))}</span>
                    </div>
                    <div class="practice-item-content">${renderMath(escMath(q.content || ''))}</div>
                </div>
            </label>`).join('')
        : '<p class="empty-row">题库中暂无匹配这些知识点的题目（可先去「题库管理」补充）</p>';
}

function closePractice() {
    $('practiceModal').classList.add('hidden');
    _practiceSid = null;
    _practiceCandidates = [];
}

$('btnPracticeSave').addEventListener('click', async () => {
    if (_practiceSid == null) return;
    const ids = [...document.querySelectorAll('.practice-cb:checked')].map(cb => parseInt(cb.value, 10));
    if (!ids.length) { alert('请至少勾选一道题'); return; }
    try {
        const d = await authedJson(`/api/submissions/${_practiceSid}/practice`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question_ids: ids }),
        });
        alert(`已生成练习卷「${d.title}」（${d.count} 题，共 ${d.total_score} 分）并分发给该学生`);
        closePractice();
    } catch (e) {
        alert('生成失败：' + (e && e.message ? e.message : e));
    }
});
