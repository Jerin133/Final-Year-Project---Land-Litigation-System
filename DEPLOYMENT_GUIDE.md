# UniGaia — Complete Deployment Guide
### Land Litigation Intelligence Platform

---

## 1. System Architecture Overview

UniGaia consists of four primary components designed to communicate seamlessly:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        UniGaia Frontend (React + Vite)                 │
│               Deployed to Vercel / Netlify / Nginx (Port 80/443)       │
└───────┬────────────────────────────┬────────────────────────────┬──────┘
        │                            │                            │
        ▼                            ▼                            ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│   Case API       │       │   Land Bridge    │       │   GIS API        │
│   (Module 2)     │       │   (Module 1)     │       │   (Module 6)     │
│   FastAPI :8000  │       │   FastAPI :8001  │       │   FastAPI :8002  │
│                  │       │                  │       │                  │
│  Court Case PDFs │       │ land_records.db  │       │ kudumiyampatty   │
│  & Risk Models   │       │ Chitta + A-Reg   │       │ geojson + SQLite │
└──────────────────┘       └─────────┬────────┘       └─────────┬────────┘
                                     │                          │
                                     └───────────┬──────────────┘
                                                 ▼
                                    ┌─────────────────────────┐
                                    │     land_records.db     │
                                    │  (SQLite with WKT GIS)  │
                                    └─────────────────────────┘
```

---

## 2. Environment Variables Reference

### Frontend (`land-litigation-dashboard/frontend/.env`)

| Variable | Description | Local Development | Cloud Production Example |
| :--- | :--- | :--- | :--- |
| `VITE_CASE_API` | Module 2 Case API URL | `http://127.0.0.1:8000` | `https://unigaia-case-api.onrender.com` |
| `VITE_LAND_API` | Module 1 Land Records Bridge URL | `http://127.0.0.1:8001` | `https://unigaia-land-api.onrender.com` |
| `VITE_GIS_API` | Module 6 GIS Cadastre API URL | `http://127.0.0.1:8002` | `https://unigaia-gis-api.onrender.com` |
| `VITE_SUPABASE_URL` | Supabase Cloud Database URL | `https://dnlnehehjebzveisvnsy.supabase.co` | `https://dnlnehehjebzveisvnsy.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Public Supabase Anon API Key | *[Configured]* | *[Configured]* |

---

## Method 1: Free Cloud Deployment (Recommended)
### Frontend on Vercel + Backends on Render (Zero Server Cost)

### Step 1: Push Code to GitHub
Ensure your project repository is uploaded to GitHub (either public or private).

### Step 2: Deploy Backends on Render.com
Create an account at [Render.com](https://render.com) (free tier):

1. **Service 1: Case API (Module 2)**:
   - Click **New +** → **Web Service**
   - Connect your GitHub repository
   - **Root Directory**: `module - case integration`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Copy the generated URL (e.g., `https://unigaia-case.onrender.com`).

2. **Service 2: Land Records Bridge (Module 1)**:
   - Click **New +** → **Web Service**
   - Connect your GitHub repository
   - **Root Directory**: `land-litigation-dashboard/bridge`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python module1_bridge.py`
   - Under **Environment Variables**, add:
     - `HOST` = `0.0.0.0`
     - `LAND_DB_PATH` = `../../module1_land_record_integration/project/db/land_records.db`
   - Copy the generated URL (e.g., `https://unigaia-land.onrender.com`).

3. **Service 3: GIS Integration (Module 6)**:
   - Click **New +** → **Web Service**
   - Connect your GitHub repository
   - **Root Directory**: `GIS Integration`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python run.py --no-browser`
   - Under **Environment Variables**, add:
     - `HOST` = `0.0.0.0`
     - `LAND_DB_PATH` = `../module1_land_record_integration/project/db/land_records.db`
   - Copy the generated URL (e.g., `https://unigaia-gis.onrender.com`).

