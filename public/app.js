/* ==========================================================================
   CHRONOS FLOW - ACTIVE SESSIONS CLIENT
   ========================================================================== */

const state = {
  employees: [],
  projects: [],
  timeEntries: [],
  activeProfileId: localStorage.getItem('chronos_user_id') || null, 
  activeView: 'dashboard',
  isOnline: navigator.onLine
};

const API_BASE = window.location.origin;

window.addEventListener('DOMContentLoaded', () => {
  setupNetworkMonitoring();
  initializeState().then(() => {
    setupGlobalEventListeners();
    checkAuth();
    startDashboardClock();
  });
});

function checkAuth() {
    const loginOverlay = document.getElementById('loginOverlay');
    const appLayout = document.getElementById('appLayout');
    if (state.activeProfileId) {
        if (loginOverlay) loginOverlay.classList.add('hidden');
        if (appLayout) appLayout.classList.remove('hidden');
        switchView(state.activeView);
    } else {
        if (loginOverlay) loginOverlay.classList.remove('hidden');
        if (appLayout) appLayout.classList.add('hidden');
    }
}

async function initializeState() {
  try {
    const [employees, projects, entries] = await Promise.all([
      apiRequest('/api/employees'),
      apiRequest('/api/projects'),
      apiRequest('/api/entries')
    ]);
    state.employees = employees;
    state.projects = projects;
    state.timeEntries = entries;
  } catch (e) { console.error('Init Error:', e); }
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const defaultHeaders = { 'Content-Type': 'application/json' };
  options.headers = { ...defaultHeaders, ...options.headers };
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function startDashboardClock() {
    setInterval(() => {
        const timeEl = document.getElementById('dashboardTime');
        const dateEl = document.getElementById('dashboardDate');
        if (timeEl && dateEl) {
            const now = new Date();
            timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
        }
    }, 1000);
}

function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.getAttribute('data-view') === viewName));
  const container = document.getElementById('mainContent');
  if (!container) return;

  switch(viewName) {
    case 'dashboard': renderDashboard(container); break;
    case 'timer': renderTimer(container); break;
    case 'projects': renderProjects(container); break;
    case 'team': renderTeam(container); break;
    case 'timesheets': renderTimesheets(container); break;
    case 'settings': renderSettings(container); break;
  }
}

function renderDashboard(container) {
    const activeTimers = state.timeEntries.filter(e => !e.end_time || e.total_hours === 0);
    const grouped = {};
    activeTimers.forEach(timer => {
        if (!grouped[timer.project_id]) grouped[timer.project_id] = [];
        grouped[timer.project_id].push(timer);
    });

    let activeTimersHtml = '';
    if (activeTimers.length === 0) {
        activeTimersHtml = `<div style="text-align:center; color:var(--text-muted); padding:40px;">No active sessions currently running.</div>`;
    } else {
        activeTimersHtml = Object.entries(grouped).map(([projectId, timers]) => {
            const project = state.projects.find(p => p.id === projectId) || { name: 'Internal', color: '#6366f1' };
            const timersList = timers.map(t => {
                const emp = state.employees.find(e => e.id === t.employee_id) || { name: 'Unknown', avatar: '??', color: '#888' };
                const start = new Date(t.start_time);
                const diff = Math.floor((new Date() - start) / 1000);
                const h = Math.floor(diff / 3600).toString().padStart(2, '0');
                const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
                const s = (diff % 60).toString().padStart(2, '0');
                
                return `
                    <div class="timer-card glass-panel">
                        <div class="timer-avatar" style="background:${emp.color}">${emp.avatar}</div>
                        <div class="timer-user-info">
                            <div class="timer-user-name">${emp.name}</div>
                            <div class="timer-task-name">${t.task || 'Development'}</div>
                        </div>
                        <div class="timer-counter">${h}:${m}:${s}</div>
                    </div>`;
            }).join('');

            return `
                <div class="project-group">
                    <div class="project-header"><span class="project-dot" style="background:${project.color}"></span>${project.name}</div>
                    <div class="timers-grid">${timersList}</div>
                </div>`;
        }).join('');
    }

    container.innerHTML = `
        <div class="dashboard-container">
            <div class="clock-card glass-container">
                <div class="dashboard-time" id="dashboardTime">00:00:00</div>
                <div class="dashboard-date" id="dashboardDate">LOADING...</div>
            </div>
            <div class="active-timers-section">
                <div class="section-label"><span class="pulse-emerald"></span>ACTIVE PROJECT SESSIONS</div>
                ${activeTimersHtml}
            </div>
        </div>`;
}

