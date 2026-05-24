const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let serviceAccount;
const saPath = path.join(__dirname, 'firebase-service-account.json');

if (fs.existsSync(saPath)) {
  serviceAccount = require(saPath);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
}

if (!serviceAccount) {
  console.error('No service account found.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://omwandi-timekeeping-default-rtdb.firebaseio.com"
});

const db = admin.database();

const newEmployee = {
    id: 'emp_111',
    emp_no: '111',
    name: 'Valentino Punzul',
    designation: 'Administrator',
    department: 'Management',
    access_role: 'Administrator',
    reports_to: 'None',
    avatar: 'VP',
    color: '#6366f1',
    avatar_url: ''
};

async function seed() {
  console.log(`Adding Administrator: ${newEmployee.name}...`);
  await db.ref('employees/' + newEmployee.id).set(newEmployee);
  console.log('Update complete.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
