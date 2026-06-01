// views/projects.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

// Sort & filter state
let _projSortCol = 'proj_no';
let _projSortDir = 'asc';
let _projFilterStatus = '';
let _projFilterClient = '';
let _projFilterVessel = '';
let _projFilterForeman = '';
let _projSearch = '';

export async function renderProjects() {
    const main = document.getElementById('mainContent');
    const isAdmin = state.userRole === 'Administrator';

    // Load custom field definitions from saved field map
    let customFields = [];
    try {
        const fm = await apiRequest('/settings/scoro-field-map').catch(() => ({}));
        customFields = fm._custom || [];
    } catch(e) {}

    // Apply search, filter, sort
    let projects = [...state.projects];

    if (_projSearch) {
        const q = _projSearch.toLowerCase();
        projects = projects.filter(p =>
            p.name?.toLowerCase().includes(q) ||
            p.proj_no?.toLowerCase().includes(q) ||
            p.client?.toLowerCase().includes(q)
        );
    }
    if (_projFilterStatus) projects = projects.filter(p => (p.project_status||p.status_name||p.status||'') === _projFilterStatus);
    if (_projFilterClient) projects = projects.filter(p => p.client === _projFilterClient);
    if (_projFilterVessel) projects = projects.filter(p => p.vessel_name === _projFilterVessel);
    if (_projFilterForeman) projects = projects.filter(p => p.project_foreman === _projFilterForeman);

    projects.sort((a, b) => {
        let cmp = 0;
        if (_projSortCol === 'proj_no')   cmp = (a.proj_no||'').localeCompare(b.proj_no||'');
        else if (_projSortCol === 'name') cmp = (a.name||'').localeCompare(b.name||'');
        else if (_projSortCol === 'client') cmp = (a.client||'').localeCompare(b.client||'');
        else if (_projSortCol === 'status') cmp = (a.project_status||a.status_name||a.status||'').localeCompare(b.project_status||b.status_name||b.status||'');
        else if (_projSortCol === 'budget') cmp = (a.budget_hours||0) - (b.budget_hours||0);
        else if (_projSortCol === 'burned') {
            const ba = state.timeEntries.filter(e=>e.project_id===a.id&&e.total_hours>0).reduce((s,e)=>s+e.total_hours,0);
            const bb = state.timeEntries.filter(e=>e.project_id===b.id&&e.total_hours>0).reduce((s,e)=>s+e.total_hours,0);
            cmp = ba - bb;
        }
        return _projSortDir === 'asc' ? cmp : -cmp;
    });

    // Build unique client and status lists for filters
    const clients  = [...new Set(state.projects.map(p=>p.client).filter(Boolean))].sort();
    const vessels  = [...new Set(state.projects.map(p=>p.vessel_name).filter(Boolean))].sort();
    const vesselOptions = vessels.map(v=>`<option value="${escapeHtml(v)}" ${_projFilterVessel===v?'selected':''}>${escapeHtml(v)}</option>`).join('');
    const foremans = [...new Set(state.projects.map(p=>p.project_foreman).filter(Boolean))].sort();
    const foremanOptions = foremans.map(f=>`<option value="${escapeHtml(f)}" ${_projFilterForeman===f?'selected':''}>${escapeHtml(f)}</option>`).join('');
    const statuses = [...new Set(state.projects.map(p=>p.status_name||p.status).filter(Boolean))].sort();

    const clientOptions  = clients.map(c=>`<option value="${escapeHtml(c)}" ${_projFilterClient===c?'selected':''}>${escapeHtml(c)}</option>`).join('');
    const statusOptions  = statuses.map(s=>{
        const key = state.projects.find(p=>(p.status_name||p.status)===s)?.status||s;
        return `<option value="${escapeHtml(key)}" ${_projFilterStatus===key?'selected':''}>${escapeHtml(s)}</option>`;
    }).join('');

    const sortCols = [
        {val:'proj_no',label:'Project No'},
        {val:'name',   label:'Name'},
        {val:'client', label:'Client'},
        {val:'status', label:'Status'},
        {val:'budget', label:'Budget'},
        {val:'burned', label:'Hours Logged'},
    ];
    const sortOptions = sortCols.map(c=>`<option value="${c.val}" ${_projSortCol===c.val?'selected':''}>${c.label}</option>`).join('');

    const cards = projects.map(p => {
        const burned = state.timeEntries.filter(e => e.project_id === p.id && e.total_hours > 0).reduce((s,e) => s + e.total_hours, 0);
        const budget = p.budget_hours || 0;
        const pct = budget > 0 ? Math.min((burned / budget) * 100, 100) : 0;
        const statusClass = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'ok';
        const color = escapeHtml(p.color || '#1d4ed8');

        // Build extra fields rows
        const extraRows = [];
        if (p.vessel_name) extraRows.push(`<div class="custom-field-row"><span class="custom-field-label">Vessel</span><span class="custom-field-value">${escapeHtml(p.vessel_name)}</span></div>`);
        customFields.filter(cf => p[cf.key]).forEach(cf => {
            extraRows.push(`<div class="custom-field-row"><span class="custom-field-label">${escapeHtml(cf.label)}</span><span class="custom-field-value">${escapeHtml(String(p[cf.key]))}</span></div>`);
        });

        return `
        <div class="project-card glass-panel">
            <div class="project-card-header">
                
                <div class="project-info">
                    <div class="project-name">${p.proj_no ? '[' + escapeHtml(p.proj_no) + '] ' : ''}${escapeHtml(p.name)}</div>
                    <div class="project-meta">${escapeHtml(p.client || '')}</div>
                </div>
                ${isAdmin ? `<div class="project-actions">
                    <button class="btn-icon" onclick="editProject('${escapeHtml(p.id)}')">✏️</button>
                    <button class="btn-icon danger" onclick="deleteProject('${escapeHtml(p.id)}')">🗑️</button>
                </div>` : ''}
            </div>
            ${p.open_project
                ? `<div class="budget-row">
                    <span class="budget-label">Budget</span>
                    <span class="open-project-badge">Open Project</span>
                    <span class="budget-value ok" style="margin-left:auto">${burned.toFixed(1)}h logged</span>
                   </div>`
                : `<div class="budget-row">
                    <span class="budget-label">Budget</span>
                    <span class="budget-value ${statusClass}">${burned.toFixed(1)}h / ${budget > 0 ? budget + 'h' : '—'}</span>
                   </div>
                   ${budget > 0 ? `<div class="progress-bar-bg"><div class="progress-bar-fill ${statusClass}" style="width:${pct.toFixed(1)}%"></div></div>` : ''}`
            }
            ${extraRows.length ? `<div class="project-custom-fields">${extraRows.join('')}</div>` : ''}
        </div>`;
    }).join('');

    main.innerHTML = `
        ${renderViewHeader('Projects')}
        <div class="projects-filter-bar glass-panel">
            <input type="text" class="form-control" id="projSearch" placeholder="Search name, number, client..." value="${escapeHtml(_projSearch)}" oninput="applyProjectFilters()" style="flex:2;min-width:160px" />
            <select class="form-control" id="projFilterClient" onchange="applyProjectFilters()" style="flex:1;min-width:120px">
                <option value="">All Clients</option>${clientOptions}
            </select>
            <select class="form-control" id="projFilterVessel" onchange="applyProjectFilters()" style="flex:1;min-width:130px">
                <option value="">All Vessels</option>${vesselOptions}
            </select>
            <select class="form-control" id="projFilterForeman" onchange="applyProjectFilters()" style="flex:1;min-width:140px">
                <option value="">All Foremen</option>${foremanOptions}
            </select>
            <select class="form-control" id="projFilterStatus" onchange="applyProjectFilters()" style="flex:1;min-width:120px">
                <option value="">All Statuses</option>
            </select>
            <select class="form-control" id="projSortCol" onchange="applyProjectFilters()" style="min-width:130px">
                ${sortOptions}
            </select>
            <button class="btn outline proj-sort-dir" id="projSortDirBtn" onclick="toggleProjectSortDir()" title="Toggle sort direction">
                ${_projSortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
            </button>
            ${isAdmin ? `<button class="btn primary" onclick="openProjEditModal()">+ New Project</button>` : ''}
            ${(_projSearch||_projFilterClient||_projFilterVessel||_projFilterForeman||_projFilterStatus) ? `<button class="btn outline" onclick="clearProjectFilters()">✕ Clear</button>` : ''}
        </div>
        <div class="project-grid" id="projectGrid">${cards || '<p class="empty-state">No projects match your filters.</p>'}</div>
        <div id="projEditModal" class="modal-overlay" style="display:none">
            <div class="modal glass-panel">
                <h3 id="projEditTitle">New Project</h3>
                <input type="hidden" id="projEditId" />
                <div class="form-group"><label>Project Name *</label><input type="text" id="projEditName" class="form-control" /></div>
                <div class="form-group"><label>Project Number</label><input type="text" id="projEditNumber" class="form-control" /></div>
                <div class="form-group"><label>Client</label><input type="text" id="projEditClient" class="form-control" /></div>
                <div class="form-group"><label>Status</label><input type="text" id="projEditStatus" class="form-control" placeholder="e.g. Busy with Work" /></div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="projEditOpenProject" onchange="toggleOpenProject(this)" />
                        <span>Open Project (no budget limit)</span>
                    </label>
                </div>
                <div class="form-group" id="projBudgetGroup">
                    <label>Budget Hours</label>
                    <input type="number" id="projEditBudget" class="form-control" min="0" step="0.5" />
                </div>
                <div class="form-group"><label>Colour</label>
                    <div class="color-picker" id="projEditColor">
                        ${['#1d4ed8','#7c3aed','#db2777','#e11d48','#ea580c','#ca8a04','#16a34a','#0891b2'].map(c =>
                            `<label class="color-swatch" style="background:${c}"><input type="radio" name="projColor" value="${c}" ${c==='#1d4ed8'?'checked':''} /></label>`).join('')}
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn outline" onclick="closeProjEditModal()">Cancel</button>
                    <button class="btn primary" onclick="saveProjEdit()">Save</button>
                </div>
            </div>
        </div>`;
}

