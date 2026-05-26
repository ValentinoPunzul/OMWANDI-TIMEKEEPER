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
      console.log('Firebase: Using Service Account from Environment Variable');
    } catch (e) { console.error('Firebase: Error parsing FIREBASE_SERVICE_ACCOUNT secret:', e.message); }
  }
  
  if (!serviceAccount) {
    const localPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(localPath)) {
      serviceAccount = require(localPath);
      console.log('Firebase: Using Service Account from local JSON file');
    }
  }

  const dbUrl = process.env.FIREBASE_DATABASE_URL || "https://omwandi-timekeeping-default-rtdb.firebaseio.com";

  try {
    const config = { databaseURL: dbUrl };
    if (serviceAccount) {
      config.credential = admin.credential.cert(serviceAccount);
      admin.initializeApp(config);
      console.log(`Firebase: Successfully initialized for ${dbUrl}`);
    } else {
      // Fallback for GCP environments
      admin.initializeApp(config);
      console.log(`Firebase: Initialized with Default Credentials for ${dbUrl}`);
    }
  } catch (error) { 
    console.error('Firebase: CRITICAL INITIALIZATION FAILURE:', error.message); 
  }
}

initializeFirebase();
const db = admin.apps.length ? admin.database() : null;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const checkDb = (req, res, next) => {
  if (!db) {
    console.error(`503 Service Unavailable: Database not connected for request ${req.url}`);
    return res.status(503).json({ 
        error: 'DB not connected.', 
        details: 'Firebase Admin SDK failed to initialize. Check server console logs for CRITICAL INITIALIZATION FAILURE.'
    });
  }
  next();
};

// ... [Existing API Routes remain the same] ...

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
app.get('/api/entries', checkDb, async (req, res) => {
    const snap = await db.ref('time_entries').once('value');
    const entries = Object.values(snap.val() || {});
    const emps = (await db.ref('employees').once('value')).val() || {};
    const projs = (await db.ref('projects').once('value')).val() || {};
    const hydrated = entries.map(e => ({ ...e, employee_name: emps[e.employee_id]?.name || 'Unknown', project_name: projs[e.project_id]?.name || 'Internal' }));
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
app.get('/api/settings/mapping', checkDb, async (req, res) => {
    const snap = await db.ref('settings/scoro_mapping').once('value');
    res.json(snap.val() || {});
});
app.post('/api/settings/mapping', checkDb, async (req, res) => {
    await db.ref('settings/scoro_mapping').set(req.body);
    res.json({ success: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
