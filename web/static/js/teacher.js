// 教师端：首页（考情总览）、考试管理、我的试卷、分发、学情
const _T_TABS = { home: 'tabHome', exam: 'tabExam', mypapers: 'tabMyPapers', wizard: 'tabWizard', bank: 'tabBank', analytics: 'tabAnalytics' };
const _ALL_VIEWS = ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView', 'examManageView', 'gradeOverviewView', 'myPapersView'];

function switchTeacherTab(tab) {
    _ALL_VIEWS.forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    Object.entries(_T_TABS).forEach(([k, id]) => {
        const el = $(id); if (el) el.classList.toggle('active', k === tab);
    });
    if (tab === 'home') { $('teacherHome').classList.remove('hidden'); loadHome(); }
    else if (tab === 'exam') { $('examManageView').classList.remove('hidden'); loadExamManage(); }
    else if (tab === 'mypapers') { $('myPapersView').classList.remove('hidden'); loadMyPapers(); }
    else if (tab === 'wizard') { $('wizardWrap').classList.remove('hidden'); }
    else if (tab === 'bank') { $('bankView').classList.remove('hidden'); loadBankList(); }
    else if (tab === 'analytics') { $('teacherAnalytics').classList.remove('hidden'); loadAnalytics(); }
}

function backToHome() { switchTeacherTab('home'); }

let _papersCache = [];
let _papersTab = 'formal';

async function loadHome() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    renderExamOverview();
    renderScoreHistograms();
}

async function loadMyPapers() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    renderPapersTabs();
}

function refreshMyPapers() { renderPapersTabs(); }

function renderPapersTabs() {
    const formal = _papersCache.filter(p => !p.is_practice);
    const practice = _papersCache.filter(p => p.is_practice);
    $('myPapersFormal').innerHTML = formal.length
        ? formal.map(paperCard).join('')
        : '<p class="empty-row">还没有正式试卷，去「出试卷」页创建一张吧</p>';
    $('myPapersPractice').innerHTML = practice.length
        ? practice.map(practiceCard).join('')
        : '<p class="empty-row">还没有错题推送卷（批改后点「🎯 按错题推练习」生成）</p>';
}

// ── 首页考情列表（只读）──
function renderExamOverview() {
    const exams = _papersCache.filter(p => !p.is_practice && (p.distributed_count || 0) > 0);
    $('examOverviewList').innerHTML = exams.length
        ? exams.map(examOverviewCard).join('')
        : '<p class="empty-row">暂无已分发的正式考试（先在「我的试卷」中分发）</p>';
}

function examOverviewCard(p) {
    const dist = p.distributed_count || 0, sub = p.submitted_count || 0, graded = p.graded_count || 0;
    const unsub = dist - sub, ungraded = sub - graded;
    const subRatio = dist ? sub / dist : 0;
    const gradeRatio = sub ? graded / sub : 0;
    return `
    <div class="paper-card exam-overview-card">
        <div class="paper-card-head">
            <span class="paper-card-title">📄 ${esc(p.title)}</span>
            <span class="tag">${esc(p.subject || '未指定学科')}</span>
            <span class="tag">${p.question_count} 题 / 总分 ${p.total_score ?? 0}</span>
            ${p.is_practice ? '' : `<span class="tag ${p.published ? 'pub-yes' : 'pub-no'}">${p.published ? '✅ 已发布' : '⏳ 未发布'}</span>`}
        </div>
        <div class="paper-card-meta">分发时间：${p.first_distributed_at ? esc(p.first_distributed_at.slice(0, 16)) : '未分发'}</div>
        <div class="exam-stats-grid">
            <div class="exam-stat"><div class="stat-num-lg ok">${sub}</div><div class="stat-label">已提交</div></div>
            <div class="exam-stat"><div class="stat-num-lg warn">${unsub}</div><div class="stat-label">未提交</div></div>
            <div class="exam-stat"><div class="stat-num-lg ok">${graded}</div><div class="stat-label">已批改</div></div>
            <div class="exam-stat"><div class="stat-num-lg warn">${ungraded}</div><div class="stat-label">未批改</div></div>
            <div class="exam-donuts">
                <div class="donut-item">${svgDonut(subRatio, { label: Math.round(subRatio * 100) + '%' })}<div class="stat-label">提交率</div></div>
                <div class="donut-item">${svgDonut(gradeRatio, { fg: '#10b981', label: Math.round(gradeRatio * 100) + '%' })}<div class="stat-label">批改率</div></div>
            </div>
        </div>
    </div>`;
}

