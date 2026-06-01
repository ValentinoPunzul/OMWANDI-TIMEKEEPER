// views/timer.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

let timerInterval = null;
let _selectedEmpId = null; // Foreman: currently selected employee

// ── Entry point ───────────────────────────────────────────────────────────────
export function renderTimerView() {
    const me = state.employees.find(e => e.id === state.activeProfileId);
    const isForeman = state.userRole === 'Foreman';
    const isTeamLeader = (me?.designation || '').toLowerCase().includes('team leader');
    if (isForeman || isTeamLeader) {
        // Team leaders can start timers for ALL team members; foremen for their own line
        renderForemanView(isTeamLeader && !isForeman);
    } else {
        renderMyTimer();
    }
}

// ── FOREMAN VIEW ──────────────────────────────────────────────────────────────
function renderForemanView(allTeamMembers = false) {
    const main = document.getElementById('mainContent');

    let team;
    if (allTeamMembers) {
        // Team Leader: all project floor staff across every team (exclude self, foremen, managers)
        team = state.employees.filter(e => {
            if (e.id === state.activeProfileId) return false;
            const dept = (e.department || '').toLowerCase();
            const desig = (e.designation || '').toLowerCase();
            return dept === 'projects' && !desig.includes('foreman') && !desig.includes('manager');
        });
    } else {
        // Foreman: direct reports + their direct reports
        const directReports = state.employees.filter(e => e.reports_to === state.activeProfileId);
        const subReports = state.employees.filter(e => directReports.some(dr => dr.id === e.reports_to));
        const teamIds = new Set([...directReports, ...subReports].map(e => e.id));
        team = state.employees.filter(e => teamIds.has(e.id));
    }

    if (team.length === 0) {
        main.innerHTML = `${renderViewHeader('Live Timer')}
            <div class="glass-panel" style="padding:2rem;text-align:center">
                <p class="muted">No team members found.</p>
            </div>`;
        return;
    }

    // If a specific employee is selected, show their timer form
    if (_selectedEmpId) {
        const selectedEmp = team.find(e => e.id === _selectedEmpId);
        if (selectedEmp) { renderForemanTimerFor(main, selectedEmp); return; }
    }

    // Group members by their manager (reports_to)
    const groups = {};
    team.forEach(emp => {
        const mgrId = emp.reports_to || '_other';
        if (!groups[mgrId]) {
            const mgr = state.employees.find(e => e.id === mgrId);
            groups[mgrId] = { leader: mgr || null, members: [] };
        }
        groups[mgrId].members.push(emp);
    });

    const sortedGroups = Object.values(groups).sort((a,b) =>
        (a.leader?.name || 'zzz').localeCompare(b.leader?.name || 'zzz'));

    let groupsHtml = '';
    for (const group of sortedGroups) {
        const cards = group.members
            .sort((a,b) => (a.name||'').localeCompare(b.name||''))
            .map(emp => {
                const active = getActiveEntryFor(emp.id);
                const initials = (emp.name||'??').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
                const color = emp.color || '#1d4ed8';
                const project = active ? state.projects.find(p => p.id === active.project_id) : null;
                return `
                <div class="foreman-emp-card glass-panel ${active ? 'timer-running' : ''}" onclick="selectForemanEmployee('${escapeHtml(emp.id)}')">
                    <div class="foreman-emp-left">
                        <div class="emp-avatar" style="background:${escapeHtml(color)}">${escapeHtml(initials)}</div>
                        <div class="foreman-emp-info">
                            <div class="emp-name">${escapeHtml(emp.name)}</div>
                            <div class="emp-no">${escapeHtml(emp.designation||'')}</div>
                            ${active && project ? `<div class="foreman-active-proj">${escapeHtml(project.name)}</div>` : ''}
                        </div>
                    </div>
                    <div class="foreman-emp-right">
                        ${active
                            ? `<div class="foreman-timer-badge running">
                                    <span class="foreman-elapsed" id="felapsed-${escapeHtml(emp.id)}">${formatElapsed(active.start_time)}</span>
                                    <button class="btn danger btn-sm" onclick="event.stopPropagation(); foremanStopTimer('${escapeHtml(active.id)}','${escapeHtml(emp.id)}')">STOP</button>
                               </div>`
                            : `<div class="foreman-timer-badge idle">
                                    <span class="muted" style="font-size:.75rem">Idle</span>
                                    <button class="btn primary btn-sm" onclick="event.stopPropagation(); selectForemanEmployee('${escapeHtml(emp.id)}')">START</button>
                               </div>`
                        }
                    </div>
                </div>`;
            }).join('');

        const leaderName = group.leader ? escapeHtml(group.leader.name) : 'Other';
        groupsHtml += `
            <div class="foreman-group">
                <div class="foreman-group-label">${leaderName}</div>
                ${cards}
            </div>`;
    }

    main.innerHTML = `
        ${renderViewHeader(allTeamMembers ? 'Team Timers — All Members' : 'Team Timers')}
        <div class="foreman-view">
            ${groupsHtml}
        </div>`;

    startForemanTicking(team);
}

