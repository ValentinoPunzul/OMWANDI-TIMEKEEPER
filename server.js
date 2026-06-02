const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'changeme-use-env-var';
const SALT_ROUNDS = 10;

const app = express();
const PORT = process.env.PORT || 8080;

// --- Firebase Initialization ---
function initializeFirebase() {
  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      const localPath = path.join(__dirname, 'firebase-service-account.json');
      if (fs.existsSync(localPath)) {
        serviceAccount = require(localPath);
      }
    }

    const databaseURL = process.env.FIREBASE_DATABASE_URL || "https://omwandi-timekeeping-default-rtdb.firebaseio.com";
    
    const config = {
      databaseURL,
      ...(serviceAccount && { credential: admin.credential.cert(serviceAccount) }),
    };

    admin.initializeApp(config);
    console.log(`Firebase: Initialized for ${databaseURL}`);
  } catch (error) {
    console.error('Firebase: Initialization Failed:', error.message);
  }
}

initializeFirebase();
const db = admin.apps.length ? admin.database() : null;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const checkDbConnection = (req, res, next) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not connected. Check server logs.' });
  }
  next();
};

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).send('Authentication required.');
  }
  try {
    const decodedToken = jwt.verify(token, JWT_SECRET);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(403).send('Invalid token.');
  }
};

// --- Input Schemas (using Zod) ---
const employeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  emp_no: z.string().optional(),
  password: z.string().optional(),
  designation: z.string().optional(),
  department: z.string().optional(),
  sub_department: z.string().optional(),
  reports_to: z.string().optional(),
  role: z.string().optional(),
  access_role: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatar: z.string().optional(),
}).passthrough();

const projectSchema = z.object({
    name: z.string().min(1, 'Project name is required'),
    proj_no: z.string().optional(),
    client: z.string().optional(),
    vessel_name: z.string().optional(),
    budget_hours: z.number().min(0).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    open_project: z.boolean().optional(),
    status: z.string().optional(),
    status_name: z.string().optional(),
    project_foreman: z.string().optional(),
    scoro_id: z.string().optional(),
    updated_from_scoro: z.string().optional(),
}).passthrough();


// --- API Endpoints ---
const apiRouter = express.Router();
apiRouter.use(checkDbConnection);
apiRouter.use(authMiddleware); 

// Employees
apiRouter.get('/employees', async (req, res) => {
  const snap = await db.ref('employees').once('value');
  res.json(Object.values(snap.val() || {}));
});

apiRouter.post('/employees', async (req, res) => {
    const result = employeeSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json(result.error);
    const id = req.body.id || 'emp_' + Date.now();
    const data = { ...result.data, id };
    if (data.password) data.password = await bcrypt.hash(data.password, SALT_ROUNDS);
    await db.ref('employees/' + id).set(data);
    res.status(201).json(data);
});

apiRouter.put('/employees/:id', async (req, res) => {
    const result = employeeSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json(result.error);
    const data = { ...result.data };
    if (data.password) data.password = await bcrypt.hash(data.password, SALT_ROUNDS);
    await db.ref('employees/' + req.params.id).update(data);
    const updated = await db.ref('employees/' + req.params.id).once('value');
    res.json(updated.val());
});

apiRouter.delete('/employees/:id', async (req, res) => {
    const employeeId = req.params.id;
    // Cascade delete: remove time entries for this employee
    const entriesRef = db.ref('time_entries');
    const snapshot = await entriesRef.orderByChild('employee_id').equalTo(employeeId).once('value');
    const updates = {};
    snapshot.forEach(child => {
        updates[child.key] = null;
    });
    await entriesRef.update(updates);
    
    // Delete employee
    await db.ref('employees/' + employeeId).remove();
    res.json({ success: true, id: employeeId });
});

// Projects
apiRouter.get('/projects', async (req, res) => {
  const snap = await db.ref('projects').once('value');
  res.json(Object.values(snap.val() || {}));
});

apiRouter.post('/projects', async (req, res) => {
    const result = projectSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json(result.error);
    const id = req.body.id || 'proj_' + Date.now();
    const projData = { ...result.data, id };
    await db.ref('projects/' + id).set(projData);
    res.status(201).json(projData);
});

