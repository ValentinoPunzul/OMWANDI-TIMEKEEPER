// timer.js
import { apiRequest } from './api.js';
import { state } from './state.js';
import { renderDashboard } from './views/dashboard.js';

export function startDashboardClock() {
    setInterval(() => {
        const timeEl = document.getElementById('dashboardTime');
        const dateEl = document.getElementById('dashboardDate');
        if (timeEl && dateEl) {
            const now = new Date();
            timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            const dow = now.toLocaleDateString(undefined, { weekday: 'long' });
            const dmy = String(now.getDate()).padStart(2,'0') + '/' + String(now.getMonth()+1).padStart(2,'0') + '/' + now.getFullYear();
            dateEl.textContent = dow + ', ' + dmy;
        }
    }, 1000);
}