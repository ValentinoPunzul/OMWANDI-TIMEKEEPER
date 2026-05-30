// views/header.js
import { state } from '../state.js';
import { escapeHtml } from '../utils.js';

export function renderViewHeader(title) {
    const me = state.employees.find(e => e.id === state.activeProfileId);
    const titleHtml = `<h2>${escapeHtml(title)}</h2>`;
    const logoutBtn = `<button class="btn outline" onclick="handleLogout()">Logout</button>`;
    return `<div class="view-header">${titleHtml}${logoutBtn}</div>`;
}