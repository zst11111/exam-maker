// 教师批改页：提交列表 + 左侧进度窗格（已批改/未批改）+ AI 批改 + 逐题改分/评语 + 总评 + 发布成绩 + 按错题推题
let _gradePaperId = null, _gradePaper = null, _gradeQuestions = [], _gradeSubs = [], _feedbacks = {}, _summaries = {};
let _gradeDistributions = [], _gradeFilter = 'all'; // all | graded | submitted | none

async function openGrade(pid, focusSid) {
    _gradePaperId = pid;
    const [d, dist] = await Promise.all([
        authedJson(`/api/papers/${pid}/submissions`),
        authedJson(`/api/papers/${pid}/distributions`),
    ]);
    _gradeQuestions = d.questions || [];
    _gradeSubs = d.submissions || [];
    _gradeDistributions = dist.distributions || [];
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
    ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView', 'examManageView', 'gradeOverviewView', 'myPapersView']
        .forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    $('gradeView').classList.remove('hidden');
    _gradePaperId = pid;
    _gradePaper = paper;
    const btnPub = $('btnPublishPaper');
    if (btnPub) {
        btnPub.classList.toggle('hidden', !!paper.is_practice);
        btnPub.textContent = paper.published ? '📋 查看整卷成绩' : '📣 发布整卷成绩';
    }
    renderGradeSidebar();
    renderGradeList();
    if (focusSid) focusStudentCard(focusSid);
}

// ── 左侧进度窗格：已批改 / 未批改（待批）/ 未提交 计数 + 快速跳转，不用一直往下翻 ──
const _GRADE_SB_TABS = [
    { key: 'all', label: '全部' },
    { key: 'submitted', label: '未批改' },
    { key: 'graded', label: '已批改' },
    { key: 'none', label: '未提交' },
];

function _gradeStatusLabel(st) {
    if (st === 'graded') return '已批改';
    if (st === 'submitted') return '待批改';
    return '未提交';
}

function renderGradeSidebar() {
    const ro = _gradeDistributions || [];
    const counts = {
        all: ro.length,
        graded: ro.filter(d => d.status === 'graded').length,
        submitted: ro.filter(d => d.status === 'submitted').length,
        none: ro.filter(d => d.status == null).length,
    };
    const filtered = ro.filter(d => {
        if (_gradeFilter === 'all') return true;
        if (_gradeFilter === 'none') return d.status == null;
        return d.status === _gradeFilter;
    });
    $('gradeSidebar').innerHTML = `
        <div class="grade-sidebar-head">批改进度</div>
        <div class="grade-sidebar-chips">
            ${_GRADE_SB_TABS.map(t => `
                <button class="sb-chip ${_gradeFilter === t.key ? 'active' : ''}" onclick="setGradeFilter('${t.key}')">${t.label} ${counts[t.key]}</button>`).join('')}
        </div>
        <div class="grade-sidebar-list">
            ${filtered.length ? filtered.map(d => `
                <div class="grade-sb-row ${d.sub_id == null ? 'muted' : ''}"
                     onclick="gradeSidebarJump(${d.sub_id == null ? 'null' : d.sub_id}, ${d.sub_id == null ? 'false' : 'true'})"
                     title="${_gradeStatusLabel(d.status)}${d.status === 'graded' ? ' · 得分 ' + d.total_score : ''}">
                    <span class="grade-sb-name">${esc(d.name)}</span>
                    <span class="tag status-${esc(d.status || 'none')}">${_gradeStatusLabel(d.status)}</span>
                    ${d.status === 'graded' ? `<span class="grade-sb-score">${d.total_score ?? '—'}</span>` : ''}
                </div>`).join('')
            : '<span class="hint">该状态下暂无学生</span>'}
        </div>`;
}

function setGradeFilter(key) {
    _gradeFilter = key;
    renderGradeSidebar();
    renderGradeList();
}

function gradeSidebarJump(sid, hasSub) {
    if (!hasSub) { alert('该生尚未作答，无可批改内容'); return; }
    focusStudentCard(sid);
}

function renderGradeList() {
    const list = _gradeSubs.filter(s => {
        if (_gradeFilter === 'all') return true;
        if (_gradeFilter === 'none') return false;
        return s.status === _gradeFilter;
    });
    $('gradeList').innerHTML = list.length
        ? list.map(s => gradeCard(s)).join('')
        : (_gradeFilter === 'none'
            ? '<p class="empty-row">暂无未提交学生</p>'
            : '<p class="empty-row">暂无学生提交（先「分发」试卷给学生）</p>');
}

