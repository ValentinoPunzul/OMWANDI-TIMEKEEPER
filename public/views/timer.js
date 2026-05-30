// views/timer.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

let timerInterval = null;

export function renderTimerView() {
    const main = document.getElementById('mainContent');
    const activeEntry = getMyActiveEntry();
    main.innerHTML = `
        ${renderViewHeader('Live Timer')}
        <div class="timer-container">
            <div class="timer-ring-card">
                <svg class="timer-ring-svg" viewBox="0 0 200 200">
                    <circle class="ring-bg" cx="100" cy="100" r="88" />
                    <circle class="ring-progress" id="timerRingProgress" cx="100" cy="100" r="88"
                        stroke-dasharray="553"
                        stroke-dashoffset="${activeEntry ? getRingOffset(activeEntry) : 553}" />
                </svg>
                <div class="timer-face">
                    <div class="timer-elapsed" id="timerElapsed">
                        ${activeEntry ? formatElapsed(activeEntry.start_time) : '00:00:00'}
                    </div>
                    <div class="timer-label">${activeEntry ? 'RUNNING' : 'READY'}</div>
                </div>
            </div>
            ${activeEntry ? renderActiveControls(activeEntry) : renderStartForm()}
        </div>`;
    if (activeEntry) startTickingDisplay(activeEntry);
    else populateProjectSelect();
}

function renderStartForm() {
    return `
        <div class="timer-form glass-panel">
            <div class="form-group">
                <label>Project</label>
                <select id="timerProject" class="form-control">
                    <option value="">-- Select project --</option>
                    ${state.projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Task</label>
                <input type="text" id="timerTask" class="form-control" placeholder="What are you working on?" />
            </div>
            <div class="form-group">
                <label>Description <span class="optional">(optional)</span></label>
                <input type="text" id="timerDescription" class="form-control" placeholder="Add details..." />
            </div>
            <button class="btn primary btn-start" onclick="startMyTimer()">START TIMER</button>
        </div>`;
}

function renderActiveControls(entry) {
    const project = state.projects.find(p => p.id === entry.project_id);
    return `
        <div class="timer-active-info glass-panel">
            <div class="active-project-badge" style="background:${escapeHtml(project?.color || '#1d4ed8')}20;border-color:${escapeHtml(project?.color || '#1d4ed8')}">
                ${escapeHtml(project?.name || 'Unknown Project')}
            </div>
            <div class="active-task">${escapeHtml(entry.task || '')}</div>
            <div class="active-description">${escapeHtml(entry.description || '')}</div>
            <button class="btn danger btn-stop" onclick="stopMyTimer('${escapeHtml(entry.id)}')">STOP &amp; SAVE</button>
        </div>`;
}

function populateProjectSelect() {
    const sel = document.getElementById('timerProject');
    if (!sel || sel.options.length > 1) return;
    state.projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.name; sel.appendChild(opt);
    });
}

function getMyActiveEntry() {
    return state.timeEntries.find(e =>
        e.employee_id === state.activeProfileId && e.start_time &&
        (!e.end_time || e.end_time === '') && (!e.total_hours || e.total_hours === 0)
    ) || null;
}

function formatElapsed(startTime) {
    const s = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
    return [Math.floor(s/3600), Math.floor((s%3600)/60), s%60].map(n => String(n).padStart(2,'0')).join(':');
}

function getRingOffset(entry) {
    const elapsed = (Date.now() - new Date(entry.start_time).getTime()) / 1000;
    return 553 - (553 * Math.min(elapsed / (8 * 3600), 1));
}

function startTickingDisplay(entry) {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const el = document.getElementById('timerElapsed');
        const ring = document.getElementById('timerRingProgress');
        if (!el) { clearInterval(timerInterval); return; }
        el.textContent = formatElapsed(entry.start_time);
        if (ring) ring.setAttribute('stroke-dashoffset', getRingOffset(entry));
    }, 1000);
}

export function stopTimerInterval() { clearInterval(timerInterval); }

window.startMyTimer = async function () {
    const projectId = document.getElementById('timerProject')?.value;
    const task = document.getElementById('timerTask')?.value?.trim();
    if (!projectId) { showNotification('Select a project first', 'warning'); return; }
    if (!task) { showNotification('Enter a task description', 'warning'); return; }
    try {
        const entry = await apiRequest('/entries', { method: 'POST', body: JSON.stringify({
            employee_id: state.activeProfileId, project_id: projectId, task,
            description: document.getElementById('timerDescription')?.value?.trim() || '',
            start_time: new Date().toISOString(), end_time: '', total_hours: 0
        })});
        state.timeEntries.push(entry);
        renderTimerView();
        showNotification('Timer started', 'success');
    } catch (e) { showNotification('Failed to start timer: ' + e.message, 'error'); }
};

window.stopMyTimer = async function (entryId) {
    const entry = state.timeEntries.find(e => e.id === entryId);
    if (!entry) return;
    const endTime = new Date().toISOString();
    const totalHours = (Date.now() - new Date(entry.start_time).getTime()) / 3600000;
    try {
        const updated = await apiRequest(`/entries/${entryId}`, { method: 'PUT',
            body: JSON.stringify({ ...entry, end_time: endTime, total_hours: parseFloat(totalHours.toFixed(4)) })});
        const idx = state.timeEntries.findIndex(e => e.id === entryId);
        if (idx !== -1) state.timeEntries[idx] = updated;
        clearInterval(timerInterval);
        renderTimerView();
        showNotification(`Logged ${totalHours.toFixed(2)}h`, 'success');
    } catch (e) { showNotification('Failed to stop timer: ' + e.message, 'error'); }
};

window.stopUserTimer = window.stopMyTimer;