// ── 首页成绩分布（每卷一张直方图，仅正式考试）──
function renderScoreHistograms() {
    const rows = [];
    _papersCache.forEach(p => {
        if (p.is_practice || (p.distributed_count || 0) === 0) return;
        const scores = (p.distributions || [])
            .filter(d => d.status === 'graded')
            .map(d => Number(d.total_score))
            .filter(Number.isFinite);
        if (!scores.length) {
            rows.push(`<div class="histogram-row">
                <span class="histogram-title">📄 ${esc(p.title)}</span>
                <span class="histogram-note">暂无已批改成绩</span>
            </div>`);
            return;
        }
        rows.push(`<div class="histogram-row">
            <span class="histogram-title">📄 ${esc(p.title)}</span>
            ${svgHistogram(scores, { max: p.total_score || 100, bins: 5 })}
        </div>`);
    });
    $('boxPlotList').innerHTML = rows.length
        ? rows.join('')
        : '<p class="empty-row">暂无已批改成绩</p>';
}

function switchPapersTab(tab) {
    _papersTab = tab;
    $('papersTabFormal').classList.toggle('active', tab === 'formal');
    $('papersTabPractice').classList.toggle('active', tab === 'practice');
    $('myPapersFormal').classList.toggle('hidden', tab !== 'formal');
    $('myPapersPractice').classList.toggle('hidden', tab !== 'practice');
}

// ── 正式试卷卡片 ──
function paperCard(p) {
    return `
    <div class="paper-card">
        <div class="paper-card-head">
            <span class="paper-card-title" style="cursor:pointer" onclick="openPaperMeta('edit', ${p.id})" title="点击改名">📄 ${esc(p.title)}</span>
            <span class="tag">${esc(p.subject || '未指定学科')}</span>
            <span class="tag">${p.question_count} 题</span>
            <span class="tag ${p.published ? 'pub-yes' : 'pub-no'}">${p.published ? '✅ 已发布' : '⏳ 未发布'}</span>
        </div>
        <div class="paper-card-meta">
            创建于 ${esc((p.created_at || '').slice(0, 16))} · 时长 ${p.duration || 120} 分钟 · 总分 ${p.total_score ?? 0}
            ${p.remark ? ` · 📝 ${esc(p.remark)}` : ''}
        </div>
        <div class="paper-card-stats">
            <span class="dist-link" onclick="toggleDistList(${p.id})">📤 分发 ${p.distributed_count}${p.distributed_count ? ' ▾' : ''}</span>
            <span>📥 提交 ${p.submitted_count}</span>
            <span>✅ 批改 ${p.graded_count}</span>
        </div>
        <div class="dist-detail hidden" id="distDetail_${p.id}">
            ${(p.distributions || []).length ? p.distributions.map(d => `
                <div class="dist-row">
                    <span>${esc(d.name)}</span>
                    <span class="tag">${esc(d.class_name || '')}</span>
                    <span class="hint">${esc(d.student_no || '')}</span>
                    <span class="tag status-${esc(d.status || 'none')}">${d.status === 'graded' ? '已批改' : (d.status === 'submitted' ? '已提交' : '未作答')}</span>
                    ${d.status === 'graded' ? `<span>得分 ${d.total_score ?? '—'}</span>` : ''}
                </div>`).join('') : '<span class="hint">未分发</span>'}
        </div>
        <div class="paper-card-actions">
            <button class="btn-small" onclick="openDistribute(${p.id})">📤 分发</button>
            <button class="btn-small" onclick="openGrade(${p.id})">✍️ 批改</button>
            <button class="btn-small" onclick="openPaperMeta('edit', ${p.id})">✏️ 编辑</button>
            <button class="btn-small btn-danger" onclick="deleteMyPaper(${p.id})">🗑 删除</button>
        </div>
    </div>`;
}