// Called after renderProjects sets main.innerHTML
function _postRenderProjects() { populateStatusFilter(); }

window.toggleOpenProject = function(cb) {
    const bg = document.getElementById('projBudgetGroup');
    if (bg) bg.style.display = cb.checked ? 'none' : 'block';
};

function populateStatusFilter() {
    const sel = document.getElementById('projFilterStatus');
    if (!sel) return;
    const statuses = [...new Set(state.projects.map(p => p.project_status || p.status_name || p.status).filter(Boolean))].sort();
    // Remove old options except first
    while (sel.options.length > 1) sel.remove(1);
    statuses.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (s === _projFilterStatus) opt.selected = true;
        sel.appendChild(opt);
    });
}

window.applyProjectFilters = function() {
    populateStatusFilter();
    _projSearch       = document.getElementById('projSearch')?.value || '';
    _projFilterClient = document.getElementById('projFilterClient')?.value || '';
    _projFilterVessel  = document.getElementById('projFilterVessel')?.value  || '';
    _projFilterForeman = document.getElementById('projFilterForeman')?.value || '';
    _projFilterStatus = document.getElementById('projFilterStatus')?.value || '';
    _projSortCol      = document.getElementById('projSortCol')?.value || 'proj_no';
    renderProjects();
};

window.toggleProjectSortDir = function() {
    _projSortDir = _projSortDir === 'asc' ? 'desc' : 'asc';
    renderProjects();
};

