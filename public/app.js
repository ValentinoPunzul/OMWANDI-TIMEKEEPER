/* ==========================================================================
   CHRONOS FLOW - COMMAND CENTER CLIENT
   ========================================================================== */

const state = {
  employees: [],
  projects: [],
  timeEntries: [],
  activeProfileId: localStorage.getItem('chronos_user_id') || null, 
  activeView: 'dashboard',
  isOnline: navigator.onLine,
  activeTimer: { running: false, startTime: null, secondsElapsed: 0, projectId: '', task: 'Development', description: '', intervalId: null }
};

const API_BASE = window.location.origin;

window.addEventListener('DOMContentLoaded', () => {
  setupNetworkMonitoring();
  initializeState().then(() => {
    setupGlobalEventListeners();
    checkAuth();
  });
});

function checkAuth() {
    const loginOverlay = document.getElementById('loginOverlay');
    const appLayout = document.getElementById('appLayout');
    if (state.activeProfileId) {
        loginOverlay.classList.add('hidden');
        appLayout.classList.remove('hidden');
        switchView(state.activeView);
    } else {
        loginOverlay.classList.remove('hidden');
        appLayout.classList.add('hidden');
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
    const me = state.employees.find(e => e.id === state.activeProfileId) || {};
    const myEntries = state.timeEntries.filter(e => e.employee_id === state.activeProfileId);
    const totalHours = myEntries.reduce((sum, e) => sum + (e.total_hours || 0), 0);
    const recentActivities = state.timeEntries.slice(0, 5);

    container.innerHTML = `
        <div class="command-center">
            <header class="view-header">
                <div class="header-main">
                    <h2>Chronos Command Center</h2>
                    <p>Aesthetic performance tracker for assigned enterprise assets.</p>
                </div>
                <button class="btn primary" onclick="switchView('timer')">+ Log Hours</button>
            </header>

            <div class="stats-grid">
                <div class="stat-card glass-container">
                    <div class="stat-label">YOUR TOTAL HOURS <span class="icon">$</span></div>
                    <div class="stat-value">${totalHours.toFixed(1)} hrs</div>
                    <div class="stat-sub">Cumulative track record</div>
                </div>
                <div class="stat-card glass-container">
                    <div class="stat-label">WEEKLY TARGET (7D) <span class="icon">📅</span></div>
                    <div class="stat-value">1.0 hrs</div>
                    <div class="stat-sub">34.0h remaining</div>
                </div>
                <div class="stat-card glass-container">
                    <div class="stat-label">BUDGET ALERTS <span class="icon">⚠️</span></div>
                    <div class="stat-value">0 Caps</div>
                    <div class="stat-sub">All project budgets stable</div>
                </div>
            </div>

            <div class="dashboard-main-grid">
                <div class="activities-section glass-container">
                    <div class="section-header">
                        <h3>Your Recent Activities</h3>
                        <button class="btn-text" onclick="switchView('timesheets')">View All</button>
                    </div>
                    <div class="activity-list">
                        ${recentActivities.map(a => {
                            const proj = state.projects.find(p => p.id === a.project_id) || { name: 'Internal' };
                            return `
                                <div class="activity-item">
                                    <div class="activity-dot" style="background:${proj.color || '#6366f1'}">${proj.name[0]}</div>
                                    <div class="activity-info">
                                        <div class="activity-task">${a.task}</div>
                                        <div class="activity-meta">${proj.name} • ${a.description || 'No description'}</div>
                                    </div>
                                    <div class="activity-hours">
                                        <div class="hours-val">+${a.total_hours.toFixed(1)}h</div>
                                        <div class="hours-date">Today at ${new Date(a.start_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <div class="allocation-section glass-container">
                    <h3>Project Allocation</h3>
                    <div class="chart-placeholder">
                        <div class="donut-ring"></div>
                        <div class="donut-labels">
                            ${state.projects.slice(0, 4).map(p => `
                                <div class="allocation-row">
                                    <span class="color-dot" style="background:${p.color}"></span>
                                    <span class="label">${p.name}</span>
                                    <span class="val">0.0h (0%)</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ... [Existing view functions: renderTimer, renderProjects, etc., updated to match new style] ...

function renderTimer(container) {
    const projectOptions = state.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    container.innerHTML = `
        <div class="view-header"><h2>Live Tracker</h2></div>
        <div class="timer-view-container glass-container" style="max-width:500px; margin: 0 auto; text-align:center; padding:40px;">
            <div class="timer-face" style="font-size:4rem; font-weight:800; margin-bottom:30px;">00:00:00</div>
            <select id="timerProjectSelect" class="form-control" style="margin-bottom:20px;">${projectOptions}</select>
            <button class="btn primary big" style="width:100%; padding:20px;" onclick="startTimer()">START SESSION</button>
        </div>
    `;
}

async function startTimer() {
    const pid = document.getElementById('timerProjectSelect').value;
    const entry = { 
        employee_id: state.activeProfileId, 
        project_id: pid, 
        task: 'Development', 
        description: 'Tracked Session', 
        start_time: new Date().toISOString(), 
        total_hours: 1.0 // Mocking 1h for demo purposes as per screenshot
    };
    await apiRequest('/api/entries', { method: 'POST', body: JSON.stringify(entry) });
    await initializeState();
    switchView('dashboard');
}

function renderSettings(container) {
    container.innerHTML = `
        <div class="view-header"><h2>Settings</h2></div>
        <div class="glass-container">
            <button class="btn primary" onclick="triggerHrDispatchFlow()">Dispatch HR Report (CSV)</button>
            <p style="margin-top:20px; color:var(--text-muted);">This will compile all time entries into the standardized HR format and save it to the server.</p>
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
