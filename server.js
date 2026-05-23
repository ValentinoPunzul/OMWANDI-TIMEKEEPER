const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize Firebase Admin SDK
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // In a deployed environment, parse the service account from the environment variable
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // For local development, load the service account from a file
  serviceAccount = require('./firebase-service-account.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://omwandi-timekeeping-default-rtdb.firebaseio.com`
});
const db = admin.database();

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data and export directories exist
const DATA_DIR = path.join(__dirname, 'data');
const DISPATCH_DIR = path.join(DATA_DIR, 'hr_dispatched');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DISPATCH_DIR)) fs.mkdirSync(DISPATCH_DIR, { recursive: true });

// ============================================
// API ROUTES
// ============================================

// 1. Employees APIs
app.get('/api/employees', async (req, res) => {
  try {
    const snapshot = await db.ref('employees').once('value');
    res.json(Object.values(snapshot.val() || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/employees', async (req, res) => {
  try {
    const { name, role, color, avatar, reports_to, emp_no } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'Name and Role are required.' });

    const id = 'emp_' + Date.now() + Math.random().toString(36).substr(2, 4);
    const newEmployee = {
      id,
      name,
      role,
      color: color || '#' + Math.floor(Math.random() * 16777215).toString(16),
      avatar: avatar || name.split(' ').map(n => n[0]).join('').toUpperCase().substr(0, 2),
      reports_to: reports_to || null,
      emp_no: emp_no || null
    };

    await db.ref('employees/' + id).set(newEmployee);
    res.status(201).json(newEmployee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/employees/:id', async (req, res) => {
  try {
    const { name, role, color, avatar, reports_to, emp_no } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'Name and Role are required.' });

    const updatedEmployee = {
      id: req.params.id,
      name,
      role,
      color: color || '#' + Math.floor(Math.random() * 16777215).toString(16),
      avatar: avatar || name.split(' ').map(n => n[0]).join('').toUpperCase().substr(0, 2),
      reports_to: reports_to || null,
      emp_no: emp_no || null
    };

    await db.ref('employees/' + req.params.id).update(updatedEmployee);
    res.json(updatedEmployee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    await db.ref('employees/' + req.params.id).remove();
    res.json({ success: true, id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Projects APIs
app.get('/api/projects', async (req, res) => {
  try {
    const snapshot = await db.ref('projects').once('value');
    res.json(Object.values(snapshot.val() || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, client, budget_hours, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required.' });

    const id = 'proj_' + Date.now() + Math.random().toString(36).substr(2, 4);
    const newProject = {
      id,
      name,
      client: client || 'Internal',
      budget_hours: parseFloat(budget_hours) || 0.0,
      color: color || '#' + Math.floor(Math.random() * 16777215).toString(16)
    };

    await db.ref('projects/' + id).set(newProject);
    res.status(201).json(newProject);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Time Entries APIs (with filtering capabilities)
app.get('/api/entries', async (req, res) => {
  try {
    const { employee_id, project_id, start_date, end_date } = req.query;
    let entriesRef = db.ref('time_entries');

    if (employee_id) entriesRef = entriesRef.orderByChild('employee_id').equalTo(employee_id);
    if (project_id) entriesRef = entriesRef.orderByChild('project_id').equalTo(project_id);
    if (start_date) entriesRef = entriesRef.orderByChild('start_time').startAt(start_date);
    if (end_date) entriesRef = entriesRef.orderByChild('start_time').endAt(end_date);

    const snapshot = await entriesRef.once('value');
    const entries = snapshot.val() || {};

    // Since Firebase doesn't support multiple orderByChild, we may need to do client-side filtering for combined queries
    let filteredEntries = Object.values(entries);
    if(employee_id && project_id) {
        filteredEntries = filteredEntries.filter(entry => entry.project_id === project_id && entry.employee_id === employee_id);
    }

    // Hydrate entries with employee and project data
    const employeesSnapshot = await db.ref('employees').once('value');
    const projectsSnapshot = await db.ref('projects').once('value');
    const employees = employeesSnapshot.val() || {};
    const projects = projectsSnapshot.val() || {};

    const hydratedEntries = filteredEntries.map(entry => ({
      ...entry,
      employee_name: employees[entry.employee_id] ? employees[entry.employee_id].name : 'N/A',
      project_name: projects[entry.project_id] ? projects[entry.project_id].name : 'N/A'
    }));

    res.json(hydratedEntries.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)));

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create single time entry
app.post('/api/entries', async (req, res) => {
    try {
        const { id, employee_id, project_id, task, description, start_time, end_time, total_hours } = req.body;
        if (!employee_id || !project_id || !task || !start_time) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        const entryId = id || db.ref('time_entries').push().key;
        const newEntry = {
            id: entryId,
            employee_id,
            project_id,
            task,
            description: description || '',
            start_time,
            end_time: end_time || null,
            total_hours: parseFloat(total_hours) || 0
        };

        await db.ref('time_entries/' + entryId).set(newEntry);
        res.status(201).json(newEntry);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update time entry
app.put('/api/entries/:id', async (req, res) => {
    try {
        const { employee_id, project_id, task, description, start_time, end_time, total_hours } = req.body;
        const entryId = req.params.id;

        const updatedEntry = {
            employee_id,
            project_id,
            task,
            description,
            start_time,
            end_time,
            total_hours: parseFloat(total_hours) || 0
        };

        await db.ref('time_entries/' + entryId).update(updatedEntry);
        res.json({ id: entryId, ...updatedEntry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete time entry
app.delete('/api/entries/:id', async (req, res) => {
    try {
        await db.ref('time_entries/' + req.params.id).remove();
        res.json({ message: 'Time entry successfully deleted.', id: req.params.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Batch Sync API
app.post('/api/sync', async (req, res) => {
    const { entries } = req.body;
    if (!entries || !Array.isArray(entries)) {
        return res.status(400).json({ error: 'Payload must be an array of entries.' });
    }

    try {
        const updates = {};
        entries.forEach(entry => {
            const entryId = entry.id || db.ref('time_entries').push().key;
            updates['/time_entries/' + entryId] = entry;
        });

        await db.ref().update(updates);
        res.json({ status: 'success', syncedCount: entries.length });
    } catch (error) {
        res.status(500).json({ error: 'Syncing failed: ' + error.message });
    }
});

// 5. HR Exporter and Dispatch API
app.post('/api/hr/dispatch', async (req, res) => {
  // This function would need to be adapted to fetch data from Firebase and then format it.
  // For brevity, this is a simplified placeholder.
  res.status(501).json({ error: 'HR dispatch from Firebase not implemented.' });
});


// Handles default page routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n===========================================`);
  console.log(`Chronos Flow Timekeeping Server running!`);
  console.log(`Access the application at: http://localhost:${PORT}`);
  console.log(`Firebase Realtime Database connected.`);
  console.log(`===========================================\n`);
});