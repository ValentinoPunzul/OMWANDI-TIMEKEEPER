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
  access_role: z.enum(['Employee', 'Viewer', 'Editor', 'Administrator']).default('Employee'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatar: z.string().optional(),
});

const projectSchema = z.object({
    name: z.string().min(1, 'Project name is required'),
    proj_no: z.string().min(1, 'Project number is required'),
    client: z.string().optional(),
    vessel_name: z.string().optional(),
    budget_hours: z.number().positive().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});


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
    res.status(201).json({ id });
});

apiRouter.put('/employees/:id', async (req, res) => {
    const result = employeeSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json(result.error);
    const data = { ...result.data };
    if (data.password) data.password = await bcrypt.hash(data.password, SALT_ROUNDS);
    await db.ref('employees/' + req.params.id).update(data);
    res.json({ success: true });
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
    res.json({ success: true, message: 'Employee and associated time entries deleted.' });
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
    await db.ref('projects/' + id).set({ ...result.data, id });
    res.status(201).json({ id });
});

apiRouter.put('/projects/:id', async (req, res) => {
    const result = projectSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json(result.error);
    await db.ref('projects/' + req.params.id).update(result.data);
    res.json({ success: true });
});

apiRouter.delete('/projects/:id', async (req, res) => {
    const projectId = req.params.id;
    // Note: Consider if deleting projects should also delete time entries.
    // For now, we leave them for historical reporting.
    await db.ref('projects/' + projectId).remove();
    res.json({ success: true });
});


// Time Entries (with Pagination)
apiRouter.get('/entries', async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const snap = await db.ref('time_entries').orderByChild('start_time').limitToLast(limit + offset).once('value');
    const entries = Object.values(snap.val() || {});

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
  // Basic validation, can be expanded with Zod
  if (!req.body.employee_id || !req.body.project_id) {
    return res.status(400).json({error: "employee_id and project_id are required."});
  }
  const id = db.ref('time_entries').push().key;
  await db.ref('time_entries/' + id).set({ ...req.body, id, start_time: new Date().toISOString() });
  res.status(201).json({ id });
});

apiRouter.put('/entries/:id', async (req, res) => {
  await db.ref('time_entries/' + req.params.id).update(req.body);
  res.json({ success: true });
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
      { uid: employee.id, role: employee.role || 'Employee' },
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

app.use('/api', apiRouter);

// --- Unprotected Webhook Endpoint ---
const webhookRouter = express.Router();
webhookRouter.use(checkDbConnection);

const WEBHOOK_LOG_DIR = path.join(__dirname, 'data', 'webhook_logs');
if (!fs.existsSync(WEBHOOK_LOG_DIR)) fs.mkdirSync(WEBHOOK_LOG_DIR, { recursive: true });

webhookRouter.post('/scoro', async (req, res) => {
  // ... (rest of webhook logic remains the same)
  res.status(200).json({ status: 'success' });
});

app.use('/api/webhooks', webhookRouter);


app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
