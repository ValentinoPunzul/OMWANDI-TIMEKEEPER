const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

function initializeFirebase() {
  let serviceAccount;
  const saEnvVar = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saEnvVar) {
    try {
      serviceAccount = typeof saEnvVar === 'string' ? JSON.parse(saEnvVar) : saEnvVar;
    } catch (e) { console.error('Firebase: Error parsing Secret:', e.message); }
  }
  if (!serviceAccount) {
    const localPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(localPath)) serviceAccount = require(localPath);
  }

  const config = { databaseURL: "https://omwandi-timekeeping-default-rtdb.firebaseio.com" };
  try {
    if (serviceAccount) {
      config.credential = admin.credential.cert(serviceAccount);
      admin.initializeApp(config);
      console.log('Firebase: Initialized with Service Account.');
    } else {
      admin.initializeApp(config);
      console.log('Firebase: Initialized with Default Credentials.');
    }
  } catch (error) { console.error('Firebase: Init Failed:', error.message); }
}

initializeFirebase();
const db = admin.apps.length ? admin.database() : null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const checkDb = (req, res, next) => {
  if (!db) return res.status(503).json({ error: 'DB not connected.' });
  next();
};

// --- API ---

app.get('/api/employees', checkDb, async (req, res) => {
  try {
    const snap = await db.ref('employees').once('value');
    res.json(Object.values(snap.val() || {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employees', checkDb, async (req, res) => {
  const id = req.body.id || 'emp_' + Date.now();
  const emp = { ...req.body, id };
  await db.ref('employees/' + id).set(emp);
  res.status(201).json(emp);
});

app.put('/api/employees/:id', checkDb, async (req, res) => {
  await db.ref('employees/' + req.params.id).update(req.body);
  res.json({ success: true });
});

app.delete('/api/employees/:id', checkDb, async (req, res) => {
  await db.ref('employees/' + req.params.id).remove();
  res.json({ success: true });
});

app.get('/api/projects', checkDb, async (req, res) => {
  try {
    const snap = await db.ref('projects').once('value');
    res.json(Object.values(snap.val() || {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/entries', checkDb, async (req, res) => {
  try {
    const snap = await db.ref('time_entries').once('value');
    const entries = Object.values(snap.val() || {});
    const emps = (await db.ref('employees').once('value')).val() || {};
    const projs = (await db.ref('projects').once('value')).val() || {};

    const hydrated = entries.map(e => ({
      ...e,
      employee_name: emps[e.employee_id]?.name || 'Unknown',
      employee_role: emps[e.employee_id]?.role || 'Staff',
      project_name: projs[e.project_id]?.name || 'Internal',
      project_client: projs[e.project_id]?.client || 'Internal Development'
    }));
    res.json(hydrated.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/entries', checkDb, async (req, res) => {
  const id = db.ref('time_entries').push().key;
  const entry = { ...req.body, id };
  await db.ref('time_entries/' + id).set(entry);
  res.status(201).json(entry);
});

// Rich HR Export Matching CSV Snippets
app.post('/api/hr/dispatch', checkDb, async (req, res) => {
  try {
    const entriesSnap = await db.ref('time_entries').once('value');
    const empsSnap = await db.ref('employees').once('value');
    const projsSnap = await db.ref('projects').once('value');
    
    const entries = Object.values(entriesSnap.val() || {});
    const emps = empsSnap.val() || {};
    const projs = projsSnap.val() || {};

    if (entries.length === 0) return res.status(404).json({ error: 'No data' });

    const csvHeaders = ['Date', 'Employee Name', 'Role', 'Project Name', 'Client', 'Task Tag', 'Description', 'Hours Logged'];
    const csvRows = entries.map(e => {
        const emp = emps[e.employee_id] || {};
        const proj = projs[e.project_id] || {};
        return [
            `"${e.start_time.split('T')[0]}"`,
            `"${emp.name || 'Unknown'}"`,
            `"${emp.role || ''}"`,
            `"${proj.name || 'Internal'}"`,
            `"${proj.client || 'Internal Development'}"`,
            `"${e.task || 'Development'}"`,
            `"${e.description || ''}"`,
            e.total_hours
        ].join(',');
    });

    const content = [csvHeaders.join(','), ...csvRows].join('\n');
    const filename = `HR_Report_${Date.now()}_ALL_to_ALL.csv`;
    const dispatchDir = path.join(__dirname, 'data', 'hr_dispatched');
    if (!fs.existsSync(dispatchDir)) fs.mkdirSync(dispatchDir, { recursive: true });
    
    fs.writeFileSync(path.join(dispatchDir, filename), content);
    res.json({ status: 'success', filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
