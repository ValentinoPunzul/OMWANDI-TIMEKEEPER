// views/team.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

export function renderTeam() {
    const main = document.getElementById('mainContent');
    const isAdmin = state.userRole === 'Administrator';
    let employees = isAdmin ? state.employees
        : state.employees.filter(e => e.id === state.activeProfileId || e.reports_to === state.activeProfileId);
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
    main.innerHTML = `
        ${renderViewHeader('Team')}
        <div class="view-toolbar">${isAdmin ? `<button class="btn primary" onclick="openEmployeeModal()">+ Add Member</button>` : ''}</div>
        <div class="table-wrapper glass-panel">
            <table class="timesheet-table">
                <thead><tr><th>Employee</th><th>Designation</th><th>Department</th><th>Role</th><th>Reports To</th><th>Total Hours</th><th></th></tr></thead>
                <tbody>${rows || '<tr><td colspan="7" class="empty-state">No team members found.</td></tr>'}</tbody>
            </table>
        </div>
        <div id="employeeModal" class="modal-overlay" style="display:none">
            <div class="modal glass-panel">
                <h3 id="empModalTitle">Add Team Member</h3>
                <input type="hidden" id="empModalId" />
                <div class="form-group"><label>Full Name *</label><input type="text" id="empModalName" class="form-control" /></div>
                <div class="form-group"><label>Employee Number</label><input type="text" id="empModalEmpNo" class="form-control" /></div>
                <div class="form-group"><label>Designation</label><input type="text" id="empModalDesignation" class="form-control" /></div>
                <div class="form-group"><label>Department</label><input type="text" id="empModalDepartment" class="form-control" /></div>
                <div class="form-group"><label>Role</label>
                    <select id="empModalRole" class="form-control">
                        <option value="Employee">Employee</option>
                        <option value="Foreman">Foreman</option>
                        <option value="Administrator">Administrator</option>
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

window.openEmployeeModal = function(id=null) {
    document.getElementById('empModalTitle').textContent = id ? 'Edit Member' : 'Add Team Member';
    document.getElementById('empModalId').value = id || '';
    document.getElementById('empModalPassword').value = '';
    if (id) {
        const emp = state.employees.find(e => e.id === id);
        if (emp) {
            document.getElementById('empModalName').value = emp.name||'';
            document.getElementById('empModalEmpNo').value = emp.emp_no||'';
            document.getElementById('empModalDesignation').value = emp.designation||'';
            document.getElementById('empModalDepartment').value = emp.department||'';
            document.getElementById('empModalRole').value = emp.role||'Employee';
            document.getElementById('empModalReportsTo').value = emp.reports_to||'';
            const r = document.querySelector(`input[name="empColor"][value="${emp.color}"]`); if(r) r.checked=true;
        }
    } else { ['empModalName','empModalEmpNo','empModalDesignation','empModalDepartment'].forEach(i => document.getElementById(i).value=''); }
    document.getElementById('employeeModal').style.display = 'flex';
};
window.closeEmployeeModal = () => document.getElementById('employeeModal').style.display = 'none';
window.editEmployee = id => window.openEmployeeModal(id);

window.saveEmployee = async function() {
    const id = document.getElementById('empModalId').value;
    const name = document.getElementById('empModalName').value.trim();
    if (!name) { showNotification('Name is required', 'warning'); return; }
    const payload = { name, emp_no: document.getElementById('empModalEmpNo').value.trim(),
        designation: document.getElementById('empModalDesignation').value.trim(),
        department: document.getElementById('empModalDepartment').value.trim(),
        role: document.getElementById('empModalRole').value,
        reports_to: document.getElementById('empModalReportsTo').value || null,
        color: document.querySelector('input[name="empColor"]:checked')?.value || '#1d4ed8' };
    const pw = document.getElementById('empModalPassword').value; if (pw) payload.password = pw;
    try {
        if (id) {
            const u = await apiRequest(`/employees/${id}`,{method:'PUT',body:JSON.stringify(payload)});
            const i = state.employees.findIndex(e=>e.id===id); if(i!==-1) state.employees[i]=u;
        } else { state.employees.push(await apiRequest('/employees',{method:'POST',body:JSON.stringify(payload)})); }
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