// ── 错题推送卷卡片（无发布成绩层）──
function practiceCard(p) {
    const d = (p.distributions || [])[0] || {};
    const st = d.status || 'none';
    const stLabel = { graded: '✅ 已批改', submitted: '⏳ 已提交待批改', none: '📝 未作答' }[st] || '📝 未作答';
    return `
    <div class="paper-card">
        <div class="paper-card-head">
            <span class="paper-card-title">📄 ${esc(p.title)}</span>
            <span class="tag">🏷️ 练习卷</span>
            <span class="tag">${esc(p.subject || '')}</span>
            <span class="tag status-${esc(st)}">${stLabel}</span>
        </div>
        <div class="paper-card-meta">
            创建于 ${esc((p.created_at || '').slice(0, 16))} · 共 ${p.question_count} 题
            ${d.name ? ` · 学生：${esc(d.name)}（${esc(d.class_name || '')}）` : ''}
        </div>
        <div class="paper-card-stats">
            <span class="dist-link" onclick="toggleDistList(${p.id})">作答详情${st !== 'none' ? ' ▾' : ''}</span>
        </div>
        <div class="dist-detail hidden" id="distDetail_${p.id}"></div>
        <div class="paper-card-actions">
            <button class="btn-small" onclick="openGrade(${p.id})">✍️ 批改</button>
            <button class="btn-small btn-danger" onclick="deleteMyPaper(${p.id})">🗑 删除</button>
        </div>
    </div>`;
}

// ── 分发名单展开（正式卷内联；练习卷懒加载逐题作答）──
async function toggleDistList(pid) {
    const el = $('distDetail_' + pid);
    if (!el) return;
    const p = _papersCache.find(x => x.id === pid);
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (p && p.is_practice) {
        el.innerHTML = '加载中…';
        try {
            const d = await authedJson(`/api/papers/${pid}/submissions`);
            const sub = (d.submissions || [])[0];
            if (!sub) { el.innerHTML = '<span class="hint">学生尚未作答</span>'; return; }
            const fmap = {}; (sub.ai_feedback || []).forEach(f => fmap[f.no] = f);
            const amap = {}; (sub.answers || []).forEach(a => amap[a.no] = a);
            el.innerHTML = (d.questions || []).length ? d.questions.map(q => {
                const f = fmap[q.no] || {};
                const a = amap[q.no] || {};
                const got = f.score != null ? (f.score + ' / ' + (f.max ?? q.score)) : '未评';
                const ans = a.answer_text ? esc(String(a.answer_text).slice(0, 40)) : '未作答';
                return `<div class="dist-row">
                    <span class="tag">第 ${q.no} 题</span>
                    <span class="hint">${ans}</span>
                    <span class="${f.correct ? 'ok' : (f.correct === false ? 'bad' : '')}">${got}</span>
                </div>`;
            }).join('') : '<span class="hint">学生尚未作答</span>';
        } catch (e) { el.innerHTML = '<span class="hint">加载失败</span>'; }
    }
}

// ── 批改总览（统计框下钻）──
const _GRADE_LABEL = { submitted: '已提交', graded: '已批改', ungraded: '未批改' };
let _gradeOverviewFilter = 'submitted';

function openGradeOverview(filter) {
    _gradeOverviewFilter = filter;
    _ALL_VIEWS.forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    $('gradeOverviewView').classList.remove('hidden');
    renderGradeOverview();
}

function renderGradeOverview() {
    $('gradeOverviewTitle').textContent = '批改总览：' + _GRADE_LABEL[_gradeOverviewFilter];
    const rows = [];
    _papersCache.forEach(p => {
        const match = (p.distributions || []).filter(d => {
            if (_gradeOverviewFilter === 'graded') return d.status === 'graded';
            if (_gradeOverviewFilter === 'ungraded') return d.status === 'submitted';
            return d.status != null;
        });
        if (!match.length) return;
        rows.push(`<div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">📄 ${esc(p.title)}</span>
                <span class="tag">${esc(p.subject || '')}</span>
                <span class="tag">${p.question_count} 题</span>
            </div>
            ${match.map(d => `
                <div class="dist-row">
                    <span>${esc(d.name)}</span>
                    <span class="tag">${esc(d.class_name || '')}</span>
                    <span class="hint">${esc(d.student_no || '')}</span>
                    <span class="tag status-${esc(d.status)}">${d.status === 'graded' ? '已批改' : '已提交'}</span>
                    ${d.status === 'graded' ? `<span>得分 ${d.total_score ?? '—'}</span>` : ''}
                    <button class="btn-small" onclick="openGrade(${p.id})">✍️ 去批改</button>
                </div>`).join('')}
        </div>`);
    });
    $('gradeOverviewList').innerHTML = rows.join('') || '<p class="empty-row">该状态下暂无提交</p>';
}

