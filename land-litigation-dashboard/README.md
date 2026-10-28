# Land Litigation Intelligence — Dashboards (Module 7 + Module 8)

React + Supabase front end that sits on top of your two finished backends **without changing them**.

```
Browser (React, :5173)
   │  login / roles / tracked cases / notifications ──►  Supabase (Auth + Postgres)
   │  cases, PDFs, risk scores  ──────────────────────►  Module 2 FastAPI   :8000   (unchanged)
   └  land records, tenure  ───────────────────────────►  Module 1 bridge    :8001   (new, read-only)
```

**Why a "bridge"?** Module 1 is a SQLite file plus a command-line script, so a browser cannot read it.
`bridge/module1_bridge.py` opens `land_records.db` **read-only** and returns the same data as JSON.
It does not import or edit any Module 1 file.

## Folder layout

```
land-litigation-dashboard/
├─ supabase/schema.sql          tables, security rules, role trigger
├─ bridge/                      Module 1 read-only API
└─ frontend/                    React app (Vite)
```

Put this folder **next to** your `module1_land_record_integration` and `module - case integration` folders.

## One-time setup

### 1. Supabase
1. Create a project at https://supabase.com.
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, press **Run**.
3. **Project Settings → API**: copy the *Project URL* and the *anon public* key.
4. (Development tip) **Authentication → Providers → Email**: turn **off** "Confirm email" so citizen sign-ups can log in immediately. Leave it **on** in production.

### 2. Government accounts (manual in database, as required)
For each official:
1. SQL Editor:
   ```sql
   insert into public.gov_officials (email, full_name, department)
   values ('collector.dharmapuri@gov.in', 'District Collector', 'Revenue')
   on conflict (email) do update set full_name = excluded.full_name;
   ```
2. **Authentication → Users → Add user → Create new user**: same email, a password, tick **Auto Confirm User**.

The database trigger automatically assigns the `government` role. Any other `@gov.in` address is rejected.

### 3. Administrator accounts (manual in database, via SQL or dashboard)
Administrators are added directly in the database just like government officials:

**Method A (Recommended — Whitelist + Supabase Auth):**
1. Run in SQL Editor:
   ```sql
   insert into public.admin_users (email, full_name)
   values ('admin@landlitigation.gov.in', 'System Administrator')
   on conflict (email) do update set full_name = excluded.full_name;
   ```
2. **Authentication → Users → Add user → Create new user**:
   - Email: `admin@landlitigation.gov.in`
   - Password: `<your_password>`
   - Tick **Auto Confirm User**
   - Press **Create user**.
   The database trigger `handle_new_user` automatically assigns the `admin` role in `public.profiles`.

**Method B (Direct Pure SQL):**
Run the SQL block provided at the bottom of `supabase/schema.sql` to insert the admin user and encrypted password directly into `auth.users` and `public.profiles`.

### 4. Front-end settings
```powershell
cd frontend
copy .env.example .env
notepad .env        # paste VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
```

## Run (three terminals)

**Terminal 1 — Module 2 (unchanged)**
```powershell
cd "module - case integration"
.venv\Scripts\activate
uvicorn app.main:app --port 8000
```
Wait until startup finishes (it parses the PDFs and trains the risk models). Check http://127.0.0.1:8000/health.

**Terminal 2 — Module 1 bridge**
```powershell
cd land-litigation-dashboard\bridge
pip install -r requirements.txt          # or use the same .venv as Module 2
$env:LAND_DB_PATH = "C:\full\path\to\module1_land_record_integration\project\db\land_records.db"
uvicorn module1_bridge:app --port 8001
```
(If the folders are side by side you can skip `LAND_DB_PATH`.) Check http://127.0.0.1:8001/villages.

**Terminal 3 — React**
```powershell
cd land-litigation-dashboard\frontend
npm run dev
```
Open http://localhost:5173.

## Using it
* Home page is public. **Register** (citizens, @gmail.com) and **Login** (everyone) are single pages.
* After login the role in Supabase decides the dashboard: `/citizen` or `/government`.
* Try: village *kudumiyampatty*, survey **71**.

## What each requirement uses

| Requirement | Data source |
|---|---|
| Search survey number | Module 1 `/land` + Module 2 `/survey/{n}` |
| Download reports | printable land+litigation report (Save as PDF) and original case PDFs `/cases/{id}/pdf` |
| Track hearings | Supabase `tracked_cases` + Module 2 `/cases/{id}` (hearing & adjournment counts) + risk |
| Notifications | checked every 60 s against the saved snapshot; stored in Supabase `notifications`, delivered live |
| Dispute history | Module 2 `/survey/{n}` as a timeline |
| Litigation hotspots | cases grouped by survey number |
| Frequently disputed villages | cases per village, cases per 100 survey numbers (Module 1 counts) |
| Monthly reports | filing/disposal dates, CSV and print |
| Encroachment statistics | dispute type = Encroachment, cross-checked with A-Register tenure |
| Pending case analytics | status, age, risk bands, projected disposals from `/risk/cases` |

## Honest limits of the current backends
* Court PDFs contain **counts** of hearings/adjournments, not individual hearing dates, so "track hearings" shows progress and alerts on change, not a calendar of next dates.
* The land database has **no GIS coordinates**, so hotspots are a survey-number grid, not a geographic map.
* Case data is synthetic (the backend says so); only one village currently has case PDFs.
* The government dashboard refreshes every 60 s (the backends are polled; they do not push).

## Troubleshooting
* **"Database error saving new user"** when registering → email is not @gmail.com, or `schema.sql` was not run.
* **Login works but bounces back** → the user has no row in `profiles`; re-run `schema.sql`, then create the user again.
* **Land details empty** → bridge not running or wrong `LAND_DB_PATH`.
* **Risk bands missing** → Module 2 is still training at startup; wait and press Refresh.
* **Production build:** `npm run build` creates `frontend/dist`; host it on any static host and set `VITE_CASE_API` / `VITE_LAND_API` to the deployed backend URLs (and restrict their CORS to your site).
