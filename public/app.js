/* ==========================================================================
   CHRONOS FLOW - ADVANCED DASHBOARD CLIENT
   ========================================================================== */

const state = {
  employees: [],
  projects: [],
  timeEntries: [],
  activeProfileId: localStorage.getItem('chronos_user_id') || null, 
  activeView: 'dashboard',
  isOnline: navigator.onLine,
  employeeSortField: 'emp_no',
  employeeSortDir: 'asc',
  userRole: 'Employee'
};

const API_BASE = window.location.origin;

window.addEventListener('DOMContentLoaded', () => {
  setupNetworkMonitoring();
  initializeState().then(() => {
    setupGlobalEventListeners();
    checkAuth();
    startDashboardClock();
    startDataRefresh(); // New: Periodic background refresh
  });
});

function checkAuth() {
    const loginOverlay = document.getElementById('loginOverlay');
    const appLayout = document.getElementById('appLayout');
    if (state.activeProfileId) {
        const me = state.employees.find(e => e.id === state.activeProfileId);
        if (me) {
            state.userRole = me.access_role || 'Employee';
            document.getElementById('activeName').textContent = me.name;
            document.getElementById('activeRole').textContent = me.designation || 'Staff';
            const avatarEl = document.getElementById('activeAvatar');
            if(avatarEl) { avatarEl.textContent = me.avatar || '??'; avatarEl.style.background = me.color || '#6366f1'; }
            updateSidebarVisibility(state.userRole);
            if (loginOverlay) loginOverlay.classList.add('hidden');
            if (appLayout) appLayout.classList.remove('hidden');
            switchView(state.activeView);
        } else { handleLogout(); }
    } else {
        if (loginOverlay) loginOverlay.classList.remove('hidden');
        if (appLayout) appLayout.classList.add('hidden');
    }
}