apiRouter.put('/projects/:id', async (req, res) => {
    const result = projectSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json(result.error);
    await db.ref('projects/' + req.params.id).update(result.data);
    const updated = await db.ref('projects/' + req.params.id).once('value');
    res.json(updated.val());
});

apiRouter.delete('/projects/:id', async (req, res) => {
    const projectId = req.params.id;
    // Note: Consider if deleting projects should also delete time entries.
    // For now, we leave them for historical reporting.
    await db.ref('projects/' + projectId).remove();
    res.json({ success: true, id: projectId });
});


// Time Entries (with Pagination)
apiRouter.get('/entries', async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const snap = await db.ref('time_entries').orderByChild('start_time').limitToLast(limit + offset).once('value');
    // Use entries() so the Firebase key is always available as id (prevents undeletable rows)
    const entries = Object.entries(snap.val() || {}).map(([key, e]) => ({ ...e, id: e.id || key }));

    // Manual slicing for offset
    const paginatedEntries = entries.reverse().slice(offset, offset + limit);

    const emps = (await db.ref('employees').once('value')).val() || {};
    const projs = (await db.ref('projects').once('value')).val() || {};

    const hydrated = paginatedEntries.map(e => ({
        ...e,
        employee_name: emps[e.employee_id]?.name || 'Unknown',
        project_name: projs[e.project_id]?.name || 'Internal'
    }));
    
    res.json(hydrated);
});

apiRouter.post('/entries', async (req, res) => {
  if (!req.body.employee_id || !req.body.project_id) {
    return res.status(400).json({ error: 'employee_id and project_id are required.' });
  }
  // Enforce one active timer per employee
  const existing = await db.ref('time_entries')
    .orderByChild('employee_id').equalTo(req.body.employee_id).once('value');
  const entries = Object.values(existing.val() || {});
  const hasActive = entries.some(e => e.start_time && (!e.end_time || e.end_time === '') && (!e.total_hours || e.total_hours === 0));
  if (hasActive) {
    return res.status(409).json({ error: 'This employee already has an active timer running.' });
  }
  const id = db.ref('time_entries').push().key;
  const entry = { ...req.body, id, start_time: req.body.start_time || new Date().toISOString() };
  await db.ref('time_entries/' + id).set(entry);
  res.status(201).json(entry);
});

apiRouter.put('/entries/:id', async (req, res) => {
  await db.ref('time_entries/' + req.params.id).update(req.body);
  const snap = await db.ref('time_entries/' + req.params.id).once('value');
  res.json(snap.val());
});

apiRouter.delete('/entries/:id', async (req, res) => {
  await db.ref('time_entries/' + req.params.id).remove();
  res.json({ success: true });
});


// Settings & Admin
apiRouter.get('/settings/mapping', async (req, res) => {
    const snap = await db.ref('settings/scoro_mapping').once('value');
    res.json(snap.val() || {});
});

apiRouter.post('/settings/mapping', async (req, res) => {
    await db.ref('settings/scoro_mapping').set(req.body);
    res.json({ success: true });
});


// --- Auth Routes (unprotected) ---
app.get('/api/config', (req, res) => {
  res.json({ firebaseApiKey: process.env.FIREBASE_API_KEY || '' });
});

