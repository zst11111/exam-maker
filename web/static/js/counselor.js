// 辅导员端：学业管理（考试）/ 日常管理（旷课请假）/ 账号管理（学生/教师）
let _cStudents = [];
let _allUsers = [];
let _counselorPapers = [];   // 学业管理：考试总览（来自 /api/counselor/exam-overview）
let _counselorExam = null;   // 当前展开的考试详情

function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function switchCounselorTab(tab) {
    $('tabCounselorAnalytics').classList.toggle('active', tab === 'analytics');
    $('tabCounselorDaily').classList.toggle('active', tab === 'daily');
    $('tabCounselorUsers').classList.toggle('active', tab === 'users');
    $('counselorAnalyticsView').classList.toggle('hidden', tab !== 'analytics');
    $('counselorDailyView').classList.toggle('hidden', tab !== 'daily');
    $('counselorUsersView').classList.toggle('hidden', tab !== 'users');
    if (tab === 'analytics') loadCounselorAnalytics();
    else if (tab === 'daily') loadCounselorDaily();
    else loadCounselorUsers();
}

// ═══════════════════════════════════════════════════════════
// 学业管理：按班级 → 考试列表（均分/提交人数/总人数）→ 点进某场考试看学生成绩
// ═══════════════════════════════════════════════════════════
async function loadCounselorAnalytics() {
    const d = await authedJson('/api/counselor/exam-overview');
    _counselorPapers = d.papers || [];
    const opts = [];
    _counselorPapers.forEach(p => (p.classes || []).forEach(c => {
        opts.push(c.class_name, c.major);
    }));
    fillOptions('cClass', opts);
    fillOptions('cMajor', opts);
    renderCounselorAnalytics();
}

function renderCounselorAnalytics() {
    const cls = $('cClass').value, major = $('cMajor').value;
    const classMap = {};
    _counselorPapers.forEach(p => (p.classes || []).forEach(c => {
        if ((cls && c.class_name !== cls) || (major && c.major !== major)) return;
        const key = (c.class_name || '未分班') + '|' + (c.major || '');
        if (!classMap[key]) classMap[key] = { name: c.class_name || '未分班', major: c.major || '', exams: [] };
        classMap[key].exams.push({ paper: p, agg: c });
    }));
    const keys = Object.keys(classMap).sort();
    $('counselorAnalyticsList').innerHTML = keys.length ? keys.map(k => {
        const cc = classMap[k];
        const totalDist = cc.exams.reduce((t, e) => t + (e.agg.total || 0), 0);
        const totalSub = cc.exams.reduce((t, e) => t + (e.agg.submitted || 0), 0);
        const totalGraded = cc.exams.reduce((t, e) => t + (e.agg.graded || 0), 0);
        const submitRatio = totalDist ? totalSub / totalDist : 0;
        const gradeRatio = totalSub ? totalGraded / totalSub : 0;
        return `
        <div class="paper-card class-card">
            <div class="paper-card-head">
                <span class="paper-card-title">🏫 ${esc(cc.name)}${cc.major ? ' · ' + esc(cc.major) : ''}</span>
                <span class="tag">${cc.exams.length} 场考试</span>
            </div>
            <div class="exam-stats-grid">
                <div class="exam-stat"><div class="stat-num-lg">${cc.exams.length}</div><div class="stat-label">考试数</div></div>
                <div class="exam-stat"><div class="stat-num-lg ok">${totalSub}</div><div class="stat-label">提交人次</div></div>
                <div class="exam-stat"><div class="stat-num-lg warn">${totalDist - totalSub}</div><div class="stat-label">未提交人次</div></div>
                <div class="exam-stat"><div class="stat-num-lg">${totalGraded}</div><div class="stat-label">已批改人次</div></div>
                <div class="exam-donuts">
                    <div class="donut-item">${svgDonut(submitRatio, { label: Math.round(submitRatio * 100) + '%' })}<div class="stat-label">提交率</div></div>
                    <div class="donut-item">${svgDonut(gradeRatio, { fg: '#10b981', label: Math.round(gradeRatio * 100) + '%' })}<div class="stat-label">批改率</div></div>
                </div>
            </div>
            <div class="class-section">
                <div class="class-subhead">📊 考试总览（点击进入查看本场考试详情）</div>
                <div class="class-exam-list">
                    ${cc.exams.map(({ paper, agg }) => `
                        <div class="class-exam-row clickable"
                             data-pid="${paper.paper_id}" data-class="${escAttr(cc.name)}" data-major="${escAttr(cc.major || '')}">
                            <span class="class-exam-title">📄 ${esc(paper.title)}</span>
                            <span class="class-exam-avg">均分 <strong>${agg.avg ?? '—'}</strong>${paper.total_score ? ' / ' + paper.total_score : ''}</span>
                            <span class="hint">提交 ${agg.submitted}/${agg.total} 人</span>
                            <span class="tag ${paper.published ? 'pub-yes' : 'pub-no'}">${paper.published ? '已发布' : '未发布'}</span>
                        </div>`).join('')}
                </div>
            </div>
        </div>`;
    }).join('') : '<p class="empty-row">暂无考试数据（老师尚未分发试卷）</p>';
}

