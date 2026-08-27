// ═══════════════════════════════════════════════════════
// 全局状态
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// 步骤导航
// ═══════════════════════════════════════════════════════
const btnPrev = $('btnPrev'), btnNext = $('btnNext'), navHint = $('navHint');
const panels = document.querySelectorAll('.step-panel');
const stepDots = document.querySelectorAll('.steps-bar .step');

function goStep(n) {
    if (n < 1 || n > 5) return;
    S.currentStep = n;
    panels.forEach(p => p.classList.remove('active'));
    $('panel-step' + n).classList.add('active');
    stepDots.forEach(d => {
        const ds = parseInt(d.dataset.step);
        d.classList.remove('active', 'done');
        if (ds === n) d.classList.add('active');
        else if (ds < n) d.classList.add('done');
    });
    btnPrev.disabled = n === 1;
    if (n === 5) { btnNext.textContent = '完成 ✓'; btnNext.style.display = 'none'; }
    else { btnNext.textContent = '下一步 →'; btnNext.style.display = ''; }
    updateNavHint();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateNavHint() {
    const hints = {
        1: '填写课程名称和命题范围',
        2: '上传往年真题，AI 将自动解析',
        3: '检查 AI 提取的知识点，可修正增删',
        4: '生成并调整试卷结构（题型/分值/知识点）',
        5: '命制试卷，切换模板、逐题替换、一键入库'
    };
    navHint.textContent = hints[S.currentStep] || '';
}

btnPrev.addEventListener('click', () => goStep(S.currentStep - 1));
btnNext.addEventListener('click', async () => {
    // 在进入下一步之前，根据步骤做保存/验证
    const ok = await handleNextStep(S.currentStep);
    if (ok) goStep(S.currentStep + 1);
});

// 点击步骤圆点跳转（只能跳到已完成的步骤或下一步）
stepDots.forEach(d => {
    d.addEventListener('click', () => {
        const target = parseInt(d.dataset.step);
        // 允许跳到已完成步骤回退修改
        if (target < S.currentStep || target === S.currentStep + 1) {
            if (target === S.currentStep + 1) {
                handleNextStep(S.currentStep).then(ok => { if (ok) goStep(target); });
            } else {
                goStep(target);
            }
        }
    });
});

// ═══════════════════════════════════════════════════════
// 处理"下一步"
// ═══════════════════════════════════════════════════════
async function handleNextStep(step) {
    switch (step) {
        case 1:
            // 创建会话或保存 Step 1
            if (!S.sessionId) {
                const fd = new FormData();
                fd.append('course', $('course').value);
                fd.append('scope', $('scope').value);
                fd.append('subject', $('subject').value);
                const r = await fetch('/api/session/start', { method: 'POST', body: fd });
                const d = await r.json();
                S.sessionId = d.session_id;
            } else {
                const fd = new FormData();
                fd.append('course', $('course').value);
                fd.append('scope', $('scope').value);
                fd.append('subject', $('subject').value);
                await fetch(`/api/session/${S.sessionId}/step1`, { method: 'POST', body: fd });
            }
            return true;

        case 2:
            // 检查是否已完成 AI 解析（上传真题解析 或 按专业/年级生成大纲）
            if (!S.knowledge) {
                alert('请先上传真题解析，或按专业/年级生成知识点大纲');
                return false;
            }
            // 加载知识点到 Step 3 表格
            loadKnowledgeTable();
            return true;

        case 3:
            // 保存知识点
            if (!S.knowledge) return true;
            // 先读取表格最新数据
            syncTableToKnowledge();
            await fetch(`/api/session/${S.sessionId}/step3/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ knowledge: S.knowledge }),
            });
            return true;

        case 4:
            // 保存命题设置
            const fd4 = new FormData();
            fd4.append('difficulty', `基础${$('basicPct').textContent} 中等${$('mediumPct').textContent} 难${$('hardPct').textContent}`);
            fd4.append('n_sets', $('nSets').value);
            await fetch(`/api/session/${S.sessionId}/step4/settings`, { method: 'POST', body: fd4 });
            syncStructureFromTable();
            await postJson(`/api/session/${S.sessionId}/step4/save-structure`, { structure: S.structure });
            return true;

        default:
            return true;
    }
}

// ═══════════════════════════════════════════════════════
// Step 2: 文件上传
// ═══════════════════════════════════════════════════════
const dropZone = $('dropZone');
const fileInput = $('pastPapers');
const fileList = $('fileList');
const btnUpload = $('btnUpload');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

function handleFiles(files) {
    S.uploadedFiles = Array.from(files);
    if (S.uploadedFiles.length === 0) return;
    fileList.innerHTML = S.uploadedFiles.map(f =>
        `<span class="file-tag">📄 ${f.name} <small>(${(f.size/1024).toFixed(0)} KB)</small></span>`
    ).join('');
    dropZone.querySelector('.drop-zone-inner').innerHTML =
        `<span class="drop-icon">✅</span><p>已选择 ${S.uploadedFiles.length} 个文件</p><p class="hint">点击更换</p>`;
    btnUpload.disabled = false;
}

// 上传并触发 AI 解析
btnUpload.addEventListener('click', async () => {
    if (S.uploadedFiles.length === 0) { alert('请先选择真题文件'); return; }
    if (!S.sessionId) {
        // 没有会话则先创建
        const fd = new FormData();
        fd.append('course', $('course').value);
        fd.append('scope', $('scope').value);
        fd.append('subject', $('subject').value);
        const r = await fetch('/api/session/start', { method: 'POST', body: fd });
        const d = await r.json();
        S.sessionId = d.session_id;
    }

    btnUpload.disabled = true;
    btnUpload.textContent = '⏳ 上传中...';

    // 1. 上传文件
    const uploadFd = new FormData();
    S.uploadedFiles.forEach(f => uploadFd.append('past_papers', f));
    const upRes = await fetch(`/api/session/${S.sessionId}/step2/upload`, { method: 'POST', body: uploadFd });
    const upData = await upRes.json();
    if (!upData.ok) { alert('上传失败: ' + JSON.stringify(upData)); btnUpload.disabled = false; return; }

    // 2. SSE 解析
    btnUpload.textContent = '🔍 AI 解析中...';
    const analysisBox = $('analysisBox');
    const analysisLog = $('analysisLog');
    const analysisProgress = $('analysisProgress');
    const analysisResult = $('analysisResult');
    const analysisSummary = $('analysisSummary');

    analysisBox.classList.remove('hidden');
    analysisResult.classList.add('hidden');
    analysisLog.innerHTML = '';
    analysisProgress.style.width = '10%';

    try {
        const response = await fetch(`/api/session/${S.sessionId}/step2/analyze`);
        const raw = await response.text();
        const frames = raw.split('\n\n').filter(Boolean);

        let stepCnt = 0;
        for (const frame of frames) {
            const lines = frame.split('\n');
            let evt = 'message', data = '';
            for (const line of lines) {
                if (line.startsWith('event: ')) evt = line.slice(7);
                else if (line.startsWith('data: ')) data = line.slice(6);
            }
            if (!data) continue;

            switch (evt) {
                case 'log':
                    addLogEl(analysisLog, data);
                    stepCnt++;
                    analysisProgress.style.width = Math.min(10 + stepCnt * 15, 90) + '%';
                    break;
                case 'result':
                    S.knowledge = JSON.parse(data);
                    analysisResult.classList.remove('hidden');
                    const kp = S.knowledge;
                    analysisSummary.innerHTML = `
                        <p><strong>题型数：</strong>${(kp.exam_structure?.question_types || []).length} 种 |
                        <strong>知识点数：</strong>${(kp.knowledge_points || []).length} 个 |
                        <strong>高频考点：</strong>${(kp.high_frequency_topics || []).slice(0,3).map(t=>esc(t.topic)).join('、') || '无'}</p>
                        <p style="color:var(--text-muted);margin-top:4px">${esc(kp.summary || '')}</p>`;
                    break;
                case 'done':
                    analysisProgress.style.width = '100%';
                    btnUpload.textContent = '✅ 解析完成';
                    btnUpload.disabled = true;
                    addLogEl(analysisLog, '[系统] ✅ 真题解析完成！点击"下一步"查看知识点。');
                    break;
                case 'error':
                    addLogEl(analysisLog, '❌ ' + data);
                    btnUpload.disabled = false;
                    btnUpload.textContent = '🔄 重试';
                    break;
            }
        }
    } catch (err) {
        addLogEl(analysisLog, '❌ 网络错误: ' + err.message);
        btnUpload.disabled = false;
        btnUpload.textContent = '🔄 重试';
    }
});

// 不上传真题，按专业+年级+期中/期末直接生成知识点大纲
$('btnGenSyllabus').addEventListener('click', async () => {
    const major = $('sylMajor').value.trim();
    const grade = $('sylGrade').value;
    const phase = document.querySelector('input[name="sylPhase"]:checked')?.value || '期中';
    if (!major) { alert('请先填写专业'); return; }

    if (!S.sessionId) {
        const fd = new FormData();
        fd.append('course', $('course').value);
        fd.append('scope', $('scope').value);
        fd.append('subject', $('subject').value);
        const r = await fetch('/api/session/start', { method: 'POST', body: fd });
        const d = await r.json();
        S.sessionId = d.session_id;
    }

    const btn = $('btnGenSyllabus');
    btn.disabled = true; btn.textContent = '🤖 生成中...';

    const analysisBox = $('analysisBox');
    const analysisLog = $('analysisLog');
    const analysisProgress = $('analysisProgress');
    const analysisResult = $('analysisResult');
    const analysisSummary = $('analysisSummary');

    analysisBox.classList.remove('hidden');
    analysisResult.classList.add('hidden');
    analysisLog.innerHTML = '';
    analysisProgress.style.width = '10%';

    const qs = new URLSearchParams({ major, grade, phase });
    try {
        await streamSSE(`/api/session/${S.sessionId}/step2/generate-syllabus?${qs.toString()}`, {
            log: (d) => {
                addLogEl(analysisLog, d);
                analysisProgress.style.width = Math.min(parseInt(analysisProgress.style.width) + 15, 90) + '%';
            },
            result: (d) => {
                S.knowledge = JSON.parse(d);
                analysisResult.classList.remove('hidden');
                const kp = S.knowledge;
                analysisSummary.innerHTML = `
                    <p><strong>题型数：</strong>${(kp.exam_structure?.question_types || []).length} 种 |
                    <strong>知识点数：</strong>${(kp.knowledge_points || []).length} 个 |
                    <strong>高频考点：</strong>${(kp.high_frequency_topics || []).slice(0,3).map(t=>esc(t.topic)).join('、') || '无'}</p>
                    <p style="color:var(--text-muted);margin-top:4px">${esc(kp.summary || '')}</p>`;
            },
            done: () => {
                analysisProgress.style.width = '100%';
                btn.textContent = '✅ 大纲已生成';
                addLogEl(analysisLog, '[系统] ✅ 知识点大纲生成完毕！点击"下一步"查看并确认知识点。');
            },
            error: (d) => {
                addLogEl(analysisLog, '❌ ' + d);
                btn.disabled = false; btn.textContent = '🔄 重试';
            },
        });
    } catch (err) {
        addLogEl(analysisLog, '❌ 网络错误: ' + err.message);
        btn.disabled = false; btn.textContent = '🔄 重试';
    }
});

// ═══════════════════════════════════════════════════════
// Step 3: 知识点表格
// ═══════════════════════════════════════════════════════
function loadKnowledgeTable() {
    const tbody = $('kpTableBody');
    const kp = S.knowledge?.knowledge_points || [];
    if (kp.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">未检测到知识点，请返回上一步重新解析</td></tr>';
        return;
    }
    tbody.innerHTML = kp.map((k, i) => `
        <tr data-index="${i}">
            <td contenteditable="true" class="cell-chapter">${esc(k.chapter || '')}</td>
            <td contenteditable="true" class="cell-topic">${esc(k.topic || '')}</td>
            <td>
                <select class="cell-difficulty">
                    <option value="基础" ${k.difficulty==='基础'?'selected':''}>基础</option>
                    <option value="中等" ${k.difficulty==='中等'?'selected':''}>中等</option>
                    <option value="难" ${k.difficulty==='难'?'selected':''}>难</option>
                </select>
            </td>
            <td contenteditable="true" class="cell-freq">${k.frequency || 1}</td>
            <td contenteditable="true" class="cell-refs">${esc((k.question_refs || []).join(', '))}</td>
            <td><button class="btn-del-row" onclick="deleteKPRow(this)">×</button></td>
        </tr>
    `).join('');
}

function syncTableToKnowledge() {
    const rows = document.querySelectorAll('#kpTableBody tr');
    const kp = [];
    rows.forEach(row => {
        const idx = row.dataset.index;
        if (idx === undefined) return; // 跳过头行/空行
        const chapter = row.querySelector('.cell-chapter')?.textContent?.trim() || '';
        const topic = row.querySelector('.cell-topic')?.textContent?.trim() || '';
        const difficulty = row.querySelector('.cell-difficulty')?.value || '基础';
        const frequency = parseInt(row.querySelector('.cell-freq')?.textContent?.trim()) || 1;
        const refs = (row.querySelector('.cell-refs')?.textContent?.trim() || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean);
        if (topic) {
            kp.push({
                ...(S.knowledge?.knowledge_points?.[parseInt(idx)] || {}),
                chapter, topic, difficulty, frequency, question_refs: refs,
            });
        }
    });
    if (S.knowledge) S.knowledge.knowledge_points = kp;
}

function deleteKPRow(btn) {
    if (!confirm('确定删除这个知识点？')) return;
    const tr = btn.closest('tr');
    const idx = parseInt(tr.dataset.index, 10);
    tr.remove();
    // 同步数组：删除对应位置的知识点，保持数组与 DOM 同序
    const kp = S.knowledge?.knowledge_points;
    if (kp && !isNaN(idx) && idx >= 0 && idx < kp.length) {
        kp.splice(idx, 1);
    }
    reindexKPRows();
}

function reindexKPRows() {
    document.querySelectorAll('#kpTableBody tr').forEach((tr, i) => {
        tr.dataset.index = String(i);
    });
}

$('btnAddRow').addEventListener('click', () => {
    const tbody = $('kpTableBody');
    // 若处于空态（只有 empty-row），先移除占位行
    tbody.querySelector('.empty-row')?.remove();
    const idx = tbody.querySelectorAll('tr').length;
    const row = document.createElement('tr');
    row.dataset.index = String(idx);
    row.innerHTML = `
        <td contenteditable="true" class="cell-chapter">新章节</td>
        <td contenteditable="true" class="cell-topic">新知识点</td>
        <td><select class="cell-difficulty"><option value="基础">基础</option><option value="中等" selected>中等</option><option value="难">难</option></select></td>
        <td contenteditable="true" class="cell-freq">1</td>
        <td contenteditable="true" class="cell-refs">新增</td>
        <td><button class="btn-del-row" onclick="deleteKPRow(this)">×</button></td>
    `;
    tbody.appendChild(row);
    reindexKPRows();
});

$('btnExportKP').addEventListener('click', () => {
    syncTableToKnowledge();
    const blob = new Blob([JSON.stringify(S.knowledge, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'knowledge_points.json';
    a.click(); URL.revokeObjectURL(url);
});

$('btnSaveKnowledge').addEventListener('click', async () => {
    syncTableToKnowledge();
    await handleNextStep(3);
    goStep(4);
});

// ═══════════════════════════════════════════════════════
// Step 4: 难度滑条 + 细目表预览
// ═══════════════════════════════════════════════════════
const basicSlider = $('basicSlider');
const hardSlider = $('hardSlider');

function updateSliders() {
    const basic = parseInt(basicSlider.value);
    const hard = parseInt(hardSlider.value);
    const medium = 100 - basic - hard;
    if (medium < 5) {
        // 调整
        if (basic + hard > 95) {
            basicSlider.value = Math.max(10, 95 - hard);
        }
        return updateSliders();
    }
    $('basicPct').textContent = basic + '%';
    $('mediumPct').textContent = medium + '%';
    $('hardPct').textContent = hard + '%';
    $('sliderBasic').style.width = basic + '%';
    $('sliderMedium').style.width = medium + '%';
    $('sliderHard').style.width = hard + '%';
}

basicSlider.addEventListener('input', updateSliders);
hardSlider.addEventListener('input', updateSliders);

// 保存设置
$('nSets').addEventListener('change', () => saveSettings());
basicSlider.addEventListener('change', () => saveSettings());
hardSlider.addEventListener('change', () => saveSettings());

async function saveSettings() {
    if (!S.sessionId) return;
    const basic = parseInt(basicSlider.value);
    const hard = parseInt(hardSlider.value);
    const medium = 100 - basic - hard;
    const fd = new FormData();
    fd.append('difficulty', `基础${basic}% 中等${medium}% 难${hard}%`);
    fd.append('n_sets', $('nSets').value);
    await fetch(`/api/session/${S.sessionId}/step4/settings`, { method: 'POST', body: fd });
}

function renderStructureTable() {
    const tbody = $('structureBody');
    const qs = S.structure || [];
    if (qs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">暂无结构，点击"AI 生成试卷结构"</td></tr>';
        return;
    }
    const kpList = S.knowledge?.knowledge_points || [];
    tbody.innerHTML = qs.map((q, i) => {
        const curVal = `${q.chapter || ''} | ${q.topic || ''}`;
        const inList = kpList.some(k => (k.chapter + ' | ' + k.topic) === curVal);
        let opts = kpList.map(k => {
            const val = k.chapter + ' | ' + k.topic;
            const sel = val === curVal ? ' selected' : '';
            return `<option value="${esc(val)}"${sel}>${esc(val)}</option>`;
        }).join('');
        if (!inList && curVal !== ' | ') {
            // AI 生成了列表外的知识点：前置当前值选项，避免静默丢失
            opts = `<option value="${esc(curVal)}" selected>${esc(curVal)}</option>` + opts;
        }
        return `
        <tr data-index="${i}">
            <td class="cell-no">${q.no || i + 1}</td>
            <td contenteditable="true" class="cell-type">${esc(q.type || '')}</td>
            <td contenteditable="true" class="cell-score">${q.score || 0}</td>
            <td contenteditable="true" class="cell-chapter">${esc(q.chapter || '')}</td>
            <td><select class="cell-topic">${opts}</select></td>
            <td>
                <select class="cell-difficulty">
                    <option value="基础" ${q.difficulty==='基础'?'selected':''}>基础</option>
                    <option value="中等" ${q.difficulty==='中等'?'selected':''}>中等</option>
                    <option value="难" ${q.difficulty==='难'?'selected':''}>难</option>
                </select>
            </td>
            <td><button class="btn-del-row" onclick="deleteQuestionRow(this)">×</button></td>
        </tr>`;
    }).join('');
}

function syncStructureFromTable() {
    const rows = document.querySelectorAll('#structureBody tr');
    const qs = [];
    rows.forEach((row, i) => {
        if (row.classList.contains('empty-row')) return; // 跳过空态占位行
        const select = row.querySelector('.cell-topic');
        if (!select) return;
        const chapter = row.querySelector('.cell-chapter')?.textContent?.trim() || '';
        const topic = (select.value.split(' | ')[1] || '').trim();
        qs.push({
            no: i + 1,
            type: row.querySelector('.cell-type')?.textContent?.trim() || '',
            score: parseInt(row.querySelector('.cell-score')?.textContent?.trim()) || 0,
            chapter,
            topic,
            difficulty: row.querySelector('.cell-difficulty')?.value || '基础',
        });
    });
    S.structure = qs;
}

function deleteQuestionRow(btn) {
    btn.closest('tr').remove();
    syncStructureFromTable();
    renderStructureTable();
}

$('btnAddQuestion').addEventListener('click', () => {
    S.structure = S.structure || [];
    S.structure.push({ no: S.structure.length + 1, type: '选择题', score: 5, chapter: '', topic: '', difficulty: '基础' });
    renderStructureTable();
});

$('btnPreviewStructure').addEventListener('click', async () => {
    if (!S.sessionId) { alert('请先完成前面步骤'); return; }
    await saveSettings();
    const box = $('structureBox');
    const log = $('structureLog');
    box.classList.remove('hidden');
    log.innerHTML = '';
    addLogEl(log, '[系统] 正在生成试卷结构...');
    await streamSSE(`/api/session/${S.sessionId}/step4/preview-structure`, {
        log: (d) => addLogEl(log, d),
        result: (d) => {
            const parsed = JSON.parse(d);
            S.structure = parsed.questions || [];
            renderStructureTable();
            addLogEl(log, '[系统] ✅ 试卷结构生成完毕，可在下表调整');
        },
        error: (d) => addLogEl(log, '❌ ' + d),
    });
});

// ═══════════════════════════════════════════════════════
// Step 5: 命题生成
// ═══════════════════════════════════════════════════════
function currentPaperMeta() {
    return {
        title: $('course').value || '试卷',
        subject: $('subject').value || '',
        duration: S.knowledge?.exam_structure?.duration_minutes || 120,
    };
}

$('btnGenerate').addEventListener('click', async () => {
    if (!S.sessionId) { alert('请先完成前面步骤'); return; }

    const genBox = $('generateBox');
    const genLog = $('generateLog');
    const genProgress = $('generateProgress');
    const errorBox = $('errorBox');

    genBox.classList.remove('hidden');
    errorBox.classList.add('hidden');
    genLog.innerHTML = '';
    genProgress.style.width = '5%';
    $('btnGenerate').disabled = true;
    $('btnGenerate').textContent = '⏳ 命题中...';

    try {
        const resp = await fetch(`/api/session/${S.sessionId}/step5/generate`);
        const raw = await resp.text();
        const frames = raw.split('\n\n').filter(Boolean);

        let stepCnt = 0;
        for (const frame of frames) {
            const lines = frame.split('\n');
            let evt = 'message', data = '';
            for (const line of lines) {
                if (line.startsWith('event: ')) evt = line.slice(7);
                else if (line.startsWith('data: ')) data = line.slice(6);
            }
            if (!data) continue;

            switch (evt) {
                case 'log':
                    addLogEl(genLog, data);
                    stepCnt++;
                    genProgress.style.width = Math.min(5 + stepCnt * 10, 90) + '%';
                    break;
                case 'result': {
                    const parsed = JSON.parse(data);
                    S.questions = parsed.questions || [];
                    renderPaper(S.questions, $('paperTemplate').value, currentPaperMeta());
                    break;
                }
                case 'done':
                    genProgress.style.width = '100%';
                    addLogEl(genLog, '[系统] ✅ 命题完成！试卷已在下方渲染，可切换模板或替换题目。');
                    break;
                case 'error':
                    errorBox.textContent = '❌ ' + data;
                    errorBox.classList.remove('hidden');
                    break;
            }
        }
    } catch (err) {
        errorBox.textContent = '❌ 网络错误: ' + err.message;
        errorBox.classList.remove('hidden');
    } finally {
        $('btnGenerate').disabled = false;
        $('btnGenerate').textContent = '🔄 重新生成';
    }
});

$('paperTemplate').addEventListener('change', () => {
    if (S.questions?.length) renderPaper(S.questions, $('paperTemplate').value, currentPaperMeta());
});

// ═══════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════
updateSliders();

$('btnImportBank').addEventListener('click', async () => {
    if (!S.questions || S.questions.length === 0) { alert('请先生成试卷'); return; }
    const items = S.questions.map(q => ({
        subject: $('subject').value || '', type: q.type, difficulty: q.difficulty,
        chapter: q.chapter, topic: q.topic, content: q.content,
        answer: q.answer, analysis: q.analysis, source: 'ai',
    }));
    const d = await postJson('/api/questionbank/import', { questions: items });
    alert(`已入库 ${d.imported} 道题`);
});

$('btnSavePaper').addEventListener('click', async () => {
    if (!S.questions || S.questions.length === 0) { alert('请先生成试卷'); return; }
    const meta = currentPaperMeta();
    const total = S.questions.reduce((s, q) => s + (q.score || 0), 0);
    try {
        await authedJson('/api/papers', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: meta.title, subject: meta.subject, duration: meta.duration,
                total_score: total, questions: S.questions,
            }),
        });
        alert('已保存到「我的试卷」');
    } catch (e) {
        alert('保存失败：' + (e && e.message ? e.message : e));
    }
});
goStep(1);