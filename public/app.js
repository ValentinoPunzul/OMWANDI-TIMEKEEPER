// app.js
import { state } from './state.js';
import { apiRequest } from './api.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTimerView, stopTimerInterval } from './views/timer.js';
import { renderProjects } from './views/projects.js';
import { renderTeam } from './views/team.js';
import { renderTimesheets } from './views/timesheets.js';
import { renderSettings } from './views/settings.js';
import { startDashboardClock } from './timer.js';

window.showNotification = function(message, type='info') {
    const c = document.getElementById('notificationContainer'); if (!c) return;
    const el = document.createElement('div'); el.className=`notification ${type}`; el.textContent=message;
    c.appendChild(el); setTimeout(()=>el.remove(), 3500);
};

const views = {
    dashboard:  ()=>{ renderDashboard(document.getElementById('mainContent')); startDashboardClock(); },
    timer:      ()=>renderTimerView(),
    projects:   ()=>renderProjects(),
    team:       ()=>renderTeam(),
    timesheets: ()=>renderTimesheets(),
    settings:   ()=>renderSettings(),
};

window.switchView = function(viewName) {
    stopTimerInterval();
    state.activeView = viewName;
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.view === viewName));
    const r = views[viewName]; if (r) r();
};

async function handleLogin(e) {
    e.preventDefault();
    const empNo    = document.getElementById('loginEmpNo')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value;
    if (!empNo || !password) { showLoginError('Enter your employee number and password.'); return; }
    try {
        const loginRes = await fetch('/api/auth/login', { method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emp_no: empNo, password }) });
        if (!loginRes.ok) { const err = await loginRes.json().catch(()=>({})); showLoginError(err.message || 'Invalid credentials.'); return; }
        const { idToken, employee } = await loginRes.json();

        state.idToken = idToken;
        state.activeProfileId = employee.id;
        state.userRole = employee.role || 'Employee';
        localStorage.setItem('chronos_user_role', state.userRole);
        localStorage.setItem('chronos_id_token', idToken);
        localStorage.setItem('chronos_user_id', employee.id);
        await loadAppData();
        showApp();
    } catch (err) {
        showLoginError('Login failed. Check your connection.');
    }
}

function showLoginError(msg) {
    const el = document.getElementById('loginError');
    if (el) { el.textContent=msg; el.style.display='block'; }
}

window.handleLogout = function() {
    state.idToken=null; state.activeProfileId=null; state.userRole='Employee';
    state.employees=[]; state.projects=[]; state.timeEntries=[];
    localStorage.removeItem('chronos_id_token'); localStorage.removeItem('chronos_user_id');
    localStorage.removeItem('chronos_user_role');
    showLogin();
};

async function loadAppData() {
    const [employees, projects, entries, mapping] = await Promise.all([
        apiRequest('/employees'),
        apiRequest('/projects'),
        apiRequest(`/entries?limit=${state.timeEntriesLimit}&offset=0`),
        apiRequest('/settings/mapping').catch(()=>({})),
    ]);
    state.employees    = employees||[];
    state.projects     = projects||[];
    state.timeEntries  = entries||[];
    state.scoroMapping = mapping?.mapping||{};
    state.hasMoreTimeEntries = (entries?.length||0) >= state.timeEntriesLimit;
    updateProfileCard();
}

function updateProfileCard() {
    const emp = state.employees.find(e=>e.id===state.activeProfileId); if (!emp) return;
    const initials = (emp.name||'??').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const a=document.getElementById('activeAvatar');
    const n=document.getElementById('activeName');
    const r=document.getElementById('activeRole');
    if (a) { a.textContent=initials; a.style.background=emp.color||'#1d4ed8'; }
    if (n) n.textContent=emp.name||'';
    if (r) r.textContent=emp.role||'Employee';
}

function showApp()  {
    document.getElementById('loginOverlay').style.display='none';
    const layout = document.getElementById('appLayout');
    layout.classList.remove('hidden');
    layout.style.display='grid';
    switchView('dashboard');
}

function showLogin() {
    const layout = document.getElementById('appLayout');
    layout.classList.add('hidden');
    layout.style.display='none';
    document.getElementById('loginOverlay').style.display='flex';
}

async function boot() {
    document.querySelectorAll('[data-view]').forEach(el =>
        el.addEventListener('click', ()=>switchView(el.dataset.view)));
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    window.addEventListener('online',  ()=>{ state.isOnline=true; });
    window.addEventListener('offline', ()=>{ state.isOnline=false; });
    if (state.idToken && state.activeProfileId) {
        try { await loadAppData(); showApp(); } catch { showLogin(); }
    } else { showLogin(); }
}

window.toggleMobileMore = function() {
    const drawer = document.getElementById('mobileMoreDrawer');
    if (drawer) drawer.classList.toggle('open');
};

// Wire up More drawer items to switchView
document.addEventListener('click', e => {
    const item = e.target.closest('.mobile-more-item[data-view]');
    if (item) switchView(item.dataset.view);
});

document.addEventListener('DOMContentLoaded', boot);
