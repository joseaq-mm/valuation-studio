# Guía de conexión — Valuation Studio (local → producción)

Guía paso a paso para conectar servicios externos y verificar cada uno antes del siguiente.

---

## 0. Estado actual de tu máquina (snapshot)

| Variable | Dónde | Estado típico ahora |
|---|---|---|
| `MONGO_URL` | `backend/.env` | SET → `mongodb://localhost:27017` |
| `DB_NAME` | `backend/.env` | SET → `test_database` (datos importados de Emergent) |
| `GOOGLE_CLIENT_ID` / `SECRET` | `backend/.env` | SET |
| `REACT_APP_BACKEND_URL` | `frontend/.env` | SET → `http://localhost:8000` |
| `REACT_APP_GOOGLE_CLIENT_ID` | `frontend/.env` | SET |
| `CORS_ORIGINS` / `PUBLIC_APP_URL` | `backend/.env` | SET → `http://localhost:3000` |
| `OPENAI_API_KEY` / `ANTHROPIC` / `GEMINI` | `backend/.env` | EMPTY |
| `EMERGENT_LLM_KEY` | `backend/.env` | (añadir vacío o clave) |
| `FRED_API_KEY` | `backend/.env` | EMPTY |
| `RESEND_API_KEY` | `backend/.env` | no declarado |
| `ADMIN_EMAIL` | `backend/.env` | no declarado |
| `EXPORT_SECRET` | `backend/.env` | no declarado |

Plantillas completas: `backend/.env.example` y `frontend/.env.example`.

---

## 1. Inventario de variables (código vs ejemplo)

### Backend (`backend/.env`) — leídas en runtime

| Variable | Obligatoria | Archivo(s) que la usan | Qué hace |
|---|---|---|---|
| `MONGO_URL` | **Sí** | `server.py` | Conexión MongoDB |
| `DB_NAME` | **Sí** | `server.py` | Nombre de la base |
| `CORS_ORIGINS` | No (default `*`) | `server.py`, `auth.py` | Orígenes frontend |
| `PUBLIC_APP_URL` | Recomendada | `auth.py`, `screener.py`, `radar.py` | Cookies locales + links en emails |
| `GOOGLE_CLIENT_ID` | Para login | `auth.py` | OAuth Google |
| `GOOGLE_CLIENT_SECRET` | Para login | `auth.py` | OAuth Google (solo servidor) |
| `EMERGENT_LLM_KEY` | Para IA* | `services/llm.py`, `services/thesis.py`, `services/kpi.py`, `routes/*`, `server.py`, `storage.py` | Clave universal / placeholder |
| `OPENAI_API_KEY` | Para IA real | `emergentintegrations/llm/chat.py` | OpenAI vía litellm |
| `ANTHROPIC_API_KEY` | Para IA real | idem | Claude vía litellm |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Para IA real | idem | Gemini vía litellm |
| `THESIS_MODEL_PRESET` | No | `services/thesis.py` | `pro` / `fast` / `custom` |
| `FRED_API_KEY` | Para /macro | `services/macro.py` | API St. Louis Fed |
| `RESEND_API_KEY` | Para emails | `screener.py`, `radar.py` | Alertas por correo |
| `SENDER_EMAIL` | No | `screener.py`, `radar.py` | Remitente (default Resend sandbox) |
| `ADMIN_EMAIL` | No | `routes/feedback.py`, `routes/community.py` | Admin UI |
| `EXPORT_SECRET` | No | `server.py` | Export HTTP de toda la BD |
| `WEBHOOK_CRON_SECRET` | Solo Emergent crons | `.emergent/cron/*` | Webhooks programados |

\* Sin clave de proveedor el stub responde en **modo mock** (no genera tesis reales).

### Frontend (`frontend/.env`)

| Variable | Obligatoria | Archivo | Qué hace |
|---|---|---|---|
| `REACT_APP_BACKEND_URL` | **Sí** | `src/lib/api.js`, `ServerWaking.jsx` | Base URL del API |
| `REACT_APP_GOOGLE_CLIENT_ID` | Para login | `src/lib/googleAuth.js` | Client ID público OAuth |
| `REACT_APP_ENABLE_MODEL_PANEL` | No | `ModelPicker.jsx` | UI de modelos |
| `ENABLE_HEALTH_CHECK` | No | `craco.config.js` | Health endpoints webpack |

### Servicios **sin** API key

