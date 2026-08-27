// 基座：全局状态 + DOM/fetch/SSE 工具（其余模块依赖本文件先加载）
const S = { sessionId: null, currentStep: 1, uploadedFiles: [], knowledge: null, structure: null, questions: [], paperTemplate: 'standard', generatedFiles: [] };
const $ = id => document.getElementById(id);

function esc(s) {
    if (!s) return '';
    const el = document.createElement('span');
    el.textContent = String(s);
    return el.innerHTML;
}

function addLogEl(parent, msg) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = msg;
    parent.appendChild(div);
    parent.parentElement.scrollTop = parent.parentElement.scrollHeight;
}

function parseSSE(raw) {
    return raw.split('\n\n').filter(Boolean).map(frame => {
        const lines = frame.split('\n');
        let evt = 'message', data = '';
        for (const line of lines) {
            if (line.startsWith('event: ')) evt = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
        }
        return { event: evt, data };
    }).filter(f => f.data);
}

async function streamSSE(url, handlers) {
    const resp = await fetch(url);
    const raw = await resp.text();
    for (const { event, data } of parseSSE(raw)) {
        if (handlers[event]) handlers[event](data);
    }
}

async function apiFetch(url, opts) {
    const r = await fetch(url, opts);
    return await r.json();
}

function postForm(url, obj) {
    const fd = new FormData();
    for (const k in obj) fd.append(k, obj[k]);
    return apiFetch(url, { method: 'POST', body: fd });
}

function postJson(url, obj) {
    return apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
}
