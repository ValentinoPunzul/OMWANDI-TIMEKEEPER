// views/dashboard.js
import { state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

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
                    <div class="timer-user-info"><div>${escapeHtml(emp.name)}</div><div style="font-size:0.8rem; opacity:0.7;">${escapeHtml(emp.designation || '')}</div></div>
                    <div class="timer-counter" style="margin-right:15px; font-family:monospace;">${timeStr}</div>
                    <button class="btn-text" style="color:#ef4444; font-weight:800;" onclick="stopUserTimer('${t.id}')">STOP</button>
                </div>`;
            }).join('');
            return `<div class="project-group"><h3>[${escapeHtml(p.proj_no) || '---'}] ${escapeHtml(p.name)}</h3>${rows}</div>`;
        }).join('');

    container.innerHTML = `${renderViewHeader('Dashboard')}<div class="clock-card glass-container"><div class="dashboard-time" id="dashboardTime">00:00:00</div><div class="dashboard-date" id="dashboardDate">LOADING...</div></div><div class="active-timers-section">${listHtml}</div>`;
}