// ── 考试管理 ──
let _examSubTab = 'formal'; // formal | wrong | homework

function matchExamSubTab(p) {
    if (_examSubTab === 'formal') return !p.is_practice;
    if (_examSubTab === 'wrong') return !!p.is_wrong_push;
    return p.is_practice && !p.is_wrong_push; // homework
}

function switchExamSubTab(name) {
    _examSubTab = name;
    const map = { formal: 'examSubFormal', wrong: 'examSubWrong', homework: 'examSubHomework' };
    Object.entries(map).forEach(([k, id]) => { const el = $(id); if (el) el.classList.toggle('active', k === name); });
    renderExamManageList();
}

async function loadExamManage() {
    const d = await authedJson('/api/papers');
    _papersCache = d.papers || [];
    renderExamManageList();
}

function renderExamManageList() {
    const list = _papersCache.filter(p => (p.distributed_count || 0) > 0 && matchExamSubTab(p));
    $('examManageList').innerHTML = list.length
        ? list.map(examRow).join('')
        : '<p class="empty-row">该分类下暂无已分发的试卷</p>';
}

function examRow(p) {
    const dist = p.distributed_count || 0, sub = p.submitted_count || 0, graded = p.graded_count || 0;
    const unsub = dist - sub, ungraded = sub - graded;
    const subRatio = dist ? sub / dist : 0;
    const gradeRatio = sub ? graded / sub : 0;
    return `
    <div class="paper-card exam-manage-card exam-head" onclick="toggleExamDetail(${p.id})">
        <div class="paper-card-head">
            <span class="paper-card-title">📄 ${esc(p.title)}</span>
            <span class="tag">${esc(p.subject || '未指定学科')}</span>
            ${p.is_wrong_push ? '<span class="tag">🎯 错题练习</span>' : (p.is_practice ? '<span class="tag">📚 日常作业</span>' : '')}
            <span class="tag">${p.question_count} 题 / 总分 ${p.total_score ?? 0}</span>
            ${p.is_practice ? '' : `<span class="tag ${p.published ? 'pub-yes' : 'pub-no'}">${p.published ? '✅ 已发布' : '⏳ 未发布'}</span>`}
            <span class="hint" style="margin-left:auto" id="examArrow_${p.id}">▾ 点击查看详情</span>
        </div>
        <div class="exam-stats-grid">
            <div class="exam-stat"><div class="stat-num-lg ok">${sub}</div><div class="stat-label">已提交</div></div>
            <div class="exam-stat"><div class="stat-num-lg warn">${unsub}</div><div class="stat-label">未提交</div></div>
            <div class="exam-stat"><div class="stat-num-lg ok">${graded}</div><div class="stat-label">已批改</div></div>
            <div class="exam-stat"><div class="stat-num-lg warn">${ungraded}</div><div class="stat-label">未批改</div></div>
            <div class="exam-donuts">
                <div class="donut-item">${svgDonut(subRatio, { label: Math.round(subRatio * 100) + '%' })}<div class="stat-label">提交率</div></div>
                <div class="donut-item">${svgDonut(gradeRatio, { fg: '#10b981', label: Math.round(gradeRatio * 100) + '%' })}<div class="stat-label">批改率</div></div>
            </div>
        </div>
        <div class="exam-detail hidden" id="examDetail_${p.id}">
            <div class="exam-info-grid">
                <span>科目：${esc(p.subject || '—')}</span>
                <span>题数：${p.question_count}</span>
                <span>总分：${p.total_score ?? 0}</span>
                <span>时长：${p.duration || 120} 分钟</span>
                <span>创建：${esc((p.created_at || '').slice(0, 16))}</span>
                <span>发布：${p.published_at ? esc((p.published_at || '').slice(0, 16)) : '未发布'}</span>
                ${p.remark ? `<span>备注：${esc(p.remark)}</span>` : ''}
            </div>
            <div class="exam-students">
                <div class="exam-students-head">学生名单（${dist} 人）— 点击学生进入该生批改</div>
                ${(p.distributions || []).map(d => `
                    <div class="student-row" onclick="event.stopPropagation(); openGrade(${p.id}, ${d.sub_id})" title="进入该生批改">
                        <span>🧑‍🎓 ${esc(d.name)}</span>
                        <span class="tag">${esc(d.class_name || '')}</span>
                        <span class="hint">${esc(d.student_no || '')}</span>
                        <span class="tag status-${esc(d.status || 'none')}">${d.status === 'graded' ? '已批改' : (d.status === 'submitted' ? '已提交' : '未作答')}</span>
                        <span class="score-big" style="margin-left:auto">${d.status === 'graded' ? (d.total_score ?? '—') : '—'}</span>
                    </div>`).join('') || '<span class="hint">暂无学生</span>'}
            </div>
        </div>
        <div class="paper-card-actions">
            <button class="btn-small" onclick="event.stopPropagation(); openGrade(${p.id})">✍️ 去批改</button>
            ${p.is_practice ? '' : `<button class="btn-small ${p.published ? '' : 'btn-primary-inline'}" onclick="event.stopPropagation(); openPublishModal(${p.id})">${p.published ? '📋 已发布 · 查看成绩' : '📣 发布成绩'}</button>`}
        </div>
    </div>`;
}