$('counselorAnalyticsList').addEventListener('click', e => {
    const row = e.target.closest('.class-exam-row');
    if (!row) return;
    openCounselorExam(parseInt(row.dataset.pid, 10), row.dataset.class || '', row.dataset.major || '');
});

async function openCounselorExam(pid, className, major) {
    _counselorExam = { pid, className, major };
    const d = await authedJson(`/api/analytics?paper_id=${pid}`);
    const rows = (d.students || []).filter(s =>
        (!className || s.class_name === className) && (!major || s.major === major));
    const paper = _counselorPapers.find(p => p.paper_id === pid);
    const graded = rows.filter(r => r.paper_status === 'graded').length;
    const submitted = rows.filter(r => r.paper_status === 'submitted').length;
    $('counselorExamTitle').textContent =
        `📄 ${paper ? paper.title : '考试详情'}${paper && paper.subject ? '（' + paper.subject + '）' : ''}`;
    $('counselorExamMeta').textContent =
        `${className || '全部班级'} · 共 ${rows.length} 人 · 已批改 ${graded} · 已提交 ${submitted} · 未作答 ${rows.length - graded - submitted}`;
    $('counselorExamList').innerHTML = rows.length ? rows.map(r => `
        <div class="student-row">
            <span>🧑‍🎓 ${esc(r.name)}</span>
            <span class="hint">${esc(r.student_no || '')}</span>
            <span class="tag">${esc(r.class_name || '')}</span>
            <span class="tag status-${esc(r.paper_status)}">${paperStateLabel(r.paper_status)}</span>
            <span class="score-big" style="margin-left:auto">${r.paper_status === 'graded' ? (r.paper_score ?? '—') : '—'}</span>
        </div>`).join('') : '<p class="empty-row">该班无人被分发本场考试</p>';
    $('counselorAnalyticsList').classList.add('hidden');
    $('counselorExamDetail').classList.remove('hidden');
}

