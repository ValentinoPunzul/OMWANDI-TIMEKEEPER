const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize Firebase Admin SDK
let serviceAccount;
const saEnvVar = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.firebase_service_account;

if (saEnvVar) {
  try {
    serviceAccount = JSON.parse(saEnvVar);
    console.log('Firebase Service Account loaded from environment variable.');
  } catch (e) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable:', e.message);
  }
}

if (!serviceAccount) {
  try {
    const saPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(saPath)) {
      serviceAccount = require(saPath);
      console.log('Firebase Service Account loaded from local file.');
    }
  } catch (e) {
    // Silent catch if file doesn't exist
  }
}

if (serviceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://omwandi-timekeeping-default-rtdb.firebaseio.com"
    });
    console.log('Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error.message);
  }
} else {
  console.warn('WARNING: No Firebase Service Account credentials found. Database features will not work.');
}

const db = admin.apps.length ? admin.database() : null;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Ensure export directory exists
const DATA_DIR = path.join(__dirname, 'data');
const DISPATCH_DIR = path.join(DATA_DIR, 'hr_dispatched');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DISPATCH_DIR)) fs.mkdirSync(DISPATCH_DIR, { recursive: true });

// Utility to check if DB is initialized
const checkDb = (req, res, next) => {
    if (!db) return res.status(500).json({ error: 'Database not initialized' });
    next();
};

// ============================================
// API ROUTES
// ============================================

// 1. Employees APIs
app.get('/api/employees', checkDb, async (req, res) => {
  try {
    const snapshot = await db.ref('employees').once('value');
    res.json(Object.values(snapshot.val() || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/employees', checkDb, async (req, res) => {
  try {
    const { name, role, color, avatar, reports_to, emp_no } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'Name and Role are required.' });
    const id = 'emp_' + Date.now() + Math.random().toString(36).substr(2, 4);
    const newEmployee = { id, name, role, color: color || '#6366f1', avatar: avatar || '??', reports_to: reports_to || null, emp_no: emp_no || null };
    await db.ref('employees/' + id).set(newEmployee);
    res.status(201).json(newEmployee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/employees/:id', checkDb, async (req, res) => {
  try {
    await db.ref('employees/' + req.params.id).update(req.body);
    res.json({ id: req.params.id, ...req.body });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/employees/:id', checkDb, async (req, res) => {
  try {
    await db.ref('employees/' + req.params.id).remove();
    res.json({ success: true, id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Projects APIs
app.get('/api/projects', checkDb, async (req, res) => {
  try {
    const snapshot = await db.ref('projects').once('value');
    res.json(Object.values(snapshot.val() || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', checkDb, async (req, res) => {
  try {
    const { name, client, budget_hours, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required.' });
    const id = 'proj_' + Date.now() + Math.random().toString(36).substr(2, 4);
    const newProject = { id, name, client: client || 'Internal', budget_hours: parseFloat(budget_hours) || 0.0, color: color || '#6366f1' };
    await db.ref('projects/' + id).set(newProject);
    res.status(201).json(newProject);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Time Entries APIs
app.get('/api/entries', checkDb, async (req, res) => {
  try {
    const snapshot = await db.ref('time_entries').once('value');
    const entries = Object.values(snapshot.val() || {});
    
    // Hydrate entries with names
    const empsSnap = await db.ref('employees').once('value');
    const projsSnap = await db.ref('projects').once('value');
    const emps = empsSnap.val() || {};
    const projs = projsSnap.val() || {};

    const hydrated = entries.map(e => ({
      ...e,
      employee_name: emps[e.employee_id]?.name || 'Unknown',
      employee_avatar: emps[e.employee_id]?.avatar || '??',
      employee_color: emps[e.employee_id]?.color || '#888',
      project_name: projs[e.project_id]?.name || 'Internal',
      project_color: projs[e.project_id]?.color || '#888'
    }));

    res.json(hydrated.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/entries', checkDb, async (req, res) => {
    try {
        const { id, employee_id, project_id, task, description, start_time, end_time, total_hours } = req.body;
        const entryId = id || db.ref('time_entries').push().key;
        const newEntry = { id: entryId, employee_id, project_id, task, description: description || '', start_time, end_time: end_time || null, total_hours: parseFloat(total_hours) || 0 };
        await db.ref('time_entries/' + entryId).set(newEntry);
        res.status(201).json(newEntry);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sync', checkDb, async (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'Invalid entries' });
    try {
        const updates = {};
        entries.forEach(e => { updates['/time_entries/' + (e.id || db.ref().push().key)] = e; });
        await db.ref().update(updates);
        res.json({ status: 'success', syncedCount: entries.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Handles default page routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n===========================================`);
  console.log(`Chronos Flow Timekeeping Server running on port ${PORT}`);
  console.log(`===========================================\n`);
});