function renderTimer(container) {
    const projectOptions = state.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    container.innerHTML = `
        <div class="view-header"><h2>Live Tracker</h2></div>
        <div class="timer-view-container glass-container" style="max-width:500px; margin: 0 auto; text-align:center;">
             <div class="timer-face" style="font-size:4rem; font-weight:800; margin-bottom:30px;">00:00:00</div>
            <select id="timerProjectSelect" class="nav-item" style="width:100%; margin-bottom:20px; background:rgba(255,255,255,0.05); color:#fff;">${projectOptions}</select>
            <button class="btn primary" style="width:100%; padding:16px;" onclick="startTimer()">START SESSION</button>
        </div>
    `;
}

async function startTimer() {
    const pid = document.getElementById('timerProjectSelect').value;
    const entry = { employee_id: state.activeProfileId, project_id: pid, task: 'Development', description: 'Track Log', start_time: new Date().toISOString(), total_hours: 0 };
    await apiRequest('/api/entries', { method: 'POST', body: JSON.stringify(entry) });
    await initializeState();
    switchView('dashboard');
}

function renderProjects(container) {
    const html = state.projects.map(p => `<div class="glass-container" style="margin-bottom:16px;"><h3>${p.name}</h3><p style="color:var(--text-muted)">${p.client}</p></div>`).join('');
    container.innerHTML = `<div class="view-header"><h2>Projects</h2></div><div class="projects-grid">${html}</div>`;
}

function renderTeam(container) {
    const html = state.employees.map(e => `
        <div class="timer-card glass-panel" style="margin-bottom:10px;">
            <div class="timer-avatar" style="background:${e.color}">${e.avatar}</div>
            <div class="timer-user-info">
                <div class="timer-user-name">${e.name}</div>
                <div class="timer-task-name">${e.role}</div>
            </div>
        </div>
    `).join('');
    container.innerHTML = `<div class="view-header"><h2>Team</h2></div>${html}`;
}

function renderTimesheets(container) {
    const rowsHtml = state.timeEntries.map(e => `<tr><td>${e.start_time.split('T')[0]}</td><td>${e.employee_name || 'User'}</td><td>${e.project_name || 'Project'}</td><td>${(e.total_hours || 0).toFixed(1)}</td></tr>`).join('');
    container.innerHTML = `<div class="view-header"><h2>Timesheets</h2></div><div class="glass-container"><table><thead><tr><th>Date</th><th>Member</th><th>Project</th><th>Hours</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}

function renderSettings(container) {
    container.innerHTML = `
        <div class="view-header"><h2>Settings</h2></div>
        <div class="glass-container">
            <button class="btn primary" onclick="triggerHrDispatchFlow()">Dispatch HR Report (CSV)</button>
        </div>
    `;
}

async function triggerHrDispatchFlow() {
  try {
    const res = await apiRequest('/api/hr/dispatch', { method: 'POST' });
    alert(`Report generated: ${res.filename}`);
  } catch (e) { alert('Dispatch failed.'); }
}

function setupGlobalEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => switchView(e.currentTarget.getAttribute('data-view')));
    });
    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const empNo = document.getElementById('loginEmpNo').value;
        const emp = state.employees.find(e => e.emp_no === empNo);
        if (emp) {
            state.activeProfileId = emp.id;
            localStorage.setItem('chronos_user_id', emp.id);
            checkAuth();
        } else { alert('Invalid Employee Number'); }
    });
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        state.activeProfileId = null;
        localStorage.removeItem('chronos_user_id');
        checkAuth();
    });
}

function setupNetworkMonitoring() {
    window.addEventListener('online', () => document.getElementById('statusDot').className = 'status-dot online');
    window.addEventListener('offline', () => document.getElementById('statusDot').className = 'status-dot offline');
}
