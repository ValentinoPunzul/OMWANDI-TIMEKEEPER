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
    console.log('Fetching initial state from:', API_BASE);
    const [employees, projects, entries] = await Promise.all([
      apiRequest('/api/employees'),
      apiRequest('/api/projects'),
      apiRequest('/api/entries')
    ]);
    state.employees = employees;
    state.projects = projects;
    state.timeEntries = entries;
    console.log('State successfully synchronized with Cloud API.');
  } catch (e) { 
    console.error('API connection failed. Loading local data buffers.', e);
    showNotification('Offline Mode: Using local cache', 'warning');
    // Fallback data
    state.employees = JSON.parse(localStorage.getItem('chronos_employees')) || [];
    state.projects = JSON.parse(localStorage.getItem('chronos_projects')) || [];
    state.timeEntries = JSON.parse(localStorage.getItem('chronos_entries')) || [];
  }
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const defaultHeaders = { 'Content-Type': 'application/json' };
  options.headers = { ...defaultHeaders, ...options.headers };
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`Request failed for ${endpoint}:`, err.message);
    throw err;
  }
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
                        <div class="timer-avatar" style="background:${emp.color || '#888'}">${emp.avatar || '??'}</div>
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
            <div class="timer-avatar" style="background:${e.color || '#888'}">${e.avatar || '??'}</div>
            <div class="timer-user-info">
                <div class="timer-user-name">${e.name}</div>
                <div class="timer-task-name">${e.designation || e.role || ''}</div>
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
        
        <div class="glass-container" style="margin-bottom:24px;">
            <h3>User Management</h3>
            <div id="userFormContainer" class="settings-form" style="margin-top:20px;">
                <input type="hidden" id="userId">
                <div class="form-row">
                    <input type="text" id="userEmpNo" placeholder="Employee Number (e.g. E001)" class="form-control">
                    <input type="text" id="userName" placeholder="Full Name" class="form-control">
                </div>
                <div class="form-row">
                    <input type="text" id="userDesignation" placeholder="Designation" class="form-control">
                    <input type="text" id="userDepartment" placeholder="Department" class="form-control">
                </div>
                <div class="form-row">
                    <input type="text" id="userSubDepartment" placeholder="Sub Department" class="form-control">
                    <input type="text" id="userReportsTo" placeholder="Reports To" class="form-control">
                </div>
                <div class="form-row">
                    <input type="text" id="userAvatarUrl" placeholder="Avatar URL" class="form-control">
                    <input type="color" id="userColor" value="#6366f1" style="height:44px; width:44px; border:none; background:none;">
                </div>
                <div class="btn-group" style="margin-top:20px;">
                    <button class="btn primary" onclick="handleUserSubmit()">Save Employee</button>
                    <button class="btn outline" onclick="resetUserForm()">Clear</button>
                </div>
            </div>
        </div>

        <div class="glass-container" style="margin-bottom:24px;">
            <h3>Employee List</h3>
            <div style="overflow-x:auto;">
                <table style="margin-top:20px;">
                    <thead>
                        <tr>
                            <th>No</th>
                            <th>Name</th>
                            <th>Designation</th>
                            <th>Dept</th>
                            <th>Reports To</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.employees.map(e => `
                            <tr>
                                <td>${e.emp_no || ''}</td>
                                <td>${e.name || ''}</td>
                                <td>${e.designation || e.role || ''}</td>
                                <td>${e.department || ''}</td>
                                <td>${e.reports_to || ''}</td>
                                <td>
                                    <button class="btn-text" onclick="editEmployee('${e.id}')">Edit</button>
                                    <button class="btn-text" style="color:#ef4444" onclick="deleteEmployee('${e.id}')">Del</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="glass-container">
            <h3>System Actions</h3>
            <button class="btn primary" style="margin-top:20px;" onclick="triggerHrDispatchFlow()">Dispatch HR Report (CSV)</button>
        </div>
    `;
}

async function handleUserSubmit() {
    const id = document.getElementById('userId').value;
    const userData = {
        emp_no: document.getElementById('userEmpNo').value,
        name: document.getElementById('userName').value,
        designation: document.getElementById('userDesignation').value,
        department: document.getElementById('userDepartment').value,
        sub_department: document.getElementById('userSubDepartment').value,
        reports_to: document.getElementById('userReportsTo').value,
        avatar_url: document.getElementById('userAvatarUrl').value,
        color: document.getElementById('userColor').value,
        avatar: document.getElementById('userName').value.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    };

    try {
        if (id) {
            await apiRequest(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(userData) });
        } else {
            await apiRequest('/api/employees', { method: 'POST', body: JSON.stringify(userData) });
        }
        await initializeState();
        renderSettings(document.getElementById('mainContent'));
    } catch (e) { alert('Failed to save user.'); }
}

window.editEmployee = (id) => {
    const emp = state.employees.find(e => e.id === id);
    if (!emp) return;
    document.getElementById('userId').value = emp.id;
    document.getElementById('userEmpNo').value = emp.emp_no || '';
    document.getElementById('userName').value = emp.name || '';
    document.getElementById('userDesignation').value = emp.designation || emp.role || '';
    document.getElementById('userDepartment').value = emp.department || '';
    document.getElementById('userSubDepartment').value = emp.sub_department || '';
    document.getElementById('userReportsTo').value = emp.reports_to || '';
    document.getElementById('userAvatarUrl').value = emp.avatar_url || '';
    document.getElementById('userColor').value = emp.color || '#6366f1';
};

window.deleteEmployee = async (id) => {
    if (!confirm('Delete this employee?')) return;
    try {
        await apiRequest(`/api/employees/${id}`, { method: 'DELETE' });
        await initializeState();
        renderSettings(document.getElementById('mainContent'));
    } catch (e) { alert('Delete failed.'); }
};

window.resetUserForm = () => {
    document.getElementById('userId').value = '';
    document.getElementById('userEmpNo').value = '';
    document.getElementById('userName').value = '';
    document.getElementById('userDesignation').value = '';
    document.getElementById('userDepartment').value = '';
    document.getElementById('userSubDepartment').value = '';
    document.getElementById('userReportsTo').value = '';
    document.getElementById('userAvatarUrl').value = '';
    document.getElementById('userColor').value = '#6366f1';
};

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

function showNotification(msg, type) {
    const c = document.getElementById('notificationContainer');
    if (!c) return;
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.textContent = msg;
    c.appendChild(n);
    setTimeout(() => n.remove(), 3000);
}