function backCounselorOverview() {
    $('counselorExamDetail').classList.add('hidden');
    $('counselorAnalyticsList').classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════
// 日常管理：旷课 / 请假 / 学业警告（含录入与自动检测）
// ═══════════════════════════════════════════════════════════
async function loadCounselorDaily() {
    const d = await authedJson('/api/analytics');
    _cStudents = d.students || [];
    fillOptions('cDClass', _cStudents.map(s => s.class_name));
    fillOptions('cDMajor', _cStudents.map(s => s.major));
    renderCounselorDaily();
}

function renderCounselorDaily() {
    const cls = $('cDClass').value, major = $('cDMajor').value;
    const list = _cStudents.filter(s => (!cls || s.class_name === cls) && (!major || s.major === major));
    if (!list.length) { $('counselorDailyList').innerHTML = '<p class="empty-row">暂无学生数据</p>'; return; }
    const byClass = {};
    list.forEach(s => {
        const k = (s.class_name || '未分班') + '|' + (s.major || '');
        (byClass[k] = byClass[k] || []).push(s);
    });
    $('counselorDailyList').innerHTML = Object.keys(byClass).sort().map(k => {
        const [cn, mj] = k.split('|');
        return dailyClassCard(cn, mj, byClass[k]);
    }).join('');
}

function dailyClassCard(cn, mj, students) {
    const n = students.length;
    const noAttn = students.filter(s => (s.attendance_count || 0) === 0).length;   // 无旷课
    const noLeave = students.filter(s => (s.leave_count || 0) === 0).length;       // 无请假
    const need = students.filter(s => (s.attendance_count || 0) + (s.leave_count || 0) + (s.warning_count || 0) > 0).length;
    const okRatio = n ? noAttn / n : 0;
    const needRatio = n ? need / n : 0;
    const tAttn = students.reduce((t, s) => t + (s.attendance_count || 0), 0);
    const tLeave = students.reduce((t, s) => t + (s.leave_count || 0), 0);
    const tWarn = students.reduce((t, s) => t + (s.warning_count || 0), 0);
    return `
    <div class="paper-card class-card">
        <div class="paper-card-head">
            <span class="paper-card-title">🏫 ${esc(cn)}${mj ? ' · ' + esc(mj) : ''}</span>
            <span class="tag">${n} 名学生</span>
        </div>
        <div class="exam-stats-grid">
            <div class="exam-stat"><div class="stat-num-lg">${tAttn}</div><div class="stat-label">旷课次数</div></div>
            <div class="exam-stat"><div class="stat-num-lg">${tLeave}</div><div class="stat-label">请假次数</div></div>
            <div class="exam-stat"><div class="stat-num-lg ${tWarn ? 'warn' : ''}">${tWarn}</div><div class="stat-label">警告次数</div></div>
            <div class="exam-stat"><div class="stat-num-lg ${need ? 'warn' : 'ok'}">${need}</div><div class="stat-label">需关注人数</div></div>
            <div class="exam-donuts">
                <div class="donut-item">${svgDonut(okRatio, { label: Math.round(okRatio * 100) + '%' })}<div class="stat-label">无旷课率</div></div>
                <div class="donut-item">${svgDonut(needRatio, { fg: '#f59e0b', label: Math.round(needRatio * 100) + '%' })}<div class="stat-label">需关注率</div></div>
            </div>
        </div>
        <div class="class-section">
            <div class="class-subhead">👥 学生考勤（点击查看 / 记录旷课请假）</div>
            <div class="class-roster">
                ${students.map(s => `
                    <div class="student-row" onclick="openRecords(${s.id})" title="查看 / 记录考勤请假">
                        <span>🧑‍🎓 ${esc(s.name)}</span>
                        <span class="hint">${esc(s.student_no || '')}</span>
                        <span class="hint" style="margin-left:auto">均分 ${s.avg_score ?? '—'}</span>
                        <span class="tag" title="旷课">🏫 ${s.attendance_count || 0}</span>
                        <span class="tag" title="请假">🌴 ${s.leave_count || 0}</span>
                        <span class="tag ${s.warning_count ? 'bad' : ''}" title="学业警告">⚠️ ${s.warning_count || 0}</span>
                    </div>`).join('')}
            </div>
        </div>
    </div>`;
}

async function autoDetect() {
    const d = await authedJson('/api/counselor/auto-detect', { method: 'POST' });
    const created = d.created || [];
    if (!created.length) alert('没有检测到需要新增的学业警告');
    else alert('已自动生成 ' + created.length + ' 条学业警告：\n' + created.map(c => '· ' + c.student + '：' + c.reason).join('\n'));
    loadCounselorDaily();
}

$('cClass').addEventListener('change', renderCounselorAnalytics);
$('cMajor').addEventListener('change', renderCounselorAnalytics);
$('cDClass').addEventListener('change', renderCounselorDaily);
$('cDMajor').addEventListener('change', renderCounselorDaily);

// ═══════════════════════════════════════════════════════════
// 学生记录（旷课 / 请假 / 警告）
// ═══════════════════════════════════════════════════════════
let _recUid = null;

async function openRecords(uid) {
    _recUid = uid;
    const s = _cStudents.find(x => x.id === uid) || {};
    $('recordsTitle').textContent = '学生记录';
    $('recordsStudentInfo').textContent = `${s.name || ''}（${s.student_no || ''} · ${s.class_name || ''}）`;
    $('addRecordBox').classList.add('hidden');
    $('addRecordBox').innerHTML = '';
    $('recordsModal').classList.remove('hidden');
    await refreshRecords();
}

async function refreshRecords() {
    const d = await authedJson(`/api/counselor/students/${_recUid}/records`);
    $('recAttendance').innerHTML = renderRecordItems(d.attendance, a => `
        <span>📅 ${esc(a.record_date)}${a.note ? ' · ' + esc(a.note) : ''}</span>
        <button class="btn-del-row" onclick="delRecord('attendance', ${a.id})">×</button>`);
    $('recLeave').innerHTML = renderRecordItems(d.leave, a => `
        <span>📅 ${esc(a.start_date)}${a.end_date ? ' ~ ' + esc(a.end_date) : ''}${a.reason ? ' · ' + esc(a.reason) : ''}</span>
        <button class="btn-del-row" onclick="delRecord('leave', ${a.id})">×</button>`);
    $('recWarnings').innerHTML = renderRecordItems(d.warnings, w => `
        <span><span class="tag">${esc(w.level || '一般')}</span> ${esc(w.reason)}</span>
        <button class="btn-del-row" onclick="delRecord('warning', ${w.id})">×</button>`);
}

function openAddRecord(type) {
    const box = $('addRecordBox');
    box.classList.remove('hidden');
    if (type === 'attendance') {
        box.innerHTML = `
            <div class="add-record-row">
                <input type="date" id="arDate">
                <input type="text" id="arNote" placeholder="备注（如：第3节旷课）">
                <button class="btn-small" onclick="saveRecord('attendance')">保存旷课</button>
            </div>`;
    } else if (type === 'leave') {
        box.innerHTML = `
            <div class="add-record-row">
                <input type="date" id="arDate">
                <input type="date" id="arEnd">
                <input type="text" id="arReason" placeholder="请假原因">
                <button class="btn-small" onclick="saveRecord('leave')">保存请假</button>
            </div>`;
    } else if (type === 'warning') {
        box.innerHTML = `
            <div class="add-record-row">
                <input type="text" id="arReason" placeholder="警告原因">
                <select id="arLevel"><option>一般</option><option>较重</option><option>严重</option></select>
                <button class="btn-small btn-warn" onclick="saveRecord('warning')">保存警告</button>
            </div>`;
    }
}

async function saveRecord(type) {
    let body = {};
    if (type === 'attendance') {
        const d = $('arDate').value;
        if (!d) { alert('请选择日期'); return; }
        body = { record_date: d, note: ($('arNote').value || '').trim() };
    } else if (type === 'leave') {
        const s = $('arDate').value;
        if (!s) { alert('请选择开始日期'); return; }
        body = { start_date: s, end_date: $('arEnd').value, reason: ($('arReason').value || '').trim() };
    } else {
        const r = ($('arReason').value || '').trim();
        if (!r) { alert('请填写警告原因'); return; }
        body = { reason: r, level: $('arLevel').value };
    }
    await authedJson(`/api/counselor/students/${_recUid}/${type}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    $('addRecordBox').classList.add('hidden');
    await refreshRecords();
}

async function delRecord(table, rid) {
    if (!confirm('确定删除该记录？')) return;
    await authedJson(`/api/counselor/records/${table}/${rid}`, { method: 'DELETE' });
    await refreshRecords();
}

function closeRecords() { $('recordsModal').classList.add('hidden'); }

// ═══════════════════════════════════════════════════════════
// 账号管理（学生 / 教师）
// ═══════════════════════════════════════════════════════════
let _editUid = null;

async function loadCounselorUsers() {
    const d = await authedJson('/api/counselor/users');
    _allUsers = d.users || [];
    const teachers = _allUsers.filter(u => u.role === 'teacher');
    const students = _allUsers.filter(u => u.role === 'student');
    const byClass = {};
    students.forEach(s => {
        const k = (s.class_name || '未分班') + '|' + (s.major || '');
        (byClass[k] = byClass[k] || []).push(s);
    });
    const parts = [];
    if (teachers.length) parts.push(usersClassCard('👨‍🏫 教师', teachers.length + ' 名教师', teachers));
    Object.keys(byClass).sort().forEach(k => {
        const [cn, mj] = k.split('|');
        parts.push(usersClassCard(`🏫 ${esc(cn)}${mj ? ' · ' + esc(mj) : ''}`, byClass[k].length + ' 名学生', byClass[k]));
    });
    $('counselorUserList').innerHTML = parts.join('') || '<p class="empty-row">暂无用户</p>';
}

function usersClassCard(title, subtitle, users) {
    return `
    <div class="paper-card class-card">
        <div class="paper-card-head">
            <span class="paper-card-title">${title}</span>
            <span class="tag">${subtitle}</span>
        </div>
        <div class="class-section">
            <div class="class-roster">
                ${users.map(u => `
                    <div class="user-row">
                        <span class="user-role">${u.role === 'teacher' ? '👨‍🏫' : '🧑‍🎓'}</span>
                        <span class="user-name">${esc(u.name)}</span>
                        <span class="hint">账号 ${esc(u.username)}</span>
                        ${u.role === 'student' ? `<span class="hint">学号 ${esc(u.student_no || '')}</span><span class="hint">${esc(u.major || '')}</span>` : ''}
                        <span class="user-actions">
                            <button class="btn-small" onclick="openUserForm(${u.id})">✏️ 编辑</button>
                            <button class="btn-small" onclick="resetPwd(${u.id})">🔑 重置密码</button>
                            <button class="btn-small btn-danger" onclick="delUser(${u.id})">🗑 删除</button>
                        </span>
                    </div>`).join('')}
            </div>
        </div>
    </div>`;
}

function _userName(uid) { const u = (_allUsers || []).find(x => x.id === uid); return u ? u.name : String(uid); }

function openUserForm(uid) {
    _editUid = uid || null;
    $('userFormTitle').textContent = uid ? '编辑账号' : '新增账号';
    $('ufName').value = '';
    $('ufUsername').value = '';
    $('ufPassword').value = '';
    $('ufStudentNo').value = '';
    $('ufClass').value = '';
    $('ufMajor').value = '';
    $('ufRole').disabled = false;
    $('ufRole').value = 'student';
    if (uid) {
        const u = _allUsers.find(x => x.id === uid);
        if (u) {
            $('ufName').value = u.name || '';
            $('ufUsername').value = u.username || '';
            $('ufStudentNo').value = u.student_no || '';
            $('ufClass').value = u.class_name || '';
            $('ufMajor').value = u.major || '';
            $('ufRole').value = u.role || 'student';
            $('ufRole').disabled = true;
        }
        $('ufPasswordGroup').classList.add('hidden');
    } else {
        $('ufPasswordGroup').classList.remove('hidden');
    }
    syncStudentFields();
    $('userFormModal').classList.remove('hidden');
}

function syncStudentFields() {
    $('ufStudentFields').classList.toggle('hidden', $('ufRole').value !== 'student');
}

$('ufRole').addEventListener('change', syncStudentFields);

async function ufSave() {
    const role = $('ufRole').value;
    const name = $('ufName').value.trim();
    const username = $('ufUsername').value.trim();
    const student_no = $('ufStudentNo').value.trim();
    const class_name = $('ufClass').value.trim();
    const major = $('ufMajor').value.trim();
    if (!name || !username) { alert('姓名、登录用户名必填'); return; }
    try {
        if (_editUid) {
            await authedJson(`/api/counselor/users/${_editUid}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, name, student_no, class_name, major }),
            });
        } else {
            const password = $('ufPassword').value;
            if (!password || password.length < 4) { alert('密码至少 4 位'); return; }
            await authedJson('/api/counselor/users', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, username, name, password, student_no, class_name, major }),
            });
        }
        closeUserForm();
        loadCounselorUsers();
    } catch (e) { alert('保存失败：' + (e && e.message ? e.message : e)); }
}

async function resetPwd(uid) {
    const name = _userName(uid);
    const pwd = prompt(`为「${name}」设置新密码（至少 4 位）：`);
    if (pwd == null) return;
    if (pwd.length < 4) { alert('密码至少 4 位'); return; }
    try {
        await authedJson(`/api/counselor/users/${uid}/reset-password`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd }),
        });
        alert('密码已重置');
    } catch (e) { alert('重置失败：' + (e && e.message ? e.message : e)); }
}

async function delUser(uid) {
    const name = _userName(uid);
    if (!confirm(`确定删除用户「${name}」？其名下试卷/提交/记录将一并删除，且不可恢复。`)) return;
    try {
        await authedJson(`/api/counselor/users/${uid}`, { method: 'DELETE' });
        loadCounselorUsers();
    } catch (e) { alert('删除失败：' + (e && e.message ? e.message : e)); }
}

function closeUserForm() { $('userFormModal').classList.add('hidden'); }

$('ufSave').addEventListener('click', ufSave);
