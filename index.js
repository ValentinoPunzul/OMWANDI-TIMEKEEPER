const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');

// Trigger redeploy: 2024-05-22

// Initialize Firebase Admin SDK
let serviceAccount;
try {
  // Production: Load from Google Cloud Secret Manager
  if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Development: Load from local file
    serviceAccount = require('./firebase-service-account.json');
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
  });
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK:', error.message);
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error('firebase-service-account.json not found. Please ensure the file exists for local development.');
  } else if (error.message.includes('Failed to parse service account')) {
    console.error('Could not parse the service account credentials. Make sure the environment variable or file is a valid JSON.');
  }
  // In a real production scenario, you might want to exit or use a fallback.
}

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ==========================================================================
// API ENDPOINTS
// ==========================================================================

// GET all employees
app.get('/api/employees', async (req, res) => {
  try {
    const snapshot = await db.collection('employees').get();
    const employees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(employees);
  } catch (error) {
    console.error('Error fetching employees:', error.message);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// GET all projects
app.get('/api/projects', async (req, res) => {
  try {
    const snapshot = await db.collection('projects').get();
    const projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error.message);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// GET all time entries
app.get('/api/entries', async (req, res) => {
  try {
    const snapshot = await db.collection('time_entries').orderBy('start_time', 'desc').get();
    const entries = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        start_time: data.start_time.toDate().toISOString(),
        end_time: data.end_time.toDate().toISOString()
      };
    });
    res.json(entries);
  } catch (error) {
    console.error('Error fetching time entries:', error.message);
    res.status(500).json({ error: 'Failed to fetch time entries' });
  }
});

// POST a new time entry
app.post('/api/entries', async (req, res) => {
  try {
    const { employee_id, project_id, task, description, start_time, end_time, total_hours } = req.body;
    const newEntry = {
      employee_id,
      project_id,
      task,
      description,
      total_hours,
      start_time: admin.firestore.Timestamp.fromDate(new Date(start_time)),
      end_time: admin.firestore.Timestamp.fromDate(new Date(end_time))
    };
    const docRef = await db.collection('time_entries').add(newEntry);
    
    // Fetch the full entry to return
    const fullEntry = await getFullEntryDetails(docRef.id);
    res.status(201).json(fullEntry);

  } catch (error) {
    console.error('Error creating time entry:', error.message);
    res.status(500).json({ error: 'Failed to create time entry' });
  }
});

// POST an array of offline entries
app.post('/api/sync', async (req, res) => {
  const { entries } = req.body;
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'Invalid sync payload' });
  }

  const batch = db.batch();
  let successCount = 0;

  for (const entry of entries) {
    const { id, employee_id, project_id, task, description, start_time, end_time, total_hours } = entry;
    const docRef = db.collection('time_entries').doc(id); // Use provided offline ID
    batch.set(docRef, {
      employee_id,
      project_id,
      task,
      description,
      total_hours,
      start_time: admin.firestore.Timestamp.fromDate(new Date(start_time)),
      end_time: admin.firestore.Timestamp.fromDate(new Date(end_time))
    });
    successCount++;
  }

  try {
    await batch.commit();
    console.log(`Successfully synced ${successCount} offline entries.`);
    res.status(200).json({ status: 'success', synced: successCount });
  } catch (error) {
    console.error('Error during batch sync:', error);
    res.status(500).json({ error: 'Failed to sync offline entries' });
  }
});

// Helper to enrich entry with employee/project details
async function getFullEntryDetails(docId) {
  const entryDoc = await db.collection('time_entries').doc(docId).get();
  if (!entryDoc.exists) return null;

  const entryData = entryDoc.data();

  // Parallel fetches for employee and project
  const [empDoc, projDoc] = await Promise.all([
    db.collection('employees').doc(entryData.employee_id).get(),
    db.collection('projects').doc(entryData.project_id).get()
  ]);

  const empData = empDoc.exists ? empDoc.data() : { name: 'Unknown', avatar: '??', color: '#888' };
  const projData = projDoc.exists ? projDoc.data() : { name: 'Unknown', client: 'Internal', color: '#888' };

  return {
    id: entryDoc.id,
    ...entryData,
    start_time: entryData.start_time.toDate().toISOString(),
    end_time: entryData.end_time.toDate().toISOString(),
    employee_name: empData.name,
    employee_avatar: empData.avatar,
    employee_color: empData.color,
    project_name: projData.name,
    project_color: projData.color,
    project_client: projData.client
  };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});