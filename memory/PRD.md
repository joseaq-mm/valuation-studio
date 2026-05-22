# Valuation Studio — PRD

## Problema original
> tengo un excel donde entro a mano datos fundamentales y precio de acciones y a través de formulas que yo he implementado obtengo ratios que me dan una idea de lo cara o barata que esta una empresa. me gustaria hacer algo así en una app, que pudiera ingerir datos, hacer esos calculos y devolver esos ratios para cualquier empresa y que siempre estuviera actualizada.

## Fórmulas del usuario (implementadas exactas)
- **POC** = (revenue_2y / shares) × (1 + gross_margin) × ((fcf_2y − net_debt) / market_cap × 100) × (1 + revenue_cagr_4y) × (1 + fcf_cagr_4y)
- **Ratio Compra** = (POC / current_price − 1) × 100, en %
- **POV** = POC × (1 + operating_margin)
- **Ratio Venta** = (POV / current_price − 1) × 100, en %

## Stack
- **Backend**: FastAPI + Motor (MongoDB) + yfinance (sin API key, mercados globales).
- **Frontend**: React 19 + Tailwind + shadcn/ui + Recharts + sonner. Tipografías Cormorant Garamond + IBM Plex Sans/Mono.
- **Estética**: Financial Times (salmón #FDF1E6) + Bloomberg dense grid. Sharp borders 0 radius.

## Personas
- Inversor retail con sistema propio en Excel. Usuario único, sin login.

## Implementado (Feb 2026)
- `GET /api/company/{ticker}` — fundamentals + auto-projections + custom_ratios (cacheado 6h en Mongo).
- `POST /api/company/{ticker}/calculate` — recálculo en vivo con inputs editables.
- `GET /api/compare?tickers=...` — comparación side-by-side (1-6 tickers).
- `GET /api/search?q=...` — autocompletado de tickers.
- Frontend: Home (hero + accesos rápidos), Company (KPIs hero, inputs editables, ratios clásicos, gráficos de ingresos/FCF, breakdown POC), Watchlist (localStorage), Compare (tabla densa).
- Soporte global: AAPL, SAP.DE, SAN.MC, VOD.L, ASML.AS, etc.
- Formato europeo es-ES en todos los números: miles con `.`, decimales con `,`. Ratios % a 1 decimal; resto a 2 decimales. Inputs editables aceptan formato europeo y se parsean automáticamente.

## Decisiones de diseño / pitfalls (no romper)
- **Proyecciones automáticas (`fetch_fundamentals_sync` en server.py)**:
  - **NO usar `info["earningsGrowth"]`** como proxy de crecimiento. Es el cambio de BPA interanual del último trimestre, muy volátil (ej. Uber Feb 2026: −84,6% que rompe completamente las proyecciones). Usar solo `revenueGrowth` (anualizado) si hace falta fallback.
  - **Revenue 2y**: derivar crecimiento implícito de (`revenue_estimate['+1y']` / último año real) y proyectar +1 año más con ese mismo crecimiento. Capado a ±50% y mínimo −30%.
  - **FCF base — usar TTM, NO anual cerrado** (decisión Feb 2026, opción B confirmada por usuario). `latest_fcf = info["freeCashflow"]` (TTM) cuando es positivo; fallback a `fcf_history[-1]` solo si TTM no está disponible. Razón: TTM es más actual y captura el ritmo reciente del negocio, especialmente importante en empresas cíclicas como Micron donde el último FY cerrado puede no reflejar la situación actual.
  - **FCF 2y**: `latest_fcf × (1 + fcf_growth_fwd)²`. Crecimiento usa CAGR histórico real del propio FCF (no de EPS). Capado a ±50% / −30% para evitar extrapolaciones absurdas cuando la base histórica es muy pequeña.
  - **CAGR 4y para la fórmula POC**: 2 años hacia atrás (revenue_history[-3]) y 2 hacia delante (revenue_2y proyectado), n=4. Si falla por valores negativos en histórico, fallback en cascada: (a) `latest → fcf_2y` sobre 2y, (b) `fcf_growth_fwd` capado, (c) 0% (plano).
  - **Flags de proyección extrema**: `auto_projections.flags` expone `revenue_projection_capped`, `revenue_analyst_suspicious`, `fcf_projection_capped`, `fcf_history_has_negatives`, `fcf_cagr_fallback`, `revenue_cagr_fallback`. El frontend muestra avisos visuales cuando alguno es true.
- **Cálculo de ratios custom** (`compute_custom_ratios`): la fórmula POC del usuario es:
  `POC = (revenue_2y/shares) × (1+gross_margin) × ((fcf_2y - net_debt)/market_cap × 100) × (1+rev_cagr_4y) × (1+fcf_cagr_4y)`
  Si se modifica algún parámetro (cap, fórmula, fields fuente), validar con AAPL (rev_cagr_4y debe ser positivo ~+13%) y UBER (ambos CAGR positivos).
- **MongoDB**: nunca devolver `_id`, usar proyección `{"_id": 0}` en todas las queries.

## Backlog priorizado
- **P0 (siguiente sesión)** — **Watchlist con snapshots manuales** (spec confirmada por usuario Feb 2026):
  - localStorage pasa de `["AAPL"]` a `[{ticker, mode: "auto"|"manual", overrides: {...inputs} | null, saved_at}]`.
  - Botón "Añadir a watchlist" actúa como "Guardar snapshot": si el usuario ha editado inputs, se guardan con `mode: manual`; si no, se guarda solo el ticker en `mode: auto`.
  - Al volver a clicar "Añadir a watchlist" sobre un ticker ya guardado: modal de confirmación de sobrescritura.
  - En la página Company, al cargar un ticker MANUAL desde watchlist: aplicar los `overrides` a `inputs`, recalcular ratios. Inputs editados en sesión actual con color ámbar/cursiva; valores guardados (no editados) en verde; auto en negro.
  - Aviso al navegar fuera de la página con cambios pendientes (React Router `useBlocker` + opcional `beforeunload` para cerrar pestaña).
  - Badge "MANUAL" en la tabla de watchlist junto al ticker.
  - Endpoint `/api/compare` debe aceptar overrides por ticker, O recomputar en frontend cuando hay overrides.
  - Decisiones tomadas: snapshot **completo** de los 10 inputs (no solo deltas); precio actual **NO** se guarda (siempre desde Yahoo, para que ratios % se actualicen con el mercado); confirmar tipo de aviso `beforeunload` con usuario.
- **P1** — Histórico de ratios (gráfico de evolución temporal de Ratio Compra/Venta).
- **P1** — Umbrales de señal configurables por el usuario (sliders cheap/expensive).
- **P1** — Aviso visual cuando una proyección automática viene de un CAGR extremo (capado), para que el usuario sepa que debe revisar manualmente.
- **P2** — Exportar análisis a PDF / Excel.
- **P2** — Modo "Sensibilidad": cómo cambia POC al variar márgenes/crecimientos ±10%.
- **P2** — Login (Emergent Google Auth) para sincronizar watchlist entre dispositivos.
- **P2** — Alertas por email cuando Ratio Compra cruza un umbral (SendGrid/Resend).
- **P2** — Screener nocturno sobre watchlist: notifica solo cuando una empresa cruza de rojo a verde.
- **P3** — Soporte multimoneda con conversión FX para comparar empresas globales.
- **P3** — Modo oscuro alternativo.