// 展开/收起考试详情（整卡点击切换；内层按钮/学生行已 stopPropagation，不会误触）
function toggleExamDetail(pid) {
    const el = $('examDetail_' + pid);
    const arrow = $('examArrow_' + pid);
    if (!el) return;
    const opening = el.classList.contains('hidden');
    el.classList.toggle('hidden');
    if (arrow) arrow.textContent = opening ? '▴ 收起' : '▾ 点击查看详情';
}

async function publishPaper(pid) { openPublishModal(pid); }

// ── 改名/备注弹窗 ──
let _paperMetaMode = 'edit', _paperMetaId = null;

function openPaperMeta(mode, pid) {
    _paperMetaMode = mode; _paperMetaId = pid || null;
    const p = pid ? (_papersCache.find(x => x.id === pid) || {}) : {};
    $('paperMetaTitle').textContent = pid ? '编辑试卷信息' : '保存试卷';
    $('pmTitle').value = pid ? (p.title || '') : ((typeof currentPaperMeta === 'function' ? currentPaperMeta().title : '') || '');
    $('pmRemark').value = pid ? (p.remark || '') : '';
    $('paperMetaModal').classList.remove('hidden');
    $('pmTitle').focus();
}

function closePaperMeta() { $('paperMetaModal').classList.add('hidden'); }