function updateSidebarVisibility(role) {
    const layout = document.getElementById('appLayout');
    if (role === 'Employee') { layout.classList.add('no-sidebar'); state.activeView = 'timer'; }
    else { layout.classList.remove('no-sidebar'); }
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

function startDataRefresh() {
    // Refresh dashboard data every 60 seconds
    setInterval(async () => {
        await initializeState();
        if (state.activeView === 'dashboard') {
            const container = document.getElementById('mainContent');
            if (container) renderDashboard(container);
        }
    }, 60000);
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
        const faceClock = document.getElementById('faceClock');
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        if (timeEl) timeEl.textContent = timeStr;
        if (faceClock) faceClock.textContent = timeStr;
        if (dateEl) dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
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
    const activeTimers = state.timeEntries.filter(e => e.total_hours === 0 || !e.end_time);
    const grouped = {};
    activeTimers.forEach(timer => {
        if (!grouped[timer.project_id]) grouped[timer.project_id] = [];
        grouped[timer.project_id].push(timer);
    });

    let activeTimersHtml = activeTimers.length === 0 ? `<div style="text-align:center; color:var(--text-muted); padding:40px;">No active sessions.</div>` : 
        Object.entries(grouped).map(([projectId, timers]) => {
            const project = state.projects.find(p => p.id === projectId) || { name: 'Internal', color: '#6366f1' };
            const timersList = timers.map(t => {
                const emp = state.employees.find(e => e.id === t.employee_id) || { name: 'Unknown', avatar: '??', color: '#888' };
                const start = new Date(t.start_time);
                const diff = Math.floor((new Date() - start) / 1000);
                const h = Math.floor(diff / 3600).toString().padStart(2, '0');
                const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
                const s = (diff % 60).toString().padStart(2, '0');
                const stopBtn = (state.userRole === 'Administrator' || state.userRole === 'Editor') ? `<button class="btn-text" style="color:#ef4444; font-weight:700;" onclick="stopUserTimer('${t.id}')">STOP</button>` : '';
                return `<div class="timer-card glass-panel">
                            <div class="timer-avatar" style="background:${emp.color || '#888'}">${emp.avatar || '??'}</div>
                            <div class="timer-user-info">
                                <div class="timer-user-name">${emp.name}</div>
                                <div class="timer-task-name">${emp.designation || 'Staff'}</div>
                            </div>
                            <div class="timer-counter" style="margin-right:15px;">${h}:${m}:${s}</div>
                            ${stopBtn}
                        </div>`;
            }).join('');
            return `<div class="project-group">
                        <div class="project-header">
                            <span class="project-dot" style="background:${project.color}"></span>
                            ${project.proj_no ? '['+project.proj_no+'] ' : ''}${project.name}
                        </div>
                        <div class="timers-grid">${timersList}</div>
                    </div>`;
        }).join('');
    container.innerHTML = `<div class="dashboard-container"><div class="clock-card glass-container"><div class="dashboard-time" id="dashboardTime">00:00:00</div><div class="dashboard-date" id="dashboardDate">LOADING...</div></div><div class="active-timers-section"><div class="section-label"><span class="pulse-emerald"></span>ACTIVE PROJECT SESSIONS</div>${activeTimersHtml}</div></div>`;
}

async function stopUserTimer(id) {
    if (!confirm('Stop tracking?')) return;
    const entry = state.timeEntries.find(e => e.id === id);
    if (!entry) return;
    const hours = Math.abs(new Date() - new Date(entry.start_time)) / 36e5;
    await apiRequest(`/api/entries/${id}`, { method: 'PUT', body: JSON.stringify({ end_time: new Date().toISOString(), total_hours: parseFloat(hours.toFixed(2)) }) });
    await initializeState();
    if (state.activeView === 'dashboard') renderDashboard(document.getElementById('mainContent'));
    else if (state.activeView === 'timer') renderTimer(document.getElementById('mainContent'));
}

function renderTimer(container) {
    const myActiveEntry = state.timeEntries.find(e => e.employee_id === state.activeProfileId && (e.total_hours === 0 || !e.end_time));
    const projectOptions = state.projects.map(p => `<option value="${p.id}" ${myActiveEntry?.project_id === p.id ? 'selected' : ''}>${p.proj_no ? '['+p.proj_no+'] ' : ''}${p.name}</option>`).join('');
    let actionBtn = myActiveEntry ? `<button class="btn" style="width:100%; padding:20px; background:#ef4444; color:#fff; font-size:1.2rem; font-weight:800; border-radius:12px;" onclick="stopUserTimer('${myActiveEntry.id}')">STOP SESSION</button>` : `<button class="btn primary" style="width:100%; padding:20px; font-size:1.2rem; font-weight:800; border-radius:12px;" onclick="startTimer()">START SESSION</button>`;
    const employeeHeader = state.userRole === 'Employee' ? `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:30px;"><div><h1 style="margin:0; font-size:1.4rem;">Chronos <span style="color:var(--accent-primary)">Flow</span></h1><p style="margin:0; font-size:0.8rem; color:var(--text-muted);">Logged in as: ${state.employees.find(e => e.id === state.activeProfileId)?.name}</p></div><button class="btn outline" style="padding:8px 16px; font-size:0.8rem;" onclick="handleLogout()">Logout</button></div>` : '<div class="view-header"><h2>Live Tracker</h2></div>';
    container.innerHTML = `${employeeHeader}<div class="timer-view-container glass-container" style="max-width:500px; margin: 0 auto; text-align:center;"><div id="faceClock" style="font-size:5rem; font-weight:800; margin-bottom:10px; font-family:monospace;">00:00:00</div><div style="margin-bottom:30px; display:flex; align-items:center; justify-content:center; gap:8px;">${myActiveEntry ? '<span class="pulse-emerald" style="width:10px; height:10px;"></span> <span style="color:#10b981; font-weight:700; font-size:0.8rem; letter-spacing:1px;">LIVE SESSION ACTIVE</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">READY TO TRACK</span>'}</div><div style="text-align:left; margin-bottom:20px;"><label style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; font-weight:800; display:block; margin-bottom:8px;">Project Selection</label><select id="timerProjectSelect" class="form-control" style="width:100%; padding:12px; background:rgba(0,0,0,0.2); color:#fff; border:1px solid var(--glass-border); border-radius:8px;" ${myActiveEntry ? 'disabled' : ''}>${projectOptions}</select></div>${actionBtn}</div>`;
}

async function startTimer() {
    const pid = document.getElementById('timerProjectSelect').value;
    const entry = { employee_id: state.activeProfileId, project_id: pid, task: 'Development', description: 'Track Log', start_time: new Date().toISOString(), total_hours: 0 };
    await apiRequest('/api/entries', { method: 'POST', body: JSON.stringify(entry) });
    await initializeState();
    renderTimer(document.getElementById('mainContent'));
}

function renderProjects(container) {
    const html = state.projects.map(p => `<div class="glass-container" style="margin-bottom:16px;"><h3>[${p.proj_no || '---'}] ${p.name}</h3><p style="color:var(--text-muted)">${p.client}</p></div>`).join('');
    container.innerHTML = `<div class="view-header"><h2>Projects</h2></div><div class="projects-grid">${html}</div>`;
}

function renderTeam(container) {
    const html = state.employees.map(e => `<div class="timer-card glass-panel" style="margin-bottom:10px;"><div class="timer-avatar" style="background:${e.color || '#888'}">${e.avatar || '??'}</div><div class="timer-user-info"><div class="timer-user-name">${e.name}</div><div class="timer-task-name">${e.designation || ''}</div></div></div>`).join('');
    container.innerHTML = `<div class="view-header"><h2>Team</h2></div>${html}`;
}

function renderTimesheets(container) {
    const canEdit = state.userRole === 'Administrator' || state.userRole === 'Editor';
    const rowsHtml = state.timeEntries.map(e => `<tr style="border-bottom:1px solid var(--glass-border);"><td>${e.start_time.split('T')[0]}</td><td>${e.employee_name || 'User'}</td><td>${e.project_name || 'Project'}</td><td>${(e.total_hours || 0).toFixed(1)} h</td>${canEdit ? `<td style="text-align:right;"><button class="btn-text" style="color:var(--accent-primary);" onclick="editTimesheetEntry('${e.id}')">Edit</button><button class="btn-text" style="color:#ef4444; margin-left:10px;" onclick="deleteTimesheetEntry('${e.id}')">Del</button></td>` : '<td></td>'}</tr>`).join('');
    container.innerHTML = `<div class="view-header"><h2>Timesheets</h2></div><div id="timesheetEditForm" class="glass-container hidden" style="margin-bottom:20px;"><h3>Edit Entry</h3><input type="hidden" id="editEntryId"><div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:15px; margin-top:15px;"><div><label style="font-size:0.7rem; opacity:0.7;">HOURS</label><input type="number" step="0.1" id="editEntryHours" class="form-control" style="width:100%; padding:8px; background:rgba(0,0,0,0.2); border:1px solid var(--glass-border); color:#fff;"></div><div><label style="font-size:0.7rem; opacity:0.7;">TASK</label><input type="text" id="editEntryTask" class="form-control" style="width:100%; padding:8px; background:rgba(0,0,0,0.2); border:1px solid var(--glass-border); color:#fff;"></div><div style="display:flex; align-items:flex-end; gap:10px;"><button class="btn primary" onclick="saveTimesheetEdit()">Save</button><button class="btn outline" onclick="document.getElementById('timesheetEditForm').classList.add('hidden')">Cancel</button></div></div></div><div class="glass-container"><table><thead><tr><th>Date</th><th>Member</th><th>Project</th><th>Hours</th><th style="text-align:right;">Actions</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}

function renderSettings(container) {
    const isAdmin = state.userRole === 'Administrator';
    const projectOptions = state.projects.map(p => `<option value="${p.id}">${p.proj_no ? '['+p.proj_no+'] ' : ''}${p.name}</option>`).join('');
    const userSelectOptions = state.employees.map(e => `<option value="${e.id}">${e.name} (${e.emp_no || 'No ID'})</option>`).join('');

    container.innerHTML = `
        <div class="view-header"><h2>Settings</h2></div>
        
        <div class="glass-container" style="margin-bottom:24px;">
            <h3 id="projectFormTitle">Project Management</h3>
            <div style="margin-top:20px;">
                <label style="display:block; font-size:0.7rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Select Project to Edit</label>
                <select id="projectSelect" class="form-control" style="margin-bottom:20px;" onchange="handleProjectSelect(this.value)">
                    <option value="">-- Add New Project --</option>
                    ${projectOptions}
                </select>
            </div>
            <div id="projectForm" class="settings-form">
                <input type="hidden" id="projectId">
                <div class="form-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="display:block; font-size:0.7rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Project Number</label><input type="text" id="projectNo" class="form-control"></div>
                    <div><label style="display:block; font-size:0.7rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Project Name</label><input type="text" id="projectName" class="form-control"></div>
                </div>
                <div class="form-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="display:block; font-size:0.7rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Client Name</label><input type="text" id="projectClient" class="form-control"></div>
                    <div><label style="display:block; font-size:0.7rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Theme Color</label><input type="color" id="projectColor" value="#6366f1" style="height:44px; width:44px; border:none; background:none; padding:0; cursor:pointer;"></div>
                </div>
                <div class="btn-group" style="display:flex; gap:12px; margin-top:10px;">
                    <button class="btn primary" onclick="handleProjectSubmit()">Save Project</button>
                    ${isAdmin ? `<button id="deleteProjectBtn" class="btn outline" style="color:#ef4444; border-color:#ef4444; display:none;" onclick="deleteProject()">Delete Project</button>` : ''}
                    <button class="btn outline" onclick="resetProjectForm()">Clear</button>
                </div>
            </div>
        </div>

        <div class="glass-container" style="margin-bottom:24px;">
            <h3 id="userFormTitle">User Management</h3>
            <div style="margin-top:20px;">
                <label style="display:block; font-size:0.7rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Select Employee to Edit</label>
                <select id="userSelect" class="form-control" style="margin-bottom:20px;" onchange="editEmployee(this.value)">
                    <option value="">-- Add New Employee --</option>
                    ${userSelectOptions}
                </select>
            </div>
            <div id="userFormContainer" class="settings-form">
                <input type="hidden" id="userId">
                <div class="form-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="display:block; font-size:0.75rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Employee Number</label><input type="text" id="userEmpNo" class="form-control"></div>
                    <div><label style="display:block; font-size:0.75rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Full Name</label><input type="text" id="userName" class="form-control"></div>
                </div>
                <div class="form-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="display:block; font-size:0.75rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Designation</label><input type="text" id="userDesignation" class="form-control"></div>
                    <div><label style="display:block; font-size:0.75rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Department</label><input type="text" id="userDepartment" class="form-control"></div>
                </div>
                <div class="form-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="display:block; font-size:0.75rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Access Role</label><select id="userAccessRole" class="form-control"><option value="Employee">Employee</option><option value="Editor">Editor</option><option value="Administrator">Administrator</option></select></div>
                    <div><label style="display:block; font-size:0.75rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Reports To</label><input type="text" id="userReportsTo" class="form-control"></div>
                </div>
                <div class="form-row" style="display:grid; grid-template-columns: 1fr 44px; gap:16px; margin-bottom:16px;">
                    <div><label style="display:block; font-size:0.75rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Avatar URL</label><input type="text" id="userAvatarUrl" class="form-control"></div>
                    <div><label style="display:block; font-size:0.75rem; color:#fff; margin-bottom:6px; text-transform:uppercase; font-weight:800; opacity:0.7;">Color</label><input type="color" id="userColor" value="#6366f1" style="height:44px; width:44px; border:none; background:none; padding:0; cursor:pointer;"></div>
                </div>
                <div class="btn-group" style="display:flex; gap:12px; margin-top:10px;"><button class="btn primary" onclick="handleUserSubmit()">Save Employee</button><button class="btn outline" onclick="resetUserForm()">Clear</button></div>
            </div>
        </div>

        <div class="glass-container" style="margin-bottom:24px;">
            <h3>Employee List</h3>
            <div style="overflow-x:auto;">
                <table style="width:100%; margin-top:20px;">
                    <thead><tr style="text-align:left; color:var(--text-muted); font-size:0.8rem; cursor:pointer;"><th onclick="setEmployeeSort('emp_no')">No</th><th onclick="setEmployeeSort('name')">Name</th><th onclick="setEmployeeSort('access_role')">Role</th><th onclick="setEmployeeSort('department')">Dept</th><th>Actions</th></tr></thead>
                    <tbody>${state.employees.map(e => `<tr style="border-bottom:1px solid var(--glass-border);"><td style="padding:12px 0;">${e.emp_no || ''}</td><td>${e.name || ''}</td><td>${e.access_role || 'Employee'}</td><td>${e.department || ''}</td><td><button class="btn-text" style="color:var(--accent-primary);" onclick="editEmployee('${e.id}')">Edit</button>${isAdmin ? `<button class="btn-text" style="color:#ef4444; margin-left:8px;" onclick="deleteEmployee('${e.id}')">Del</button>` : ''}</td></tr>`).join('')}</tbody>
                </table>
            </div>
        </div>

        ${isAdmin ? `<div class="glass-container"><h3>System Actions</h3><button class="btn primary" style="margin-top:20px;" onclick="triggerHrDispatchFlow()">Dispatch HR Report (CSV)</button></div>` : ''}
    `;
}

window.handleProjectSelect = (id) => {
    const project = state.projects.find(p => p.id === id);
    if (project) {
        document.getElementById('projectId').value = project.id;
        document.getElementById('projectNo').value = project.proj_no || '';
        document.getElementById('projectName').value = project.name;
        document.getElementById('projectClient').value = project.client || '';
        document.getElementById('projectColor').value = project.color || '#6366f1';
        document.getElementById('projectFormTitle').textContent = 'Edit Project: ' + project.name;
        const delBtn = document.getElementById('deleteProjectBtn');
        if (delBtn) delBtn.style.display = 'inline-block';
        document.getElementById('projectNo').readOnly = true;
    } else { resetProjectForm(); }
};

window.handleProjectSubmit = async () => {
    const projNo = document.getElementById('projectNo').value;
    const name = document.getElementById('projectName').value;
    if (!projNo || !name) return alert('Project Number and Name are required');
    const data = { proj_no: projNo, name: name, client: document.getElementById('projectClient').value, color: document.getElementById('projectColor').value, id: 'proj_' + projNo };
    const id = document.getElementById('projectId').value || data.id;
    if (document.getElementById('projectId').value) await apiRequest(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    else await apiRequest('/api/projects', { method: 'POST', body: JSON.stringify(data) });
    await initializeState(); renderSettings(document.getElementById('mainContent'));
};

window.deleteProject = async () => {
    const id = document.getElementById('projectId').value;
    if (!id || !confirm('Delete project?')) return;
    await apiRequest(`/api/projects/${id}`, { method: 'DELETE' });
    await initializeState(); renderSettings(document.getElementById('mainContent'));
};

window.resetProjectForm = () => {
    document.getElementById('projectId').value = ''; document.getElementById('projectNo').value = ''; document.getElementById('projectName').value = ''; document.getElementById('projectClient').value = ''; document.getElementById('projectColor').value = '#6366f1'; document.getElementById('projectFormTitle').textContent = 'Project Management'; document.getElementById('projectSelect').value = ''; document.getElementById('projectNo').readOnly = false;
    const delBtn = document.getElementById('deleteProjectBtn'); if (delBtn) delBtn.style.display = 'none';
};

async function handleUserSubmit() {
    const name = document.getElementById('userName').value;
    if(!name) return alert('Name is required');
    const userData = { emp_no: document.getElementById('userEmpNo').value, name: name, designation: document.getElementById('userDesignation').value, department: document.getElementById('userDepartment').value, access_role: document.getElementById('userAccessRole').value, reports_to: document.getElementById('userReportsTo').value, avatar_url: document.getElementById('userAvatarUrl').value, color: document.getElementById('userColor').value, avatar: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) };
    const id = document.getElementById('userId').value;
    if (id) await apiRequest(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(userData) });
    else await apiRequest('/api/employees', { method: 'POST', body: JSON.stringify(userData) });
    await initializeState(); renderSettings(document.getElementById('mainContent')); checkAuth(); 
}

window.editEmployee = (id) => {
    const emp = state.employees.find(e => e.id === id);
    if (!emp) { resetUserForm(); return; }
    const userSelect = document.getElementById('userSelect');
    if (userSelect) userSelect.value = id;
    document.getElementById('userId').value = emp.id;
    document.getElementById('userEmpNo').value = emp.emp_no || '';
    document.getElementById('userName').value = emp.name || '';
    document.getElementById('userDesignation').value = emp.designation || '';
    document.getElementById('userDepartment').value = emp.department || '';
    document.getElementById('userAccessRole').value = emp.access_role || 'Employee';
    document.getElementById('userReportsTo').value = emp.reports_to || '';
    document.getElementById('userAvatarUrl').value = emp.avatar_url || '';
    document.getElementById('userColor').value = emp.color || '#6366f1';
    document.getElementById('userFormTitle').textContent = 'Edit Employee: ' + emp.name;
};

window.resetUserForm = () => {
    const userSelect = document.getElementById('userSelect');
    if (userSelect) userSelect.value = '';
    document.getElementById('userId').value = ''; document.getElementById('userEmpNo').value = ''; document.getElementById('userName').value = ''; document.getElementById('userDesignation').value = ''; document.getElementById('userDepartment').value = ''; document.getElementById('userAccessRole').value = 'Employee'; document.getElementById('userReportsTo').value = ''; document.getElementById('userAvatarUrl').value = ''; document.getElementById('userColor').value = '#6366f1'; document.getElementById('userFormTitle').textContent = 'User Management';
};

async function triggerHrDispatchFlow() { const res = await apiRequest('/api/hr/dispatch', { method: 'POST' }); alert(`Report generated: ${res.filename}`); }
function handleLogout() { state.activeProfileId = null; localStorage.removeItem('chronos_user_id'); location.reload(); }
function setupGlobalEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => { item.addEventListener('click', (e) => switchView(e.currentTarget.getAttribute('data-view'))); });
    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const empNo = document.getElementById('loginEmpNo').value;
        const emp = state.employees.find(e => e.emp_no === empNo);
        if (emp) { state.activeProfileId = emp.id; localStorage.setItem('chronos_user_id', emp.id); checkAuth(); }
        else { document.getElementById('loginError').classList.remove('hidden'); }
    });
    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
}
function setupNetworkMonitoring() {
    window.addEventListener('online', () => document.getElementById('statusDot').className = 'status-dot online');
    window.addEventListener('offline', () => document.getElementById('statusDot').className = 'status-dot offline');
}
function showNotification(msg, type) {
    const c = document.getElementById('notificationContainer');
    if (!c) return;
    const n = document.createElement('div');
    n.className = `notification ${type}`; n.textContent = msg;
    n.style.padding = '12px 24px'; n.style.background = type === 'success' ? '#10b981' : '#ef4444';
    n.style.color = '#fff'; n.style.borderRadius = '8px'; n.style.marginTop = '10px';
    c.appendChild(n); setTimeout(() => n.remove(), 3000);
}