function focusStudentCard(sid) {
    const card = document.getElementById('grade-card-' + sid);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('grade-card-focus');
    setTimeout(() => card.classList.remove('grade-card-focus'), 2200);
}

function gradeCard(s) {
    const fb = _feedbacks[s.id] || [];
    const amap = {}; (s.answers || []).forEach(a => amap[a.no] = a);
    const total = fb.reduce((t, f) => t + ((f.score != null && !isNaN(f.score)) ? Number(f.score) : 0), 0);
    const shown = s.status === 'graded' ? (s.total_score ?? total) : (total || '—');
    return `
    <div class="paper-card grade-card" id="grade-card-${s.id}">
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
            <button class="btn-small btn-primary-inline" onclick="finalizeGrade(${s.id})">✅ 定稿</button>
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
    if (ungraded && !confirm(`还有 ${ungraded} 题未评分，将按 0 分计，确认定稿？`)) return;
    const clean = fb.map(f => Object.assign({}, f, { score: f.score == null ? 0 : Number(f.score) }));
    const total = clean.reduce((t, f) => t + (Number(f.score) || 0), 0);
    await authedJson(`/api/submissions/${sid}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: clean, total_score: total, comment: _summaries[sid] || '' }),
    });
    alert('已定稿（结果已存，学生端将在你「发布整卷成绩」后可见）');
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

// ═══════════════════════════════════════════════════════════
// 发布整卷成绩：已发布所有学生成绩一览，避免重复发布
// ═══════════════════════════════════════════════════════════
let _pubPaperId = null, _pubPaper = null, _pubDists = [];

async function openPublishModal(pid) {
    _pubPaperId = pid;
    try {
        const [paper, dist] = await Promise.all([
            authedJson(`/api/papers/${pid}`),
            authedJson(`/api/papers/${pid}/distributions`),
        ]);
        _pubPaper = paper;
        _pubDists = dist.distributions || [];
    } catch (e) {
        alert('加载成绩失败：' + (e && e.message ? e.message : e));
        return;
    }
    renderPublishModal();
    $('publishModal').classList.remove('hidden');
}

function renderPublishModal() {
    const p = _pubPaper || {};
    const dists = _pubDists || [];
    const graded = dists.filter(d => d.status === 'graded').length;
    const submitted = dists.filter(d => d.status === 'submitted').length;
    const none = dists.length - graded - submitted;
    $('publishTitle').textContent = '发布整卷成绩：' + (p.title || '');
    $('publishHint').textContent = `共分发 ${dists.length} 人 · 已批改 ${graded} · 待批改 ${submitted} · 未提交 ${none}`;
    $('publishStatus').innerHTML = p.published
        ? `<span class="tag pub-yes">✅ 成绩已发布${p.published_at ? '（' + esc(String(p.published_at).slice(0, 16)) + '）' : ''}</span>`
        : `<span class="tag pub-no">⏳ 尚未发布（发布后学生端可见所有已批改分数与反馈）</span>`;
    $('publishTableBody').innerHTML = dists.length ? dists.map(d => `
        <tr>
            <td>🧑‍🎓 ${esc(d.name)}</td>
            <td class="hint">${esc(d.student_no || '')}</td>
            <td class="hint">${esc(d.class_name || '')}</td>
            <td><span class="tag status-${esc(d.status || 'none')}">${_gradeStatusLabel(d.status)}</span></td>
            <td>${d.status === 'graded' ? (d.total_score ?? '—') : '—'}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="empty-row">该卷尚未分发给任何学生</td></tr>';
    const btn = $('btnPublishConfirm');
    if (btn) {
        btn.classList.toggle('hidden', !!p.published);
        btn.disabled = graded === 0;
        btn.title = graded === 0 ? '尚无已批改成绩' : '';
    }
}

async function confirmPublish(pid) {
    const graded = (_pubDists || []).filter(d => d.status === 'graded').length;
    if (!graded) { alert('尚无已批改成绩可发布'); return; }
    if (!confirm('确定发布整卷成绩？发布后学生端将可见所有已批改分数与反馈。')) return;
    await authedJson(`/api/papers/${pid}/publish`, { method: 'POST' });
    if (_pubPaper) { _pubPaper.published = true; _pubPaper.published_at = new Date().toISOString().slice(0, 19); }
    renderPublishModal();
    if (typeof loadExamManage === 'function') await loadExamManage();
    if (typeof loadHome === 'function') await loadHome();
    if (typeof refreshMyPapers === 'function') refreshMyPapers();
    alert('成绩已发布，学生端现在可以查看分数');
}

function closePublishModal() {
    $('publishModal').classList.add('hidden');
    _pubPaperId = null;
}
