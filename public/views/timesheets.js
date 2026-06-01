// views/timesheets.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

// Sort state
let _tsSortCol = 'date';
let _tsSortDir = 'desc';

export function renderTimesheets() {
    const main = document.getElementById('mainContent');
    const isAdmin = state.userRole === 'Administrator';
    const isForeman = state.userRole === 'Foreman';
    const projectOptions = [...state.projects].sort((a,b)=>(a.proj_no||'').localeCompare(b.proj_no||'')).map(p=>`<option value="${escapeHtml(p.id)}">${p.proj_no?'['+escapeHtml(p.proj_no)+'] ':''}${escapeHtml(p.name)}</option>`).join('');
    const employeeOptions = state.employees.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
    main.innerHTML = `
        ${renderViewHeader('Timesheets')}
        <div class="filter-bar glass-panel">
            <select id="tsFilterProject" class="form-control" onchange="applyTimesheetFilters()">
                <option value="">All Projects</option>${projectOptions}
            </select>
            ${(isAdmin||isForeman)?`<select id="tsFilterEmployee" class="form-control" onchange="applyTimesheetFilters()">
                <option value="">All Employees</option>${employeeOptions}</select>`:''}
            <input type="date" id="tsFilterStart" class="form-control" onchange="applyTimesheetFilters()" />
            <input type="date" id="tsFilterEnd" class="form-control" onchange="applyTimesheetFilters()" />
            <button class="btn outline" onclick="clearTimesheetFilters()">Clear</button>
            <button class="btn primary" onclick="exportTimesheets()">⤓ Export Excel</button>
        </div>
        <div id="timesheetContent" class="glass-panel table-wrapper">${buildTable()}</div>
        ${state.hasMoreTimeEntries?`<div class="load-more-row"><button class="btn outline" onclick="loadMoreEntries()">Load More</button></div>`:''}
        <div id="editEntryModal" class="modal-overlay" style="display:none">
            <div class="modal glass-panel">
                <h3>Edit Time Entry</h3>
                <input type="hidden" id="editEntryId" />
                <div class="form-group"><label>Project</label><select id="editEntryProject" class="form-control">${projectOptions}</select></div>
                <div class="form-group"><label>Task</label><input type="text" id="editEntryTask" class="form-control" /></div>
                <div class="form-group"><label>Description</label><input type="text" id="editEntryDescription" class="form-control" /></div>
                <div class="form-group"><label>Date</label><input type="date" id="editEntryDate" class="form-control" /></div>
                <div class="form-group"><label>Hours</label><input type="number" id="editEntryHours" class="form-control" min="0.25" max="24" step="0.25" /></div>
                <div class="modal-actions">
                    <button class="btn outline" onclick="closeEditEntryModal()">Cancel</button>
                    <button class="btn primary" onclick="saveEntryEdit()">Save</button>
                </div>
            </div>
        </div>`;
}

function getFiltered() {
    const proj = document.getElementById('tsFilterProject')?.value||'';
    const emp  = document.getElementById('tsFilterEmployee')?.value||'';
    const s    = document.getElementById('tsFilterStart')?.value||'';
    const e    = document.getElementById('tsFilterEnd')?.value||'';
    const isAdmin = state.userRole==='Administrator';
    const isForeman = state.userRole==='Foreman';
    return state.timeEntries.filter(x => {
        if (x.total_hours<=0 && !x.end_time) return false;
        if (!isAdmin && !isForeman && x.employee_id!==state.activeProfileId) return false;
        if (isForeman) {
            // Direct reports (Team Leaders)
            const directIds = state.employees.filter(r => r.reports_to === state.activeProfileId).map(r => r.id);
            // Sub-reports (Team Members who report to Team Leaders)
            const subIds = state.employees.filter(r => directIds.includes(r.reports_to)).map(r => r.id);
            const allTeamIds = new Set([state.activeProfileId, ...directIds, ...subIds]);
            if (!allTeamIds.has(x.employee_id)) return false;
        }
        if (proj && x.project_id!==proj) return false;
        if (emp  && x.employee_id!==emp)  return false;
        if (s && x.start_time && x.start_time<s) return false;
        if (e && x.start_time && x.start_time>e+'T23:59:59') return false;
        return true;
    });
}

