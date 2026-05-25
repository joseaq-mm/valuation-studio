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
- **✅ COMPLETADO (Feb 2026)** — **POC/POV más visibles y avisos de anomalía**: aumentado el tamaño/contraste de POC/POV en hero cards (text-lg, negro, semibold). Nuevo panel rojo `poc-pov-anomalies` que detecta automáticamente tres casos y explica el porqué con datos: (a) POC ≤ 0 señalando qué factor (gross margin, x_raw, CAGRs, etc.) está colapsando, (b) POV < POC por margen operativo negativo (muestra el factor y resultante), (c) POV ≤ 0 con POC > 0 por margen operativo < −100%.
- **✅ COMPLETADO (Feb 2026)** — **Tooltips ricos en POC/POV y desglose**: componente `HoverTip` con posicionamiento fixed + clamping de viewport. POC y POV en hero cards muestran "Precio Objetivo de Compra/Venta" al pasar el cursor. Las 8 etiquetas del desglose muestran el cálculo concreto (con valores actuales sustituidos) y reglas de ajuste de factores especiales.
- **✅ COMPLETADO (Mayo 2026)** — **Watchlist con snapshots manuales** según spec del usuario:
  - localStorage v2: `[{ticker, mode: "auto"|"manual", overrides: {field: value, ...} | null, saved_at}]`. Migración automática desde v1 legacy (`["AAPL", ...]`).
  - Solo se persisten los **deltas** (campos modificados respecto al auto de Yahoo). Precio NUNCA se guarda (siempre fresco).
  - Botón "Añadir a watchlist" → "En watchlist" → "Guardar cambios" según estado. Badge `MANUAL` visible en cabecera y en tabla.
  - Inputs con tres colores: **negro** = auto Yahoo, **verde** = guardado por usuario, **ámbar/cursiva** = editado en sesión sin guardar. Indicador ● status por input.
  - Modal de confirmación al sobrescribir snapshot existente.
  - Modal de aviso al navegar con cambios sin guardar (interceptor manual de clicks en links, sin `useBlocker` porque la app no usa data router) + `beforeunload` para cierre de pestaña/refresh.
  - Watchlist y compare aplican overrides client-side vía `customRatios.js` (réplica JS de la fórmula del backend) → ratios reflejan tu análisis manual.
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