function renderForemanTimerFor(main, emp) {
    const activeEntry = getActiveEntryFor(emp.id);
    const initials = (emp.name||'??').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const color = emp.color || '#1d4ed8';

    const projectOptions = state.projects
        .map(p => `<option value="${escapeHtml(p.id)}" data-npt="${p.proj_no === 'NPT' || p.name.toUpperCase().includes('NPT') ? 'true' : 'false'}">
            ${p.proj_no ? '[' + escapeHtml(p.proj_no) + '] ' : ''}${escapeHtml(p.name)}
        </option>`).join('');

    main.innerHTML = `
        ${renderViewHeader('Team Timers')}
        <div class="timer-container">
            <button class="btn outline" style="align-self:flex-start;margin-bottom:.5rem" onclick="selectForemanEmployee(null)">← Back to Team</button>

            <div class="foreman-selected-emp glass-panel">
                <div class="emp-avatar" style="background:${escapeHtml(color)};width:48px;height:48px;font-size:1rem">${escapeHtml(initials)}</div>
                <div>
                    <div class="emp-name" style="font-size:1rem">${escapeHtml(emp.name)}</div>
                    <div class="muted">${escapeHtml(emp.designation||'')}</div>
                </div>
            </div>

            <div class="timer-ring-card">
                <svg class="timer-ring-svg" viewBox="0 0 200 200">
                    <circle class="ring-bg" cx="100" cy="100" r="88" />
                    <circle class="ring-progress" id="timerRingProgress" cx="100" cy="100" r="88"
                        stroke-dasharray="553"
                        stroke-dashoffset="${activeEntry ? getRingOffset(activeEntry) : 553}" />
                </svg>
                <div class="timer-face">
                    <div class="timer-elapsed" id="timerElapsed">${activeEntry ? formatElapsed(activeEntry.start_time) : '00:00:00'}</div>
                    <div class="timer-label">${activeEntry ? 'RUNNING' : 'READY'}</div>
                </div>
            </div>

            ${activeEntry
                ? `<div class="timer-active-info glass-panel">
                    <div class="active-project-badge" style="background:rgba(29,78,216,.1);border-color:#1d4ed8">
                        ${escapeHtml(state.projects.find(p => p.id === activeEntry.project_id)?.name || 'Unknown')}
                    </div>
                    <button class="btn-stop" onclick="foremanStopTimer('${escapeHtml(activeEntry.id)}','${escapeHtml(emp.id)}')">STOP &amp; SAVE</button>
                   </div>`
                : `<div class="timer-form glass-panel">
                    <div class="form-group">
                        <label>Project</label>
                        <select id="timerProject" class="form-control" onchange="handleProjectChange(this)">
                            <option value="">-- Select project --</option>
                            ${projectOptions}
                        </select>
                    </div>
                    <div class="form-group" id="nptReasonGroup" style="display:none">
                        <label>Reason for NPT <span style="color:#f43f5e">*</span></label>
                        <input type="text" id="timerNptReason" class="form-control" placeholder="Explain reason for non-productive time..." />
                    </div>
                    <button class="btn primary btn-start" onclick="foremanStartTimer('${escapeHtml(emp.id)}')">START TIMER</button>
                   </div>`
            }
        </div>`;

    if (activeEntry) startTickingDisplay(activeEntry);
}

function startForemanTicking(team) {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        team.forEach(emp => {
            const active = getActiveEntryFor(emp.id);
            const el = document.getElementById('felapsed-' + emp.id);
            if (el && active) el.textContent = formatElapsed(active.start_time);
        });
    }, 1000);
}

