# CHANGELOG — Valuation Studio

> Histórico de implementaciones. PRD.md = problema/arquitectura estática.

## 20-21 jun 2026 — Visual + KPIs (Opción A) + Home/Compare/ETFs

### /visual — Coeficiente KPI + aguja
- Backend `/api/thesis/visual`: cada fila lleva `kpi_coef` (cruce ticker → última tesis de empresa con `kpi_snapshot.coef_global`).
- Columna **Coef KPI** tras TAM Score (color verde>1.05 / ámbar / rojo<0.95, "—" sin análisis). Ordenable.
- Combinados con **factor relativo**: `neutro=(1+mediaC)/2`, `factor=clamp(1+0.5·(C−neutro),0.6,1.4)`. Modula el Combinado cualitativo y, vía éste, el total → cuenta UNA vez. Empresas sin KPI: factor=1 y fuera de mediaC + aviso bajo la tabla.
- **Aguja KPI** en el cuadrante (`KpiNeedle` en `Visual.jsx`): radial desde el borde del círculo; dirección por matriz 2×2 (absoluto C↔1 = dcha/izq · relativo C↔media = arriba/abajo) → verde ↗ / ámbar ↘↖ / rojo ↙; inclinación 0–45° y longitud ∝ |C−media| normalizada. Sin aguja = sin KPI. Leyenda + tooltip Coef KPI.

### /kpis — documentos, noticias, avisos
- **Drag & drop** de documentos (`KpiDocuments.jsx`): overlay al arrastrar, múltiples archivos, valida formato/tamaño/cap 10.
- **Noticias colapsables** (`KpiNews.jsx`): plegado por defecto con badge de conteo + desglose sentimiento (N · X+ · Y−). Se expande al pulsar; "Buscar noticias" lo abre.
- **Aviso de áreas sin KPIs** junto al coeficiente global (`Kpis.jsx`): si algún driver tiene `n_kpis:0`, caja ámbar listando las áreas → "busca/desarrolla KPIs para validación más fiable". Verificado en HIMS.
- **Descarga** de documentos auto/manuales: endpoint `/download` acepta cookie (`session_token`) + Content-Disposition; `api.kpiFileDownload` (blob). Botón ⬇ en filas con storage.
- **Aviso de documento equivalente más nuevo**: helpers `_doc_family`/`_period_rank`/`_find_superseded` (Jaccard≥0.6 de familia sin periodo, rank año·4+Q). Campo `supersedes` en el doc; UI ámbar con "Mantener ambos" (PATCH `dismiss_supersedes` → $unset) y "Borrar el antiguo" (delete + dismiss).

### Extractor de KPIs — multi-sector
- `EXTRACTOR_SYS` ampliado a familias no-SaaS (auto/hardware, energía, semis, retail/e-commerce, banca/fintech, salud, telecom, transporte…). `gather_kpi_sources` agnóstico de sector (+query `filetype:pdf`).

### Opción A — lectura de contenido completo + auto-ingesta
- Nuevo `services/fetcher.py`: abre los mejores resultados (HTML→texto, 6 pág, 40k chars, 35s) y descarga **1 PDF** de inversores. Filtro `_pdf_relevant`: empresa (ticker/nombre) en **URL o título** + señal de doc de inversores; rechaza informes de fondos/terceros (ARK) y tesis. Orden por prioridad (PDF/IR primero).
- Nuevo `services/sec.py`: **fallback SEC EDGAR** cuando no hay deck PDF (solo US filers; salta foráneos .DE/.MC). Baja el último 10-Q/10-K, recorta desde MD&A/Results of Operations.
- `_auto_fetch_for_kpis` (routes): enriquece sources + ingiere PDF/SEC como doc **kind="auto"** (`auto_fetched`, `source_url`, re-etiquetado IA, dedupe por URL=caché, respeta cap 10). Badge "AUTO · WEB" + enlace fuente. `_kpi_sync` acepta `web_sources`. Tope doc-source 6k→9k.
- Verificado: Tesla 1→8 KPIs (deck oficial), Circle 3→6 KPIs (10-Q SEC).

