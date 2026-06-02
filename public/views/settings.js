// views/settings.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

let webhookLogs = [];
let fieldMap = {};
let activeTab = 'account';

const APP_FIELDS = [
  { key: 'name',         label: 'Project Name' },
  { key: 'proj_no',      label: 'Project Number' },
  { key: 'client',       label: 'Client / Customer' },
  { key: 'budget_hours', label: 'Budget Hours' },
  { key: 'vessel_name',  label: 'Vessel Name' },
];

export async function renderSettings(tab = null) {
    if (tab) activeTab = tab;
    const main = document.getElementById('mainContent');
    const isAdmin = state.userRole === 'Administrator';
    const me = state.employees.find(e => e.id === state.activeProfileId);

    main.innerHTML = `
        ${renderViewHeader('Settings')}
        <div class="settings-tabs">
            <button class="settings-tab ${activeTab==='account'?'active':''}" onclick="switchSettingsTab('account')">Account</button>
            ${isAdmin ? `
            <button class="settings-tab ${activeTab==='dropdowns'?'active':''}" onclick="switchSettingsTab('dropdowns')">Dropdowns</button>
            <button class="settings-tab ${activeTab==='scoro'?'active':''}" onclick="switchSettingsTab('scoro')">Scoro</button>
            <button class="settings-tab ${activeTab==='webhooks'?'active':''}" onclick="switchSettingsTab('webhooks')">Webhooks</button>
            <button class="settings-tab ${activeTab==='timerules'?'active':''}" onclick="switchSettingsTab('timerules')">Time Rules</button>
    <button class="settings-tab ${activeTab==='hr'?'active':''}" onclick="switchSettingsTab('hr')">HR Dispatch</button>
            ` : ''}
        </div>
        <div id="settingsTabContent" class="settings-tab-content">
            <div class="muted" style="padding:2rem;text-align:center">Loading...</div>
        </div>`;

    await loadSettingsTab(activeTab, isAdmin, me);
}

