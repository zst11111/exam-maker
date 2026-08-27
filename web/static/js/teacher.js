// 教师端：首页（统计+我的试卷）、分发、学情
const _T_TABS = { home: 'tabHome', wizard: 'tabWizard', bank: 'tabBank', analytics: 'tabAnalytics' };

function switchTeacherTab(tab) {
    ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView']
        .forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
    Object.entries(_T_TABS).forEach(([k, id]) => {
        const el = $(id); if (el) el.classList.toggle('active', k === tab);
    });
    if (tab === 'home') { $('teacherHome').classList.remove('hidden'); loadHome(); }
    else if (tab === 'wizard') { $('wizardWrap').classList.remove('hidden'); }
    else if (tab === 'bank') { $('bankView').classList.remove('hidden'); loadBankList(); }
    else if (tab === 'analytics') { $('teacherAnalytics').classList.remove('hidden'); loadAnalytics(); }
}

function backToHome() { switchTeacherTab('home'); }

async function loadHome() {
    const d = await authedJson('/api/papers');
    const papers = d.papers || [];
    const stat = { total: papers.length, dist: 0, sub: 0, graded: 0 };
    papers.forEach(p => { stat.dist += p.distributed_count || 0; stat.sub += p.submitted_count || 0; stat.graded += p.graded_count || 0; });
    $('statCards').innerHTML = `
        <div class="stat-card"><div class="stat-num">${stat.total}</div><div class="stat-label">我的试卷</div></div>
        <div class="stat-card"><div class="stat-num">${stat.dist}</div><div class="stat-label">已分发人次</div></div>
        <div class="stat-card"><div class="stat-num">${stat.sub}</div><div class="stat-label">已提交</div></div>
        <div class="stat-card"><div class="stat-num">${stat.graded}</div><div class="stat-label">已批改</div></div>`;
    $('myPapers').innerHTML = papers.length ? papers.map(p => `
        <div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">📄 ${esc(p.title)}</span>
                <span class="tag">${esc(p.subject || '未指定学科')}</span>
                <span class="tag">${p.question_count} 题</span>
            </div>
            <div class="paper-card-meta">
                创建于 ${esc((p.created_at || '').slice(0, 16))} · 时长 ${p.duration || 120} 分钟 · 总分 ${p.total_score ?? 0}
            </div>
            <div class="paper-card-stats">
                <span>📤 分发 ${p.distributed_count}</span>
                <span>📥 提交 ${p.submitted_count}</span>
                <span>✅ 批改 ${p.graded_count}</span>
            </div>
            <div class="paper-card-actions">
                <button class="btn-small" onclick="openDistribute(${p.id})">📤 分发</button>
                <button class="btn-small" onclick="openGrade(${p.id})">✍️ 批改</button>
                <button class="btn-small btn-danger" onclick="deleteMyPaper(${p.id})">🗑 删除</button>
            </div>
        </div>`).join('') : '<p class="empty-row">还没有试卷，去「出试卷」页创建一张吧</p>';
}

async function deleteMyPaper(pid) {
    if (!confirm('确定删除该试卷？将同时删除其分发与提交记录。')) return;
    await authedJson(`/api/papers/${pid}`, { method: 'DELETE' });
    loadHome();
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
    ['teacherHome', 'wizardWrap', 'bankView', 'teacherAnalytics', 'distributeView', 'gradeView']
        .forEach(id => $(id).classList.add('hidden'));
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