| Servicio | Archivo | Notas |
|---|---|---|
| Yahoo Finance | `services/valuation.py`, `server.py`, `timeline.py` | `yfinance`, gratis |
| Tavily Search | `services/thesis.py` (`_run_searches`) | Requiere `TAVILY_API_KEY` |
| FX (tipos de cambio) | `fx.py` | `open.er-api.com`, gratis |
| OWID energy (macro) | `services/macro.py` | CSV público |
| Emergent object storage | `storage.py` | **Solo Emergent** — PDFs KPI en local fallan sin migrar a S3/R2 |

---

## 2. Orden lógico de conexión (probar de forma progresiva)

```
① MongoDB → ② Backend+Frontend → ③ Yahoo/FX (sin claves)
   → ④ Google OAuth → ⑤ LLM → ⑥ FRED → ⑦ Resend → ⑧ Atlas/producción
```

### Paso 1 — MongoDB

**Archivos:** `backend/server.py` (arranque), `scripts/dev-local.sh`

**Config:**
```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=test_database
```

**Arranque:**
```bash
cd ~/Desktop/valuation-studio
./scripts/dev-local.sh
```

**Verificación:**
```bash
# Ping
cd backend && ./venv/bin/python -c "
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
async def t():
    c=AsyncIOMotorClient('mongodb://localhost:27017', serverSelectionTimeoutMS=3000)
    print(await c.admin.command('ping'))
    print('dbs', await c.list_database_names())
asyncio.run(t())
"
```
Esperado: `{'ok': 1.0}` y ver `test_database` si ya importaste datos.

---

### Paso 2 — Backend API + Frontend

**Archivos:** `backend/server.py`, `frontend/src/lib/api.js`, `scripts/dev-local.sh`

**Config frontend:**
```env
REACT_APP_BACKEND_URL=http://localhost:8000
```

**Arranque (2 terminales):**
```bash
# Terminal A
./scripts/dev-local.sh

# Terminal B
cd frontend && npm start
```

**Verificación:**
```bash
curl -s http://127.0.0.1:8000/api/
# → {"message":"Valuation Studio API","version":"1.0"}

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
# → 200
```
En el navegador: home sin splash permanente de “Despertando los servidores…”.

---

### Paso 3 — Yahoo Finance + FX (sin claves)

**Archivos:**
- Cotizaciones: `backend/services/valuation.py`, `backend/server.py` (`GET /api/company/{ticker}`)
- FX: `backend/fx.py` (`GET /api/fx`)

**Verificación:**
```bash
curl -s 'http://127.0.0.1:8000/api/company/AAPL' | head -c 400
curl -s 'http://127.0.0.1:8000/api/fx' | head -c 200
curl -s 'http://127.0.0.1:8000/api/search?q=AAPL'
```
En UI: busca `AAPL` → ficha con ratios. Si falla, suele ser red/Yahoo, no `.env`.

---

### Paso 4 — Google OAuth (login + sync Nivel I/II)

**Archivos:**
- Backend: `backend/auth.py` (`POST /api/auth/google`, `/auth/me`, watchlist/portfolio)
- Frontend: `frontend/src/lib/googleAuth.js`, `pages/GoogleCallback.jsx`, `components/AuthButton.jsx`

**Config:**
```env
# backend/.env
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
PUBLIC_APP_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000

# frontend/.env  (reiniciar npm start)
REACT_APP_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
```

**Google Cloud Console:**
- Orígenes JS: `http://localhost:3000`
- Redirect: `http://localhost:3000/auth/google`

**Verificación:**
```bash
# Sin sesión → 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/auth/me

# OAuth mal configurado → "Google OAuth no configurado"
# OAuth OK + code inválido → "No se pudo validar el código con Google"
curl -s -X POST http://127.0.0.1:8000/api/auth/google \
  -H 'Content-Type: application/json' \
  -d '{"code":"x","redirect_uri":"http://localhost:3000/auth/google"}'
```
En UI: **Entrar** → Google → Nivel 1 / Nivel 2 con tus datos importados.

---

### Paso 5 — LLM (tesis, KPIs, chat, moderación)

**Archivos:**
- Stub local: `backend/emergentintegrations/llm/chat.py`
- Orquestación: `services/thesis.py`, `services/kpi.py`, `services/llm.py`, `routes/thesis.py`, `routes/help.py`, `routes/community.py`, `server.py` (traducciones)

**Config (elige una):**
```env
OPENAI_API_KEY=sk-...
# o ANTHROPIC_API_KEY=sk-ant-...
# o GEMINI_API_KEY=...
EMERGENT_LLM_KEY=   # puede quedar vacío en local
```