$('pmSave').addEventListener('click', async () => {
    const title = $('pmTitle').value.trim();
    const remark = $('pmRemark').value.trim();
    if (!title) { alert('试卷标题不能为空'); return; }
    if (_paperMetaMode === 'save') {
        await saveNewPaper(title, remark);
    } else if (_paperMetaId) {
        await authedJson(`/api/papers/${_paperMetaId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, remark }),
        });
        closePaperMeta();
        await loadHome();
        refreshMyPapers();
    }
});

async function saveNewPaper(title, remark) {
    if (!S.questions || S.questions.length === 0) { alert('请先生成试卷'); return; }
    const meta = currentPaperMeta();
    const total = S.questions.reduce((s, q) => s + (q.score || 0), 0);
    try {
        await authedJson('/api/papers', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title, remark, subject: meta.subject, duration: meta.duration,
                total_score: total, questions: S.questions,
            }),
        });
        closePaperMeta();
        alert('已保存到「我的试卷」');
    } catch (e) { alert('保存失败：' + (e && e.message ? e.message : e)); }
}

async function deleteMyPaper(pid) {
    if (!confirm('确定删除该试卷？将同时删除其分发与提交记录。')) return;
    await authedJson(`/api/papers/${pid}`, { method: 'DELETE' });
    await loadHome();
    await loadExamManage();
    refreshMyPapers();
}

// ═══════════════════════════════════════════════════════════
// 分发
// ═══════════════════════════════════════════════════════════
let _distPaperId = null, _distStudents = [], _distExisting = new Set();

async function openDistribute(pid) {
    _distPaperId = pid;
    const [stu, dist] = await Promise.all([
        authedJson('/api/students'),
        authedJson(`/api/papers/${pid}/distributions`),
    ]);
    _distStudents = stu.students || [];
    _distExisting = new Set((dist.distributions || []).map(x => x.student_id));
    const paper = await authedJson(`/api/papers/${pid}`);
    $('distributeTitle').textContent = `分发试卷：${paper.title}`;
    // 填充筛选下拉
    fillOptions('dClass', _distStudents.map(s => s.class_name));
    fillOptions('dMajor', _distStudents.map(s => s.major));
    ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView', 'examManageView', 'gradeOverviewView', 'myPapersView']
        .forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    $('distributeView').classList.remove('hidden');
    renderDistributeList();
}

function fillOptions(id, values) {
    const el = $(id);
    const cur = el.value;
    const uniq = [...new Set(values.filter(Boolean))];
    el.innerHTML = '<option value="">全部</option>' + uniq.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    el.value = cur;
}

function renderDistributeList() {
    const cls = $('dClass').value, major = $('dMajor').value;
    const list = _distStudents.filter(s => (!cls || s.class_name === cls) && (!major || s.major === major));
    $('distributeList').innerHTML = list.length ? list.map(s => `
        <label class="student-check ${_distExisting.has(s.id) ? 'already' : ''}">
            <input type="checkbox" class="dist-cb" value="${s.id}" ${_distExisting.has(s.id) ? 'checked' : ''}>
            <span>${esc(s.name)}</span>
            <span class="tag">${esc(s.class_name)}</span>
            <span class="tag">${esc(s.major)}</span>
            <span class="hint">${esc(s.student_no)}</span>
        </label>`).join('') : '<p class="empty-row">无符合条件的学生</p>';
    $('dSelectAll').checked = false;
}

function toggleSelectAllStudents() {
    const all = $('dSelectAll').checked;
    document.querySelectorAll('.dist-cb').forEach(cb => cb.checked = all);
}

$('dClass').addEventListener('change', renderDistributeList);
$('dMajor').addEventListener('change', renderDistributeList);

$('btnDoDistribute').addEventListener('click', async () => {
    if (_distPaperId == null) return;
    const ids = [...document.querySelectorAll('.dist-cb:checked')].map(cb => parseInt(cb.value));
    const d = await authedJson(`/api/papers/${_distPaperId}/distribute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: ids }),
    });
    alert(`已分发 ${d.distributed} 名学生`);
    backToHome();
});

// ═══════════════════════════════════════════════════════════
// 学情
// ═══════════════════════════════════════════════════════════
let _analyticsStudents = [];
let _analyticsPapers = [];

async function loadAnalytics() {
    const [d, pd] = await Promise.all([
        authedJson('/api/analytics'),
        authedJson('/api/papers'),
    ]);
    _analyticsStudents = d.students || [];
    _analyticsPapers = pd.papers || [];
    fillOptions('aClass', _analyticsStudents.map(s => s.class_name));
    fillOptions('aMajor', _analyticsStudents.map(s => s.major));
    fillPaperOptions();
    renderAnalytics();
}

function fillPaperOptions() {
    const el = $('aPaper');
    const cur = el.value;
    el.innerHTML = '<option value="">全部试卷（学情总览）</option>' + _analyticsPapers.map(p =>
        `<option value="${p.id}">${esc(p.title)}（${p.is_practice ? '练习' : '考试'} · ${p.question_count} 题）</option>`
    ).join('');
    el.value = cur;
}

