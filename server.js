const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// --- Firebase Initialization ---
function initializeFirebase() {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) { console.error('Error parsing FIREBASE_SERVICE_ACCOUNT:', e.message); }
  }
  if (!serviceAccount) {
    const localPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(localPath)) serviceAccount = require(localPath);
  }

  const dbUrl = process.env.FIREBASE_DATABASE_URL || "https://omwandi-timekeeping-default-rtdb.firebaseio.com";
  const config = { databaseURL: dbUrl };
  
  try {
    if (serviceAccount) {
      config.credential = admin.credential.cert(serviceAccount);
      admin.initializeApp(config);
      console.log(`Firebase: Initialized with Service Account for ${dbUrl}`);
    } else {
      admin.initializeApp(config);
      console.log(`Firebase: Initialized with Application Default Credentials for ${dbUrl}`);
    }
  } catch (error) { console.error('Firebase: Initialization Failed:', error.message); }
}

initializeFirebase();
const db = admin.apps.length ? admin.database() : null;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const checkDb = (req, res, next) => {
  if (!db) return res.status(503).json({ error: 'Database not connected. Check server logs.' });
  next();
};

// --- SCORO Integration Logic ---
const WEBHOOK_LOG_DIR = path.join(__dirname, 'data', 'webhook_logs');
if (!fs.existsSync(WEBHOOK_LOG_DIR)) fs.mkdirSync(WEBHOOK_LOG_DIR, { recursive: true });

function getValueByPath(obj, path) {
    if (!path) return null;
    if (path.startsWith('cf:')) {
        const cfId = path.split(':')[1];
        const customFields = (obj.entity && obj.entity.custom_fields) || obj.custom_fields || [];
        const field = customFields.find(f => f.id === cfId);
        return field ? field.value : null;
    }
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

app.post('/api/webhooks/scoro', checkDb, async (req, res) => {
  try {
    const body = req.body;
    fs.writeFileSync(path.join(WEBHOOK_LOG_DIR, `scoro_${Date.now()}.json`), JSON.stringify(body, null, 2));

    const mappingSnap = await db.ref('settings/scoro_mapping').once('value');
    const mappings = mappingSnap.val() || { proj_no: "entity.no", name: "entity.project_name", client: "entity.company_name" };

    const projNo = getValueByPath(body, mappings.proj_no) || 'SC-' + Date.now();
    const id = 'proj_' + projNo.toString().replace(/[^a-zA-Z0-9]/g, '_');
    
    const projectData = {
      id: id,
      proj_no: projNo.toString(),
      name: getValueByPath(body, mappings.name) || 'New Project',
      client: getValueByPath(body, mappings.client) || 'Client',
      vessel_name: getValueByPath(body, mappings.vessel_name) || 'N/A',
      color: '#8b5cf6',
      last_sync: new Date().toISOString(),
      source: 'SCORO'
    };

    await db.ref('projects/' + id).update(projectData);
    res.status(200).json({ status: 'success' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- API Endpoints ---

// Employees
app.get('/api/employees', checkDb, async (req, res) => {
  const snap = await db.ref('employees').once('value');
  res.json(Object.values(snap.val() || {}));
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

// Projects
app.get('/api/projects', checkDb, async (req, res) => {
  const snap = await db.ref('projects').once('value');
  res.json(Object.values(snap.val() || {}));
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

// Time Entries
app.get('/api/entries', checkDb, async (req, res) => {
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

// Settings & Admin
app.get('/api/settings/mapping', checkDb, async (req, res) => {
    const snap = await db.ref('settings/scoro_mapping').once('value');
    res.json(snap.val() || {});
});
app.post('/api/settings/mapping', checkDb, async (req, res) => {
    await db.ref('settings/scoro_mapping').set(req.body);
    res.json({ success: true });
});
app.get('/api/admin/webhooks', async (req, res) => {
    try {
        const files = fs.readdirSync(WEBHOOK_LOG_DIR).filter(f => f.endsWith('.json'))
            .sort((a, b) => fs.statSync(path.join(WEBHOOK_LOG_DIR, b)).mtime - fs.statSync(path.join(WEBHOOK_LOG_DIR, a)).mtime);
        const logs = files.slice(0, 5).map(f => ({ name: f, content: JSON.parse(fs.readFileSync(path.join(WEBHOOK_LOG_DIR, f), 'utf8')) }));
        res.json(logs);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// HR Dispatch
app.post('/api/hr/dispatch', checkDb, async (req, res) => {
  try {
    const entries = Object.values((await db.ref('time_entries').once('value')).val() || {});
    const emps = (await db.ref('employees').once('value')).val() || {};
    const projs = (await db.ref('projects').once('value')).val() || {};
    if (entries.length === 0) return res.status(404).json({ error: 'No data' });
    const csvHeaders = ['Date', 'Employee Name', 'Role', 'Project Name', 'Client', 'Task Tag', 'Description', 'Hours Logged'];
    const csvRows = entries.map(e => {
        const emp = emps[e.employee_id] || {};
        const proj = projs[e.project_id] || {};
        return [`"${e.start_time?.split('T')[0] || ''}"`,`"${emp.name || ''}"`,`"${emp.designation || ''}"`,`"${proj.name || ''}"`,`"${proj.client || ''}"`,`"${e.task || ''}"`,`"${e.description || ''}"`,e.total_hours].join(',');
    });
    const content = [csvHeaders.join(','), ...csvRows].join('\n');
    const filename = `HR_Report_${Date.now()}.csv`;
    const dispatchDir = path.join(__dirname, 'data', 'hr_dispatched');
    if (!fs.existsSync(dispatchDir)) fs.mkdirSync(dispatchDir, { recursive: true });
    fs.writeFileSync(path.join(dispatchDir, filename), content);
    res.json({ status: 'success', filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