Reinicia el backend tras cambiar `.env`.

**Verificación:**
```bash
# En logs del backend, una tesis sin clave → "LlmChat mock mode"
# Con clave: genera texto real en /thesis
```
En UI: Tesis → explorar tendencia o generar; Help chat; KPIs IA.

**Búsqueda web (Tavily):** `services/thesis.py` + `TAVILY_API_KEY` — se usa junto al LLM.

---

### Paso 6 — FRED (Macro)

**Archivo:** `backend/services/macro.py` → rutas en `routes/macro.py` → UI `/macro`

**Config:**
```env
FRED_API_KEY=tu_clave_fred
```

**Verificación:**
```bash
curl -s 'http://127.0.0.1:8000/api/macro' | head -c 300
```
Esperado: indicadores (Fed funds, CPI, etc.). Sin clave → error 500 / KeyError.

---

### Paso 7 — Resend (emails opcionales)

**Archivos:** `backend/screener.py`, `backend/radar.py`  
Triggers: `POST /api/admin/run-screener`, `POST /api/admin/run-radar`

**Config:**
```env
RESEND_API_KEY=re_...
SENDER_EMAIL=onboarding@resend.dev
PUBLIC_APP_URL=http://localhost:3000
```

**Verificación:**
```bash
curl -s -X POST http://127.0.0.1:8000/api/admin/run-screener
# Revisa logs: "RESEND_API_KEY not configured" vs email enviado
```
En UI: con login + alertas activadas en Nivel 1/2.

---

### Paso 8 — Admin (opcional)

**Archivos:** `routes/feedback.py`, `routes/community.py`

```env
ADMIN_EMAIL=joseaq.2m@gmail.com
```

Verificación: tras login con ese email, rutas `/admin` feedback / moderación comunidad (no 403).

---

### Paso 9 — Producción (MongoDB Atlas + hosting)

1. Crear cluster Atlas → URI `mongodb+srv://...`
2. Importar backup:
   ```bash
   ./venv/bin/python ../scripts/import_user_backup.py \
     --in ../mongo-backup/user-export.json \
     --url 'mongodb+srv://...' \
     --db valuation_studio
   ```
3. En producción:
   ```env
   MONGO_URL=mongodb+srv://...
   DB_NAME=valuation_studio
   CORS_ORIGINS=https://tu-dominio.com
   PUBLIC_APP_URL=https://tu-dominio.com
   ```
4. Google Console: añadir origen y redirect del dominio real.
5. Frontend build: `REACT_APP_BACKEND_URL=https://api.tu-dominio.com`

**Pendiente de código:** `storage.py` sigue apuntando a Emergent object storage — PDFs KPI requieren S3/R2 u otro storage.

---

## 3. Arranque diario (checklist)

```bash
# 1) Mongo + backend
cd ~/Desktop/valuation-studio && ./scripts/dev-local.sh

# 2) Frontend (otra terminal)
cd ~/Desktop/valuation-studio/frontend && npm start

# 3) Abrir
open http://localhost:3000
```

Tras cambiar **cualquier** `REACT_APP_*`, reinicia `npm start`.  
Tras cambiar `backend/.env`, reinicia uvicorn (`Ctrl+C` + `./scripts/dev-local.sh`).

---

## 4. Scripts útiles de datos

| Script | Uso |
|---|---|
| `scripts/export_via_api.py` | Exportar tu cuenta desde preview Emergent (con `vs:token`) |
| `scripts/import_user_backup.py` | Importar ese JSON a Mongo local/Atlas |
| `scripts/mongo_dump.py` / `mongo_restore.py` | Dump/restore por colecciones (si hay acceso directo a Mongo) |
| `scripts/migrate_mongo.py` | Copiar remote→local cuando `MONGO_URL` sea alcanzable |
| `GET /api/admin/export-database?secret=` | Export completo si `EXPORT_SECRET` está definido |

---

## 5. Qué ya funciona vs qué falta en tu setup

| Capacidad | Estado |
|---|---|
| App local + UI | ✅ |
| Mongo + datos Emergent (196 tesis, 38+9 tickers) | ✅ |
| Login Google | ✅ (si secret/redirect OK) |
| Yahoo / FX / búsqueda | ✅ sin claves |
| Tesis / KPIs con IA real | ❌ falta clave LLM |
| Página Macro | ❌ falta `FRED_API_KEY` |
| Emails alerta | ❌ falta Resend |
| Subida PDFs KPI | ❌ storage Emergent |
| Producción independiente | ⏳ Atlas + hosting + storage |
