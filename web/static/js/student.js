// 学生端：试卷列表、答题（题目总览 + 拍照 + 文字输入）、提交、查看成绩
const _answers = {};      // no -> { answer_text, photo }
let _curPaper = null, _curQuestions = [], _photoTargetNo = null;

function switchStudentTab(tab) {
    $('tabStudentPapers').classList.toggle('active', tab === 'papers');
    $('tabStudentResult').classList.toggle('active', tab === 'result');
    $('tabStudentRecords').classList.toggle('active', tab === 'records');
    $('studentPapersView').classList.toggle('hidden', tab !== 'papers');
    $('studentAnswerView').classList.add('hidden');
    $('studentResultView').classList.toggle('hidden', tab !== 'result');
    $('studentRecordsView').classList.toggle('hidden', tab !== 'records');
    if (tab === 'papers') loadStudentPapers();
    else if (tab === 'records') loadStudentRecords();
    else loadStudentResults();
}

// 通用：记录条目渲染（list → .record-item；学生端与辅导员端共用）
function renderRecordItems(list, fn) {
    if (!list || !list.length) return '<span class="hint">暂无记录</span>';
    return list.map(fn).map(html => `<div class="record-item">${html}</div>`).join('');
}

async function loadStudentRecords() {
    const d = await authedJson('/api/student/records');
    $('studentRecordsContent').innerHTML = `
        <div class="records-col">
            <div class="records-col-head">🏫 旷课记录（${(d.attendance || []).length}）</div>
            <div class="records-list">${renderRecordItems(d.attendance, a => `📅 ${esc(a.record_date)}${a.note ? ' · ' + esc(a.note) : ''}`)}</div>
        </div>
        <div class="records-col">
            <div class="records-col-head">🌴 请假记录（${(d.leave || []).length}）</div>
            <div class="records-list">${renderRecordItems(d.leave, a => `📅 ${esc(a.start_date)}${a.end_date ? ' ~ ' + esc(a.end_date) : ''}${a.reason ? ' · ' + esc(a.reason) : ''}`)}</div>
        </div>
        <div class="records-col">
            <div class="records-col-head">⚠️ 学业警告（${(d.warnings || []).length}）</div>
            <div class="records-list">${renderRecordItems(d.warnings, w => `<span class="tag">${esc(w.level || '一般')}</span> ${esc(w.reason)}`)}</div>
        </div>`;
}

function paperStatusLabel(s) {
    if (s === 'graded') return '✅ 已批改';
    if (s === 'submitted') return '⏳ 待批改';
    return '📝 未作答';
}

async function loadStudentPapers() {
    const d = await authedJson('/api/student/papers');
    const papers = d.papers || [];
    $('studentPapersList').innerHTML = papers.length ? papers.map(p => `
        <div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">📄 ${esc(p.title)}</span>
                <span class="tag">${esc(p.subject || '')}</span>
            </div>
            <div class="paper-card-stats">
                <span>时长 ${p.duration || 120} 分钟</span>
                <span class="tag status-${esc(p.sub_status || 'none')}">${paperStatusLabel(p.sub_status)}</span>
                ${p.sub_status === 'graded' ? (p.score_visible
                    ? `<span>得分 ${p.score}</span>`
                    : `<span class="tag">⏳ 成绩待发布</span>`) : ''}
            </div>
            <div class="paper-card-actions">
                <button class="btn-small" onclick="openStudentPaper(${p.id})">
                    ${p.sub_status === 'graded' ? '查看成绩' : (p.sub_status === 'submitted' ? '查看状态' : '开始答题')}
                </button>
            </div>
        </div>`).join('') : '<p class="empty-row">老师还没有给你分发试卷</p>';
}

async function loadStudentResults() {
    const d = await authedJson('/api/student/papers');
    const graded = (d.papers || []).filter(p => p.sub_status === 'graded' && p.score_visible);
    $('studentResultContent').innerHTML = graded.length ? graded.map(p => `
        <div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">📄 ${esc(p.title)}</span>
                <span class="tag">${esc(p.subject || '')}</span>
            </div>
            <div class="paper-card-stats">
                <span class="score-big">${p.score} / ${p.total_score}</span>
                <span>${esc((p.submitted_at || '').slice(0, 16))}</span>
            </div>
            <div class="paper-card-actions">
                <button class="btn-small" onclick="showResult(${p.id})">查看逐题详情</button>
            </div>
        </div>`).join('') : '<p class="empty-row">暂无已批改的试卷</p>';
}

async function openStudentPaper(pid) {
    const p = await authedJson(`/api/student/papers/${pid}`);
    if (p.submission && p.submission.status === 'graded' && !p.score_visible) {
        alert('成绩待发布，请耐心等待老师发布');
        return;
    }
    if (p.submission && p.submission.status === 'graded') { showResult(pid); return; }
    if (p.submission && p.submission.status === 'submitted') {
        alert('已提交，请等待老师批改');
        return;
    }
    // 开始答题
    _curPaper = p; _curQuestions = p.questions || [];
    Object.keys(_answers).forEach(k => delete _answers[k]);
    $('studentPaperTitle').textContent = p.title + '（' + (p.subject || '') + '）';
    renderAnswerSheet();
    $('studentPapersView').classList.add('hidden');
    $('studentResultView').classList.add('hidden');
    $('studentAnswerView').classList.remove('hidden');
    $('tabStudentPapers').classList.add('active');
    $('tabStudentResult').classList.remove('active');
}