async function loadSettingsTab(tab, isAdmin, me) {
    const content = document.getElementById('settingsTabContent');
    if (!content) return;

    if (tab === 'account') {
        content.innerHTML = `
            <div class="settings-card">
                <h3>Account</h3>
                <div class="setting-row"><span class="setting-label">Name</span><span class="setting-value">${escapeHtml(me?.name||'')}</span></div>
                <div class="setting-row"><span class="setting-label">Employee No</span><span class="setting-value">${escapeHtml(me?.emp_no||'')}</span></div>
                <div class="setting-row"><span class="setting-label">Role</span><span class="setting-value">${escapeHtml(state.userRole)}</span></div>
                <div class="setting-row"><span class="setting-label">Designation</span><span class="setting-value">${escapeHtml(me?.designation||'—')}</span></div>
                <div class="setting-row"><span class="setting-label">Department</span><span class="setting-value">${escapeHtml(me?.department||'—')}</span></div>
                <button class="btn danger" style="margin-top:1.25rem" onclick="handleLogout()">Logout</button>
            </div>`;
        return;
    }

    if (tab === 'dropdowns') {
        const [designations, departments, roles] = await Promise.all([
            apiRequest('/ref/designations').catch(()=>[]),
            apiRequest('/ref/departments').catch(()=>[]),
            apiRequest('/ref/roles').catch(()=>[]),
        ]);
        content.innerHTML = `
            ${renderDropdownCard('designations', 'Designations', 'Configure options for the Designation field on employee records.', designations)}
            ${renderDropdownCard('departments', 'Departments', 'Configure options for the Department field on employee records.', departments)}
            ${renderDropdownCard('roles', 'Roles', 'Configure options for the Role field on employee records.', roles)}`;
        return;
    }

    if (tab === 'scoro') {
        const [fMap, empMapping] = await Promise.all([
            apiRequest('/settings/scoro-field-map').catch(()=>({})),
            apiRequest('/settings/mapping').catch(()=>({})),
        ]);
        fieldMap = fMap;
        const empOptions = state.employees.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
        const mappingRows = Object.entries(state.scoroMapping||{}).map(([empId,scoroId])=>{
            const emp = state.employees.find(e=>e.id===empId);
            return `<tr data-emp-id="${escapeHtml(empId)}">
                <td>${escapeHtml(emp?.name||empId)}</td><td>${escapeHtml(scoroId)}</td>
                <td><button class="btn-icon danger" onclick="removeScoroMapping('${escapeHtml(empId)}')">✕</button></td>
            </tr>`;
        }).join('');

        // Load webhook logs for field mapper
        webhookLogs = await apiRequest('/webhook-logs').catch(()=>[]);
        const allFields = new Set();
        webhookLogs.forEach(log => {
            if (log.fields) log.fields.forEach(f=>allFields.add(f));
            if (log.payload) collectNestedKeys(log.payload,'',allFields);
        });
        const scoroFields = Array.from(allFields);
        const customFields = fieldMap._custom || [];

        content.innerHTML = `
            <div class="settings-card">
                <h3>Project Field Mapping</h3>
                <p class="setting-description">Map Scoro project fields to OMWANDI fields. Send a test webhook from Scoro first to populate the available fields.</p>
                ${scoroFields.length === 0
                    ? `<p class="muted">No webhook data captured yet. Register <code>/webhook</code> in Scoro → Settings → Webhooks and trigger a project event.</p>`
                    : `<table class="timesheet-table" style="margin-bottom:1rem" id="fieldMapTable">
                        <thead><tr><th>OMWANDI Field</th><th></th><th>Scoro Field</th><th>Sample Value</th><th></th></tr></thead>
                        <tbody id="standardFieldRows">
                            ${APP_FIELDS.map(f=>{
                                const cur = fieldMap[f.key]||'';
                                const opts = scoroFields.map(sf=>`<option value="${escapeHtml(sf)}" ${sf===cur?'selected':''}>${escapeHtml(sf)}</option>`).join('');
                                const sample = cur&&webhookLogs[0]?.payload ? escapeHtml(String(getScoroValue(webhookLogs[0].payload,cur)||'')) : '';
                                return `<tr>
                                    <td><strong>${escapeHtml(f.label)}</strong><div class="muted">${escapeHtml(f.key)}</div></td>
                                    <td class="arrow-cell">→</td>
                                    <td><select class="form-control field-map-select" data-app-field="${escapeHtml(f.key)}">
                                        <option value="">— Not mapped —</option>${opts}
                                    </select></td>
                                    <td class="muted sample-cell">${sample}</td>
                                    <td></td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                        <tbody id="customFieldRows">
                            ${customFields.map((cf,idx)=>{
                                const opts = scoroFields.map(sf=>`<option value="${escapeHtml(sf)}" ${sf===(cf.scoroField||'')?'selected':''}>${escapeHtml(sf)}</option>`).join('');
                                const sample = cf.scoroField&&webhookLogs[0]?.payload ? escapeHtml(String(getScoroValue(webhookLogs[0].payload,cf.scoroField)||'')) : '';
                                return `<tr data-custom-idx="${idx}">
                                    <td>
                                        <input type="text" class="form-control custom-field-label" value="${escapeHtml(cf.label)}" placeholder="Label" style="margin-bottom:.3rem"/>
                                        <input type="text" class="form-control custom-field-key" value="${escapeHtml(cf.key)}" placeholder="Key" style="font-size:.75rem"/>
                                    </td>
                                    <td class="arrow-cell">→</td>
                                    <td><select class="form-control field-map-select" data-app-field="${escapeHtml(cf.key)}" data-custom="true">
                                        <option value="">— Not mapped —</option>${opts}
                                    </select></td>
                                    <td class="muted sample-cell">${sample}</td>
                                    <td><button class="btn-icon danger" onclick="this.closest('tr').remove()">✕</button></td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                        <tbody><tr><td colspan="5">
                            <button class="btn outline" style="width:100%;margin-top:.5rem" onclick="addCustomField()">+ Add Custom Field</button>
                        </td></tr></tbody>
                    </table>
                    <button class="btn primary" onclick="saveFieldMap()">Save Field Mapping</button>`
                }
            </div>

            <div class="settings-card">
                <h3>Employee Scoro IDs</h3>
                <p class="setting-description">Map employees to their Scoro user IDs for time sync.</p>
                <table class="timesheet-table" style="margin-bottom:1rem">
                    <thead><tr><th>Employee</th><th>Scoro ID</th><th></th></tr></thead>
                    <tbody id="scoroMappingBody">${mappingRows||'<tr><td colspan="3" class="empty-state">No mappings yet.</td></tr>'}</tbody>
                </table>
                <div class="scoro-add-row">
                    <select id="scoroEmpSelect" class="form-control"><option value="">— Select employee —</option>${empOptions}</select>
                    <input type="text" id="scoroIdInput" class="form-control" placeholder="Scoro User ID"/>
                    <button class="btn primary" onclick="addScoroMapping()">Add</button>
                </div>
                <button class="btn primary" style="margin-top:1rem" onclick="saveScoroMapping()">Save Mapping</button>
            </div>`;
        return;
    }

    if (tab === 'webhooks') {
        webhookLogs = await apiRequest('/webhook-logs').catch(()=>[]);
        content.innerHTML = `
            <div class="settings-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
                    <div>
                        <h3 style="margin:0">Webhook Logs</h3>
                        <p class="muted" style="margin:.25rem 0 0">Webhook URL: <code>/webhook</code></p>
                    </div>
                    <button class="btn outline" onclick="refreshWebhookLogs()">↻ Refresh</button>
                </div>
                <div id="webhookLogsArea">${renderLogs(webhookLogs)}</div>
            </div>`;
        return;
    }

    if (tab === 'timerules') {
        const [rules, holidays] = await Promise.all([
            apiRequest('/settings/time-rules').catch(()=>({})),
            apiRequest('/holidays').catch(()=>[]),
        ]);
        const r = Object.assign({
            normalStart:'07:00', normalEnd:'17:00', teaStart:'10:00', teaEnd:'10:15',
            lunchStart:'13:00', lunchEnd:'14:00', fridayEnd:'16:00',
            afterHoursRate:'overtime', saturdayRate:'overtime', sundayRate:'double', holidayRate:'double',
            rateNormal:1, rateOvertime:1.5, rateDouble:2
        }, rules);
        const holRows = holidays.sort((a,b)=>a.date.localeCompare(b.date)).map(h=>`
            <tr data-id="${escapeHtml(h.id)}">
                <td>${escapeHtml(h.date)}</td>
                <td>${escapeHtml(h.name||'')}</td>
                <td><button class="btn-icon danger" onclick="deleteHoliday('${escapeHtml(h.id)}')">🗑</button></td>
            </tr>`).join('');
        content.innerHTML = `
            <div class="settings-card">
                <h3>Working Hours</h3>
                <p class="setting-description">Normal working window for weekdays. Hours outside this are classified automatically.</p>
                <div style="display:flex;gap:1rem;flex-wrap:wrap">
                    <div class="form-group" style="flex:1;min-width:120px"><label>Normal Start</label><input type="time" id="trNormalStart" class="form-control" value="${r.normalStart}"></div>
                    <div class="form-group" style="flex:1;min-width:120px"><label>Mon–Thu End</label><input type="time" id="trNormalEnd" class="form-control" value="${r.normalEnd}"></div>
                    <div class="form-group" style="flex:1;min-width:120px"><label>Friday End</label><input type="time" id="trFridayEnd" class="form-control" value="${r.fridayEnd}"></div>
                </div>
                <div style="display:flex;gap:1rem;flex-wrap:wrap">
                    <div class="form-group" style="flex:1;min-width:120px"><label>Tea Time Start</label><input type="time" id="trTeaStart" class="form-control" value="${r.teaStart}"></div>
                    <div class="form-group" style="flex:1;min-width:120px"><label>Tea Time End</label><input type="time" id="trTeaEnd" class="form-control" value="${r.teaEnd}"></div>
                </div>
                <div style="display:flex;gap:1rem;flex-wrap:wrap">
                    <div class="form-group" style="flex:1;min-width:120px"><label>Lunch Start</label><input type="time" id="trLunchStart" class="form-control" value="${r.lunchStart}"></div>
                    <div class="form-group" style="flex:1;min-width:120px"><label>Lunch End</label><input type="time" id="trLunchEnd" class="form-control" value="${r.lunchEnd}"></div>
                </div>
            </div>
            <div class="settings-card">
                <h3>Rate Classification</h3>
                <table class="timesheet-table">
                    <thead><tr><th>Condition</th><th>Classification</th></tr></thead>
                    <tbody>
                        <tr><td>Mon–Thu ${r.normalStart}–${r.normalEnd}</td><td><span class="rate-badge normal">Normal Time</span></td></tr>
                        <tr><td>Friday ${r.normalStart}–${r.fridayEnd} (no lunch)</td><td><span class="rate-badge normal">Normal Time</span></td></tr>
                        <tr><td>Tea ${r.teaStart}–${r.teaEnd}</td><td><span class="rate-badge tea">Tea Time</span></td></tr>
                        <tr><td>Lunch ${r.lunchStart}–${r.lunchEnd} (Mon–Thu only)</td><td><span class="rate-badge tea">Lunch</span></td></tr>
                        <tr><td>Weekday after ${r.normalEnd}</td><td><select class="form-control rate-select" id="trAfterHours">
                            <option value="normal" ${(r.afterHoursRate)==='normal'?'selected':''}>Normal Time</option>
                            <option value="overtime" ${(r.afterHoursRate)==='overtime'?'selected':''}>Overtime</option>
                            <option value="double" ${(r.afterHoursRate)==='double'?'selected':''}>Double Time</option>
                        </select></td></tr>
                        <tr><td>Saturday (all day)</td><td><select class="form-control rate-select" id="trSaturday">
                            <option value="normal" ${(r.saturdayRate)==='normal'?'selected':''}>Normal Time</option>
                            <option value="overtime" ${(r.saturdayRate)==='overtime'?'selected':''}>Overtime</option>
                            <option value="double" ${(r.saturdayRate)==='double'?'selected':''}>Double Time</option>
                        </select></td></tr>
                        <tr><td>Sunday (all day)</td><td><select class="form-control rate-select" id="trSunday">
                            <option value="normal" ${(r.sundayRate)==='normal'?'selected':''}>Normal Time</option>
                            <option value="overtime" ${(r.sundayRate)==='overtime'?'selected':''}>Overtime</option>
                            <option value="double" ${(r.sundayRate)==='double'?'selected':''}>Double Time</option>
                        </select></td></tr>
                        <tr><td>Public Holiday</td><td><select class="form-control rate-select" id="trHoliday">
                            <option value="normal" ${(r.holidayRate)==='normal'?'selected':''}>Normal Time</option>
                            <option value="overtime" ${(r.holidayRate)==='overtime'?'selected':''}>Overtime</option>
                            <option value="double" ${(r.holidayRate)==='double'?'selected':''}>Double Time</option>
                        </select></td></tr>
                    </tbody>
                </table>
                <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:1rem">
                    <div class="form-group" style="flex:1;min-width:120px"><label>Overtime Multiplier</label><input type="number" step="0.1" id="trRateOt" class="form-control" value="${r.rateOvertime}"></div>
                    <div class="form-group" style="flex:1;min-width:120px"><label>Double Time Multiplier</label><input type="number" step="0.1" id="trRateDt" class="form-control" value="${r.rateDouble}"></div>
                </div>
                <button class="btn primary" onclick="saveTimeRules()">Save Time Rules</button>
            </div>
            <div class="settings-card">
                <h3>Public Holidays</h3>
                <p class="setting-description">Days classified as Double Time. Add all public holidays for the year.</p>
                <div class="scoro-add-row">
                    <input type="date" id="holDate" class="form-control">
                    <input type="text" id="holName" class="form-control" placeholder="Holiday name (e.g. Independence Day)">
                    <button class="btn primary" onclick="addHoliday()">+ Add</button>
                </div>
                <table class="timesheet-table" style="margin-top:1rem">
                    <thead><tr><th>Date</th><th>Name</th><th></th></tr></thead>
                    <tbody id="holidaysBody">${holRows||'<tr><td colspan="3" class="empty-state">No holidays added.</td></tr>'}</tbody>
                </table>
            </div>`;
        return;
    }

    if (tab === 'hr') {
        content.innerHTML = `
            <div class="settings-card">
                <h3>HR Dispatch</h3>
                <p class="setting-description">Export time data to CSV for HR reporting.</p>
                <div class="form-group"><label>From Date</label><input type="date" id="hrDispatchStart" class="form-control"/></div>
                <div class="form-group"><label>To Date</label><input type="date" id="hrDispatchEnd" class="form-control"/></div>
                <button class="btn primary" onclick="triggerHrDispatch()">Generate Report</button>
                <div id="hrDispatchResult" style="margin-top:1rem"></div>
            </div>`;
        return;
    }
}

function renderDropdownCard(type, title, description, items) {
    const chips = items.map(item=>`
        <div class="ref-chip" data-id="${escapeHtml(item.id)}" data-type="${type}">
            <span class="ref-chip-label">${escapeHtml(item.name)}</span>
            <button class="ref-chip-edit" onclick="editRefItem('${type}','${escapeHtml(item.id)}','${escapeHtml(item.name)}')" title="Edit">✏️</button>
            <button class="ref-chip-del" onclick="deleteRefItem('${type}','${escapeHtml(item.id)}')" title="Delete">🗑</button>
        </div>`).join('');
    return `
        <div class="settings-card">
            <h3>${title}</h3>
            <p class="setting-description">${description}</p>
            <div class="ref-add-row" style="margin-bottom:1rem">
                <input type="text" class="form-control" id="ref-input-${type}" placeholder="e.g., ${items[0]?.name||'Add new...'}" />
                <button class="btn primary" onclick="addRefItem('${type}')">+ Add</button>
            </div>
            <div class="ref-chips" id="ref-chips-${type}">${chips||'<p class="muted" style="font-size:.85rem">No items yet.</p>'}</div>
        </div>`;
}

function renderLogs(logs) {
    if (!logs.length) return `<p class="empty-state">No webhooks received yet.</p>`;
    return logs.map(log=>`
        <div class="webhook-log-entry glass-panel" style="margin-bottom:.75rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
                <span class="muted">${escapeHtml(log.received_at)}</span>
                <span class="badge-pill">${escapeHtml(String(log.fields?.length||0))} fields</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.65rem">
                ${(log.fields||[]).map(f=>`<span class="field-pill">${escapeHtml(f)}</span>`).join('')}
            </div>
            <details>
                <summary class="muted" style="cursor:pointer;font-size:.8rem">View raw payload</summary>
                <pre class="payload-pre">${escapeHtml(JSON.stringify(log.payload,null,2))}</pre>
            </details>
        </div>`).join('');
}

function collectNestedKeys(obj, prefix, result) {
    for (const [k,v] of Object.entries(obj||{})) {
        const key = prefix ? prefix+'.'+k : k;
        if (Array.isArray(v) && v.length>0 && v[0]?.id && 'value' in v[0]) {
            v.forEach(item=>{ if(item.id) result.add(key+'.'+item.id); });
        } else {
            result.add(key);
            if (v && typeof v==='object' && !Array.isArray(v)) collectNestedKeys(v,key,result);
        }
    }
}

function getScoroValue(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur===null||cur===undefined) return undefined;
        if (Array.isArray(cur) && cur[0]?.id!==undefined) { cur=cur.find(i=>i.id===p)?.value; }
        else { cur=cur[p]; }
    }
    return cur;
}

// ── Global handlers ───────────────────────────────────────────────────────────

window.switchSettingsTab = function(tab) {
    activeTab = tab;
    document.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().replace(' ','')===tab||b.onclick?.toString().includes(`'${tab}'`)));
    const isAdmin = state.userRole==='Administrator';
    const me = state.employees.find(e=>e.id===state.activeProfileId);
    // Update active tab styling
    document.querySelectorAll('.settings-tab').forEach(b => {
        const match = b.getAttribute('onclick')?.includes(`'${tab}'`);
        b.classList.toggle('active', match);
    });
    loadSettingsTab(tab, isAdmin, me);
};

