// views/dashboard.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';
import { classifyEntry } from '../timeRules.js';

let _dashTab = 'active';       // 'active' | 'previous'
let _prevDate = null;          // YYYY-MM-DD for the Previous Day view
let _activeInterval = null;    // live counter ticker

const toHM = h => {
    const m = Math.round((h || 0) * 60);
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
};
const hms = secs => `${Math.floor(secs/3600).toString().padStart(2,'0')}:${Math.floor((secs%3600)/60).toString().padStart(2,'0')}:${(secs%60).toString().padStart(2,'0')}`;
const ymd = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const dmy = s => { const [y,m,d] = s.split('-'); return `${d}/${m}/${y}`; };

function isNptProject(projId) {
    const p = state.projects.find(x => x.id === projId);
    return !!p && (String(p.proj_no || '').toUpperCase() === 'NPT' || String(p.name || '').toUpperCase().includes('NPT'));
}

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
    if (!_prevDate) { const d = new Date(); d.setDate(d.getDate() - 1); _prevDate = ymd(d); }
    container.innerHTML = `${renderViewHeader('Dashboard')}`
        + `<div class="clock-card glass-container"><div class="dashboard-time" id="dashboardTime">00:00:00</div><div class="dashboard-date" id="dashboardDate">LOADING...</div></div>`
        + `<div class="dash-tabs">
                <button class="dash-tab ${_dashTab === 'active' ? 'active' : ''}" onclick="setDashTab('active')">Active Connections</button>
                <button class="dash-tab ${_dashTab === 'previous' ? 'active' : ''}" onclick="setDashTab('previous')">Previous Day</button>
           </div>`
        + `<div id="dashContent"></div>`;
    renderDashContent();
}

function renderDashContent() {
    clearInterval(_activeInterval);
    const el = document.getElementById('dashContent');
    if (!el) return;
    document.querySelectorAll('.dash-tab').forEach(b =>
        b.classList.toggle('active', b.getAttribute('onclick')?.includes(`'${_dashTab}'`)));

    if (_dashTab === 'active') {
        el.innerHTML = `<div class="active-timers-section">${buildActiveSection()}</div>`;
        startActiveTicker();
    } else {
        el.innerHTML = `
            <div class="prev-day-bar">
                <label class="muted" style="font-size:.85rem">Date</label>
                <select id="prevDate" class="form-control" style="max-width:240px" onchange="changePrevDate(this.value)">
                    ${buildDateOptions()}
                </select>
            </div>
            <div id="prevDayContent"><div class="glass-panel" style="padding:1.25rem"><div class="muted">Loading…</div></div></div>`;
        loadPreviousDay();
    }
}

function buildDateOptions() {
    const opts = [];
    for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const v = ymd(d);
        const wd = d.toLocaleDateString(undefined, { weekday: 'short' });
        const tag = i === 0 ? ' (Today)' : i === 1 ? ' (Yesterday)' : '';
        opts.push(`<option value="${v}" ${v === _prevDate ? 'selected' : ''}>${wd} ${dmy(v)}${tag}</option>`);
    }
    return opts.join('');
}

window.setDashTab = function(tab) { _dashTab = tab; renderDashContent(); };
window.changePrevDate = function(val) { if (val) { _prevDate = val; loadPreviousDay(); } };

// ── Active connections (live ticking) ─────────────────────────────────────────
function buildActiveSection() {
    const allowed = visibleEmployeeIds();
    const active = state.timeEntries.filter(e =>
        (e.total_hours === 0 || !e.end_time) && e.start_time &&
        (!allowed || allowed.has(e.employee_id))
    );
    if (active.length === 0) {
        return '<div style="text-align:center; padding:40px; color:var(--text-muted);">No active sessions found.</div>';
    }
    const grouped = {};
    active.forEach(t => { (grouped[t.project_id] ||= []).push(t); });

    return Object.entries(grouped).map(([pid, timers]) => {
        const p = state.projects.find(proj => proj.id === pid) || { name: 'Internal', color: '#6366f1' };
        const rows = timers.map(t => {
            const emp = state.employees.find(e => e.id === t.employee_id) || { name: 'Unknown', avatar: '??', color: '#888' };
            const diff = Math.floor((Date.now() - new Date(t.start_time)) / 1000);
            return `<div class="timer-card glass-panel">
                <div class="timer-avatar" style="background:${escapeHtml(emp.color)}">${escapeHtml(emp.avatar)}</div>
                <div class="timer-user-info"><div>${escapeHtml(emp.name)}</div><div style="font-size:0.8rem; opacity:0.7;">${escapeHtml(emp.designation || '')}</div>${(() => { const sb = state.employees.find(x=>x.id===t.started_by); return (sb && t.started_by!==t.employee_id) ? `<div style="font-size:0.7rem;opacity:0.6;color:#818cf8">▶ Started by ${escapeHtml(sb.name)}</div>` : ''; })()}</div>
                <div class="timer-counter" data-start="${escapeHtml(t.start_time)}" style="margin-right:15px; font-family:monospace;">${hms(diff)}</div>
                <button class="btn-text" style="color:#ef4444; font-weight:800;" onclick="stopUserTimer('${t.id}')">STOP</button>
            </div>`;
        }).join('');
        return `<div class="project-group"><h3>[${escapeHtml(p.proj_no) || '---'}] ${escapeHtml(p.name)}</h3>${rows}</div>`;
    }).join('');
}

