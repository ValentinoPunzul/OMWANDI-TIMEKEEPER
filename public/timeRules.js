// timeRules.js — classify worked time into Normal / Overtime / Double / Break
import { state } from './state.js';

function toMin(t) { const [h,m] = (t||'0:0').split(':').map(Number); return h*60 + m; }

// Returns { normal, overtime, double, brk } in decimal hours
export function classifyEntry(entry) {
    const res = { normal:0, overtime:0, double:0, brk:0 };
    if (!entry?.start_time || !entry?.end_time) return res;
    const start = new Date(entry.start_time);
    const end = new Date(entry.end_time);
    if (!(end > start)) return res;

    const r = state.timeRules || {};
    const nS = toMin(r.normalStart || '07:00');
    const nE = toMin(r.normalEnd   || '17:00');
    const teaS = toMin(r.teaStart  || '10:00'), teaE = toMin(r.teaEnd  || '10:15');
    const luS  = toMin(r.lunchStart|| '13:00'), luE  = toMin(r.lunchEnd || '14:00');
    const holidays = state.holidays || new Set();

    const totalMinutes = Math.min(Math.round((end - start) / 60000), 36 * 60); // cap 36h
    let t = new Date(start);
    for (let i = 0; i < totalMinutes; i++) {
        const dow = t.getDay();                       // 0 Sun … 6 Sat
        const mod = t.getHours() * 60 + t.getMinutes();
        const ds = t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
        const isHoliday = holidays.has(ds);

        let bucket;
        if (isHoliday || dow === 0)      bucket = 'double';     // Sunday / public holiday
        else if (dow === 6)              bucket = 'overtime';   // Saturday
        else {                                                  // weekday
            const inTea   = mod >= teaS && mod < teaE;
            const inLunch = mod >= luS  && mod < luE;
            if (inTea || inLunch)        bucket = 'brk';
            else if (mod >= nS && mod < nE) bucket = 'normal';
            else                         bucket = 'overtime';   // before start / after end
        }
        res[bucket]++;
        t = new Date(t.getTime() + 60000);
    }
    res.normal /= 60; res.overtime /= 60; res.double /= 60; res.brk /= 60;
    return res;
}