window.addRefItem = async function(type) {
    const input = document.getElementById('ref-input-'+type);
    const name = input?.value?.trim();
    if (!name) { showNotification('Enter a name first','warning'); return; }
    try {
        const item = await apiRequest('/ref/'+type,{method:'POST',body:JSON.stringify({name})});
        const container = document.getElementById('ref-chips-'+type);
        if (container) {
            const empty = container.querySelector('.muted'); if(empty) empty.remove();
            const div = document.createElement('div');
            div.className='ref-chip'; div.dataset.id=item.id; div.dataset.type=type;
            div.innerHTML=`<span class="ref-chip-label">${escapeHtml(item.name)}</span>
                <button class="ref-chip-edit" onclick="editRefItem('${type}','${escapeHtml(item.id)}','${escapeHtml(item.name)}')" title="Edit">✏️</button>
                <button class="ref-chip-del" onclick="deleteRefItem('${type}','${escapeHtml(item.id)}')" title="Delete">🗑</button>`;
            container.appendChild(div);
        }
        input.value='';
        showNotification(`Added to ${type}`,'success');
    } catch(e) { showNotification('Failed: '+e.message,'error'); }
};

window.editRefItem = async function(type, id, currentName) {
    const newName = prompt('Edit:',currentName);
    if (!newName?.trim()||newName.trim()===currentName) return;
    try {
        await apiRequest(`/ref/${type}/${id}`,{method:'PUT',body:JSON.stringify({name:newName.trim()})});
        const chip = document.querySelector(`.ref-chip[data-id="${id}"] .ref-chip-label`);
        if (chip) chip.textContent=newName.trim();
        showNotification('Updated','success');
    } catch(e) { showNotification('Failed: '+e.message,'error'); }
};