function renderAnswerSheet() {
    // 题目小格子总览
    $('studentGrid').innerHTML = _curQuestions.map(q => `
        <div class="q-grid-item" id="grid_${q.no}" onclick="scrollToQuestion(${q.no})">${q.no}</div>`).join('');
    $('studentPaperContent').innerHTML = _curQuestions.map(q => `
        <div class="answer-question" id="q_${q.no}" data-no="${q.no}">
            <div class="answer-q-head">
                <span class="answer-q-no">第 ${q.no} 题</span>
                <span class="tag">${esc(q.type)}</span>
                <span class="tag">${q.score} 分</span>
            </div>
            <div class="answer-q-content">${renderMath(escMath(q.content || ''))}</div>
            <textarea class="answer-input" data-no="${q.no}" rows="3" placeholder="在此输入答案（支持公式，也可拍照上传）" oninput="markAnswered(${q.no})"></textarea>
            <div class="answer-photo-row">
                <button class="btn-small" onclick="pickPhoto(${q.no})">📷 拍照上传</button>
                <span class="photo-preview" id="photo_${q.no}"></span>
            </div>
        </div>`).join('');
}

function markAnswered(no) {
    const ta = document.querySelector(`.answer-input[data-no="${no}"]`);
    const has = ((ta && ta.value.trim()) || _answers[no]?.photo);
    const g = $('grid_' + no);
    if (g) g.classList.toggle('answered', !!has);
}

function scrollToQuestion(no) {
    const el = $('q_' + no);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function pickPhoto(no) {
    _photoTargetNo = no;
    $('photoInput').click();
}

$('photoInput').addEventListener('change', async () => {
    const file = $('photoInput').files[0];
    if (!file || _photoTargetNo == null) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
        const d = await authedJson('/api/upload', { method: 'POST', body: fd });
        _answers[_photoTargetNo] = _answers[_photoTargetNo] || {};
        _answers[_photoTargetNo].photo = d.path;
        $('photo_' + _photoTargetNo).innerHTML = `<img class="photo-thumb" src="${esc(d.path)}" alt="已上传">`;
        markAnswered(_photoTargetNo);
    } catch (e) {
        alert('上传失败：' + e.message);
    }
    $('photoInput').value = '';
    _photoTargetNo = null;
});

$('btnStudentSubmit').addEventListener('click', async () => {
    if (!_curPaper) return;
    const unanswered = _curQuestions.filter(q => {
        const a = _answers[q.no];
        const ta = document.querySelector(`.answer-input[data-no="${q.no}"]`);
        return !(a && a.photo) && !(ta && ta.value.trim());
    }).length;
    if (!confirm(`确认提交？${unanswered ? '还有 ' + unanswered + ' 题未作答。' : '所有题目均已作答。'}提交后不可修改。`)) return;
    const answers = _curQuestions.map(q => ({
        no: q.no,
        answer_text: document.querySelector(`.answer-input[data-no="${q.no}"]`)?.value?.trim() || '',
    }));
    const photos = {};
    Object.entries(_answers).forEach(([no, a]) => { if (a.photo) photos[no] = a.photo; });
    await authedJson(`/api/student/papers/${_curPaper.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, photos }),
    });
    alert('提交成功！请等待老师批改。');
    _curPaper = null; _curQuestions = [];
    switchStudentTab('papers');
});

async function showResult(pid) {
    const p = await authedJson(`/api/student/papers/${pid}`);
    if (p.submission && p.submission.status === 'graded' && !p.score_visible) { alert('成绩待发布'); return; }
    const sub = p.submission || {};
    const amap = {}; (sub.answers || []).forEach(a => amap[a.no] = a);
    const fmap = {}; (sub.ai_feedback || []).forEach(f => fmap[f.no] = f);
    const photos = p.submission?.photos || {};
    const qs = p.questions || [];
    $('studentResultContent').innerHTML = `
        <div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">📄 ${esc(p.title)}</span>
                <span class="tag">${esc(p.subject || '')}</span>
            </div>
            <div class="result-total">
                总分 <span class="score-big">${sub.total_score ?? 0} / ${p.total_score ?? 0}</span>
                <span class="tag status-${esc(sub.status)}">${paperStatusLabel(sub.status)}</span>
            </div>
            ${sub.comment ? `<div class="result-summary">📝 老师总评：${renderMath(escMath(sub.comment))}</div>` : ''}
        </div>
        ${qs.map(q => {
            const f = fmap[q.no] || {};
            const a = amap[q.no] || {};
            const ph = photos[q.no];
            return `
            <div class="paper-card result-q">
                <div class="answer-q-head">
                    <span class="answer-q-no">第 ${q.no} 题</span>
                    <span class="tag">${esc(q.type)}</span>
                    <span class="tag">${q.score} 分</span>
                    <span class="${f.correct ? 'ok' : (f.correct === false ? 'bad' : '')}" style="margin-left:auto">
                        ${f.score != null ? '得分 ' + f.score + ' / ' + f.max : '待老师评分'}
                    </span>
                </div>
                <div class="answer-q-content">${renderMath(escMath(q.content || ''))}</div>
                <div class="result-answer"><strong>你的作答：</strong>${renderMath(escMath(a.answer_text || '')) || '<span class="hint">（未作答）</span>'}
                    ${ph ? `<img class="photo-thumb" src="${esc(ph)}">` : ''}
                </div>
                ${q.answer ? `<div class="result-ref"><strong>参考答案：</strong>${renderMath(escMath(q.answer))}</div>` : ''}
                ${f.comment ? `<div class="result-comment"><strong>评语：</strong>${renderMath(escMath(f.comment))}</div>` : ''}
            </div>`;
        }).join('')}`;
    $('studentPapersView').classList.add('hidden');
    $('studentAnswerView').classList.add('hidden');
    $('studentResultView').classList.remove('hidden');
    $('tabStudentResult').classList.add('active');
    $('tabStudentPapers').classList.remove('active');
}