### Home / Compare / Explorar
- `/kpis`: empresas aparecen solo cuando la tesis está **completamente desarrollada** (`company_is_complete`) — confirmado por el usuario tras prueba.
- **Home** (`HomeSearch.jsx`): buscador destacado (sombra navy + autocompletado) a la altura de la explicación, derecha. Explicación (`home.hero_sub`) y pasos (`method_01..03` = Valora / Construye la tesis / Valida y decide) actualizados ES+EN.
- **Comparar**: filas Score cualitativo, TAM Score, Coef KPI (desde `thesisVisualData` por ticker).
- **Empresa** (`CompanyQualCard.jsx`): "También aparece en" desplegable colapsado + textos ("desde las tesis desarrolladas desde los planes de otras empresas" / "coherencia con el plan de esta empresa").
- **Explorar — ETFs/Fondos temáticos** (`run_trend_explore` → `etfs[]`): nombre completo, gestora, ticker, universo de inversión exacto, **sin ISIN**. Título enlaza a búsqueda de la fuente. Etiqueta de ajuste **Pura/Alta/Parcial** (`fit`/`fit_note`) ordenado por especificidad; honesto cuando no hay pure-play (ej. memoria edge → SMH/SOXX "Parcial"). UI en `TendenciaResult.jsx`.
- **Cartera + Watchlist (Jun 2026):** añadidas columnas **Score / TAM / Coef KPI** (desde `thesisVisualData` por ticker, mismo origen que Comparar), ubicadas tras los ratios RC/RV y antes de alertas. Sortables, colores idénticos a Comparar (Score ≥70 verde/≥50 ámbar/<50 rojo; Coef KPI >1.05 verde/<0.95 rojo). Tabla con scroll horizontal y **columnas de identidad fijas (sticky)**: Ticker en Cartera; Ticker+Empresa en Watchlist. i18n: `metrics.score/tam/kpi`.
- **Renombrado Cartera→Nivel 1, Watchlist→Nivel 2 (Jun 2026):** cambio global de la nomenclatura visible en toda la app (nav, títulos/tags de página, botones y modales de `Company.jsx`, toasts, `Instructions.jsx`, tour, `HelpChat`, `AuthButton` sync, banners de alertas, Comparar "Cargar Nivel 2"). Añadidos **tooltips en el nav** (`nav.portfolio_tip`/`nav.watchlist_tip` ES+EN): Nivel 1 = acciones preferidas; Nivel 2 = acciones que no son preferidas pero interesan. EN = Level 1 / Level 2. NO se tocaron rutas, claves de localStorage ni identificadores de código.
- **Company.jsx:** reducido un poco el tamaño de letra del cuerpo del recuadro "Avisos sobre las proyecciones automáticas" (`text-sm`→`text-[13px] leading-snug`); la nota de Recomendación (`text-xs`) se mantiene intacta.

## 2026-06-28 — Fix lectura de PDFs (causa raíz) + pypdf + reintento
- **BUG CRÍTICO (causa raíz):** la línea `def _doc_extract_sync(...)` se había borrado en el último commit; su cuerpo quedó como código muerto tras el `return` de `_period_rank`, dejando la función SIN DEFINIR. Resultado: TODA subida de PDF/imagen fallaba con "No se pudo leer el documento" (`NameError: name '_doc_extract_sync' is not defined`). **Restaurada** la definición en `routes/thesis.py`.
- **Extracción local con `pypdf` (primaria):** `extract_pdf_text_local()` en `services/kpi.py` saca el texto de PDFs basados en texto sin coste de visión; se digiere con una llamada Gemini Flash de TEXTO (barata). Solo PDFs escaneados/gráficos e imágenes caen al lector multimodal. Añadido `pypdf==6.14.2` a requirements.
- **Reintentos multimodal:** `extract_document_text()` ahora reintenta 2-3 veces (los docs largos/pesados a veces hacían timeout y quedaban ilegibles).
- **Reintentar lectura (UI + API):** nuevo `POST /api/thesis/{company_id}/kpis/files/{file_id}/retry` (re-descarga bytes de storage, status→processing, relanza extractor). Botón "Reintentar lectura" (`kpi-file-retry-{id}`) en `KpiDocuments.jsx` para docs en estado `error` con archivo descargable. `kpiFileRetry` en `lib/api.js`.
- **Verificado (self-test, sin testing_agent):** pypdf extrae texto OK; subida e2e PDF → status `ready`, auto-nombrado "Informe resultados Q3 2025", texto correcto; endpoint retry error→processing→ready OK; página /kpis renderiza sin errores.

## 2026-06-29 — Página Macro (panel macro EEUU vía FRED)
- **Nueva fuente:** FRED (Reserva Federal de St. Louis), API key gratuita en `backend/.env` → `FRED_API_KEY`. Datos oficiales, dominio público.
- **Backend:** `services/macro.py` (fetch concurrente httpx + derivadas + caché Mongo `macro_cache`, TTL 6h) y `routes/macro.py` → `GET /api/macro/indicators?refresh=`. Registrado en `server.py`.
- **6 indicadores:**
  1. Indicador Buffett (proxy) = `NCBEILQ027S` (renta variable corp. no financiera, $M→$B) ÷ `GDP` ($B) ×100. (Wilshire 5000 ya no está en FRED desde 2023 → se usa este proxy; da ~218%, muy cercano al real).
  2. Tipo FED = `FEDFUNDS` (%).
  3. Inflación IPC interanual = `CPIAUCSL` YoY %.
  4. Productividad = `OPHNFB` YoY % (+ índice 2017=100).
  5. M2 crecimiento = `M2SL` YoY % (+ nivel $B).
  6. Petróleo WTI = `DCOILWTICO` ($/barril, + var. ~30 días).
