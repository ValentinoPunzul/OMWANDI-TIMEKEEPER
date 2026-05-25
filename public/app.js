/* ==========================================================================
   CHRONOS FLOW - ADVANCED DASHBOARD CLIENT WITH FULL MANAGEMENT & SCORO
   ========================================================================== */

const state = {
  employees: [],
  projects: [],
  timeEntries: [],
  activeProfileId: localStorage.getItem('chronos_user_id') || null, 
  activeView: 'dashboard',
  isOnline: navigator.onLine,
  employeeSortField: 'name',
  employeeSortDir: 'asc',
  userRole: 'Employee',
  scoroMapping: {}
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
        const me = state.employees.find(e => e.id === state.activeProfileId);
        if (me) {
            state.userRole = me.access_role || 'Employee';
            const nameEl = document.getElementById('activeName');
            const roleEl = document.getElementById('activeRole');
            const avatarEl = document.getElementById('activeAvatar');
            if(nameEl) nameEl.textContent = me.name;
            if(roleEl) roleEl.textContent = me.designation || me.role || 'Staff';
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
    const [employees, projects, entries, mapping] = await Promise.all([
      apiRequest('/api/employees'),
      apiRequest('/api/projects'),
      apiRequest('/api/entries'),
      apiRequest('/api/settings/mapping')
    ]);
    state.employees = employees;
    state.projects = projects;
    state.timeEntries = entries;
    state.scoroMapping = mapping;
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
        const faceClock = document.getElementById('faceClock');
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        if (timeEl) timeEl.textContent = timeStr;
        if (faceClock) faceClock.textContent = timeStr;
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
    activeTimers.forEach(timer => { if (!grouped[timer.project_id]) grouped[timer.project_id] = []; grouped[timer.project_id].push(timer); });
    let html = activeTimers.length === 0 ? '<div style="text-align:center; padding:40px;">No active sessions.</div>' : 
        Object.entries(grouped).map(([pid, timers]) => {
            const proj = state.projects.find(p => p.id === pid) || { name: 'Internal', color: '#6366f1' };
            const list = timers.map(t => {
                const emp = state.employees.find(e => e.id === t.employee_id) || { name: 'Unknown', avatar: '??', color: '#888' };
                return `<div class="timer-card glass-panel"><div class="timer-avatar" style="background:${emp.color}">${emp.avatar}</div><div class="timer-user-info"><div>${emp.name}</div><div style="font-size:0.8rem; opacity:0.7;">${emp.designation || ''}</div></div><button class="btn-text" style="color:#ef4444;" onclick="stopUserTimer('${t.id}')">STOP</button></div>`;
            }).join('');
            return `<div class="project-group"><h3>[${proj.proj_no || '---'}] ${proj.name}</h3>${list}</div>`;
        }).join('');
    container.innerHTML = `<div class="clock-card glass-container"><div class="dashboard-time" id="dashboardTime">00:00:00</div></div><div class="active-timers-section">${html}</div>`;
}

async function stopUserTimer(id) {
    if (!confirm('Stop tracking?')) return;
    const entry = state.timeEntries.find(e => e.id === id);
    const hours = Math.abs(new Date() - new Date(entry.start_time)) / 36e5;
    await apiRequest(`/api/entries/${id}`, { method: 'PUT', body: JSON.stringify({ end_time: new Date().toISOString(), total_hours: Math.floor(hours * 4) / 4 }) });
    await initializeState(); switchView(state.activeView);
}

function renderTimer(container) {
    const projects = state.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    container.innerHTML = `<div class="timer-view-container glass-container"><div id="faceClock" style="font-size:4rem; font-weight:800; margin-bottom:20px;">00:00:00</div><select id="timerProjectSelect" class="form-control" style="margin-bottom:20px;">${projects}</select><button class="btn primary" style="width:100%;" onclick="startTimer()">START SESSION</button></div>`;
}

async function startTimer() {
    const active = state.timeEntries.find(e => e.employee_id === state.activeProfileId && (!e.end_time || e.total_hours === 0));
    if (active) return alert('You already have an active timer running. Please stop it before starting a new one.');

    const pid = document.getElementById('timerProjectSelect').value;
    await apiRequest('/api/entries', { method: 'POST', body: JSON.stringify({ employee_id: state.activeProfileId, project_id: pid, start_time: new Date().toISOString(), total_hours: 0 }) });
    await initializeState(); switchView('dashboard');
}

function renderProjects(container) {
    const html = state.projects.map(p => `<div class="glass-container" style="margin-bottom:10px;"><h3>[${p.proj_no || '---'}] ${p.name}</h3><p>Client: ${p.client}</p><p style="opacity:0.7">Vessel: ${p.vessel_name || 'N/A'}</p></div>`).join('');
    container.innerHTML = `<h2>Projects</h2>${html}`;
}

function renderTeam(container) {
    const html = state.employees.map(e => `<div class="timer-card glass-panel" style="margin-bottom:10px;"><div class="timer-avatar" style="background:${e.color}">${e.avatar}</div><div>${e.name} (${e.designation})</div></div>`).join('');
    container.innerHTML = `<h2>Team</h2>${html}`;
}

function renderTimesheets(container) {
    // FIX: Added safety check for start_time
    const rows = state.timeEntries.map(e => {
        const date = e.start_time ? e.start_time.split('T')[0] : 'No Date';
        return `<tr><td>${date}</td><td>${e.employee_name || '---'}</td><td>${e.project_name || '---'}</td><td>${(e.total_hours || 0).toFixed(2)}h</td></tr>`;
    }).join('');
    container.innerHTML = `<h2>Timesheets</h2><div class="glass-container"><table><thead><tr><th>Date</th><th>Member</th><th>Project</th><th>Hours</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderSettings(container) {
    const isAdmin = state.userRole === 'Administrator';
    if (!isAdmin && state.userRole !== 'Editor') { container.innerHTML = 'Access Denied'; return; }

    const sortedEmployees = [...state.employees].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const userOptions = sortedEmployees.map(e => `<option value="${e.id}">${e.name} (${e.emp_no || '---'})</option>`).join('');
    const projectOptions = state.projects.map(p => `<option value="${p.id}">${p.proj_no ? '['+p.proj_no+'] ' : ''}${p.name}</option>`).join('');

    container.innerHTML = `
        <div class="view-header"><h2>Settings</h2></div>
        
        <!-- SCORO MAPPER -->
        <div class="glass-container" style="margin-bottom:24px; border-left: 4px solid #8b5cf6;">
            <h3>SCORO Webhook Mapper</h3>
            <div id="mappingForm" class="settings-form" style="margin-top:20px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="font-size:0.7rem; opacity:0.7;">PROJECT NUMBER PATH</label><input type="text" id="mapProjNo" value="${state.scoroMapping.proj_no || 'entity.no'}" class="form-control"></div>
                    <div><label style="font-size:0.7rem; opacity:0.7;">PROJECT NAME PATH</label><input type="text" id="mapName" value="${state.scoroMapping.name || 'entity.project_name'}" class="form-control"></div>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="font-size:0.7rem; opacity:0.7;">CLIENT NAME PATH</label><input type="text" id="mapClient" value="${state.scoroMapping.client || 'entity.company_name'}" class="form-control"></div>
                    <div><label style="font-size:0.7rem; opacity:0.7;">VESSEL NAME PATH</label><input type="text" id="mapVessel" value="${state.scoroMapping.vessel_name || 'cf:c_vesselname'}" class="form-control"></div>
                </div>
                <button class="btn primary" onclick="saveMapping()">Save Mapping</button>
                <button class="btn outline" style="margin-left:10px;" onclick="viewLatestWebhook()">View JSON</button>
            </div>
        </div>

        <!-- EMPLOYEE MANAGEMENT -->
        <div class="glass-container" style="margin-bottom:24px;">
            <h3 id="userFormTitle">User Management</h3>
            <div style="margin-top:20px;">
                <label style="font-size:0.7rem; opacity:0.7; text-transform:uppercase;">Select Employee to Edit</label>
                <select id="userSelect" class="form-control" style="margin-bottom:20px;" onchange="editEmployee(this.value)">
                    <option value="">-- Add New Employee --</option>${userOptions}
                </select>
            </div>
            <div id="userForm" class="settings-form">
                <input type="hidden" id="userId">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="font-size:0.7rem; opacity:0.7;">EMPLOYEE NUMBER</label><input type="text" id="userEmpNo" class="form-control"></div>
                    <div><label style="font-size:0.7rem; opacity:0.7;">FULL NAME</label><input type="text" id="userName" class="form-control"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="font-size:0.7rem; opacity:0.7;">DESIGNATION</label><input type="text" id="userDesignation" class="form-control"></div>
                    <div><label style="font-size:0.7rem; opacity:0.7;">DEPARTMENT</label><input type="text" id="userDepartment" class="form-control"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="font-size:0.7rem; opacity:0.7;">SUB DEPARTMENT</label><input type="text" id="userSubDepartment" class="form-control"></div>
                    <div><label style="font-size:0.7rem; opacity:0.7;">REPORTS TO</label><input type="text" id="userReportsTo" class="form-control"></div>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="font-size:0.7rem; opacity:0.7;">ACCESS ROLE</label>
                        <select id="userAccessRole" class="form-control">
                            <option value="Employee">Employee</option><option value="Editor">Editor</option><option value="Administrator">Administrator</option>
                        </select>
                    </div>
                    <div><label style="font-size:0.7rem; opacity:0.7;">COLOR</label><input type="color" id="userColor" value="#6366f1" style="height:44px; width:100%; border:none; background:none; padding:0; cursor:pointer;"></div>
                </div>
                <div class="btn-group" style="display:flex; gap:12px; margin-top:10px;">
                    <button class="btn primary" onclick="handleUserSubmit()">Save Employee</button>
                    ${isAdmin ? `<button id="deleteEmployeeBtn" class="btn outline" style="color:#ef4444; border-color:#ef4444; display:none;" onclick="deleteEmployee()">Delete Employee</button>` : ''}
                    <button class="btn outline" onclick="resetUserForm()">Clear</button>
                </div>
            </div>
        </div>

        <!-- PROJECT MANAGEMENT -->
        <div class="glass-container">
            <h3>Project Management</h3>
            <div style="margin-top:20px;">
                <label style="font-size:0.7rem; opacity:0.7; text-transform:uppercase;">Select Project to Edit</label>
                <select id="projectSelect" class="form-control" style="margin-bottom:20px;" onchange="handleProjectSelect(this.value)">
                    <option value="">-- Add New Project --</option>${projectOptions}
                </select>
            </div>
            <div id="projectForm" class="settings-form">
                <input type="hidden" id="projectId">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="font-size:0.7rem; opacity:0.7;">PROJECT NUMBER</label><input type="text" id="projectNo" class="form-control"></div>
                    <div><label style="font-size:0.7rem; opacity:0.7;">PROJECT NAME</label><input type="text" id="projectName" class="form-control"></div>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
                    <div><label style="font-size:0.7rem; opacity:0.7;">CLIENT NAME</label><input type="text" id="projectClient" class="form-control"></div>
                    <div><label style="font-size:0.7rem; opacity:0.7;">VESSEL NAME</label><input type="text" id="projectVessel" class="form-control"></div>
                </div>
                <div class="btn-group" style="display:flex; gap:12px; margin-top:10px;">
                    <button class="btn primary" onclick="handleProjectSubmit()">Save Project</button>
                    ${isAdmin ? `<button id="deleteProjectBtn" class="btn outline" style="color:#ef4444; border-color:#ef4444; display:none;" onclick="deleteProject()">Delete Project</button>` : ''}
                    <button class="btn outline" onclick="resetProjectForm()">Clear</button>
                </div>
            </div>
        </div>
    `;
}

// --- LOGIC ---

async function saveMapping() {
    const data = { proj_no: document.getElementById('mapProjNo').value, name: document.getElementById('mapName').value, client: document.getElementById('mapClient').value, vessel_name: document.getElementById('mapVessel').value };
    await apiRequest('/api/settings/mapping', { method: 'POST', body: JSON.stringify(data) });
    showNotification('Mapping saved!', 'success');
}

async function viewLatestWebhook() {
    const logs = await apiRequest('/api/admin/webhooks');
    if (logs.length > 0) {
        const win = window.open("", "Webhook JSON", "width=600,height=600");
        win.document.body.innerHTML = `<pre style="background:#222; color:#0f0; padding:20px;">${JSON.stringify(logs[0].content, null, 2)}</pre>`;
    } else { alert('No logs found.'); }
}

async function handleUserSubmit() {
    const name = document.getElementById('userName').value;
    if(!name) return alert('Name required');
    const userData = {
        emp_no: document.getElementById('userEmpNo').value,
        name,
        designation: document.getElementById('userDesignation').value,
        department: document.getElementById('userDepartment').value,
        sub_department: document.getElementById('userSubDepartment').value,
        reports_to: document.getElementById('userReportsTo').value,
        access_role: document.getElementById('userAccessRole').value,
        color: document.getElementById('userColor').value,
        avatar: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    };
    const id = document.getElementById('userId').value;
    if (id) await apiRequest(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(userData) });
    else await apiRequest('/api/employees', { method: 'POST', body: JSON.stringify(userData) });
    await initializeState(); renderSettings(document.getElementById('mainContent'));
}

function editEmployee(id) {
    const emp = state.employees.find(e => e.id === id);
    if (!emp) { resetUserForm(); return; }
    document.getElementById('userId').value = emp.id;
    document.getElementById('userEmpNo').value = emp.emp_no || '';
    document.getElementById('userName').value = emp.name || '';
    document.getElementById('userDesignation').value = emp.designation || '';
    document.getElementById('userDepartment').value = emp.department || '';
    document.getElementById('userSubDepartment').value = emp.sub_department || '';
    document.getElementById('userReportsTo').value = emp.reports_to || '';
    document.getElementById('userAccessRole').value = emp.access_role || 'Employee';
    document.getElementById('userColor').value = emp.color || '#6366f1';
    document.getElementById('userFormTitle').textContent = 'Edit Employee: ' + emp.name;
    const delBtn = document.getElementById('deleteEmployeeBtn');
    if (delBtn) delBtn.style.display = 'inline-block';
}

async function deleteEmployee() {
    const id = document.getElementById('userId').value;
    if (!id || !confirm('Delete employee?')) return;
    await apiRequest(`/api/employees/${id}`, { method: 'DELETE' });
    await initializeState(); renderSettings(document.getElementById('mainContent'));
}

function resetUserForm() {
    document.getElementById('userId').value = '';
    document.getElementById('userForm').reset();
    document.getElementById('userFormTitle').textContent = 'User Management';
    document.getElementById('userSelect').value = '';
    const delBtn = document.getElementById('deleteEmployeeBtn');
    if (delBtn) delBtn.style.display = 'none';
}

function handleProjectSelect(id) {
    const p = state.projects.find(p => p.id === id);
    if (!p) { resetProjectForm(); return; }
    document.getElementById('projectId').value = p.id;
    document.getElementById('projectNo').value = p.proj_no || '';
    document.getElementById('projectName').value = p.name || '';
    document.getElementById('projectClient').value = p.client || '';
    document.getElementById('projectVessel').value = p.vessel_name || '';
    document.getElementById('projectFormTitle').textContent = 'Edit Project: ' + p.name;
    const delBtn = document.getElementById('deleteProjectBtn');
    if (delBtn) delBtn.style.display = 'inline-block';
}

async function handleProjectSubmit() {
    const projNo = document.getElementById('projectNo').value;
    const name = document.getElementById('projectName').value;
    if(!projNo || !name) return alert('No & Name required');
    const data = { proj_no: projNo, name, client: document.getElementById('projectClient').value, vessel_name: document.getElementById('projectVessel').value, id: 'proj_'+projNo };
    const id = document.getElementById('projectId').value || data.id;
    if (document.getElementById('projectId').value) await apiRequest(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    else await apiRequest('/api/projects', { method: 'POST', body: JSON.stringify(data) });
    await initializeState(); renderSettings(document.getElementById('mainContent'));
}

async function deleteProject() {
    const id = document.getElementById('projectId').value;
    if (!id || !confirm('Delete project?')) return;
    await apiRequest(`/api/projects/${id}`, { method: 'DELETE' });
    await initializeState(); renderSettings(document.getElementById('mainContent'));
}

function resetProjectForm() {
    document.getElementById('projectId').value = '';
    document.getElementById('projectForm').reset();
    document.getElementById('projectFormTitle').textContent = 'Project Management';
    document.getElementById('projectSelect').value = '';
    const delBtn = document.getElementById('deleteProjectBtn');
    if (delBtn) delBtn.style.display = 'none';
}

function handleLogout() { state.activeProfileId = null; localStorage.removeItem('chronos_user_id'); location.reload(); }
function setupGlobalEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => { item.addEventListener('click', (e) => switchView(e.currentTarget.getAttribute('data-view'))); });
    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const emp = state.employees.find(e => e.emp_no === document.getElementById('loginEmpNo').value);
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