// ── EMPLOYEE VIEW ─────────────────────────────────────────────────────────────
function renderMyTimer() {
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
                    <div class="timer-elapsed" id="timerElapsed">${activeEntry ? formatElapsed(activeEntry.start_time) : '00:00:00'}</div>
                    <div class="timer-label">${activeEntry ? 'RUNNING' : 'READY'}</div>
                </div>
            </div>
            ${activeEntry ? renderActiveControls(activeEntry) : renderStartForm()}
        </div>`;
    if (activeEntry) startTickingDisplay(activeEntry);
}

function renderStartForm() {
    const projectOptions = state.projects
        .map(p => `<option value="${escapeHtml(p.id)}" data-npt="${p.proj_no === 'NPT' || p.name.toUpperCase().includes('NPT') ? 'true' : 'false'}">
            ${p.proj_no ? '[' + escapeHtml(p.proj_no) + '] ' : ''}${escapeHtml(p.name)}
        </option>`).join('');
    return `
        <div class="timer-form glass-panel">
            <div class="form-group">
                <label>Project</label>
                <select id="timerProject" class="form-control" onchange="handleProjectChange(this)">
                    <option value="">-- Select project --</option>
                    ${projectOptions}
                </select>
            </div>
            <div class="form-group" id="nptReasonGroup" style="display:none">
                <label>Reason for NPT <span style="color:#f43f5e">*</span></label>
                <input type="text" id="timerNptReason" class="form-control" placeholder="Explain reason for non-productive time..." />
            </div>
            <button class="btn primary btn-start" onclick="startMyTimer()">START TIMER</button>
        </div>`;
}

function renderActiveControls(entry) {
    const project = state.projects.find(p => p.id === entry.project_id);
    return `
        <div class="timer-active-info glass-panel">
            <div class="active-project-badge" style="background:${escapeHtml(project?.color || '#1d4ed8')}20;border-color:${escapeHtml(project?.color || '#1d4ed8')}">
                ${project?.proj_no ? '[' + escapeHtml(project.proj_no) + '] ' : ''}${escapeHtml(project?.name || 'Unknown Project')}
            </div>
            ${entry.description ? `<div class="active-description">${escapeHtml(entry.description)}</div>` : ''}
            <button class="btn-stop" onclick="stopMyTimer('${escapeHtml(entry.id)}')">STOP &amp; SAVE</button>
        </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMyActiveEntry() {
    return state.timeEntries.find(e =>
        e.employee_id === state.activeProfileId && e.start_time &&
        (!e.end_time || e.end_time === '') && (!e.total_hours || e.total_hours === 0)
    ) || null;
}

function getActiveEntryFor(empId) {
    return state.timeEntries.find(e =>
        e.employee_id === empId && e.start_time &&
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

// ── Global handlers ───────────────────────────────────────────────────────────

window.selectForemanEmployee = function(empId) {
    _selectedEmpId = empId;
    renderTimerView();
};

window.handleProjectChange = function(select) {
    const isNpt = select?.options[select.selectedIndex]?.dataset?.npt === 'true';
    const g = document.getElementById('nptReasonGroup');
    if (g) g.style.display = isNpt ? 'block' : 'none';
    if (!isNpt) { const r = document.getElementById('timerNptReason'); if (r) r.value = ''; }
};

window.foremanStartTimer = async function(empId) {
    const projectId = document.getElementById('timerProject')?.value;
    if (!projectId) { showNotification('Select a project first', 'warning'); return; }
    const select = document.getElementById('timerProject');
    const isNpt = select?.options[select.selectedIndex]?.dataset?.npt === 'true';
    const nptReason = document.getElementById('timerNptReason')?.value?.trim();
    if (isNpt && !nptReason) { showNotification('Please enter a reason for NPT', 'warning'); return; }

    // Check no active timer already
    const existing = getActiveEntryFor(empId);
    if (existing) { showNotification('This employee already has an active timer', 'warning'); return; }

    const emp = state.employees.find(e => e.id === empId);
    try {
        const entry = await apiRequest('/entries', { method: 'POST', body: JSON.stringify({
            employee_id: empId,
            project_id: projectId,
            task: isNpt ? 'NPT - ' + nptReason : 'Work',
            description: isNpt ? nptReason : '',
            start_time: new Date().toISOString(),
            end_time: '', total_hours: 0,
            started_by: state.activeProfileId  // track who started it
        })});
        state.timeEntries.push(entry);
        showNotification(`Timer started for ${emp?.name || 'employee'}`, 'success');
        renderTimerView();
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.foremanStopTimer = async function(entryId, empId) {
    const entry = state.timeEntries.find(e => e.id === entryId);
    if (!entry) return;
    const endTime = new Date().toISOString();
    const totalHours = (Date.now() - new Date(entry.start_time).getTime()) / 3600000;
    const emp = state.employees.find(e => e.id === empId);
    try {
        const updated = await apiRequest(`/entries/${entryId}`, { method: 'PUT',
            body: JSON.stringify({ ...entry, end_time: endTime, total_hours: parseFloat(totalHours.toFixed(4)) })});
        const idx = state.timeEntries.findIndex(e => e.id === entryId);
        if (idx !== -1) state.timeEntries[idx] = updated;
        clearInterval(timerInterval);
        _selectedEmpId = null;
        if (window._refreshEntries) await window._refreshEntries();
        showNotification(`Logged ${totalHours.toFixed(2)}h for ${emp?.name || 'employee'}`, 'success');
        renderTimerView();
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.startMyTimer = async function() {
    const projectId = document.getElementById('timerProject')?.value;
    if (!projectId) { showNotification('Select a project first', 'warning'); return; }
    const select = document.getElementById('timerProject');
    const isNpt = select?.options[select.selectedIndex]?.dataset?.npt === 'true';
    const nptReason = document.getElementById('timerNptReason')?.value?.trim();
    if (isNpt && !nptReason) { showNotification('Please enter a reason for NPT', 'warning'); return; }
    try {
        const entry = await apiRequest('/entries', { method: 'POST', body: JSON.stringify({
            employee_id: state.activeProfileId,
            project_id: projectId,
            task: isNpt ? 'NPT - ' + nptReason : 'Work',
            description: isNpt ? nptReason : '',
            start_time: new Date().toISOString(),
            end_time: '', total_hours: 0
        })});
        state.timeEntries.push(entry);
        renderTimerView();
        showNotification('Timer started', 'success');
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.stopMyTimer = async function(entryId) {
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
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.stopUserTimer = window.stopMyTimer;
