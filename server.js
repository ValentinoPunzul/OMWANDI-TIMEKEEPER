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
    try { serviceAccount = typeof saEnvVar === 'string' ? JSON.parse(saEnvVar) : saEnvVar; } 
    catch (e) { console.error('Firebase: Error parsing Secret:', e.message); }
  }
  if (!serviceAccount) {
    const localPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(localPath)) serviceAccount = require(localPath);
  }
  const dbUrl = process.env.FIREBASE_DATABASE_URL || "https://omwandi-timekeeping-default-rtdb.firebaseio.com";
  try {
    const config = { databaseURL: dbUrl };
    if (serviceAccount) {
      config.credential = admin.credential.cert(serviceAccount);
      admin.initializeApp(config);
    } else { admin.initializeApp(config); }
  } catch (error) { console.error('Firebase: Init Failed:', error.message); }
}

initializeFirebase();
const db = admin.apps.length ? admin.database() : null;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const checkDb = (req, res, next) => {
  if (!db) return res.status(503).json({ error: 'DB not connected.' });
  next();
};

// ============================================
// SCORO WEBHOOK HANDLER (UPDATED MAPPING)
// ============================================
app.post('/api/webhooks/scoro', checkDb, async (req, res) => {
  try {
    const body = req.body;
    console.log('--- SCORO WEBHOOK RECEIVED ---');
    console.log('Raw Payload:', JSON.stringify(body));

    // SCORO Rules often wrap data in a 'data' key or send it flat
    const data = body.data || body;
    
    // 1. Extract Project Number
    // Prioritize 'project_number' or 'no' over internal 'id'
    const projNo = data.project_number || data.no || data.project_no || data.number || data.project_id || data.id || 'SC-' + Date.now();
    
    // 2. Extract Project Name
    const projName = data.project_name || data.name || data.object_name || 'New SCORO Project';
    
    // 3. Extract Client
    const client = data.company_name || data.client_name || data.account_name || data.company || 'SCORO Client';
    
    // 4. Extract Vessel Name (if provided in payload)
    const vessel = data.vessel_name || data.custom_vessel || 'N/A';

    const id = 'proj_' + projNo.toString().replace(/[^a-zA-Z0-9]/g, '_');
    
    const projectData = {
      id: id,
      proj_no: projNo.toString(),
      name: projName,
      client: client,
      vessel_name: vessel,
      color: '#8b5cf6',
      last_sync: new Date().toISOString(),
      source: 'SCORO'
    };

    await db.ref('projects/' + id).update(projectData);
    
    console.log(`SCORO Sync Success: [${projNo}] ${projName} for ${client}`);
    res.status(200).json({ status: 'success', imported: projectData });
  } catch (error) {
    console.error('SCORO Webhook Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ... [Existing API Routes] ...

app.get('/api/employees', checkDb, async (req, res) => {
  try {
    const snap = await db.ref('employees').once('value');
    res.json(Object.values(snap.val() || {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employees', checkDb, async (req, res) => {
  const id = req.body.id || 'emp_' + Date.now();
  await db.ref('employees/' + id).set({ ...req.body, id });
  res.status(201).json({ id });
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

app.post('/api/projects', checkDb, async (req, res) => {
  const id = req.body.id || 'proj_' + Date.now();
  await db.ref('projects/' + id).set({ ...req.body, id });
  res.status(201).json({ id });
});

app.put('/api/projects/:id', checkDb, async (req, res) => {
  await db.ref('projects/' + req.params.id).update(req.body);
  res.json({ success: true });
});

app.delete('/api/projects/:id', checkDb, async (req, res) => {
  await db.ref('projects/' + req.params.id).remove();
  res.json({ success: true });
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
      project_name: projs[e.project_id]?.name || 'Internal'
    }));
    res.json(hydrated.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/entries', checkDb, async (req, res) => {
  const id = db.ref('time_entries').push().key;
  await db.ref('time_entries/' + id).set({ ...req.body, id });
  res.status(201).json({ id });
});

app.put('/api/entries/:id', checkDb, async (req, res) => {
  await db.ref('time_entries/' + req.params.id).update(req.body);
  res.json({ success: true });
});

app.delete('/api/entries/:id', checkDb, async (req, res) => {
  await db.ref('time_entries/' + req.params.id).remove();
  res.json({ success: true });
});

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
        return [`"${e.start_time.split('T')[0]}"`,`"${emp.name || 'Unknown'}"`,`"${emp.role || emp.designation || ''}"`,`"${proj.name || 'Internal'}"`,`"${proj.client || ''}"`,`"${e.task || ''}"`,`"${e.description || ''}"`,e.total_hours].join(',');
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
