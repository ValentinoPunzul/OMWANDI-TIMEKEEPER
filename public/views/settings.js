// views/settings.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

let webhookLogs = [];
let fieldMap = {};

// App fields that can be mapped from Scoro
const APP_FIELDS = [
  { key: 'name',         label: 'Project Name' },
  { key: 'proj_no',      label: 'Project Number' },
  { key: 'client',       label: 'Client / Customer' },
  { key: 'budget_hours', label: 'Budget Hours' },
  { key: 'vessel_name',  label: 'Vessel Name' },
];

export async function renderSettings() {
    const main = document.getElementById('mainContent');
    const isAdmin = state.userRole === 'Administrator';
    const me = state.employees.find(e => e.id === state.activeProfileId);

    // Load logs and field map in parallel
    if (isAdmin) {
        [webhookLogs, fieldMap] = await Promise.all([
            apiRequest('/webhook-logs').catch(() => []),
            apiRequest('/settings/scoro-field-map').catch(() => ({}))
        ]);
    }

    const empOptions = state.employees.map(e =>
        `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');

    const mappingRows = Object.entries(state.scoroMapping || {}).map(([empId, scoroId]) => {
        const emp = state.employees.find(e => e.id === empId);
        return `<tr data-emp-id="${escapeHtml(empId)}">
            <td>${escapeHtml(emp?.name || empId)}</td>
            <td>${escapeHtml(scoroId)}</td>
            ${isAdmin ? `<td><button class="btn-icon danger" onclick="removeScoroMapping('${escapeHtml(empId)}')">✕</button></td>` : '<td></td>'}
        </tr>`;
    }).join('');

    main.innerHTML = `
        ${renderViewHeader('Settings')}
        <div class="settings-grid">

            <!-- Account -->
            <div class="glass-panel settings-section">
                <h3>Account</h3>
                <div class="setting-row">
                    <span class="setting-label">Logged in as</span>
                    <span class="setting-value">${escapeHtml(me?.name || '')}</span>
                </div>
                <div class="setting-row">
                    <span class="setting-label">Role</span>
                    <span class="setting-value">${escapeHtml(state.userRole)}</span>
                </div>
                <button class="btn outline" style="margin-top:1rem" onclick="handleLogout()">Logout</button>
            </div>

            ${isAdmin ? `
            <!-- Employee → Scoro ID Mapping -->
            <div class="glass-panel settings-section">
                <h3>Employee Scoro IDs</h3>
                <p class="setting-description">Map employees to their Scoro user IDs for time sync.</p>
                <div class="table-wrapper">
                    <table class="timesheet-table">
                        <thead><tr><th>Employee</th><th>Scoro ID</th><th></th></tr></thead>
                        <tbody id="scoroMappingBody">${mappingRows || '<tr><td colspan="3" class="empty-state">No mappings yet.</td></tr>'}</tbody>
                    </table>
                </div>
                <div class="scoro-add-row">
                    <select id="scoroEmpSelect" class="form-control">
                        <option value="">— Select employee —</option>${empOptions}
                    </select>
                    <input type="text" id="scoroIdInput" class="form-control" placeholder="Scoro User ID" />
                    <button class="btn primary" onclick="addScoroMapping()">Add</button>
                </div>
                <button class="btn primary" style="margin-top:1rem" onclick="saveScoroMapping()">Save Mapping</button>
            </div>

            <!-- Scoro Field Mapper -->
            <div class="glass-panel settings-section" style="grid-column: 1 / -1">
                <h3>Scoro → Project Field Mapping</h3>
                <p class="setting-description">
                    Map Scoro webhook fields to OMWANDI project fields.
                    Send a test webhook from Scoro first to capture the available fields.
                </p>
                <div id="fieldMapperArea">
                    ${renderFieldMapper(webhookLogs, fieldMap)}
                </div>
            </div>

            <!-- Webhook Logs -->
            <div class="glass-panel settings-section" style="grid-column: 1 / -1">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
                    <h3 style="margin:0">Scoro Webhook Logs</h3>
                    <div style="display:flex;gap:.5rem">
                        <span class="muted" style="align-self:center">Webhook URL: <code>/api/webhooks/scoro</code></span>
                        <button class="btn outline" onclick="refreshWebhookLogs()">↻ Refresh</button>
                    </div>
                </div>
                <div id="webhookLogsArea">
                    ${renderLogs(webhookLogs)}
                </div>
            </div>

            <!-- HR Dispatch -->
            <div class="glass-panel settings-section">
                <h3>HR Dispatch</h3>
                <p class="setting-description">Export time data to CSV.</p>
                <div class="form-group">
                    <label>From Date</label>
                    <input type="date" id="hrDispatchStart" class="form-control" />
                </div>
                <div class="form-group">
                    <label>To Date</label>
                    <input type="date" id="hrDispatchEnd" class="form-control" />
                </div>
                <button class="btn primary" onclick="triggerHrDispatch()">Generate Report</button>
                <div id="hrDispatchResult" style="margin-top:1rem"></div>
            </div>
            ` : ''}
        </div>`;
}

function renderFieldMapper(logs, currentMap) {
    // Collect all unique fields from captured logs
    const allFields = new Set();
    logs.forEach(log => {
        if (log.fields) log.fields.forEach(f => allFields.add(f));
        if (log.payload) collectNestedKeys(log.payload, '', allFields);
    });

    const scoroFields = Array.from(allFields);

    if (scoroFields.length === 0) {
        return `<div class="webhook-empty">
            <p class="muted">No webhook data captured yet.</p>
            <p class="muted">Register <code>/api/webhooks/scoro</code> in Scoro → Settings → Webhooks, then trigger a project event.</p>
        </div>`;
    }

    const rows = APP_FIELDS.map(appField => {
        const currentValue = currentMap[appField.key] || '';
        const options = scoroFields.map(f =>
            `<option value="${escapeHtml(f)}" ${f === currentValue ? 'selected' : ''}>${escapeHtml(f)}</option>`
        ).join('');
        return `<tr>
            <td><strong>${escapeHtml(appField.label)}</strong><div class="muted">${escapeHtml(appField.key)}</div></td>
            <td style="font-size:1.3rem;text-align:center;color:#94a3b8">→</td>
            <td>
                <select class="form-control field-map-select" data-app-field="${escapeHtml(appField.key)}">
                    <option value="">— Not mapped —</option>
                    ${options}
                </select>
            </td>
            <td class="muted" id="preview-${escapeHtml(appField.key)}">
                ${currentValue && logs[0]?.payload ? escapeHtml(String(getNestedValue(logs[0].payload, currentValue) || '')) : ''}
            </td>
        </tr>`;
    }).join('');

    return `
        <table class="timesheet-table" style="margin-bottom:1rem">
            <thead><tr><th>OMWANDI Field</th><th></th><th>Scoro Field</th><th>Sample Value</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <button class="btn primary" onclick="saveFieldMap()">Save Field Mapping</button>`;
}

function renderLogs(logs) {
    if (!logs.length) {
        return `<p class="empty-state">No webhooks received yet. Register the URL in Scoro and trigger a project event.</p>`;
    }
    return logs.map(log => `
        <div class="webhook-log-entry glass-panel" style="margin-bottom:.75rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
                <span class="muted">${escapeHtml(log.received_at)}</span>
                <span class="badge-pill">${escapeHtml(String(log.fields?.length || 0))} fields</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.65rem">
                ${(log.fields || []).map(f => `<span class="field-pill">${escapeHtml(f)}</span>`).join('')}
            </div>
            <details>
                <summary class="muted" style="cursor:pointer;font-size:.8rem">View raw payload</summary>
                <pre class="payload-pre">${escapeHtml(JSON.stringify(log.payload, null, 2))}</pre>
            </details>
        </div>`).join('');
}

function collectNestedKeys(obj, prefix, result) {
    for (const [k, v] of Object.entries(obj || {})) {
        const key = prefix ? prefix + '.' + k : k;
        result.add(key);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            collectNestedKeys(v, key, result);
        }
    }
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

// ── Global handlers ───────────────────────────────────────────────────────────

window.refreshWebhookLogs = async function() {
    const area = document.getElementById('webhookLogsArea');
    const mapArea = document.getElementById('fieldMapperArea');
    if (area) area.innerHTML = '<p class="muted">Loading...</p>';
    webhookLogs = await apiRequest('/webhook-logs').catch(() => []);
    if (area) area.innerHTML = renderLogs(webhookLogs);
    if (mapArea) mapArea.innerHTML = renderFieldMapper(webhookLogs, fieldMap);
};

window.saveFieldMap = async function() {
    const selects = document.querySelectorAll('.field-map-select');
    const map = {};
    selects.forEach(sel => {
        if (sel.value) map[sel.dataset.appField] = sel.value;
    });
    fieldMap = map;
    try {
        await apiRequest('/settings/scoro-field-map', { method: 'POST', body: JSON.stringify(map) });
        showNotification('Field mapping saved', 'success');
    } catch(e) { showNotification('Failed to save: ' + e.message, 'error'); }
};

window.addScoroMapping = function() {
    const empId = document.getElementById('scoroEmpSelect').value;
    const scoroId = document.getElementById('scoroIdInput').value.trim();
    if (!empId || !scoroId) { showNotification('Select employee and enter Scoro ID', 'warning'); return; }
    state.scoroMapping[empId] = scoroId;
    document.getElementById('scoroIdInput').value = '';
    const emp = state.employees.find(e => e.id === empId);
    const tbody = document.getElementById('scoroMappingBody');
    if (tbody?.querySelector('.empty-state')) tbody.innerHTML = '';
    const tr = document.createElement('tr');
    tr.dataset.empId = empId;
    tr.innerHTML = `<td>${escapeHtml(emp?.name || empId)}</td><td>${escapeHtml(scoroId)}</td>
        <td><button class="btn-icon danger" onclick="removeScoroMapping('${escapeHtml(empId)}')">✕</button></td>`;
    tbody?.appendChild(tr);
};

window.removeScoroMapping = function(empId) {
    delete state.scoroMapping[empId];
    document.querySelector(`tr[data-emp-id="${CSS.escape(empId)}"]`)?.remove();
};

window.saveScoroMapping = async function() {
    try {
        await apiRequest('/settings/mapping', { method: 'POST', body: JSON.stringify({ mapping: state.scoroMapping }) });
        showNotification('Scoro mapping saved', 'success');
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.triggerHrDispatch = async function() {
    const resultEl = document.getElementById('hrDispatchResult');
    resultEl.innerHTML = '<span class="muted">Generating...</span>';
    try {
        const r = await apiRequest('/hr/dispatch', { method: 'POST', body: JSON.stringify({
            startDate: document.getElementById('hrDispatchStart')?.value || '',
            endDate: document.getElementById('hrDispatchEnd')?.value || ''
        })});
        resultEl.innerHTML = `<div class="dispatch-result">
            <div>✅ Report generated</div>
            <div class="muted">Transaction: ${escapeHtml(r.transactionId || '')}</div>
            <div class="muted">${escapeHtml(String(r.recordCount || 0))} records · ${escapeHtml(String((r.totalHours || 0).toFixed(2)))}h</div>
        </div>`;
    } catch(e) { resultEl.innerHTML = `<div class="error-text">Failed: ${escapeHtml(e.message)}</div>`; }
};
