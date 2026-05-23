const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize Firebase Admin SDK
let serviceAccount;
// Check all possible variations of the environment variable name
const saEnvVar = process.env.FIREBASE_SERVICE_ACCOUNT || 
                 process.env.firebase_service_account || 
                 process.env['firebase-service-account'];

if (saEnvVar) {
  try {
    serviceAccount = JSON.parse(saEnvVar);
    console.log('Firebase Service Account loaded from environment variable.');
  } catch (e) {
    console.error('Failed to parse Service Account environment variable. Ensure it is a valid JSON string.');
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
    // Local file not found, expected in production
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
    console.error('Firebase Initialization Error:', error.message);
  }
} else {
  console.warn('WARNING: No Firebase Credentials found. App will run in demo mode with no database connection.');
}

const db = admin.apps.length ? admin.database() : null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to ensure DB is ready
const checkDb = (req, res, next) => {
  if (!db) return res.status(503).json({ error: 'Database connection not established. Check server logs.' });
  next();
};

// ============================================
// API ROUTES
// ============================================

// 1. Employees
app.get('/api/employees', checkDb, async (req, res) => {
  try {
    const snapshot = await db.ref('employees').once('value');
    res.json(Object.values(snapshot.val() || {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employees', checkDb, async (req, res) => {
  const { name, role } = req.body;
  if (!name || !role) return res.status(400).json({ error: 'Name and Role required' });
  const id = req.body.id || 'emp_' + Date.now();
  const emp = { ...req.body, id };
  await db.ref('employees/' + id).set(emp);
  res.status(201).json(emp);
});

app.put('/api/employees/:id', checkDb, async (req, res) => {
  await db.ref('employees/' + req.params.id).update(req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/employees/:id', checkDb, async (req, res) => {
  await db.ref('employees/' + req.params.id).remove();
  res.json({ success: true });
});

// 2. Projects
app.get('/api/projects', checkDb, async (req, res) => {
  try {
    const snapshot = await db.ref('projects').once('value');
    res.json(Object.values(snapshot.val() || {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects', checkDb, async (req, res) => {
  const id = req.body.id || 'proj_' + Date.now();
  const proj = { ...req.body, id };
  await db.ref('projects/' + id).set(proj);
  res.status(201).json(proj);
});

// 3. Time Entries
app.get('/api/entries', checkDb, async (req, res) => {
  try {
    const snapshot = await db.ref('time_entries').once('value');
    const entries = Object.values(snapshot.val() || {});
    
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/entries', checkDb, async (req, res) => {
  const id = req.body.id || db.ref('time_entries').push().key;
  const entry = { ...req.body, id };
  await db.ref('time_entries/' + id).set(entry);
  res.status(201).json(entry);
});

app.delete('/api/entries/:id', checkDb, async (req, res) => {
  await db.ref('time_entries/' + req.params.id).remove();
  res.json({ success: true });
});

app.post('/api/sync', checkDb, async (req, res) => {
  const { entries } = req.body;
  const updates = {};
  entries.forEach(e => { updates['/time_entries/' + (e.id || db.ref().push().key)] = e; });
  await db.ref().update(updates);
  res.json({ status: 'success', syncedCount: entries.length });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chronos Flow running on port ${PORT}`);
});
