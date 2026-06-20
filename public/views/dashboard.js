// views/dashboard.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

const toHM = h => {
    const m = Math.round((h || 0) * 60);
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
};

// Which employees the current user may see (null = all, for admin)
function visibleEmployeeIds() {
    const me = state.employees.find(e => e.id === state.activeProfileId);
    const desig = (me?.designation || '').toLowerCase();
    if (state.userRole === 'Administrator') return null;
    const isMgr = state.userRole === 'Foreman' || desig.includes('team leader') || desig.includes('foreman');
    if (isMgr) {
        const direct = state.employees.filter(e => e.reports_to === state.activeProfileId).map(e => e.id);
        const sub = state.employees.filter(e => direct.includes(e.reports_to)).map(e => e.id);
        return new Set([state.activeProfileId, ...direct, ...sub]);
    }
    return new Set([state.activeProfileId]);
}

export function renderDashboard(container) {
    const me = state.employees.find(e => e.id === state.activeProfileId);
    const isForeman = me?.designation === "Foreman Marine Outfitting";

    const active = state.timeEntries.filter(e => (e.total_hours === 0 || !e.end_time) && e.start_time);

    const filtered = isForeman ? active.filter(t => {
        const staff = state.employees.find(e => e.id === t.employee_id);
        return (staff && staff.reports_to === me.name) || t.employee_id === me.id;
    }) : active;

    const grouped = {};
    filtered.forEach(t => { if (!grouped[t.project_id]) grouped[t.project_id] = []; grouped[t.project_id].push(t); });

    let listHtml = filtered.length === 0 ? '<div style="text-align:center; padding:40px; color:var(--text-muted);">No active sessions found.</div>' :
        Object.entries(grouped).map(([pid, timers]) => {
            const p = state.projects.find(proj => proj.id === pid) || { name: 'Internal', color: '#6366f1' };
            const rows = timers.map(t => {
                const emp = state.employees.find(e => e.id === t.employee_id) || { name: 'Unknown', avatar: '??', color: '#888' };
                const diff = Math.floor((new Date() - new Date(t.start_time)) / 1000);
                const timeStr = `${Math.floor(diff/3600).toString().padStart(2,'0')}:${Math.floor((diff%3600)/60).toString().padStart(2,'0')}:${(diff%60).toString().padStart(2,'0')}`;
                return `<div class="timer-card glass-panel">
                    <div class="timer-avatar" style="background:${escapeHtml(emp.color)}">${escapeHtml(emp.avatar)}</div>
                    <div class="timer-user-info"><div>${escapeHtml(emp.name)}</div><div style="font-size:0.8rem; opacity:0.7;">${escapeHtml(emp.designation || '')}</div>${(() => { const sb = state.employees.find(x=>x.id===t.started_by); return (sb && t.started_by!==t.employee_id) ? `<div style="font-size:0.7rem;opacity:0.6;color:#818cf8">▶ Started by ${escapeHtml(sb.name)}</div>` : ''; })()}</div>
                    <div class="timer-counter" style="margin-right:15px; font-family:monospace;">${timeStr}</div>
                    <button class="btn-text" style="color:#ef4444; font-weight:800;" onclick="stopUserTimer('${t.id}')">STOP</button>
                </div>`;
            }).join('');
            return `<div class="project-group"><h3>[${escapeHtml(p.proj_no) || '---'}] ${escapeHtml(p.name)}</h3>${rows}</div>`;
        }).join('');

    container.innerHTML = `${renderViewHeader('Dashboard')}`
        + `<div class="clock-card glass-container"><div class="dashboard-time" id="dashboardTime">00:00:00</div><div class="dashboard-date" id="dashboardDate">LOADING...</div></div>`
        + `<div id="yesterdayCard" class="glass-panel" style="margin-bottom:1rem;padding:1.25rem"><div class="muted">Loading yesterday's hours…</div></div>`
        + `<div class="active-timers-section">${listHtml}</div>`;

    loadYesterdayCard();
}

async function loadYesterdayCard() {
    const el = document.getElementById('yesterdayCard');
    if (!el) return;

    // Previous calendar day (local)
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const label = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();

    let rows;
    try {
        rows = await apiRequest(`/reports/daily?date=${ymd}`);
    } catch (e) {
        el.innerHTML = `<h3 style="margin:0 0 .5rem">Yesterday's Hours</h3><div class="error-text">Failed to load: ${escapeHtml(e.message)}</div>`;
        return;
    }

    // Role-based visibility
    const allowed = visibleEmployeeIds();
    if (allowed) rows = rows.filter(r => allowed.has(r.employee_id));
    rows.sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || ''));

    if (!rows.length) {
        el.innerHTML = `<h3 style="margin:0 0 .25rem">Yesterday's Hours <span class="muted" style="font-size:.85rem">(${label})</span></h3>
            <p class="empty-state">No hours booked.</p>`;
        return;
    }

    let tN = 0, tP = 0;
    const body = rows.map(r => {
        tN += r.normal; tP += r.npt;
        return `<tr>
            <td>${escapeHtml(r.employee_name)}</td>
            <td class="hours-cell" style="color:#34d399">${r.normal > 0 ? toHM(r.normal) : '—'}</td>
            <td class="hours-cell" style="color:#fbbf24">${r.npt > 0 ? toHM(r.npt) : '—'}</td>
            <td class="hours-cell">${toHM(r.normal + r.npt)}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
        <h3 style="margin:0 0 .75rem">Yesterday's Hours <span class="muted" style="font-size:.85rem">(${label})</span></h3>
        <div class="table-wrapper">
            <table class="timesheet-table">
                <thead><tr><th>Employee</th><th>Normal</th><th>NPT</th><th>Total</th></tr></thead>
                <tbody>${body}</tbody>
                <tfoot><tr>
                    <td class="total-label">Total</td>
                    <td class="hours-cell" style="color:#34d399">${toHM(tN)}</td>
                    <td class="hours-cell" style="color:#fbbf24">${toHM(tP)}</td>
                    <td class="hours-cell">${toHM(tN + tP)}</td>
                </tr></tfoot>
            </table>
        </div>`;
}