function buildTable() {
    const isAdmin = state.userRole==='Administrator';
    const entries = getFiltered();

    // Sort
    entries.sort((a, b) => {
        let cmp = 0;
        if (_tsSortCol === 'date') {
            cmp = new Date(a.start_time||0) - new Date(b.start_time||0);
        } else if (_tsSortCol === 'employee') {
            const na = state.employees.find(x=>x.id===a.employee_id)?.name||'';
            const nb = state.employees.find(x=>x.id===b.employee_id)?.name||'';
            cmp = na.localeCompare(nb);
        } else if (_tsSortCol === 'project') {
            const pa = state.projects.find(x=>x.id===a.project_id)?.name||'';
            const pb = state.projects.find(x=>x.id===b.project_id)?.name||'';
            cmp = pa.localeCompare(pb);
        } else if (_tsSortCol === 'proj_no') {
            const pa = state.projects.find(x=>x.id===a.project_id)?.proj_no||'';
            const pb = state.projects.find(x=>x.id===b.project_id)?.proj_no||'';
            cmp = pa.localeCompare(pb);
        } else if (_tsSortCol === 'hours') {
            cmp = (a.total_hours||0) - (b.total_hours||0);
        }
        return _tsSortDir === 'asc' ? cmp : -cmp;
    });

    if (!entries.length) return '<p class="empty-state">No entries match your filters.</p>';

    // Build sortable headers
    const cols = ['date','employee','project','description','hours'];
    const labels = ['Date','Employee','Project','Description','Hours'];
    const headers = cols.map((col, i) => {
        const active = _tsSortCol === col;
        const canSort = col !== 'description';
        const arrow = active ? (_tsSortDir === 'asc' ? ' ↑' : ' ↓') : '';
        return `<th class="${active ? 'sort-active' : ''}" ${canSort ? `style="cursor:pointer;user-select:none" onclick="sortTimesheetsBy('${col}')"` : ''}>${labels[i]}${arrow}</th>`;
    }).join('');

    const rows = entries.map(e => {
        const emp  = state.employees.find(x=>x.id===e.employee_id);
        const proj = state.projects.find(x=>x.id===e.project_id);
        const date = e.start_time ? new Date(e.start_time).toLocaleDateString() : '—';
        const canEdit = isAdmin || e.employee_id===state.activeProfileId;
        return `<tr>
            <td>${date}</td>
            <td>${escapeHtml(emp?.name||'Unknown')}</td>
            <td><span class="proj-tag" style="border-color:${escapeHtml(proj?.color||'#1d4ed8')}">${proj?.proj_no?'['+escapeHtml(proj.proj_no)+'] ':''}${escapeHtml(proj?.name||'Unknown')}</span></td>
            <td>${escapeHtml(e.description||'')}</td>
            <td class="hours-cell">${(e.total_hours||0).toFixed(2)}h</td>
            <td>${canEdit?`<button class="btn-icon" onclick="openEditEntryModal('${escapeHtml(e.id)}')">✏️</button>
                <button class="btn-icon danger" onclick="deleteEntry('${escapeHtml(e.id)}')">🗑️</button>`:''}</td>
        </tr>`;
    }).join('');

    const total = entries.reduce((s,e)=>s+(e.total_hours||0),0);
    return `<table class="timesheet-table">
        <thead><tr>${headers}<th></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4" class="total-label">Total</td><td class="hours-cell">${total.toFixed(2)}h</td><td></td></tr></tfoot>
    </table>`;
}

window.sortTimesheetsBy = function(col) {
    if (_tsSortCol === col) { _tsSortDir = _tsSortDir === 'asc' ? 'desc' : 'asc'; }
    else { _tsSortCol = col; _tsSortDir = col === 'date' ? 'desc' : 'asc'; }
    document.getElementById('timesheetContent').innerHTML = buildTable();
};

