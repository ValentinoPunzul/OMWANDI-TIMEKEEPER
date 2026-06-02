// views/team.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

// Cache ref data for modal use
let _designations = [];
let _departments = [];
let _roles = [];

// Sort state
let _sortCol = 'name';
let _sortDir = 'asc';

export async function renderTeam() {
    const main = document.getElementById('mainContent');
    const isAdmin = state.userRole === 'Administrator';

    // Load reference data
    [_designations, _departments, _roles] = await Promise.all([
        apiRequest('/ref/designations').catch(() => []),
        apiRequest('/ref/departments').catch(() => []),
        apiRequest('/ref/roles').catch(() => []),
    ]);

    let employees = isAdmin ? [...state.employees]
        : state.employees.filter(e => e.id === state.activeProfileId || e.reports_to === state.activeProfileId);

    // Apply sort
    employees.sort((a, b) => {
        let valA = '', valB = '';
        if (_sortCol === 'name')        { valA = a.name||''; valB = b.name||''; }
        else if (_sortCol === 'designation') { valA = a.designation||''; valB = b.designation||''; }
        else if (_sortCol === 'department')  { valA = a.department||''; valB = b.department||''; }
        else if (_sortCol === 'role')        { valA = a.role||''; valB = b.role||''; }
        else if (_sortCol === 'reports_to')  {
            const ma = state.employees.find(e => e.id === a.reports_to);
            const mb = state.employees.find(e => e.id === b.reports_to);
            valA = ma?.name||''; valB = mb?.name||'';
        }
        else if (_sortCol === 'hours') {
            const ha = state.timeEntries.filter(e => e.employee_id === a.id && e.total_hours > 0).reduce((s,e) => s+e.total_hours, 0);
            const hb = state.timeEntries.filter(e => e.employee_id === b.id && e.total_hours > 0).reduce((s,e) => s+e.total_hours, 0);
            return _sortDir === 'asc' ? ha - hb : hb - ha;
        }
        const cmp = valA.localeCompare(valB);
        return _sortDir === 'asc' ? cmp : -cmp;
    });

    const rows = employees.map(emp => {
        const hours = state.timeEntries.filter(e => e.employee_id === emp.id && e.total_hours > 0).reduce((s,e) => s+e.total_hours, 0);
        const manager = state.employees.find(e => e.id === emp.reports_to);
        const initials = escapeHtml((emp.name||'??').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase());
        const color = escapeHtml(emp.color || '#1d4ed8');
        return `<tr>
            <td><div class="emp-cell">
                <div class="emp-avatar" style="background:${color}">${initials}</div>
                <div><div class="emp-name">${escapeHtml(emp.name||'')}</div><div class="emp-no">${escapeHtml(emp.emp_no||'')}</div></div>
            </div></td>
            <td>${escapeHtml(emp.designation||'')}</td>
            <td>${escapeHtml(emp.department||'')}</td>
            <td>${escapeHtml(emp.role||'Employee')}</td>
            <td>${manager ? escapeHtml(manager.name) : '—'}</td>
            <td>${hours.toFixed(1)}h</td>
            ${isAdmin ? `<td>
                <button class="btn-icon" onclick="editEmployee('${escapeHtml(emp.id)}')">✏️</button>
                <button class="btn-icon danger" onclick="deleteEmployee('${escapeHtml(emp.id)}')">🗑️</button>
            </td>` : '<td></td>'}
        </tr>`;
    }).join('');

    const empOptions = state.employees.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
    const colorSwatches = ['#1d4ed8','#7c3aed','#db2777','#e11d48','#ea580c','#ca8a04','#16a34a','#0891b2']
        .map(c => `<label class="color-swatch" style="background:${c}"><input type="radio" name="empColor" value="${c}" ${c==='#1d4ed8'?'checked':''}/></label>`).join('');

    const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const desigSet = uniq([..._designations.map(d=>d.name), ...state.employees.map(e=>e.designation)]);
    const deptSet  = uniq([..._departments.map(d=>d.name),  ...state.employees.map(e=>e.department)]);
    const baseRoles = _roles.length ? _roles.map(r=>r.name) : ['Employee','Foreman','Administrator'];
    const roleSet  = uniq([...baseRoles, ...state.employees.map(e=>e.role)]);
    const designationOptions = desigSet.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    const departmentOptions  = deptSet.map(n  => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    const roleOptions        = roleSet.map(n  => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

    main.innerHTML = `
        ${renderViewHeader('Team')}
        <div class="view-toolbar">${isAdmin ? `<button class="btn primary" onclick="openEmployeeModal()">+ Add Member</button>` : ''}</div>
        <div class="table-wrapper glass-panel">
            <table class="timesheet-table">
                <thead><tr>
    ${['name','designation','department','role','reports_to','hours'].map((col, i) => {
        const labels = ['Employee','Designation','Department','Role','Reports To','Hours'];
        const active = _sortCol === col;
        const arrow = active ? (_sortDir === 'asc' ? ' ↑' : ' ↓') : '';
        return `<th class="sortable-th ${active?'sort-active':''}" onclick="sortTeamBy('${col}')" style="cursor:pointer;user-select:none">${labels[i]}${arrow}</th>`;
    }).join('')}
    <th></th>
</tr></thead>
                <tbody>${rows || '<tr><td colspan="7" class="empty-state">No team members found.</td></tr>'}</tbody>
            </table>
        </div>
        <div id="employeeModal" class="modal-overlay" style="display:none">
            <div class="modal glass-panel">
                <h3 id="empModalTitle">Add Team Member</h3>
                <input type="hidden" id="empModalId" />
                <div class="form-group"><label>Full Name *</label><input type="text" id="empModalName" class="form-control" /></div>
                <div class="form-group"><label>Employee Number</label><input type="text" id="empModalEmpNo" class="form-control" /></div>
                <div class="form-group"><label>Designation</label>
                    <select id="empModalDesignation" class="form-control">
                        <option value="">— Select designation —</option>
                        ${designationOptions}
                    </select>
                </div>
                <div class="form-group"><label>Department</label>
                    <select id="empModalDepartment" class="form-control">
                        <option value="">— Select department —</option>
                        ${departmentOptions}
                    </select>
                </div>
                <div class="form-group"><label>Role</label>
                    <select id="empModalRole" class="form-control">
                        <option value="">— Select role —</option>
                        ${roleOptions}
                    </select>
                </div>
                <div class="form-group"><label>Reports To</label>
                    <select id="empModalReportsTo" class="form-control"><option value="">— None —</option>${empOptions}</select>
                </div>
                <div class="form-group"><label>Password</label><input type="password" id="empModalPassword" class="form-control" placeholder="Leave blank to keep existing" /></div>
                <div class="form-group"><label>Colour</label><div class="color-picker">${colorSwatches}</div></div>
                <div class="modal-actions">
                    <button class="btn outline" onclick="closeEmployeeModal()">Cancel</button>
                    <button class="btn primary" onclick="saveEmployee()">Save</button>
                </div>
            </div>
        </div>`;
}

window.sortTeamBy = function(col) {
    if (_sortCol === col) { _sortDir = _sortDir === 'asc' ? 'desc' : 'asc'; }
    else { _sortCol = col; _sortDir = 'asc'; }
    renderTeam();
};

function ensureOption(selectId, value) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    if (value && ![...sel.options].some(o => o.value === value)) {
        const o = document.createElement('option');
        o.value = value; o.textContent = value;
        sel.appendChild(o);
    }
    sel.value = value || '';
}

window.openEmployeeModal = function(id=null) {
    document.getElementById('empModalTitle').textContent = id ? 'Edit Member' : 'Add Team Member';
    document.getElementById('empModalId').value = id || '';
    document.getElementById('empModalPassword').value = '';
    if (id) {
        const emp = state.employees.find(e => e.id === id);
        if (emp) {
            document.getElementById('empModalName').value = emp.name||'';
            document.getElementById('empModalEmpNo').value = emp.emp_no||'';
            ensureOption('empModalDesignation', emp.designation);
            ensureOption('empModalDepartment', emp.department);
            ensureOption('empModalRole', emp.role || 'Employee');
            document.getElementById('empModalReportsTo').value = emp.reports_to||'';
            const r = document.querySelector(`input[name="empColor"][value="${emp.color}"]`); if(r) r.checked=true;
        }
    } else {
        ['empModalName','empModalEmpNo'].forEach(i => document.getElementById(i).value='');
        document.getElementById('empModalDesignation').value='';
        document.getElementById('empModalDepartment').value='';
        document.getElementById('empModalRole').value='';
    }
    document.getElementById('employeeModal').style.display = 'flex';
};

window.closeEmployeeModal = () => document.getElementById('employeeModal').style.display = 'none';
window.editEmployee = id => window.openEmployeeModal(id);

window.saveEmployee = async function() {
    const id = document.getElementById('empModalId').value;
    const name = document.getElementById('empModalName').value.trim();
    if (!name) { showNotification('Name is required', 'warning'); return; }
    const payload = { name,
        emp_no: document.getElementById('empModalEmpNo').value.trim(),
        designation: document.getElementById('empModalDesignation').value,
        department: document.getElementById('empModalDepartment').value,
        role: document.getElementById('empModalRole').value || 'Employee',
        reports_to: document.getElementById('empModalReportsTo').value || null,
        color: document.querySelector('input[name="empColor"]:checked')?.value || '#1d4ed8' };
    const pw = document.getElementById('empModalPassword').value; if (pw) payload.password = pw;
    try {
        if (id) {
            const u = await apiRequest(`/employees/${id}`,{method:'PUT',body:JSON.stringify(payload)});
            const i = state.employees.findIndex(e=>e.id===id);
            if(i!==-1) state.employees[i] = (u && u.id) ? u : { ...state.employees[i], ...payload };
        } else {
            const created = await apiRequest('/employees',{method:'POST',body:JSON.stringify(payload)});
            state.employees.push(created);
        }
        window.closeEmployeeModal(); renderTeam(); showNotification('Saved', 'success');
    } catch(e) { showNotification('Failed: '+e.message, 'error'); }
};

window.deleteEmployee = async function(id) {
    if (!confirm('Delete this employee and their time entries?')) return;
    try {
        await apiRequest(`/employees/${id}`,{method:'DELETE'});
        state.employees = state.employees.filter(e=>e.id!==id);
        state.timeEntries = state.timeEntries.filter(e=>e.employee_id!==id);
        renderTeam(); showNotification('Deleted', 'success');
    } catch(e) { showNotification('Failed: '+e.message,'error'); }
};