- **Frontend:** `pages/Macro.jsx` (grid de tarjetas con icono, valor en serif, unidad, interpretación, línea de contexto, frecuencia y fecha del dato), ruta `/macro` en `App.js`, enlace "Macro" en el nav (`Layout.jsx`), `macroIndicators` en `lib/api.js`. Cada tarjeta tiene **tooltip** (icono Info) que explica qué mide, interpretación (↑/↓), unidades/moneda, frecuencia y fuente.
- **Verificado (self-test):** `GET /api/macro/indicators` devuelve los 6 con valores correctos; página `/macro` renderiza y los tooltips muestran la explicación completa. Página pública (no requiere login).
- **PENDIENTE (mañana):** definir la fórmula del coeficiente cara/barata (>1 barato, <1 caro) combinando los 6 factores con pesos.

## Backlog anotado (29-jun-2026)
- [Macro · futuro] Guardar un **histórico del coeficiente** cara/barata + mini-gráfico de tendencia en la página Macro ("¿el mercado está cada vez más caro o más barato?"). Aprobado por el usuario para implementar MÁS TARDE (después de definir la fórmula del coeficiente).

## Coeficiente Macro cara/barata — DISEÑO EN CURSO (29-jun-2026, NO IMPLEMENTAR aún)
Usuario hará pruebas de cálculo y decidirá normalización (punto 1) y tratamiento de factores absolutos/nivel (punto 4). "De momento no hagas nada."

### CONFIRMADO por el usuario:
- **4 áreas, peso 25% cada una:**
  1. PRECIO DEL MERCADO (base) = Indicador Buffett.
  2. FACILIDAD PARA CREAR DINERO (sube precios) = Tipo FED + Inflación.
  3. PRODUCTIVIDAD (baja precios) = Productividad + Petróleo.
  4. CREACIÓN REAL DE DINERO = M2.
- **Métricas que alimentan cada factor (punto 2 confirmado):**
  - Buffett: valor actual (%). Tipo FED: valor actual (%). Inflación: IPC interanual (%).
  - Productividad: **NIVEL del índice OPHNFB (2017=100)**, NO la variación.
  - M2: **NIVEL en miles de M$ (M2SL)**, NO la variación YoY.
  - Petróleo: precio actual ($/barril).
- **Signos:** Buffett +, Tipo FED +, Inflación +, Productividad −, M2 −, Petróleo +.
- **Combinación (punto 3 confirmado):** dentro de cada área media de factores; S global = media de las 4 áreas (equiponderadas) ∈ [−1,+1]. **C = 1 + 0,3·S**, recortado a **[0,7 – 1,3]**. Fuera de rango → recortar pero mostrar **AVISO** (mercado extremadamente caro/barato).
- **Significado de los extremos:** C=0,7 → mercado barato, aumentar exposición ~30% a renta variable / empresas de alto crecimiento. C=1,3 → caro, tener ~30% en efectivo o defensivas.
- **Punto 5 confirmado:** las listas de empresas las propone el AGENTE. Defensivas sugeridas: KO, PG, JNJ, WM (revisar). Alto crecimiento sugeridas: NVDA, PLTR, TSLA, SHOP (revisar). Mostrar como ejemplo en los extremos del índice.
- Áreas/factores/coeficiente y su significado (literal + teoría) → como TOOLTIPS en la futura página.

### PENDIENTE DE DECISIÓN DEL USUARIO (tras sus pruebas):
- **Punto 1 — Normalización:** z-score vs historia (~20a, ±2σ) vs percentil histórico vs OTRA que proponga el usuario. SIN DECIDIR.
- **Punto 4 — Factores de nivel monotónico (productividad-nivel y M2-nivel):** nivel absoluto puro (a) vs aceleración/variación respecto a tendencia (b) vs OTRA. SIN DECIDIR. (El usuario quiere darle una vuelta; su teoría: el precio de mercado es el resultado de fuerzas opuestas — productividad baja precios, creación de dinero los sube, y el nivel de M2 eleva el precio admisible de los activos = transición de economía del trabajo a economía de creación/propiedad.)