window.deleteRefItem = async function(type, id) {
    if (!confirm('Delete this item?')) return;
    try {
        await apiRequest(`/ref/${type}/${id}`,{method:'DELETE'});
        document.querySelector(`.ref-chip[data-id="${id}"]`)?.remove();
        showNotification('Deleted','success');
    } catch(e) { showNotification('Failed: '+e.message,'error'); }
};

window.refreshWebhookLogs = async function() {
    const area = document.getElementById('webhookLogsArea');
    if (area) area.innerHTML='<p class="muted">Loading...</p>';
    webhookLogs = await apiRequest('/webhook-logs').catch(()=>[]);
    if (area) area.innerHTML=renderLogs(webhookLogs);
};

window.addCustomField = function() {
    const tbody = document.getElementById('customFieldRows'); if(!tbody) return;
    const allFields = Array.from(document.querySelectorAll('.field-map-select option:not([value=""])'))
        .map(o=>o.value).filter((v,i,a)=>a.indexOf(v)===i);
    const opts = allFields.map(f=>`<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
    const tr = document.createElement('tr');
    tr.innerHTML=`<td>
        <input type="text" class="form-control custom-field-label" placeholder="Label" style="margin-bottom:.3rem"/>
        <input type="text" class="form-control custom-field-key" placeholder="Key (no spaces)" style="font-size:.75rem"/>
    </td>
    <td class="arrow-cell">→</td>
    <td><select class="form-control field-map-select" data-app-field="" data-custom="true">
        <option value="">— Not mapped —</option>${opts}
    </select></td>
    <td class="muted sample-cell"></td>
    <td><button class="btn-icon danger" onclick="this.closest('tr').remove()">✕</button></td>`;
    tr.querySelector('.custom-field-key').addEventListener('input',function(){
        tr.querySelector('.field-map-select').dataset.appField=this.value.trim().replace(/\s+/g,'_');
    });
    tbody.appendChild(tr);
};

window.saveFieldMap = async function() {
    const map={};
    document.querySelectorAll('#standardFieldRows .field-map-select').forEach(sel=>{ if(sel.value) map[sel.dataset.appField]=sel.value; });
    const custom=[];
    document.querySelectorAll('#customFieldRows tr').forEach(row=>{
        const label=row.querySelector('.custom-field-label')?.value?.trim();
        const key=row.querySelector('.custom-field-key')?.value?.trim().replace(/\s+/g,'_');
        const scoro=row.querySelector('.field-map-select')?.value;
        if(label&&key){ custom.push({label,key,scoroField:scoro||''}); if(scoro) map[key]=scoro; }
    });
    map._custom=custom; fieldMap=map;
    try {
        await apiRequest('/settings/scoro-field-map',{method:'POST',body:JSON.stringify(map)});
        showNotification('Field mapping saved','success');
    } catch(e) { showNotification('Failed: '+e.message,'error'); }
};

window.addScoroMapping = function() {
    const empId=document.getElementById('scoroEmpSelect').value;
    const scoroId=document.getElementById('scoroIdInput').value.trim();
    if(!empId||!scoroId){ showNotification('Select employee and enter Scoro ID','warning'); return; }
    state.scoroMapping[empId]=scoroId;
    document.getElementById('scoroIdInput').value='';
    const emp=state.employees.find(e=>e.id===empId);
    const tbody=document.getElementById('scoroMappingBody');
    if(tbody?.querySelector('.empty-state')) tbody.innerHTML='';
    const tr=document.createElement('tr'); tr.dataset.empId=empId;
    tr.innerHTML=`<td>${escapeHtml(emp?.name||empId)}</td><td>${escapeHtml(scoroId)}</td>
        <td><button class="btn-icon danger" onclick="removeScoroMapping('${escapeHtml(empId)}')">✕</button></td>`;
    tbody?.appendChild(tr);
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

window.saveTimeRules = async function() {
    const payload = {
        normalStart: document.getElementById('trNormalStart').value,
        normalEnd:   document.getElementById('trNormalEnd').value,
        fridayEnd:   document.getElementById('trFridayEnd').value,
        teaStart:    document.getElementById('trTeaStart').value,
        teaEnd:      document.getElementById('trTeaEnd').value,
        lunchStart:  document.getElementById('trLunchStart').value,
        lunchEnd:    document.getElementById('trLunchEnd').value,
        afterHoursRate: document.getElementById('trAfterHours').value,
        saturdayRate:   document.getElementById('trSaturday').value,
        sundayRate:     document.getElementById('trSunday').value,
        holidayRate:    document.getElementById('trHoliday').value,
        rateNormal:1,
        rateOvertime: parseFloat(document.getElementById('trRateOt').value) || 1.5,
        rateDouble:   parseFloat(document.getElementById('trRateDt').value) || 2,
    };
    try {
        await apiRequest('/settings/time-rules', { method:'POST', body:JSON.stringify(payload) });
        showNotification('Time rules saved', 'success');
        switchSettingsTab('timerules');
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.addHoliday = async function() {
    const date = document.getElementById('holDate').value;
    const name = document.getElementById('holName').value.trim();
    if (!date) { showNotification('Pick a date first', 'warning'); return; }
    try {
        const item = await apiRequest('/holidays', { method:'POST', body:JSON.stringify({ date, name }) });
        const tbody = document.getElementById('holidaysBody');
        if (tbody.querySelector('.empty-state')) tbody.innerHTML = '';
        const tr = document.createElement('tr'); tr.dataset.id = item.id;
        tr.innerHTML = `<td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.name||'')}</td>
            <td><button class="btn-icon danger" onclick="deleteHoliday('${escapeHtml(item.id)}')">🗑</button></td>`;
        tbody.appendChild(tr);
        document.getElementById('holName').value = '';
        document.getElementById('holDate').value = '';
        showNotification('Holiday added', 'success');
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.deleteHoliday = async function(id) {
    if (!confirm('Delete this holiday?')) return;
    try {
        await apiRequest(`/holidays/${id}`, { method:'DELETE' });
        document.querySelector(`tr[data-id="${id}"]`)?.remove();
        showNotification('Deleted', 'success');
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.triggerHrDispatch = async function() {
    const resultEl=document.getElementById('hrDispatchResult');
    resultEl.innerHTML='<span class="muted">Generating...</span>';
    try {
        const r=await apiRequest('/hr/dispatch',{method:'POST',body:JSON.stringify({
            startDate:document.getElementById('hrDispatchStart')?.value||'',
            endDate:document.getElementById('hrDispatchEnd')?.value||''
        })});
        resultEl.innerHTML=`<div class="dispatch-result">
            <div>✅ Report generated</div>
            <div class="muted">Transaction: ${escapeHtml(r.transactionId||'')}</div>
            <div class="muted">${escapeHtml(String(r.recordCount||0))} records · ${escapeHtml(String((r.totalHours||0).toFixed(2)))}h</div>
        </div>`;
    } catch(e) { resultEl.innerHTML=`<div class="error-text">Failed: ${escapeHtml(e.message)}</div>`; }
};