window.clearProjectFilters = function() {
    _projSearch = ''; _projFilterClient = ''; _projFilterVessel = ''; _projFilterForeman = ''; _projFilterStatus = '';
    renderProjects();
};

window.openProjEditModal = function(id=null) {
    document.getElementById('projEditTitle').textContent = id ? 'Edit Project' : 'New Project';
    document.getElementById('projEditId').value = id || '';
    if (id) {
        const p = state.projects.find(x => x.id === id);
        if (p) {
            document.getElementById('projEditName').value = p.name || '';
            document.getElementById('projEditNumber').value = p.proj_no || '';
            document.getElementById('projEditClient').value = p.client || '';
            document.getElementById('projEditStatus').value = p.project_status || p.status_name || p.status || '';
            document.getElementById('projEditBudget').value = p.budget_hours || '';
            const isOpen = p.open_project === true || p.open_project === 1;
            document.getElementById('projEditOpenProject').checked = isOpen;
            const bg = document.getElementById('projBudgetGroup');
            if (bg) bg.style.display = isOpen ? 'none' : 'block';
            const r = document.querySelector(`input[name="projColor"][value="${p.color}"]`);
            if (r) r.checked = true;
        }
    } else {
        ['projEditName','projEditNumber','projEditClient','projEditStatus','projEditBudget'].forEach(i => {
            const el = document.getElementById(i); if (el) el.value = '';
        });
        const cb = document.getElementById('projEditOpenProject'); if (cb) cb.checked = false;
        const bg = document.getElementById('projBudgetGroup'); if (bg) bg.style.display = 'block';
    }
    document.getElementById('projEditModal').style.display = 'flex';
};
window.closeProjEditModal = () => document.getElementById('projEditModal').style.display = 'none';
window.editProject = id => window.openProjEditModal(id);

window.saveProjEdit = async function() {
    const id = document.getElementById('projEditId').value;
    const name = document.getElementById('projEditName').value.trim();
    if (!name) { showNotification('Project name is required', 'warning'); return; }
    const isOpen = document.getElementById('projEditOpenProject')?.checked || false;
    const statusVal = document.getElementById('projEditStatus')?.value?.trim();
    const payload = { name,
        proj_no: document.getElementById('projEditNumber').value.trim(),
        client: document.getElementById('projEditClient').value.trim(),
        project_status: statusVal || '',
        budget_hours: isOpen ? 0 : (parseFloat(document.getElementById('projEditBudget').value) || 0),
        open_project: isOpen,
        color: document.querySelector('input[name="projColor"]:checked')?.value || '#1d4ed8' };
    try {
        if (id) {
            const u = await apiRequest(`/projects/${id}`, {method:'PUT', body:JSON.stringify(payload)});
            const i = state.projects.findIndex(p => p.id === id);
            if (i !== -1) state.projects[i] = (u && u.id) ? u : { ...state.projects[i], ...payload };
        } else {
            const created = await apiRequest('/projects', {method:'POST', body:JSON.stringify(payload)});
            state.projects.push(created);
        }
        window.closeProjEditModal(); await renderProjects(); showNotification('Project saved', 'success');
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};

window.deleteProject = async function(id) {
    if (!confirm('Delete this project?')) return;
    try {
        await apiRequest(`/projects/${id}`, {method:'DELETE'});
        state.projects = state.projects.filter(p => p.id !== id);
        renderProjects(); showNotification('Project deleted', 'success');
    } catch(e) { showNotification('Failed: ' + e.message, 'error'); }
};
