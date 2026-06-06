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
// --- Firebase Realtime Database Local Mock Implementation ---
class MockRef {
  constructor(dbPath, dbData, saveFn) {
    this.dbPath = dbPath;
    this.dbData = dbData;
    this.saveFn = saveFn;
    this.queryField = null;
    this.queryValue = null;
    this.limit = null;
    this.orderByKeyFlag = false;
  }

  ref(path) {
    const fullPath = this.dbPath ? `${this.dbPath}/${path}` : path;
    return new MockRef(fullPath, this.dbData, this.saveFn);
  }

  orderByChild(field) {
    this.queryField = field;
    return this;
  }

  equalTo(value) {
    this.queryValue = value;
    return this;
  }

  orderByKey() {
    this.orderByKeyFlag = true;
    return this;
  }

  limitToLast(limit) {
    this.limit = limit;
    return this;
  }

  _getDataAtPath() {
    if (!this.dbPath) return this.dbData;
    const parts = this.dbPath.split('/');
    let current = this.dbData;
    for (const part of parts) {
      if (current === undefined || current === null) return null;
      current = current[part];
    }
    return current;
  }

  _setDataAtPath(value) {
    if (!this.dbPath) {
      if (value === null) {
        for (const k of Object.keys(this.dbData)) delete this.dbData[k];
      } else {
        Object.assign(this.dbData, value);
      }
      return;
    }
    const parts = this.dbPath.split('/');
    let current = this.dbData;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || current[part] === null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }
    const lastPart = parts[parts.length - 1];
    if (value === null) {
      delete current[lastPart];
    } else {
      current[lastPart] = value;
    }
  }

  async once(eventType) {
    if (eventType !== 'value') throw new Error('Only value event type is mocked');
    let data = this._getDataAtPath();

    if (data && typeof data === 'object') {
      let entries = Object.entries(data);
      if (this.queryField && this.queryValue !== null && this.queryValue !== undefined) {
        entries = entries.filter(([k, v]) => v && v[this.queryField] === this.queryValue);
      }
      if (this.orderByKeyFlag) {
        entries.sort((a, b) => a[0].localeCompare(b[0]));
      } else if (this.queryField) {
        entries.sort((a, b) => {
          const valA = a[1] ? a[1][this.queryField] : undefined;
          const valB = b[1] ? b[1][this.queryField] : undefined;
          if (valA === undefined && valB === undefined) return 0;
          if (valA === undefined) return 1;
          if (valB === undefined) return -1;
          if (valA < valB) return -1;
          if (valA > valB) return 1;
          return 0;
        });
      }
      if (this.limit !== null) {
        entries = entries.slice(-this.limit);
      }
      data = Object.fromEntries(entries);
    }

    return {
      val: () => data,
      forEach: (callback) => {
        if (data && typeof data === 'object') {
          Object.entries(data).forEach(([key, val]) => {
            callback({
              key,
              val: () => val
            });
          });
        }
      }
    };
  }

  async set(value) {
    this._setDataAtPath(value);
    await this.saveFn();
  }

  async update(value) {
    let current = this._getDataAtPath();
    if (!current) {
      current = {};
      this._setDataAtPath(current);
    }
    if (typeof current === 'object' && value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v === null) {
          delete current[k];
        } else if (current[k] && typeof current[k] === 'object' && v && typeof v === 'object') {
          Object.assign(current[k], v);
        } else {
          current[k] = v;
        }
      }
    } else {
      this._setDataAtPath(value);
    }
    await this.saveFn();
  }

  async remove() {
    this._setDataAtPath(null);
    await this.saveFn();
  }

  push() {
    const key = 'push_' + Date.now() + Math.random().toString(36).substr(2, 9);
    const pushRef = new MockRef(`${this.dbPath}/${key}`, this.dbData, this.saveFn);
    pushRef.key = key;
    return pushRef;
  }
}

let db;
const localDbPath = path.join(__dirname, 'data', 'local_db.json');

