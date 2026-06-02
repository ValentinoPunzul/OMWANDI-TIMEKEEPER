# OMWANDI Timekeeper — Changelog

## Architecture & Cleanup
- Modularised frontend into `app.js` plus per-view modules (`dashboard`, `timer`, `projects`, `team`, `timesheets`, `settings`)
- Removed committed `node_modules`, build logs, generated CSV reports and `.oops` from version control
- Migrated backend to Firebase Realtime Database with JWT authentication and bcrypt password hashing
- Hardened `GET /entries` to always return a valid `id` (prevents undeletable rows)

## Authentication & Roles
- Employee-number + password login
- Role-based access: Administrator, Foreman, Team Leader, Employee
- Roles persisted across sessions; role baked into JWT at login

## Live Timer
- Project selection with NPT reason capture
- Project-number quick-find input
- One-active-timer-per-employee guard
- Foremen and Team Leaders can start/stop timers for their team members
- "My Timer" group so managers can also time themselves
- Other foremen/team leaders excluded from the selectable list

## Projects
- Scoro webhook auto-creates/updates projects (matched by Scoro ID or project number)
- Visual Scoro field mapper with custom field support
- Displays vessel, foreman, status and custom fields on cards
- Open Project flag (no budget limit)
- Grid and list views
- Search + filter by client, vessel, foreman and status; sortable
- Hours shown as HH:MM

## Timesheets
- Sortable columns; columns: Date, Employee, Started By, Start, End, Project, Category, Normal, OT, DT, Total
- Hours classified into Normal / Overtime / Double / Break per Time Rules
- Category badges per entry
- Export to Excel (CSV) respecting active filters
- Hours as HH:MM, dates as DD/MM/YYYY

## Settings
- Tabbed layout: Account, Dropdowns, Scoro, Webhooks, Time Rules, HR Dispatch
- Dropdowns CRUD for Designations, Departments, Roles
- Scoro webhook logs + field mapping (standard + custom)
- Time Rules: working hours, tea, lunch, Friday hours (07:00–16:00, no lunch), editable overtime/double rates, public holidays management

## Mobile
- Bottom nav (Dashboard, Timer, Projects) with a "More" drawer for Timesheets, Team, Settings, Logout

## Data
- 43 employees seeded/cleaned with correct names, employee codes, designations and reporting hierarchy