function startActiveTicker() {
    clearInterval(_activeInterval);
    _activeInterval = setInterval(() => {
        const counters = document.querySelectorAll('.timer-counter[data-start]');
        if (!counters.length) { clearInterval(_activeInterval); return; }
        counters.forEach(c => {
            const diff = Math.floor((Date.now() - new Date(c.dataset.start)) / 1000);
            c.textContent = hms(diff);
        });
    }, 1000);
}

export function stopDashboardTickers() { clearInterval(_activeInterval); }

// ── Previous day (date picker + Normal/OT/DT/NPT) ─────────────────────────────
async function loadPreviousDay() {
    const el = document.getElementById('prevDayContent');
    if (!el) return;
    el.innerHTML = `<div class="glass-panel" style="padding:1.25rem"><div class="muted">Loading…</div></div>`;
    const reqDate = _prevDate;

    let entries;
    try {
        entries = await apiRequest(`/reports/daily?date=${reqDate}`);
    } catch (e) {
        el.innerHTML = `<div class="glass-panel" style="padding:1.25rem"><div class="error-text">Failed to load: ${escapeHtml(e.message)}</div></div>`;
        return;
    }
    if (reqDate !== _prevDate) return; // user changed date while loading

    const allowed = visibleEmployeeIds();
    const byEmp = {};
    for (const e of entries) {
        if (allowed && !allowed.has(e.employee_id)) continue;
        const emp = state.employees.find(x => x.id === e.employee_id);
        const k = e.employee_id;
        if (!byEmp[k]) byEmp[k] = { name: emp?.name || 'Unknown', normal: 0, ot: 0, dt: 0, npt: 0 };
        if (isNptProject(e.project_id)) {
            byEmp[k].npt += e.total_hours;
        } else {
            const c = classifyEntry(e);
            byEmp[k].normal += c.normal;
            byEmp[k].ot += c.overtime;
            byEmp[k].dt += c.double;
        }
    }
    const rows = Object.values(byEmp).sort((a, b) => a.name.localeCompare(b.name));

    if (!rows.length) {
        el.innerHTML = `<div class="glass-panel" style="padding:1.25rem">
            <h3 style="margin:0 0 .25rem">Hours Booked <span class="muted" style="font-size:.85rem">(${dmy(reqDate)})</span></h3>
            <p class="empty-state">No hours booked.</p></div>`;
        return;
    }

    const tot = { normal: 0, ot: 0, dt: 0, npt: 0 };
    const body = rows.map(r => {
        tot.normal += r.normal; tot.ot += r.ot; tot.dt += r.dt; tot.npt += r.npt;
        const sum = r.normal + r.ot + r.dt + r.npt;
        return `<tr>
            <td>${escapeHtml(r.name)}</td>
            <td class="hours-cell" style="color:#34d399">${r.normal > 0 ? toHM(r.normal) : '—'}</td>
            <td class="hours-cell" style="color:#fbbf24">${r.ot > 0 ? toHM(r.ot) : '—'}</td>
            <td class="hours-cell" style="color:#fb7185">${r.dt > 0 ? toHM(r.dt) : '—'}</td>
            <td class="hours-cell" style="color:#818cf8">${r.npt > 0 ? toHM(r.npt) : '—'}</td>
            <td class="hours-cell">${toHM(sum)}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `<div class="glass-panel" style="padding:1.25rem">
        <h3 style="margin:0 0 .75rem">Hours Booked <span class="muted" style="font-size:.85rem">(${dmy(reqDate)})</span></h3>
        <div class="table-wrapper">
            <table class="timesheet-table">
                <thead><tr><th>Employee</th><th>Normal</th><th>OT</th><th>DT</th><th>NPT</th><th>Total</th></tr></thead>
                <tbody>${body}</tbody>
                <tfoot><tr>
                    <td class="total-label">Total</td>
                    <td class="hours-cell" style="color:#34d399">${toHM(tot.normal)}</td>
                    <td class="hours-cell" style="color:#fbbf24">${toHM(tot.ot)}</td>
                    <td class="hours-cell" style="color:#fb7185">${toHM(tot.dt)}</td>
                    <td class="hours-cell" style="color:#818cf8">${toHM(tot.npt)}</td>
                    <td class="hours-cell">${toHM(tot.normal + tot.ot + tot.dt + tot.npt)}</td>
                </tr></tfoot>
            </table>
        </div></div>`;
}