async function renderAnalytics() {
    const cls = $('aClass').value, major = $('aMajor').value, pid = $('aPaper').value;
    if (pid) { await renderAnalyticsByPaper(parseInt(pid)); return; }
    const list = _analyticsStudents.filter(s => (!cls || s.class_name === cls) && (!major || s.major === major));
    $('analyticsList').innerHTML = list.length ? list.map(s => {
        const pr = s.practice || [];
        const done = pr.filter(p => p.sub_status === 'submitted' || p.sub_status === 'graded').length;
        return `
        <div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">🧑‍🎓 ${esc(s.name)}</span>
                <span class="tag">${esc(s.class_name)}</span>
                <span class="tag">${esc(s.major)}</span>
                <span class="hint">${esc(s.student_no)}</span>
            </div>
            <div class="paper-card-stats">
                <span>提交 ${s.submitted_count || 0}</span>
                <span>均分 ${s.avg_score ?? '—'}</span>
                <span>最近 ${s.last_score ?? '—'}</span>
            </div>
            <div class="paper-card-stats">
                <span class="status-practice">📝 练习卷 ${pr.length} 份 · 已完成 ${done}</span>
                <span>🏫 旷课 ${s.attendance_count || 0}</span>
                <span>🌴 请假 ${s.leave_count || 0}</span>
                <span>⚠️ 警告 ${s.warning_count || 0}</span>
            </div>
            <div class="analytics-subs">
                ${(s.submissions || []).length ? s.submissions.map(sub => `
                    <div class="analytics-sub">
                        <div class="analytics-sub-head" onclick="toggleDrill(this)">
                            📄 ${esc(sub.title)}（${esc(sub.subject)}） ·
                            <span class="tag status-${esc(sub.status)}">${statusLabel(sub.status)}</span>
                            ${sub.status === 'graded' ? ' · 得分 ' + sub.total_score : ''}
                            <span class="drill-arrow">▾</span>
                        </div>
                        <div class="analytics-drill hidden">
                            ${(sub.ai_feedback || []).map(f => `
                                <div class="drill-row">
                                    <span class="tag">第 ${f.no} 题</span>
                                    <span class="${f.correct ? 'ok' : (f.correct === false ? 'bad' : '')}">${f.score != null ? f.score + ' / ' + f.max : '未评'}</span>
                                    <span class="hint">${esc(f.comment || '')}</span>
                                </div>`).join('') || '<span class="hint">暂无逐题反馈</span>'}
                        </div>
                    </div>`).join('') : '<span class="hint">暂无提交</span>'}
            </div>
        </div>`; }).join('') : '<p class="empty-row">暂无学生数据</p>';
}

async function renderAnalyticsByPaper(pid) {
    const d = await authedJson(`/api/analytics?paper_id=${pid}`);
    const list = d.students || [];
    $('analyticsList').innerHTML = list.length ? list.map(s => `
        <div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">🧑‍🎓 ${esc(s.name)}</span>
                <span class="tag">${esc(s.class_name)}</span>
                <span class="tag">${esc(s.major)}</span>
                <span class="hint">${esc(s.student_no)}</span>
            </div>
            <div class="paper-card-stats">
                <span class="tag status-${esc(s.paper_status)}">${paperStateLabel(s.paper_status)}</span>
                ${s.paper_status === 'graded' ? `<span>得分 ${s.paper_score}</span>` : ''}
                ${s.paper_submitted_at ? `<span>提交于 ${esc((s.paper_submitted_at || '').slice(0, 16))}</span>` : ''}
            </div>
        </div>`).join('') : '<p class="empty-row">该试卷尚未分发给任何学生</p>';
}

function paperStateLabel(s) {
    if (s === 'graded') return '✅ 已批改';
    if (s === 'submitted') return '⏳ 已提交待批改';
    return '📝 未作答';
}

function toggleDrill(head) {
    const drill = head.nextElementSibling;
    drill.classList.toggle('hidden');
    head.querySelector('.drill-arrow').textContent = drill.classList.contains('hidden') ? '▾' : '▴';
}

function statusLabel(s) {
    return { submitted: '已提交待批改', graded: '已批改' }[s] || s;
}

$('aClass').addEventListener('change', renderAnalytics);
$('aMajor').addEventListener('change', renderAnalytics);
$('aPaper').addEventListener('change', renderAnalytics);
