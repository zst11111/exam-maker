// 辅导员端：学生学情（含考勤/请假/警告）、账号管理（学生/教师）
let _cStudents = [];
let _allUsers = [];

function switchCounselorTab(tab) {
    $('tabCounselorAnalytics').classList.toggle('active', tab === 'analytics');
    $('tabCounselorUsers').classList.toggle('active', tab === 'users');
    $('counselorAnalyticsView').classList.toggle('hidden', tab !== 'analytics');
    $('counselorUsersView').classList.toggle('hidden', tab !== 'users');
    if (tab === 'analytics') loadCounselorAnalytics();
    else loadCounselorUsers();
}

// ═══════════════════════════════════════════════════════════
// 学生学情
// ═══════════════════════════════════════════════════════════
async function loadCounselorAnalytics() {
    const d = await authedJson('/api/analytics');
    _cStudents = d.students || [];
    fillOptions('cClass', _cStudents.map(s => s.class_name));
    fillOptions('cMajor', _cStudents.map(s => s.major));
    renderCounselorAnalytics();
}

function renderCounselorAnalytics() {
    const cls = $('cClass').value, major = $('cMajor').value;
    const list = _cStudents.filter(s => (!cls || s.class_name === cls) && (!major || s.major === major));
    $('counselorAnalyticsList').innerHTML = list.length ? list.map(s => `
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
                <span>🏫 旷课 ${s.attendance_count || 0}</span>
                <span>🌴 请假 ${s.leave_count || 0}</span>
                <span class="${s.warning_count ? 'bad' : ''}">⚠️ 警告 ${s.warning_count || 0}</span>
            </div>
            <div class="paper-card-actions">
                <button class="btn-small" onclick="openRecords(${s.id})">📋 查看 / 记录考勤请假</button>
            </div>
        </div>`).join('') : '<p class="empty-row">暂无学生数据</p>';
}

async function autoDetect() {
    const d = await authedJson('/api/counselor/auto-detect', { method: 'POST' });
    const created = d.created || [];
    if (!created.length) alert('没有检测到需要新增的学业警告');
    else alert('已自动生成 ' + created.length + ' 条学业警告：\n' + created.map(c => '· ' + c.student + '：' + c.reason).join('\n'));
    loadCounselorAnalytics();
}

$('cClass').addEventListener('change', renderCounselorAnalytics);
$('cMajor').addEventListener('change', renderCounselorAnalytics);

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
    $('counselorUserList').innerHTML = _allUsers.length ? _allUsers.map(u => `
        <div class="paper-card">
            <div class="paper-card-head">
                <span class="paper-card-title">${u.role === 'teacher' ? '👨‍🏫' : (u.role === 'counselor' ? '🧑‍💼' : '🧑‍🎓')} ${esc(u.name)}</span>
                <span class="tag">${u.role === 'teacher' ? '教师' : (u.role === 'counselor' ? '辅导员' : '学生')}</span>
                <span class="hint">账号 ${esc(u.username)}</span>
                ${u.role === 'student' ? `<span class="tag">${esc(u.class_name || '')}</span><span class="tag">${esc(u.major || '')}</span><span class="hint">学号 ${esc(u.student_no || '')}</span>` : ''}
            </div>
            <div class="paper-card-actions">
                ${u.role !== 'counselor' ? `
                <button class="btn-small" onclick="openUserForm(${u.id})">✏️ 编辑</button>
                <button class="btn-small" onclick="resetPwd(${u.id})">🔑 重置密码</button>
                <button class="btn-small btn-danger" onclick="delUser(${u.id})">🗑 删除</button>` : '<span class="hint">系统内置账号</span>'}
            </div>
        </div>`).join('') : '<p class="empty-row">暂无用户</p>';
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