window.exportTimesheets = function() {
    const entries = getFiltered().sort((a,b)=>new Date(b.start_time)-new Date(a.start_time));
    if (!entries.length) { showNotification('No entries to export', 'warning'); return; }

    const headers = ['Date','Employee','Project No','Project','Description','Hours'];
    const csvEscape = v => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    };

    const rows = entries.map(e => {
        const emp  = state.employees.find(x=>x.id===e.employee_id);
        const proj = state.projects.find(x=>x.id===e.project_id);
        const date = e.start_time ? new Date(e.start_time).toLocaleDateString() : '';
        return [
            date,
            emp?.name || 'Unknown',
            proj?.proj_no || '',
            proj?.name || 'Unknown',
            e.description || '',
            (e.total_hours||0).toFixed(2)
        ].map(csvEscape).join(',');
    });

    const total = entries.reduce((s,e)=>s+(e.total_hours||0),0);
    rows.push(['','','','','Total', total.toFixed(2)].map(csvEscape).join(','));

    // BOM for Excel UTF-8 compatibility
    const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'timesheet-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification(`Exported ${entries.length} entries`, 'success');
};

window.applyTimesheetFilters = () => document.getElementById('timesheetContent').innerHTML = buildTable();
window.clearTimesheetFilters = function() {
    ['tsFilterProject','tsFilterEmployee','tsFilterStart','tsFilterEnd'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    window.applyTimesheetFilters();
};
window.loadMoreEntries = async function() {
    state.timeEntriesOffset += state.timeEntriesLimit;
    try {
        const data = await apiRequest(`/entries?limit=${state.timeEntriesLimit}&offset=${state.timeEntriesOffset}`);
        if (data.length < state.timeEntriesLimit) state.hasMoreTimeEntries = false;
        state.timeEntries.push(...data);
        renderTimesheets();
    } catch(e) { showNotification('Failed to load more: '+e.message,'error'); }
};
window.openEditEntryModal = function(id) {
    const e = state.timeEntries.find(x=>x.id===id); if(!e) return;
    document.getElementById('editEntryId').value = id;
    document.getElementById('editEntryProject').value = e.project_id||'';
    document.getElementById('editEntryTask').value = e.task||'';
    document.getElementById('editEntryDescription').value = e.description||'';
    document.getElementById('editEntryDate').value = e.start_time?e.start_time.slice(0,10):'';
    document.getElementById('editEntryHours').value = e.total_hours||'';
    document.getElementById('editEntryModal').style.display = 'flex';
};
window.closeEditEntryModal = () => document.getElementById('editEntryModal').style.display='none';
window.saveEntryEdit = async function() {
    const id = document.getElementById('editEntryId').value;
    const entry = state.timeEntries.find(e=>e.id===id); if(!entry) return;
    const hours = parseFloat(document.getElementById('editEntryHours').value);
    const date  = document.getElementById('editEntryDate').value;
    const payload = { ...entry,
        project_id: document.getElementById('editEntryProject').value,
        task: document.getElementById('editEntryTask').value.trim(),
        description: document.getElementById('editEntryDescription').value.trim(),
        total_hours: isNaN(hours)?entry.total_hours:hours,
        start_time: date?date+'T08:00:00.000Z':entry.start_time,
        end_time: date?date+`T${String(Math.floor(hours)+8).padStart(2,'0')}:00:00.000Z`:entry.end_time };
    try {
        const u = await apiRequest(`/entries/${id}`,{method:'PUT',body:JSON.stringify(payload)});
        const i = state.timeEntries.findIndex(e=>e.id===id); if(i!==-1) state.timeEntries[i]=u;
        window.closeEditEntryModal(); window.applyTimesheetFilters(); showNotification('Entry updated','success');
    } catch(e) { showNotification('Failed: '+e.message,'error'); }
};
window.deleteEntry = async function(id) {
    if (!confirm('Delete this time entry?')) return;
    try {
        await apiRequest(`/entries/${id}`,{method:'DELETE'});
        state.timeEntries = state.timeEntries.filter(e=>e.id!==id);
        window.applyTimesheetFilters(); showNotification('Deleted','success');
    } catch(e) { showNotification('Failed: '+e.message,'error'); }
};
