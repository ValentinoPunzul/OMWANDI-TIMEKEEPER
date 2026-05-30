// views/settings.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

export function renderSettings() {
    const main = document.getElementById('mainContent');
    const isAdmin = state.userRole === 'Administrator';
    const me = state.employees.find(e => e.id === state.activeProfileId);
    const mappingRows = Object.entries(state.scoroMapping||{}).map(([empId,scoroId]) => {
        const emp = state.employees.find(e=>e.id===empId);
        return `<tr data-emp-id="${escapeHtml(empId)}">
            <td>${escapeHtml(emp?.name||empId)}</td><td>${escapeHtml(scoroId)}</td>
            ${isAdmin?`<td><button class="btn-icon danger" onclick="removeScoroMapping('${escapeHtml(empId)}')">✕</button></td>`:'<td></td>'}
        </tr>`;
    }).join('');
    const empOptions = state.employees.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
    main.innerHTML = `
        ${renderViewHeader('Settings')}
        <div class="settings-grid">
            <div class="glass-panel settings-section">
                <h3>Account</h3>
                <div class="setting-row"><span class="setting-label">Logged in as</span><span class="setting-value">${escapeHtml(me?.name||'')}</span></div>
                <div class="setting-row"><span class="setting-label">Role</span><span class="setting-value">${escapeHtml(state.userRole)}</span></div>
                <button class="btn outline" style="margin-top:1rem" onclick="handleLogout()">Logout</button>
            </div>
            ${isAdmin?`
            <div class="glass-panel settings-section">
                <h3>Scoro Integration</h3>
                <p class="setting-description">Map employees to their Scoro user IDs.</p>
                <div class="table-wrapper">
                    <table class="timesheet-table">
                        <thead><tr><th>Employee</th><th>Scoro ID</th><th></th></tr></thead>
                        <tbody id="scoroMappingBody">${mappingRows||'<tr><td colspan="3" class="empty-state">No mappings yet.</td></tr>'}</tbody>
                    </table>
                </div>
                <div class="scoro-add-row" style="display:flex;gap:.5rem;margin-top:1rem">
                    <select id="scoroEmpSelect" class="form-control"><option value="">— Select employee —</option>${empOptions}</select>
                    <input type="text" id="scoroIdInput" class="form-control" placeholder="Scoro User ID" />
                    <button class="btn primary" onclick="addScoroMapping()">Add</button>
                </div>
                <button class="btn primary" style="margin-top:1rem" onclick="saveScoroMapping()">Save Mapping</button>
            </div>
            <div class="glass-panel settings-section">
                <h3>HR Dispatch</h3>
                <p class="setting-description">Export time data to CSV.</p>
                <div class="form-group"><label>From Date</label><input type="date" id="hrDispatchStart" class="form-control" /></div>
                <div class="form-group"><label>To Date</label><input type="date" id="hrDispatchEnd" class="form-control" /></div>
                <button class="btn primary" onclick="triggerHrDispatch()">Generate Report</button>
                <div id="hrDispatchResult" style="margin-top:1rem"></div>
            </div>`:''}
        </div>`;
}

window.addScoroMapping = function() {
    const empId = document.getElementById('scoroEmpSelect').value;
    const scoroId = document.getElementById('scoroIdInput').value.trim();
    if (!empId||!scoroId) { showNotification('Select employee and enter Scoro ID','warning'); return; }
    state.scoroMapping[empId] = scoroId;
    document.getElementById('scoroIdInput').value = '';
    const emp = state.employees.find(e=>e.id===empId);
    const tbody = document.getElementById('scoroMappingBody');
    if (tbody.querySelector('.empty-state')) tbody.innerHTML='';
    const tr = document.createElement('tr'); tr.dataset.empId = empId;
    tr.innerHTML = `<td>${escapeHtml(emp?.name||empId)}</td><td>${escapeHtml(scoroId)}</td>
        <td><button class="btn-icon danger" onclick="removeScoroMapping('${escapeHtml(empId)}')">✕</button></td>`;
    tbody.appendChild(tr);
};
window.removeScoroMapping = function(empId) {
    delete state.scoroMapping[empId];
    document.querySelector(`tr[data-emp-id="${CSS.escape(empId)}"]`)?.remove();
};
window.saveScoroMapping = async function() {
    try {
        await apiRequest('/settings/mapping',{method:'POST',body:JSON.stringify({mapping:state.scoroMapping})});
        showNotification('Scoro mapping saved','success');
    } catch(e) { showNotification('Failed: '+e.message,'error'); }
};
window.triggerHrDispatch = async function() {
    const resultEl = document.getElementById('hrDispatchResult');
    resultEl.innerHTML = '<span class="muted">Generating...</span>';
    try {
        const r = await apiRequest('/hr/dispatch',{method:'POST',body:JSON.stringify({
            startDate: document.getElementById('hrDispatchStart')?.value||'',
            endDate: document.getElementById('hrDispatchEnd')?.value||''
        })});
        resultEl.innerHTML = `<div class="dispatch-result">
            <div>✅ Report generated</div>
            <div class="muted">Transaction: ${escapeHtml(r.transactionId||'')}</div>
            <div class="muted">${escapeHtml(String(r.recordCount||0))} records · ${escapeHtml(String((r.totalHours||0).toFixed(2)))}h</div>
        </div>`;
    } catch(e) { resultEl.innerHTML=`<div class="error-text">Failed: ${escapeHtml(e.message)}</div>`; }
};
