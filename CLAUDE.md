# Valuation Studio

Plataforma de análisis fundamental y cualitativo de empresas cotizadas: ratios de valoración (Yahoo Finance), tesis de inversión con IA, validación de KPIs, watchlist/cartera sincronizada, macro (FRED) y comunidad.

## Stack tecnológico

### Frontend (`frontend/`)
- **React 19** + **React Router 7** + **Create React App** (Craco)
- **Tailwind CSS**, **Radix UI**, **TanStack Query**, **Recharts**, **Axios**
- Auth Google OAuth (Authorization Code) → `frontend/src/lib/googleAuth.js`

### Backend (`backend/`)
- **Python 3.14** + **FastAPI** + **Uvicorn**
- **Motor** (MongoDB async), **APScheduler** (crons: screener, radar, alertas)
- IA: **LiteLLM** (Gemini, Anthropic) + **Tavily** (búsqueda web)
- Datos mercado: **yfinance**, tipos de cambio vía API pública
- Macro: **FRED** + OWID (CSV)
- Archivos (PDFs KPI, exports): **Cloudflare R2** (S3/boto3) o disco local (`.local/blobs/`)
- Emails: **Resend**

### Datos e infraestructura
- **MongoDB Atlas** — fuente de verdad (tesis, usuarios, watchlist, KPIs metadatos)
- **Cloudflare R2** — blobs (PDFs, imágenes, shares)
- Variables: `backend/.env`, `frontend/.env` (plantillas en `*.env.example`)

## Estructura rápida

```
backend/server.py          # Entrada FastAPI, scheduler, rutas base
backend/routes/            # thesis, help, macro, community, feedback, share…
backend/services/          # thesis, kpi, llm, macro, valuation
frontend/src/pages/        # Home, Company, Thesis, Kpis, Macro, Watchlist…
scripts/dev-local.sh       # Mongo portable + backend (solo macOS/local)
docs/CONNECTION_GUIDE.md   # Guía detallada de servicios externos
```

## Configuración inicial

```bash
# Backend
cp backend/.env.example backend/.env   # rellenar MONGO_URL, claves API…
cd backend && python3 -m venv venv
./venv/bin/python -m pip install -r requirements.txt

# Frontend
cp frontend/.env.example frontend/.env
cd frontend && npm install
```

## Arranque local

**Opción A — script (Mongo embebido + backend):**
```bash
./scripts/dev-local.sh
# otra terminal:
cd frontend && npm start
```

**Opción B — manual (Mongo/Atlas ya configurado):**
```bash
cd backend && ./venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload
cd frontend && npm start
```

- Frontend: http://localhost:3000  
- API: http://localhost:8000/api/  
- Tras cambiar `REACT_APP_*` → reiniciar `npm start`. Tras cambiar `backend/.env` → reiniciar uvicorn.

## Compilar (producción)

```bash
cd frontend
REACT_APP_BACKEND_URL=https://api.tu-dominio.com npm run build
# salida en frontend/build/
```

## Tests

**Backend (pytest, muchos son e2e contra API en marcha):**
```bash
cd backend
REACT_APP_BACKEND_URL=http://127.0.0.1:8000 ./venv/bin/python -m pytest tests/ -q
# un módulo concreto:
./venv/bin/python -m pytest tests/test_feedback.py -q
```

**Frontend:**
```bash
cd frontend && npm test
```

**Smoke manual API:**
```bash
curl -s http://127.0.0.1:8000/api/
curl -s 'http://127.0.0.1:8000/api/company/AAPL' | head -c 200
```

## Comandos admin útiles (QA)

```bash
curl -X POST http://127.0.0.1:8000/api/admin/run-screener
curl -X POST http://127.0.0.1:8000/api/admin/run-radar
```

## Servicios externos (resumen)

| Variable | Servicio |
|---|---|
| `MONGO_URL`, `DB_NAME` | MongoDB Atlas |
| `GOOGLE_CLIENT_*` | Login Google |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | IA (tesis, KPIs, chat) |
| `TAVILY_API_KEY` | Búsqueda web en tesis |
| `FRED_API_KEY` | Panel macro |
| `R2_*` | Archivos en Cloudflare R2 |
| `RESEND_API_KEY` | Emails de alertas |
| `ADMIN_EMAIL` | Panel admin feedback/comunidad |

Detalle paso a paso: `docs/CONNECTION_GUIDE.md`.

## Convención de tarjetas de gráficos (frontend)

Toda tarjeta cuyo contenido principal sea un gráfico (Recharts u otro) debe seguir esta cabecera, sin necesidad de que se pida cada vez:

- **Fila de cabecera**: icono + título, y **justo a continuación del título** (mismo renglón, pegado) el icono de información (ⓘ) con su tooltip explicativo — no al otro extremo de la fila.
- **Esquina superior derecha**: el icono de ampliar (⛶ `Maximize2`), separado, como única acción en ese lado.
- **Al ampliar (modal)**: debe ofrecer **compartir** (`ShareMenu`) y **descargar en JPG** (`downloadSvgJpg`/`getSvgJpgBlob`), además de cerrar — igual que `HighYieldSpreadModal`/`DebtModal`/`TrendModal`/`CoefHistoryModal` en `frontend/src/pages/Macro.jsx`.

Esto aplica a tarjetas cuyo contenido principal ES un gráfico (p. ej. spread de high yield, deuda/PIB, evolución 10 años). No aplica a tarjetas sin gráfico (valor simple, dial/slider, desglose en barras) ni a mini-gráficos incrustados como sub-widget dentro de una tarjeta mayor (p. ej. el histórico dentro de la tarjeta del coeficiente), que mantienen su propio patrón anidado salvo que se indique lo contrario.
