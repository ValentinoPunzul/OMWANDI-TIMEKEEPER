// views/projects.js
import { state } from '../state.js';
import { apiRequest } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderViewHeader } from './header.js';

export function renderProjects() {
    const main = document.getElementById('mainContent');
    const isAdmin = state.userRole === 'Administrator';
    const cards = state.projects.map(p => {
        const burned = state.timeEntries.filter(e => e.project_id === p.id && e.total_hours > 0).reduce((s,e) => s + e.total_hours, 0);
        const budget = p.budget_hours || 0;
        const pct = budget > 0 ? Math.min((burned / budget) * 100, 100) : 0;
        const statusClass = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'ok';
        const color = escapeHtml(p.color || '#1d4ed8');
        return `
        <div class="project-card glass-panel">
            <div class="project-card-header">
                <div class="project-color-dot" style="background:${color}"></div>
                <div class="project-info">
                    <div class="project-name">${p.proj_no ? '[' + escapeHtml(p.proj_no) + '] ' : ''}${escapeHtml(p.name)}</div>
                    <div class="project-meta">${escapeHtml(p.client || '')}</div>
                </div>
                ${isAdmin ? `<div class="project-actions">
                    <button class="btn-icon" onclick="editProject('${escapeHtml(p.id)}')">✏️</button>
                    <button class="btn-icon danger" onclick="deleteProject('${escapeHtml(p.id)}')">🗑️</button>
                </div>` : ''}
            </div>
            <div class="budget-row">
                <span class="budget-label">Budget</span>
                <span class="budget-value ${statusClass}">${burned.toFixed(1)}h / ${budget > 0 ? budget + 'h' : '—'}</span>
            </div>
            ${budget > 0 ? `<div class="progress-bar-bg"><div class="progress-bar-fill ${statusClass}" style="width:${pct.toFixed(1)}%"></div></div>` : ''}
        </div>`;
    }).join('');
    main.innerHTML = `
        ${renderViewHeader('Projects')}
        <div class="view-toolbar">${isAdmin ? `<button class="btn primary" onclick="openProjectModal()">+ New Project</button>` : ''}</div>
        <div class="project-grid">${cards || '<p class="empty-state">No projects found.</p>'}</div>
        <div id="projectModal" class="modal-overlay" style="display:none">
            <div class="modal glass-panel">
                <h3 id="projectModalTitle">New Project</h3>
                <input type="hidden" id="projectModalId" />
                <div class="form-group"><label>Project Name *</label><input type="text" id="projectModalName" class="form-control" /></div>
                <div class="form-group"><label>Project Number</label><input type="text" id="projectModalNumber" class="form-control" /></div>
                <div class="form-group"><label>Client</label><input type="text" id="projectModalClient" class="form-control" /></div>
                <div class="form-group"><label>Budget Hours</label><input type="number" id="projectModalBudget" class="form-control" min="0" step="0.5" /></div>
                <div class="form-group"><label>Colour</label>
                    <div class="color-picker" id="projectModalColor">
                        ${['#1d4ed8','#7c3aed','#db2777','#e11d48','#ea580c','#ca8a04','#16a34a','#0891b2'].map(c =>
                            `<label class="color-swatch" style="background:${c}"><input type="radio" name="projColor" value="${c}" ${c==='#1d4ed8'?'checked':''} /></label>`).join('')}
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn outline" onclick="closeProjectModal()">Cancel</button>
                    <button class="btn primary" onclick="saveProject()">Save</button>
                </div>
            </div>
        </div>`;
}

window.openProjectModal = function(id=null) {
    document.getElementById('projectModalTitle').textContent = id ? 'Edit Project' : 'New Project';
    document.getElementById('projectModalId').value = id || '';
    if (id) {
        const p = state.projects.find(x => x.id === id);
        if (p) {
            document.getElementById('projectModalName').value = p.name || '';
            document.getElementById('projectModalNumber').value = p.proj_no || '';
            document.getElementById('projectModalClient').value = p.client || '';
            document.getElementById('projectModalBudget').value = p.budget_hours || '';
            const r = document.querySelector(`input[name="projColor"][value="${p.color}"]`);
            if (r) r.checked = true;
        }
    } else {
        ['projectModalName','projectModalNumber','projectModalClient','projectModalBudget'].forEach(i => document.getElementById(i).value = '');
    }
    document.getElementById('projectModal').style.display = 'flex';
};
window.closeProjectModal = () => document.getElementById('projectModal').style.display = 'none';
window.editProject = id => window.openProjectModal(id);

window.saveProject = async function() {
    const id = document.getElementById('projectModalId').value;
    const name = document.getElementById('projectModalName').value.trim();
    if (!name) { showNotification('Project name is required', 'warning'); return; }
    const payload = { name,
        proj_no: document.getElementById('projectModalNumber').value.trim(),
        client: document.getElementById('projectModalClient').value.trim(),
        budget_hours: parseFloat(document.getElementById('projectModalBudget').value) || 0,
        color: document.querySelector('input[name="projColor"]:checked')?.value || '#1d4ed8' };
    try {
        if (id) {
            const u = await apiRequest(`/projects/${id}`, {method:'PUT', body:JSON.stringify(payload)});
            const i = state.projects.findIndex(p => p.id === id); if (i !== -1) state.projects[i] = u;
        } else { state.projects.push(await apiRequest('/projects', {method:'POST', body:JSON.stringify(payload)})); }
        window.closeProjectModal(); renderProjects(); showNotification('Project saved', 'success');
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