### Step 3: Deploy Frontend on Vercel
1. Go to [Vercel.com](https://vercel.com) and log in with GitHub.
2. Click **Add New...** → **Project** and select your repository.
3. Configure the project:
   - **Framework Preset**: `Vite`
   - **Root Directory**: click *Edit* and select `land-litigation-dashboard/frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Expand **Environment Variables** and enter:
   - `VITE_CASE_API` = `https://unigaia-case.onrender.com`
   - `VITE_LAND_API` = `https://unigaia-land.onrender.com`
   - `VITE_GIS_API` = `https://unigaia-gis.onrender.com`
   - `VITE_SUPABASE_URL` = `https://dnlnehehjebzveisvnsy.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
5. Click **Deploy**. Vercel will build the frontend and provide a free live domain (e.g., `https://unigaia.vercel.app`).
   *(SPA routing is handled automatically by the included `vercel.json` file).*

---

## Method 2: 1-Click Container Deployment with Docker Compose
### For any VPS, Cloud Server (AWS / DigitalOcean / GCP), or Local Docker

A production-ready `docker-compose.yml` and Dockerfiles are included in the repository.

1. Install Docker & Docker Compose on your server.
2. Clone your repository:
   ```bash
   git clone <YOUR_REPO_URL>
   cd "Land Litigation"
   ```
3. Run with one command:
   ```bash
   docker compose up --build -d
   ```
4. Access the system:
   - **Frontend**: `http://<YOUR_SERVER_IP>:5173`
   - **Case API**: `http://<YOUR_SERVER_IP>:8000/docs`
   - **Land API**: `http://<YOUR_SERVER_IP>:8001/villages`
   - **GIS API**: `http://<YOUR_SERVER_IP>:8002/gis/villages`

To stop:
```bash
docker compose down
```

---

## Method 3: Cloud Virtual Machine / VPS Deployment (Ubuntu / Debian)
### Using Nginx + Systemd (Full Production Setup)

### 1. Install prerequisites on Ubuntu:
```bash
sudo apt update && sudo apt install -y python3 python3-pip python3-venv nodejs npm nginx
```

### 2. Set up Backend Services with Systemd:

Create service file for Case API `/etc/systemd/system/unigaia-case.service`:
```ini
[Unit]
Description=UniGaia Case Integration API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Land-Litigation/module - case integration
ExecStart=/usr/local/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

Create service file for Land Bridge `/etc/systemd/system/unigaia-land.service`:
```ini
[Unit]
Description=UniGaia Land Record Bridge API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Land-Litigation/land-litigation-dashboard/bridge
ExecStart=/usr/bin/python3 module1_bridge.py
Environment=HOST=127.0.0.1
Environment=PORT=8001
Restart=always

[Install]
WantedBy=multi-user.target
```

Create service file for GIS API `/etc/systemd/system/unigaia-gis.service`:
```ini
[Unit]
Description=UniGaia GIS Cadastre API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Land-Litigation/GIS Integration
ExecStart=/usr/bin/python3 run.py --no-browser --host 127.0.0.1 --port 8002
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start services:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now unigaia-case unigaia-land unigaia-gis
```

### 3. Build & Configure Frontend with Nginx:
```bash
cd /home/ubuntu/Land-Litigation/land-litigation-dashboard/frontend
npm install
npm run build
```

Configure Nginx `/etc/nginx/sites-available/unigaia`:
```nginx
server {
    listen 80;
    server_name yourdomain.com; # or your VPS public IP

    # Frontend Single Page App
    location / {
        root /home/ubuntu/Land-Litigation/land-litigation-dashboard/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # API Proxies
    location /api/cases/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/land/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/gis/ {
        proxy_pass http://127.0.0.1:8002/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable the site and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/unigaia /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Method 4: Local Network / Lab Presentation Deployment
### Windows Single-Click Launch

For lab evaluations, project expos, or demoing to external review panels on the same Wi-Fi network:

1. Double click **`start_all.bat`** in the project root directory.
2. It will open and run:
   - Module 2 Case API on `8000`
   - Module 1 Land Records Bridge on `8001`
   - Module 6 GIS Integration on `8002`
   - Frontend on `http://localhost:5173`
3. To allow evaluators or other laptops on the same Wi-Fi to access the dashboard:
   - Find your IPv4 address via `ipconfig` (e.g., `192.168.1.45`).
   - Any device on the same network can access `http://192.168.1.45:5173`.
