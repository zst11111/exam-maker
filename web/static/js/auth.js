// 鉴权：登录态 + token + 带 Bearer 的 fetch 封装（401 自动登出）
const AUTH = { token: null, user: null };

function authedFetch(url, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (AUTH.token) headers['Authorization'] = 'Bearer ' + AUTH.token;
    return fetch(url, Object.assign({}, opts, { headers }));
}

async function authedJson(url, opts) {
    const r = await authedFetch(url, opts);
    if (r.status === 401) { logout(true); throw new Error('未登录或登录已过期'); }
    let d = {};
    try { d = await r.json(); } catch (e) { d = {}; }
    if (!r.ok) throw new Error(d.detail || ('请求失败 HTTP ' + r.status));
    return d;
}

function roleIcon(role) { return { teacher: '👨‍🏫', counselor: '🧑‍💼', student: '🧑‍🎓' }[role] || '👤'; }
function roleLabel(role) { return { teacher: '教师', counselor: '辅导员', student: '学生' }[role] || role; }

function renderUserBar() {
    $('userBar').classList.remove('hidden');
    const u = AUTH.user;
    if (!u) { $('userInfo').textContent = ''; return; }
    let sub = roleLabel(u.role);
    if (u.role === 'student') sub = (u.class_name || '') + ' · ' + (u.student_no || '');
    $('userInfo').textContent = `${roleIcon(u.role)} ${u.name}（${sub}）`;
}

function enterApp() {
    $('loginView').classList.add('hidden');
    renderUserBar();
    ['teacherApp', 'studentApp', 'counselorApp'].forEach(id => $(id).classList.add('hidden'));
    if (AUTH.user.role === 'teacher') {
        $('teacherApp').classList.remove('hidden');
        switchTeacherTab('home');
    } else if (AUTH.user.role === 'counselor') {
        $('counselorApp').classList.remove('hidden');
        switchCounselorTab('analytics');
    } else {
        $('studentApp').classList.remove('hidden');
        switchStudentTab('papers');
    }
}

function logout(expired) {
    const token = AUTH.token;
    AUTH.token = null; AUTH.user = null;
    localStorage.removeItem('exam_token');
    $('userBar').classList.add('hidden');
    ['teacherApp', 'studentApp', 'counselorApp'].forEach(id => $(id).classList.add('hidden'));
    $('loginView').classList.remove('hidden');
    if (token) fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
    if (expired) { const e = $('loginError'); e.textContent = '登录已过期，请重新登录'; e.classList.remove('hidden'); }
}

async function doLogin() {
    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value;
    const err = $('loginError');
    err.classList.add('hidden');
    if (!username || !password) { err.textContent = '请输入用户名和密码'; err.classList.remove('hidden'); return; }
    const btn = $('btnLogin');
    btn.disabled = true; btn.textContent = '登录中…';
    try {
        const d = await apiFetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (!d.token) throw new Error(d.detail || '登录失败');
        AUTH.token = d.token;
        AUTH.user = { id: d.user_id, role: d.role, name: d.name, student_no: d.student_no, class_name: d.class_name, major: d.major };
        localStorage.setItem('exam_token', d.token);
        enterApp();
    } catch (e) {
        err.textContent = (e && e.message ? e.message : '登录失败');
        err.classList.remove('hidden');
    } finally {
        btn.disabled = false; btn.textContent = '登 录';
    }
}

// 事件绑定 + 启动时恢复登录态
$('btnLogin').addEventListener('click', doLogin);
$('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('btnLogout').addEventListener('click', () => logout(false));

async function restoreSession() {
    const token = localStorage.getItem('exam_token');
    if (!token) return;
    AUTH.token = token;
    try {
        const me = await authedJson('/api/auth/me');
        AUTH.user = { id: me.id, role: me.role, name: me.name, student_no: me.student_no, class_name: me.class_name, major: me.major };
        enterApp();
    } catch (e) {
        logout(false);
    }
}
restoreSession();