function setupLocalDbFallback() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let dbData = {};
  if (fs.existsSync(localDbPath)) {
    try {
      dbData = JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
    } catch (err) {
      console.error('Error reading local_db.json, recreating:', err.message);
    }
  }

  const saveFn = async () => {
    try {
      fs.writeFileSync(localDbPath, JSON.stringify(dbData, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving local database to disk:', err.message);
    }
  };

  db = new MockRef('', dbData, saveFn);

  // Seed default data if empty
  if (!dbData.employees || Object.keys(dbData.employees).length === 0) {
    console.log('[Database] Seeding local database with default employees and sample project...');
    dbData.employees = {};
    dbData.projects = {};
    dbData.time_entries = {};
    dbData.settings = {
      scoro_mapping: {},
      scoro_field_map: {},
      time_rules: {},
      ref: { designations: {}, departments: {}, roles: {} },
      holidays: {}
    };

    // Seed admin
    const adminEmp = {
      id: 'emp_111',
      emp_no: '111',
      name: 'Valentino Punzul',
      designation: 'Administrator',
      department: 'Management',
      access_role: 'Administrator',
      reports_to: 'None',
      avatar: 'VP',
      color: '#6366f1',
      avatar_url: '',
      role: 'Administrator',
      password: bcrypt.hashSync('111', SALT_ROUNDS)
    };
    dbData.employees[adminEmp.id] = adminEmp;

    // Seed default employees
    const defaultEmployeesList = [
      { emp_no: "4745", name: "Andapo", designation: "Team Leader Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Trevor Langenhoven", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772174684745-Andapo.png?alt=media&token=38c29cc6-7422-47b3-a7bb-029303a01bc1" },
      { emp_no: "6595", name: "Andreas", designation: "Team Leader Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Andries van Rooyen", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772174706595-Andreas.png?alt=media&token=3abf4fe1-05cf-4628-ac39-a979bab1b090" },
      { emp_no: "5442", name: "Andries van Rooyen", designation: "Team Leader Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Trevor Langenhoven", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772174166375442-Andries.png?alt=media&token=35d41ec8-b688-4d76-af66-2e1b7ae2a4c7" },
      { emp_no: "8040", name: "Aukus Shigwedha", designation: "Foreman - Engineering", department: "Projects", sub_department: "Engineering", reports_to: "Herman Karsten", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772174778040-Aukus.png?alt=media&token=9db10679-68e6-4a25-beac-dffee4e6781a" },
      { emp_no: "7880", name: "Shipmate", designation: "Shipmate Foreman", department: "Projects", sub_department: "Shipmate", reports_to: "(Top Level)", avatar_url: "" },
      { emp_no: "1234", name: "Estimator", designation: "Estimator", department: "Sales", sub_department: "", reports_to: "Ashwin Nash", avatar_url: "" },
      { emp_no: "5319", name: "Cliffie", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Ethan Benz", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187025319-Cliffie.png?alt=media&token=9d4b8d6b-031c-459c-92ac-f667e15eb0c0" },
      { emp_no: "0528", name: "Conrad", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Andries van Rooyen", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187120528-Conrad.png?alt=media&token=00212187-cb9b-42e2-99a0-e31321b45d0" },
      { emp_no: "7226", name: "Elbie", designation: "Senior Foreman Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Herman Karsten", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F17721848727226-Elbie.png?alt=media&token=cdde414d-e220-4ad7-ad6a-a3d61231b32e" },
      { emp_no: "2617", name: "Eliaser Hambuda", designation: "Foreman - Engineering", department: "Projects", sub_department: "Engineering", reports_to: "Herman Karsten", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772174822617-Eliaser.png?alt=media&token=9d0c1fcc-ae76-4afe-80fd-c89d2ed84e11" },
      { emp_no: "6932", name: "Ethan Benz", designation: "Team Leader Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Wayne Maasdorp", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187065932-Ethan.png?alt=media&token=0f1cf687-c560-4f87-b858-5060f41cd093" },
      { emp_no: "9101", name: "Filippus Nelomba", designation: "Trainee", department: "Projects", sub_department: "Engineering", reports_to: "Aukus Shigwedha", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772517909101-NIMT%20FILIPPUS%20NELOMBA.png?alt=media&token=c597722b-2ad3-46db-bfbc-de1960c2c9c7" },
      { emp_no: "2997", name: "Phillipus", designation: "Welder", department: "Projects", sub_department: "Engineering", reports_to: "Eliaser Hambuda", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187092997-Phillipus.png?alt=media&token=4daccfcd-3048-44b6-a01c-3a0224781c96" },
      { emp_no: "0962", name: "Herman Karsten", designation: "Project Manager", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Wiana Groenewald", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772807120962-Herman.png?alt=media&token=eca2307e-6a82-4abc-a18e-31505703243b" },
      { emp_no: "8531", name: "Immanuel Nkando", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Ethan Benz", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772184848531-immanuel%20Nkando.png?alt=media&token=f5dd88c1-b4ba-4b9d-a090-12da10dfe4aa" },
      { emp_no: "1437", name: "Manu", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Andries van Rooyen", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772184871437-Manu.png?alt=media&token=9ec4e9b9-2226-4d65-a642-999c3b791197" },
      { emp_no: "1000", name: "Ismael", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Andries van Rooyen", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1773741531000-ismael.png?alt=media&token=7678b0ac-54d4-4f2b-8dde-c4767e095758" },
      { emp_no: "1639", name: "Kalu", designation: "Team Leader Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Elbern Engelbrecht", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187216239-Kalu.png?alt=media&token=ddcc7ff1-46e7-853e-46a0a40f2a59" },
      { emp_no: "7150", name: "Levi", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Ethan Benz", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187247150-Levi.png?alt=media&token=76bf4fec-1926-4cec-853e-c8022d6c27b9" },
      { emp_no: "9690", name: "Lucky", designation: "Welder", department: "Projects", sub_department: "Engineering", reports_to: "Aukus Shigwedha", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772184956960-Lucky.png?alt=media&token=a788e369-7ed3-4cdc-90af-a2876f2a5bb8" },
      { emp_no: "9387", name: "Timjan", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Andries van Rooyen", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F177217459387-Timjan.png?alt=media&token=c2deafa8-b927-4847-9639-0ffc7b7eef74" },
      { emp_no: "8969", name: "Mathew", designation: "Fitter", department: "Projects", sub_department: "Engineering", reports_to: "Aukus Shigwedha", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187278969-Mathew.png?alt=media&token=8ab42a07-6337-42c1-9758-150fa5823752" },
      { emp_no: "0621", name: "Melissa", designation: "Cleaner", department: "Finance & Admin", sub_department: "", reports_to: "Verenique Ward", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772174906221-Melissa.png?alt=media&token=113c97fa-5862-4d1e-ad61-8e7441c4fff6" },
      { emp_no: "8898", name: "Pavo", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Ethan Benz", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772174928898-Pavo.png?alt=media&token=c871ebf4-b130-4f76-9520-d3e7f7113ffb" },
      { emp_no: "1744", name: "Filippus Nelomba", designation: "Trainee", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Immanuel Uule", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1773741291744-NIMT%20FILIPPUS%20NELOMBA.png?alt=media&token=d77087da-eff0-444a-aa9e-da8e61ddb3c0" },
      { emp_no: "1807", name: "Ravinia Kavela", designation: "Trainee", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Romano Gaseb", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772517831807-NIMT%20RAVINIA%20KAVELA.png?alt=media&token=dea6c55c-a683-410a-85da-9f9b68ecf235" },
      { emp_no: "7680", name: "Rewaldo", designation: "Driver", department: "Procurement", sub_department: "", reports_to: "Ashwin Nash", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772519277680-Rewaldo.png?alt=media&token=8da0ff80-4a90-41fe-bd3a-eb4b97d1a11d" },
      { emp_no: "0315", name: "Romano Gaseb", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Kalapushe Ngonekesho", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772518740315-ROMANO%20GASEB.png?alt=media&token=f50e0721-05e0-4a1c-a51b-35f6fc2d4146" },
      { emp_no: "4714", name: "Sacky", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Ethan Benz", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1773741444714-Sacky.png?alt=media&token=ad3ea974-1714-4bce-9b6b-0ae723ab150a" },
      { emp_no: "4844", name: "Shaun", designation: "Safety Officer", department: "HSE", sub_department: "Safety", reports_to: "Herman Karsten", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772517948448-Shaun.png?alt=media&token=17d2a473-cdc3-46db-ae77-0b99e0603505" },
      { emp_no: "9227", name: "Sydicko", designation: "Team Member Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Kalapushe Ngonekesho", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187429227-Sydicko.png?alt=media&token=2a30d921-5b08-4255-8ea4-311578c79e60" },
      { emp_no: "4767", name: "Trevor Langenhoven", designation: "Foreman Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Herman Karsten", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187476758-TREVOR%20LANGENHOVEN.png?alt=media&token=5944a840-f039-4097-bb4e-4955aabc7e2c" },
      { emp_no: "3094", name: "Verenique Ward", designation: "HR Officer", department: "Finance & Admin", sub_department: "HR", reports_to: "Wiana Groenewald", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772188630945-VERENIQUE%20WARD.png?alt=media&token=3fce3538-feb9-4742-b1f0-026fdde254a8" },
      { emp_no: "7779", name: "Wayne Maasdorp", designation: "Foreman Marine Outfitting", department: "Projects", sub_department: "Marine Outfitting", reports_to: "Herman Karsten", avatar_url: "https://firebasestorage.googleapis.com/v0/b/studio-9450480546-a2cc7.firebasestorage.app/o/avatars%2FDOHGWC3045VwqDVTIipfwEqjDT32%2F1772187677794-WAYNE%20MAASDORP.png?alt=media&token=037cf86b-3bbd-43ae-b609-43354797deb5" }
    ];

    const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#3b82f6', '#ef4444', '#14b8a6'];

    for (const emp of defaultEmployeesList) {
      const id = 'emp_' + emp.emp_no;
      const initials = emp.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      const color = colors[Math.floor(Math.random() * colors.length)];

      dbData.employees[id] = {
        ...emp,
        id,
        avatar: initials,
        color: color,
        role: emp.designation,
        password: bcrypt.hashSync(emp.emp_no, SALT_ROUNDS)
      };
    }

    dbData.projects['proj_local_sample'] = {
      id: 'proj_local_sample',
      name: 'Sample Local Project',
      proj_no: 'LP-001',
      client: 'OMWANDI Ltd',
      vessel_name: 'Sea Timekeeper',
      budget_hours: 120,
      color: '#3b82f6',
      open_project: true,
      status: 'active',
      status_name: 'Active',
      project_foreman: 'Valentino Punzul'
    };

    saveFn();
  }
}

function initializeDatabase() {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    const localSaPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(localSaPath)) {
      serviceAccount = require(localSaPath);
    }
  }

  const databaseURL = process.env.FIREBASE_DATABASE_URL || "https://omwandi-timekeeping-default-rtdb.firebaseio.com";

  if (serviceAccount) {
    try {
      const config = {
        databaseURL,
        credential: admin.credential.cert(serviceAccount)
      };
      admin.initializeApp(config);
      console.log(`Firebase: Initialized for ${databaseURL}`);
      db = admin.database();
    } catch (error) {
      console.error('Firebase: Initialization Failed, falling back to local JSON db:', error.message);
      setupLocalDbFallback();
    }
  } else {
    console.log('[Database] No Firebase credentials found. Running in local JSON database mock mode.');
    setupLocalDbFallback();
  }
}

initializeDatabase();

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