app.post('/api/auth/login', checkDbConnection, async (req, res) => {
  try {
    const { emp_no, password } = req.body;
    if (!emp_no || !password) return res.status(400).json({ message: 'emp_no and password are required' });
    const snap = await db.ref('employees').orderByChild('emp_no').equalTo(emp_no).once('value');
    const val = snap.val();
    if (!val) return res.status(401).json({ message: 'Invalid credentials' });
    const employee = Object.values(val)[0];
    const passwordMatch = await bcrypt.compare(password, employee.password || '');
    if (!passwordMatch) return res.status(401).json({ message: 'Invalid credentials' });
    const idToken = jwt.sign(
      { uid: employee.id, role: employee.role || employee.access_role || 'Employee' },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({
      idToken,
      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role || 'Employee',
        color: employee.color,
        emp_no: employee.emp_no,
        designation: employee.designation
      }
    });
  } catch(err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// --- Reference Data (Designations, Departments, Roles) ---
const REF_TYPES = ['designations', 'departments', 'roles'];

apiRouter.get('/ref/:type', async (req, res) => {
  if (!REF_TYPES.includes(req.params.type)) return res.status(400).json({ error: 'Invalid type' });
  const snap = await db.ref('settings/ref/' + req.params.type).once('value');
  res.json(Object.values(snap.val() || {}));
});

apiRouter.post('/ref/:type', async (req, res) => {
  if (!REF_TYPES.includes(req.params.type)) return res.status(400).json({ error: 'Invalid type' });
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = 'ref_' + Date.now();
  const item = { id, name: name.trim() };
  await db.ref('settings/ref/' + req.params.type + '/' + id).set(item);
  res.status(201).json(item);
});

apiRouter.put('/ref/:type/:id', async (req, res) => {
  if (!REF_TYPES.includes(req.params.type)) return res.status(400).json({ error: 'Invalid type' });
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  await db.ref('settings/ref/' + req.params.type + '/' + req.params.id).update({ name: name.trim() });
  res.json({ id: req.params.id, name: name.trim() });
});

apiRouter.delete('/ref/:type/:id', async (req, res) => {
  if (!REF_TYPES.includes(req.params.type)) return res.status(400).json({ error: 'Invalid type' });
  await db.ref('settings/ref/' + req.params.type + '/' + req.params.id).remove();
  res.json({ success: true });
});

// --- Time Rules ---
apiRouter.get('/settings/time-rules', async (req, res) => {
  const snap = await db.ref('settings/time_rules').once('value');
  res.json(snap.val() || {});
});
apiRouter.post('/settings/time-rules', async (req, res) => {
  await db.ref('settings/time_rules').set(req.body);
  res.json({ success: true });
});

// --- Public Holidays ---
apiRouter.get('/holidays', async (req, res) => {
  const snap = await db.ref('settings/holidays').once('value');
  res.json(Object.values(snap.val() || {}));
});
apiRouter.post('/holidays', async (req, res) => {
  const { date, name } = req.body;
  if (!date) return res.status(400).json({ error: 'Date is required' });
  const id = 'hol_' + Date.now();
  const item = { id, date, name: (name || '').trim() };
  await db.ref('settings/holidays/' + id).set(item);
  res.status(201).json(item);
});
apiRouter.delete('/holidays/:id', async (req, res) => {
  await db.ref('settings/holidays/' + req.params.id).remove();
  res.json({ success: true });
});

app.use('/api', apiRouter);

// --- Unprotected Webhook Endpoint ---
const webhookRouter = express.Router();
webhookRouter.use(checkDbConnection);

const WEBHOOK_LOG_DIR = path.join(__dirname, 'data', 'webhook_logs');
if (!fs.existsSync(WEBHOOK_LOG_DIR)) fs.mkdirSync(WEBHOOK_LOG_DIR, { recursive: true });

webhookRouter.post('/scoro', async (req, res) => {
  try {
    const payload = req.body;
    const timestamp = Date.now();
    const logEntry = {
      id: 'wh_' + timestamp,
      received_at: new Date(timestamp).toISOString(),
      headers: {
        'content-type': req.headers['content-type'] || '',
        'x-scoro-token': req.headers['x-scoro-token'] || '',
        'x-webhook-secret': req.headers['x-webhook-secret'] || '',
      },
      payload,
      fields: Object.keys(payload || {})
    };

    // Save to Firebase — keep last 50 logs
    await db.ref('webhook_logs/' + logEntry.id).set(logEntry);

    // Prune old logs — keep only most recent 50
    const logsSnap = await db.ref('webhook_logs').orderByKey().once('value');
    const keys = Object.keys(logsSnap.val() || {});
    if (keys.length > 50) {
      const toDelete = keys.slice(0, keys.length - 50);
      const deletes = {};
      toDelete.forEach(k => { deletes[k] = null; });
      await db.ref('webhook_logs').update(deletes);
    }

    console.log(`[Webhook] Received from Scoro — fields: ${logEntry.fields.join(', ')}`);

    // Auto-create/update project using saved field map
    try {
      const mapSnap = await db.ref('settings/scoro_field_map').once('value');
      const fieldMap = mapSnap.val() || {};
      const custom = fieldMap._custom || [];

      const getVal = (obj, path) => {
        if (!path || !obj) return undefined;
        const parts = path.split('.');
        let cur = obj;
        for (const p of parts) {
          if (cur === null || cur === undefined) return undefined;
          if (Array.isArray(cur) && cur[0]?.id !== undefined) {
            cur = cur.find(i => i.id === p)?.value;
          } else { cur = cur[p]; }
        }
        return cur;
      };

      // Scoro-specific ID and field defaults
      const scoroId = getVal(payload, 'entity.project_id') || getVal(payload, 'entityId') ||
                      getVal(payload, 'entity.id') || getVal(payload, 'id');

      console.log('[Webhook] scoroId:', scoroId, '| entityType:', payload.entityType);

      if (scoroId) {
        const projectData = { scoro_id: String(scoroId), updated_from_scoro: new Date().toISOString() };

        // Standard field defaults from known Scoro structure (override with field map if set)
        const scoroDefaults = {
          name:         'entity.project_name',
          proj_no:      'entity.no',
          client:       'entity.company_name',
          budget_hours: null,
          vessel_name:  null,
        };

        // Map standard fields — use field map if configured, else use Scoro defaults
        ['name','proj_no','client','budget_hours','vessel_name'].forEach(appKey => {
          const path = fieldMap[appKey] || scoroDefaults[appKey];
          if (path) {
            const val = getVal(payload, path);
            if (val !== undefined && val !== null) {
              if (appKey === 'budget_hours') projectData[appKey] = parseFloat(val) || 0;
              else if (appKey === 'open_project') projectData[appKey] = val == 1 || val === true || val === 'true';
              else projectData[appKey] = String(val);
            }
          }
        });

        // Map custom fields
        custom.forEach(cf => {
          if (cf.key && cf.scoroField) {
            const val = getVal(payload, cf.scoroField);
            if (val !== undefined && val !== null) projectData[cf.key] = String(val);
          }
        });

        // Fallback name if not mapped
        if (!projectData.name) {
          projectData.name = getVal(payload, 'entity.name') || getVal(payload, 'name') || 'Untitled Project';
        }

        console.log('[Webhook] projectData to save:', JSON.stringify(projectData));

        // Find existing project by scoro_id OR proj_no fallback
        const allProjectsSnap = await db.ref('projects').once('value');
        const allProjects = allProjectsSnap.val() || {};
        const existingEntry = Object.entries(allProjects).find(([,p]) =>
          String(p.scoro_id) === String(scoroId) ||
          (projectData.proj_no && String(p.proj_no) === String(projectData.proj_no))
        );

        if (existingEntry) {
          const [existingId] = existingEntry;
          projectData.id = existingId;
          await db.ref('projects/' + existingId).update(projectData);
          console.log(`[Webhook] Updated project: ${projectData.name} (${existingId})`);
        } else {
          const newId = 'proj_' + Date.now();
          projectData.id = newId;
          projectData.color = '#1d4ed8';
          await db.ref('projects/' + newId).set(projectData);
          console.log(`[Webhook] Created project: ${projectData.name} (${newId})`);
        }
      } else {
        console.warn('[Webhook] No scoroId found in payload. Keys received:', Object.keys(payload || {}).join(', '));
      }
    } catch(mapErr) {
      console.error('[Webhook] Field mapping error:', mapErr.message, mapErr.stack);
    }

    res.status(200).json({ status: 'success', logged: logEntry.id, fields: logEntry.fields });
  } catch(err) {
    console.error('[Webhook] Error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Get webhook logs (protected)
apiRouter.get('/webhook-logs', async (req, res) => {
  const snap = await db.ref('webhook_logs').orderByKey().limitToLast(20).once('value');
  const logs = Object.values(snap.val() || {}).reverse();
  res.json(logs);
});

// Save field mapping
apiRouter.post('/settings/scoro-field-map', async (req, res) => {
  await db.ref('settings/scoro_field_map').set(req.body);
  res.json({ success: true });
});

// Get field mapping
apiRouter.get('/settings/scoro-field-map', async (req, res) => {
  const snap = await db.ref('settings/scoro_field_map').once('value');
  res.json(snap.val() || {});
});

app.use('/api/webhooks', webhookRouter);


// Short alias for Scoro webhook
app.post('/webhook', (req, res, next) => {
  req.url = '/scoro';
  webhookRouter(req, res, next);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
