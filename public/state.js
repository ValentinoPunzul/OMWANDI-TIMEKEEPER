// state.js

export const state = {
    employees: [],
    projects: [],
    timeEntries: [],
    timeEntriesOffset: 0,
    timeEntriesLimit: 100,
    hasMoreTimeEntries: true,
    activeProfileId: localStorage.getItem('chronos_user_id') || null,
    idToken: localStorage.getItem('chronos_id_token') || null,
    activeView: 'dashboard',
    isOnline: navigator.onLine,
    userRole: localStorage.getItem('chronos_user_role') || 'Employee',
    scoroMapping: {},
    timeRules: {},
    holidays: new Set(),
  };