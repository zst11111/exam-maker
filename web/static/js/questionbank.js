// 题库管理：列表（LaTeX 渲染 + 来源标签）、新增/编辑正式表单
const SOURCE_LABEL = { teacher: '某位老师', paper: '试卷', ai: 'AI' };
function sourceLabel(s) {
    return SOURCE_LABEL[s] || (s === 'manual' ? '某位老师' : (s === 'exam' ? 'AI' : (s || '—')));
}
const SOURCE_TAG_CLASS = { teacher: 'src-teacher', paper: 'src-paper', ai: 'src-ai' };

async function loadBankList() {
    const params = new URLSearchParams({
        subject: $('fSubject').value, topic: $('fTopic').value,
        type: $('fType').value, difficulty: $('fDifficulty').value, source: $('fSource').value,
    });
    const d = await apiFetch(`/api/questionbank/list?${params.toString()}`);
    const list = $('bankList');
    const qs = d.questions || [];
    list.innerHTML = qs.length ? qs.map(q => `
        <div class="bank-item">
            <div class="bank-item-meta">
                <span class="tag">${esc(q.subject)}</span>
                <span class="tag">${esc(q.type)}</span>
                <span class="tag">${esc(q.difficulty)}</span>
                <span class="tag">${esc(q.topic || '')}</span>
                <span class="tag source-tag ${SOURCE_TAG_CLASS[q.source] || ''}">来源：${esc(sourceLabel(q.source))}</span>
            </div>
            <div class="bank-item-content">${renderMath(escMath(q.content || ''))}</div>
            <div class="bank-item-actions">
                <button class="btn-small" onclick="openBankForm(${q.id})">编辑</button>
                <button class="btn-small btn-danger" onclick="deleteBankQuestion(${q.id})">删除</button>
            </div>
        </div>`).join('') : '<p class="empty-row">题库为空，点「＋ 新增题目」或去「出试卷」一键入库</p>';
}

let _editingId = null;

async function openBankForm(id) {
    _editingId = id || null;
    $('bankFormTitle').textContent = id ? '编辑题目' : '新增题目';
    if (id) {
        const q = await apiFetch(`/api/questionbank/${id}`);
        $('bfSubject').value = q.subject || '';
        $('bfType').value = q.type || '选择题';
        $('bfDifficulty').value = q.difficulty || '中等';
        $('bfSource').value = SOURCE_LABEL[q.source] ? q.source : 'teacher';
        $('bfChapter').value = q.chapter || '';
        $('bfTopic').value = q.topic || '';
        $('bfContent').value = q.content || '';
        $('bfAnswer').value = q.answer || '';
        $('bfAnalysis').value = q.analysis || '';
    } else {
        ['bfSubject', 'bfChapter', 'bfTopic', 'bfContent', 'bfAnswer', 'bfAnalysis'].forEach(id => $(id).value = '');
        $('bfType').value = '选择题';
        $('bfDifficulty').value = '中等';
        $('bfSource').value = 'teacher';
    }
    $('bankFormModal').classList.remove('hidden');
}

function closeBankForm() {
    $('bankFormModal').classList.add('hidden');
}

$('bfSave').addEventListener('click', async () => {
    const q = {
        subject: $('bfSubject').value, type: $('bfType').value, difficulty: $('bfDifficulty').value,
        chapter: $('bfChapter').value, topic: $('bfTopic').value,
        content: $('bfContent').value, answer: $('bfAnswer').value, analysis: $('bfAnalysis').value,
        source: $('bfSource').value,
    };
    if (!q.content.trim()) { alert('请填写题干'); return; }
    if (_editingId) {
        await apiFetch(`/api/questionbank/${_editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
    } else {
        await postJson('/api/questionbank/', q);
    }
    closeBankForm();
    loadBankList();
});

async function deleteBankQuestion(id) {
    if (!confirm('确定删除该题？')) return;
    await apiFetch(`/api/questionbank/${id}`, { method: 'DELETE' });
    loadBankList();
}
