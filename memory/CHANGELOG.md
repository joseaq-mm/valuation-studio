# CHANGELOG — Valuation Studio

> Histórico de implementaciones. PRD.md = problema/arquitectura estática.

## 18 jul 2026 — Visual: filtro "Nivel" (Nivel 1 / Nivel 2 / Ambas)
- Nuevo control segmentado **"Nivel"** en la sección de Filtros de `/visual`: Ambas (por defecto) · Nivel 1 (solo Cartera) · Nivel 2 (solo Seguimiento).
- Membresía leída de localStorage (`getPortfolio` = Nivel 1, `getWatchlistTickers` = Nivel 2), sincronizada con la nube por `WatchlistCloudSync`; se actualiza en vivo vía eventos `vs:portfolio-changed` / `vs:watchlist-changed`.
- Integrado en `passesFilters` (afecta tabla + mapa) y en Reset. `Visual.jsx`. data-testids: `filter-level`, `filter-level-both|n1|n2`.
- Verificado en vivo: "Ambas" 38/38; "Nivel 2" filtra a 1 (RMBS, la única de seguimiento presente en la tabla).


## 18 jul 2026 — Tabla Visual: nueva columna "Ant. result." + ahorro de espacio
- Añadida columna **"Ant. result."** (`last_earnings_date`, últimos resultados publicados) entre "Tesis" y "Próx. result." → `LastEarningsBadge` (gris, no coloreado, ordenable).
- Renombrada columna **"Actualiz." → "Tesis"** (tooltip sin cambios).
- **Campanita de alerta** movida junto al nombre de la empresa (eliminada su columna dedicada) para dejar sitio a la nueva columna. `Visual.jsx`.
- Verificado en vivo (usuario real, 38 filas): las 38 con Ant. result., 29 con Próx. result. (9 vacías correctas), campanita inline junto al nombre.


## 18 jul 2026 — Fix: "Próx. result." nunca puede ser una fecha pasada- Causa raíz: `next_earnings_date` se tomaba de `info.get("earningsTimestamp")` de yfinance sin validar que fuese futura; Yahoo suele devolver ahí la fecha del ÚLTIMO resultado ya publicado (pasado).
- `services/valuation.py`: `earningsTimestamp` solo se acepta si `>= hoy`; se prioriza la fecha futura más próxima del calendario `get_earnings_dates`; guard final que anula cualquier fecha < hoy. Si no hay fecha futura → `None` (celda vacía).
- `routes/thesis.py`: nuevo helper `_future_earnings_date()` aplicado en tiempo de lectura en `/visual` y en el endpoint de KPIs, para que la caché existente (10 empresas con fecha pasada: SOUN, CRCL, CRWD, IOVA, MDB, SNOW, PATH, AVGO, IONQ, MU) tampoco muestre fechas pasadas sin necesidad de refrescar.
- Verificado con `python -c` (helper) + inspección directa de `db.fundamentals`.


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

## 2026-07-01 — KPIs: orden por coeficiente + auto-descarga informe (A) + aviso sin fuente (E)
- **Orden "Por coeficiente"** en `Kpis.jsx`: 4º botón de orden (mayor→menor; empresas sin coeficiente al final). `data-testid="kpi-sort-coef"`. Verificado (render + lógica comparador).
- **A (mejor cobertura de descarga automática del informe oficial):**
  - `fetcher.py`: `FETCH_MAX_PDFS` 1→3, `FETCH_MAX_ATTEMPTS` 12→18, `FETCH_PDF_MAX_BYTES` 15→25 MB, `_DEADLINE_SECS` 35→50.
  - `_pdf_relevant` **relajado**: acepta PDFs en dominios de IR fuertes (`ir.`, `/investor`, `investor.`, `sec.gov`, **`q4cdn`/`q4inc`** — CDN dominante de decks con nombre hasheado) aunque el nombre/ticker no esté en la URL; mantiene el rechazo de PDFs ajenos (fondos que solo mencionan la empresa en el cuerpo). Verificado con casos unitarios.
  - **A3 · fallback HTML** en `_auto_fetch_for_kpis` (`routes/thesis.py`): si no hay deck PDF ni informe SEC y la empresa no tiene documento auto, **ingiere la mejor página de resultados/IR** ya leída como documento auto (`kind:auto`, `ext:htm`, texto extraído = contenido limpio de la página). Así siempre hay una fuente.
- **E (aviso honesto):** el snapshot marca `no_source_doc=True` cuando no hay ningún documento fuente disponible; `Kpis.jsx` muestra un **aviso rojo** (`kpi-no-source-warning`) indicando subir el PDF o pegar el transcript. Verificado en pantalla.
- **Nota:** A2/E verificados (unit test + screenshot). A3 no se probó con un análisis LLM en vivo para **ahorrar créditos**; lógica revisada y backend arranca OK.

## 2026-07-01 (fix) — KPIs: el documento auto-descargado no aparecía tras analizar
- **Bug reportado (Neurocrine/NBIX):** al analizar no aparecía ni documento ni aviso. **Causa raíz:** el backend SÍ descargaba el documento (10-Q de SEC EDGAR) y `no_source_doc=False` (correcto), pero el panel `KpiDocuments` del frontend NO se refrescaba tras el análisis → el documento recién añadido no se veía hasta recargar la página.
- **Fix:** en `Kpis.jsx`, `analyze()` incrementa `docsRefresh` tras `loadCompanies()`; se pasa `refreshKey={docsRefresh}` a `<KpiDocuments>`, cuyo `useEffect` de carga ahora depende de `[load, refreshKey]` → recarga la lista de archivos al terminar cada análisis (full o incremental).
- **Verificado por testing_agent (frontend, 100%):** 0 archivos antes de Analizar → 1 doc '10-Q · SEC EDGAR' (badge AUTO·WEB, estado 'listo') inmediatamente después SIN recargar; sin aviso falso; coeficiente global mostrado. Sin issues.

## 2026-07-02 — Macro: tarjeta M3 (con aviso de serie desactualizada)
- Añadida 7ª tarjeta **Masa monetaria M3** en `/macro`. Serie FRED `MABMM301USM189S` (M3 amplio de EEUU, OCDE).
- **Limitación honesta:** la Fed dejó de publicar M3 en 2006; la serie OCDE es la mejor disponible pero su último dato es de finales de 2023 → se muestra badge ámbar **"Desactualizada · <fecha>"** (`macro-stale-{key}`) y nota en el tooltip. Backend marca `stale=True` vía `_is_stale()` (>150 días).
- Muestra: nivel en miles de M$ (B$) como valor principal + crecimiento interanual en la línea de contexto. Icono `Layers`.
- Verificado: endpoint devuelve M3 (nivel 20.767,4 B$, YoY −2,95%, as_of 2023-11, stale True) y la tarjeta + badge renderizan en pantalla.

## 2026-07-02 — Macro: M3 sustituido por proxy AL DÍA (con desglose y fórmula)
- Sustituida la tarjeta M3 (OCDE, congelada en 2023) por **M3 (proxy) · dinero amplio**, calculado con series FRED actuales:
  **M3 (proxy) = M2 (`M2SL`) + Grandes depósitos a plazo (`LTDACBW027SBOG`) + Papel comercial (`COMPOUT`)**.
- La tarjeta muestra: valor total (miles de M$), crecimiento interanual, **desglose de cada componente** (`macro-breakdown-m3_proxy`) y la **fórmula** (`macro-formula-m3_proxy`). Icono `Layers`.
- Motivo (decisión del usuario): las letras del Tesoro ≤2a no tienen serie limpia/actual en FRED; los grandes depósitos a plazo SÍ son el componente real que M3 añade a M2 → proxy más fiel y actualizado. No incluye repos ni eurodólares (no disponibles limpios) → indicado en el tooltip/nota.
- Eliminado helper backend `_is_stale` (sin uso). Verificado: endpoint (26.957,4 B$ = 23.052,3 + 2.508 + 1.397,1; YoY +4,91%) y tarjeta con desglose+fórmula en pantalla; tarjeta M3 antigua eliminada.

## 2026-07-02 (b) — Macro M3 proxy: añadidos Fondos monetarios institucionales (ICI) + congelación ante fallo
- Añadido 4º componente al M3 proxy: **Fondos monetarios institucionales** desde el **ICI** (fichero semanal `mm_summary_data_{año}.xls`, col 14 = TNA institucional en millones → billones). Nueva dep `xlrd==2.0.2`.
- Fórmula ahora: **M3 (proxy) = M2 + Grandes depósitos a plazo + Fondos monetarios institucionales + Papel comercial** = 31.773,7 B$ (institucionales 4.816,3 B$, 24-jun-2026).
- **Congelación ante fallo de lectura (petición del usuario):** `resolve_ici_institutional(db)` guarda el último valor bueno en `db.macro_ici`; si la lectura semanal del ICI falla, usa ese último valor, lo marca `frozen=True` y la tarjeta muestra un **aviso** ("se ha CONGELADO en su último valor válido (<fecha>)") + marca "⚠ congelado" en el componente. Si nunca hubo lectura válida, se omite el componente con aviso.
- Backend: `import asyncio` a nivel de módulo (bug: NameError en fetch ICI), helper `_fmt_date_es`. Frontend: aviso `macro-warning-{key}` y marca de congelado por componente. YoY del proxy se calcula sobre M2+depósitos+papel (los que tienen histórico anual); indicado en la nota.
- Verificado (self-test): endpoint con ICI OK (31.773,7 B$), simulación de fallo → congela 4.816,3 con aviso, y tarjeta+desglose renderizan en pantalla.

## 2026-07-02 (c) — Macro: reestructuración de fichas
- **Indicador Buffett eliminado** → sustituido por 2 fichas independientes: **Renta variable (EEUU)** (`equities`, NCBEILQ027S, nivel en miles de M$ + YoY) y **PIB (EEUU)** (`gdp`, GDP, nivel + YoY).
- **Productividad**: ahora el valor principal es el **índice (2017=100)** y el crecimiento interanual % pasa a línea de info adicional.
- **Ficha M2 eliminada** (M2SL se sigue consultando solo para el M3 proxy).
- UI: fichas más compactas (p-3, cifra text-3xl, icono/label reducidos) y pie de tarjeta más visible (frecuencia text-[11px] y fecha del dato en azul marino negrita, testid `macro-asof-{key}`).
- Verificado en pantalla: 7 fichas (equities, gdp, fed_rate, inflation, productivity, m3_proxy, oil); buffett y m2_growth ausentes.

## 2026-07-02 (d) — Macro: nueva ficha "Petróleo vs media histórica" con dial
- Nueva serie FRED `MCOILWTICO` (WTI mensual desde 1986); se envían 252 meses de histórico al frontend en el indicador `oil_avg`.
- Ficha nueva con **dial (slider 1-20 años, por defecto 4)**: al mover el dial, el navegador recalcula al instante la **media simple** de los precios mensuales del WTI del periodo elegido, el **precio actual** y el **% actual vs media** (verde=barato, rojo=caro). data-testids: oil-avg-slider, oil-avg-years, oil-avg-value, oil-avg-diff.
- Verificado (self-test + screenshot): 4a → media 76,41 (−5,94% barato); 10a → media 65,99 (+8,9% caro). Recálculo instantáneo sin volver a llamar al servidor.

## 2026-07-02 (e) — Macro: nueva ficha "Mix energético mundial"
- Nueva ficha `energy_mix` con el reparto MUNDIAL de energía primaria por fuente y el cálculo destacado **(petróleo + gas) / total = 55,1%** (datos 2024).
- Desglose detallado con barras: Petróleo 31,5% · Carbón 26,2% · Gas natural 23,6% · Hidro 6,2% · Nuclear 3,9% · Eólica 3,5% · Solar 2,9% · Otras renovables 1,4% · Biocombustibles 0,8% (suman 100%).
- **Fuente: Our World in Data (Energy Institute Statistical Review)** — CSV sin API key, mundial y actual (2024). Backend: `resolve_energy_mix(db)` cachea ~7 días en `db.macro_energy` (con congelación al último valor si falla la descarga). El usuario eligió EIA pero para el mix MUNDIAL de energía primaria OWID es más actual/limpio; **la API key de EIA se guardó en `.env` (`EIA_API_KEY`) para futuros usos** (detalle energético de EEUU).
- Frontend: componente `EnergyMixCard` (barras por fuente). Verificado en pantalla.

## 2026-07-02 (f) — Macro: eliminada ficha "Petróleo (WTI)" independiente
- Quitada la tarjeta `oil` (precio WTI diario) por redundante: la ficha "Petróleo vs media histórica" (`oil_avg`) ya muestra el precio actual del barril. Se sigue consultando DCOILWTICO para ese precio actual. Fichas ahora: equities, gdp, fed_rate, inflation, productivity, m3_proxy, oil_avg, energy_mix.

## 2026-07-03 — Macro: ficha "Coeficiente de mercado" (fórmula del usuario + aguja)
- Fórmula (definida por el usuario, imagen transcrita): **C = (m71/(m70−m72)) × (1−(m73+m74)/100) × (m75/100) × (1−((m76−m77)×(m78/10000)))**.
  Códigos: m70 Renta variable, m71 PIB, **m72 = M3 proxy** (corrección del usuario), m73 Tipo FED, m74 Inflación, m75 Productividad (índice), m76 Precio petróleo actual, m77 Media petróleo (según dial), m78 Mix petróleo+gas.
- **Interpretación (nueva, usuario): C<1 = mercado CARO, C>1 = BARATO, 1 = neutro.**
- UI: ficha destacada arriba del grid con **aguja/gauge SVG semicircular (180°)**: 1 arriba (neutro gris), izquierda→0 degradado naranja→rojo (caro), derecha→2 verde claro→oscuro (barato). Muestra C, veredicto y cajas de acciones **Caro→Defensivas (KO·PG·JNJ·WM)** vs **Barato→Crecimiento (NVDA·PLTR·TSLA·SHOP)** resaltando la activa, más los 9 valores usados.
- **m77 usa el dial de la ficha "Petróleo vs media" (estado compartido)** → el coeficiente se recalcula en vivo al mover el dial. Verificado: C 0,95 (4a) → 0,91 (14a). Cálculo 100% en frontend desde el payload de indicadores.

## 2026-07-03 (b) — Macro: extrapolación EN VIVO de Renta variable (m70) y PIB (m71)
- **Renta variable (m70)**: al último valor oficial trimestral (`NCBEILQ027S`) se le aplica la variación de un índice bursátil desde la fecha del dato oficial hasta hoy. Se obtienen de FRED `SP500`, `NASDAQ100` y `DJIA` (400 obs diarias). Backend `_index_at()` busca el valor del índice en/antes de la fecha oficial; `equities_vivo = oficial × (idx_hoy/idx_ref)`. Se devuelve `live.by_index` con las 3 opciones (label, value, growth_pct, index_now, index_ref, index_date).
- **PIB (m71)**: al último PIB oficial se le aplica el crecimiento interanual nominal (`_q_yoy`) prorrateado por días transcurridos: `gdp_vivo = oficial × (1 + (yoy/100) × días/365)`. Se devuelve `live` con value, yoy_pct, days_elapsed, as_of.
- **Frontend** (`Macro.jsx`): nuevo `LiveIndicatorCard` para equities/gdp que muestra el valor **estimado en grande** (sufijo "· est.") y el **oficial más pequeño** debajo con fecha y % de ajuste. Desplegable `equities-index-select` (S&P 500 por defecto · NASDAQ 100 · Dow Jones). El **coeficiente de mercado usa los valores estimados (vivo)** vía `liveEquities()`/`liveGdp()`; el índice seleccionado alimenta m70.
- Verificado backend por curl: equities oficial 69511,6 → est. SP500 75987,4 (+9,32%) / NASDAQ100 80741,9 (+16,16%) / DJIA 76506,8. PIB oficial 31865,7 → est. 32835,5 (+6,07% YoY, 183 días). Frontend compila sin errores. NOTA: la captura visual no se pudo tomar porque el preview del navegador estaba en estado "resting" a nivel de plataforma; lógica validada por curl.

## 2026-07-03 (c) — Explorar (treemap): vista Tendencias por TAM / CAGR / media
- La vista **Tendencias** del treemap (`ThesisExplore.jsx`) ahora se puede dimensionar por tres métricas seleccionables: **por CAGR** (defecto, tamaño∝CAGR 4a, badge CAGR, sub TAM), **por TAM** (tamaño∝TAM 2027e, badge TAM, sub CAGR) y **media (TAM+CAGR)** (media normalizada 0–100 de ambas variables → tamaño y color; badge = índice 0–100, sub = "CAGR · TAM"). Permite comparar cada tendencia por cada variable y por ambas a la vez.
- El botón "Tendencias" se convierte en **desplegable**: al activarse muestra un `<select>` (`data-testid="tendencias-metric"`: por CAGR / por TAM / media) embebido en el mismo grupo de botones.
- La **leyenda inferior** (`explore-caption`) se adapta al modo elegido. El color verde→rojo (alto→bajo) sigue aplicando sobre la métrica activa.
- Normalización min-max por lista para el modo media (si todos iguales → 50). Cambio 100% frontend. Compila sin errores; captura visual no tomada por preview en "resting" (plataforma).

## 2026-07-04 — Macro: gráfico de evolución 10 años (4 variables, doble eje Y)
- Backend (`macro.py`): nuevo `_build_trend()` que devuelve `trend.points` = serie TRIMESTRAL de los últimos ~10 años (40 puntos) con `equities` (renta variable, miles de M$), `gdp` (PIB), `diff` (RV − PIB) y `productivity` (índice). Se subió el límite de obs de NCBEILQ027S/GDP/OPHNFB a 44. Alineado por fecha de trimestre; se actualiza al refrescar cuando FRED publica nuevos datos oficiales.
- Frontend (`Macro.jsx`): `TrendChart` (recharts ComposedChart) con **doble eje Y** — izquierdo para RV/PIB/resta (miles de M$), derecho para productividad (índice). `TrendCard` colocada en el **hueco inferior derecho** del grid; botón **Ampliar** (`trend-expand-btn`) abre `TrendModal` a pantalla grande (max-w-5xl, height 460).
- Los valores de RV y PIB del histórico son OFICIALES trimestrales; el **último punto es Estimado** (usa equities live del índice seleccionado + PIB live), marcado con un aro hueco y etiqueta "Est." en el eje X, con nota explicativa y en el tooltip ("· estimado"). Reacciona al desplegable de índice.
- Verificado backend por curl (40 puntos: 2016-04 → 2026-01). Frontend compila sin errores. Captura visual no tomada: preview del navegador en estado "resting" (plataforma).

## 2026-07-05 — Macro: histórico del coeficiente de mercado (mini-gráfico + modal)
- Backend (`macro.py`): `_compute_coef_default()` calcula el coeficiente en servidor con los valores POR DEFECTO (renta variable vía S&P 500 + media petróleo 4 años), replicando la fórmula del frontend para que el histórico sea consistente. `_store_coef_point()` hace upsert de 1 punto/día en `db.macro_coef_history` (idempotente por fecha). `_get_coef_history()` devuelve últimos 180 puntos, adjuntados a la respuesta como `coef_history` (también en la ruta cacheada). `_seed_coef_history()` siembra ~90 puntos de ejemplo (random walk anclado al coef actual) la primera vez si la colección está vacía.
- Frontend (`Macro.jsx`): `CoefHistoryChart` (recharts LineChart con `ReferenceLine` en y=1 = neutro). Mini-sparkline dentro del recuadro "Coeficiente de mercado" bajo la aguja/veredicto (`coef-history-mini`, height 84) + botón **Ampliar** (`coef-history-expand-btn`) que abre `CoefHistoryModal` (height 420). Tooltip muestra fecha + coef + caro/barato/neutro.
- Confirmado por el usuario: guardar 1x/día, valores por defecto, ubicación dentro del recuadro, y sembrar puntos de ejemplo.
- Verificado backend por curl: `coef_history` con 91 puntos (90 seed + hoy). Frontend compila sin errores. Captura visual no tomada: preview del navegador en "resting" (plataforma).

## 2026-07-06 — Visual: los filtros marcan/desmarcan filas de la tabla automáticamente
- `Visual.jsx`: los filtros (Score, TAM, Ratio Compra, Ratio Venta) ahora **sincronizan las casillas de la tabla**: al aplicar/ajustar un filtro se marca (pasa) o desmarca (no pasa) cada empresa automáticamente, en sincronía con el mapa.
- Nuevo helper `passesFilters(r, f)` (reutilizado por el mapa y por el marcado) + `useEffect([filters, rows])` que hace `setSelected` = tickers que pasan los filtros. El marcado manual (toggleOne/toggleAll) sigue funcionando entre cambios de filtro.
- Texto de filtros actualizado: "Filtros · marcan/desmarcan empresas en la tabla y las muestran u ocultan en el mapa".
- Cambio 100% frontend. Compila sin errores; captura visual no tomada por preview en "resting".

## 2026-07-06 (b) — Batch: email verificado + 4 mejoras
- **[P1 VERIFICADO] Entrega real de emails (Resend)**: `/admin/run-screener` → emails_sent:1 (ID 550a6247…) y `/admin/run-radar` → emails_sent:1 (ID 95abff59…), ambos entregados a joseaq.2m@gmail.com. SENDER=onboarding@resend.dev (sandbox: entrega al email propietario de la cuenta Resend; para enviar a OTROS destinatarios haría falta verificar un dominio propio en Resend).
- **Sombreado caro/barato** en el histórico del coeficiente macro (`Macro.jsx` CoefHistoryChart): `ReferenceArea` verde (y>1, barato) y roja (y<1, caro) al 7% de opacidad, en mini y modal. Nota del modal actualizada.
- **Borde dorado en Convergencia** (`ThesisExplore.jsx`): las empresas con `count>=2` (aparecen en 2+ tendencias, cualquier categoría: líder/competidor/disruptor) llevan borde dorado `#D4AF37` + leyenda explicativa (`convergence-gold-legend`).
- **Tooltip de fuente en KPIs** (`Kpis.jsx` tabla): la columna Fuente usa `HoverTip` mostrando la cita textual (`source_quote`) + dominio de origen; también muestra "cita" si hay quote sin URL. `data-testid="kpi-source-{i}"`.
- **Indicador de tendencia del coeficiente KPI**: backend guarda `coef_history` (1 punto/día por reanálisis, últimos 20) en `kpi_snapshot` y lo preserva en editar/buscar (`routes/thesis.py`). Frontend `CoefTrend` junto al CoefBadge: flecha ↑/↓/– + delta vs análisis previo, con tooltip del histórico (`kpi-coef-trend`).
- Backend hot-reload OK (endpoints 200), frontend compila sin errores. Captura visual no tomada (preview en "resting").

## 2026-07-06 (c) — Sistema de ALERTAS por empresa (campanita en Visual) + email diario consolidado
- Decisión de producto: se DESCARTA el tiering T1/T2/T3. En su lugar, alertas configurables por el usuario.
- Backend (`routes/thesis.py`, colección `company_alerts`): endpoints `GET /thesis/alerts`, `PUT /thesis/alerts/{ticker}`, `DELETE /thesis/alerts/{ticker}`. Config por empresa: score/tam/kpi con {enabled, dir(gte/lte), value}. Si no hay ninguna métrica activa → se borra (sin campanita).
- Job diario `run_company_alerts()` (expuesto en `_thesis_router`): reutiliza `visual_data(user)` para las métricas reales; evalúa umbrales cualitativos (Score/TAM/Coef KPI) con dirección ≥/≤ y cruces de ratio barato↔caro (automático para toda empresa con campanita, umbrales cheap=20/fair=0). Anti-spam: dispara SOLO en la transición (no-cumple→cumple / cambio de señal), guardando `state` por alerta. Envía UN único email consolidado por usuario (secciones Cualitativo + Valoración).
- `server.py`: endpoint `POST /admin/run-alerts` + scheduler diario a las **06:05 UTC** (tras el screener 06:00). Router capturado en `_thesis_router`.
- Frontend (`Visual.jsx` + `lib/api.js`): nueva columna con **campanita** por fila (`alert-bell-{ticker}`), tooltip explicativo en la cabecera, panel desplegable (posición fixed anti-clip) con checkbox/dirección/valor por métrica + Guardar/Quitar (toasts). Campana dorada `BellRing` si hay alerta activa. Carga inicial vía `alertsGet`.
- Verificado: CRUD OK (PUT/GET/DELETE por curl), `run-alerts` ejecuta sin error (users_scanned:1), envío Resend probado previamente (emails reales entregados). Frontend compila. ⚠️ NO verificado visualmente ni con datos reales (la cuenta de prueba no tiene tesis de empresa; el preview está en "resting"). El usuario real (joseaq) sí tiene datos → funcionará en la ejecución diaria.

## 2026-07-06 (d) — Backlog: eliminadas 2 features
- ELIMINADAS del backlog (decisión del usuario, no rentables): "Soporte de vídeo como fuente de KPIs (Fase 2)" y "Recolector dedicado de Investor Relations (Option B)". El fetcher actual cubre la mayoría de casos; se mejorará puntualmente si falla con alguna empresa.

## 2026-07-06 (e) — Responsive Fase 1: navegación global (móvil/tablet)
- `Layout.jsx`: la barra de navegación se convierte en **menú hamburguesa** por debajo de `md` (móvil y tablet-portrait). Row 1 (logo+búsqueda+auth) usa `flex-wrap`: logo compacto (oculta subtítulo en <sm), botón hamburguesa a la derecha, búsqueda a ancho completo en móvil. Row 2 (nav+toggles) solo en `md+`. Menú móvil (drawer) con enlaces apilados + toggles (Help/Thresholds/Idioma/Tema/Divisa) + AuthButton; se cierra al navegar. Paddings `px-4 sm:px-6`, main `py-6 sm:py-8`.
- Verificado que las tablas (Visual/KPIs/Compare) ya tienen `overflow-x-auto` (scroll horizontal en móvil) y los grids de Macro son responsive (`grid-cols-1 sm:2 lg:3`; tarjeta coeficiente `grid-cols-1 md:grid-cols-2`). Compila sin errores. Pendiente verificación visual (preview en "resting").
- Próxima fase responsive: pulir Home/Company/Macro (alturas de gráficos, hero) y comodidad táctil página por página.

## 2026-07-09 — Bug fix: chat de Ayuda tapado por el badge "Made with Emergent"
- `HelpChat.jsx`: el panel se anclaba pegado al fondo (`sm:m-4`, `h-[80vh]`), donde el badge flotante de la plataforma tapaba el input y el botón enviar. Fix: panel elevado con `mb-[76px]` (móvil y sm+) + `h-[70vh]` móvil / `sm:max-h-[calc(100vh-7rem)]`, dejando hueco inferior. VERIFICADO por testing_agent (iteration_19): input a 33px por encima del badge, sin solape; abrir/escribir/enviar/cerrar OK (frontend 100%).
- Genta docx: manual completo de la app en `/app/frontend/public/Valuation_Studio_Manual.docx` (descargable en la URL de la app).

## 2026-07-12 — Toggle TTM/ANUAL en "Ingresos proyectados 2y" (COMPLETADO)
- Backend (valuation.py) ya exponía revenue_2y_ttm / revenue_2y_annual + default TTM.
- Frontend (Company.jsx): añadidos los botones reales TTM/ANUAL junto al campo revenue_2y (data-testid revenue-base-ttm / revenue-base-annual), misma estética que la barra BU/TTM/ANUAL del FCF.
- Verificado live (MSFT): TTM 592,66B (default) -> ANUAL 524,60B, input marcado como editado y POC/POV recalculados.
- Fix (2026-07-12): botones TTM/ANUAL de ingresos no salían en empresas ya cacheadas (p.ej. COIN). Causa: caché en db.fundamentals servía docs anteriores al cambio sin revenue_2y_ttm/annual. Añadido schema-guard en GET /api/company/{ticker} (server.py) que refresca la caché si faltan los campos nuevos. Verificado en COIN.
- Enhancement (2026-07-12): tooltips unificados en Inputs/proyecciones. FCF proyectado (TTM/ANUAL) ahora muestran arriba HORIZONTE + cálculo directo y debajo el MÉTODO (regresión/g). Ingresos proyectados (TTM/ANUAL) ahora muestran debajo del horizonte el MÉTODO de cálculo de g (nuevo revenue_growth_breakdown en valuation.py: analyst_implied / revenue_growth_yoy / historical_cagr). HoverTip: prop dense (texto 10.5px leading-snug) para tooltips largos. schema-guard de caché ahora exige revenue_growth_breakdown.
- Enhancement (2026-07-12): notas de horizonte objetivo bajo Ingresos/FCF proyectados 2Y (TTM → "objetivo ≈ TTM {q+2años}" ej 2028Q1; ANUAL/BU → "objetivo FY{año}"). Backend expone auto_projections.ttm_asof_quarter/ttm_target_quarter (desde info.mostRecentQuarter). Corregida nota del CAGR 4Y (antes decía erróneamente "base TTM"): Ingresos siempre "de FY2023 a FY2027" (año fiscal completo); FCF normal igual; FCF fallback con base TTM → "Base TTM → FY2027 (2 años)". Tooltips del CAGR aclaran base TTM vs año fiscal. schema-guard de caché ahora exige ttm_target_quarter. Verificado live MSFT.
- Bug fix (2026-07-12): ABNB (y otros) mostraban Ratio compra/venta en null y faltaban botones TTM/FCF. Causa: caché envenenada por fetch transitorio incompleto de Yahoo (net_debt/total_revenue_ttm/fcf_ttm null) durante el refresco masivo del schema-guard. Fix en GET /api/company/{ticker}: helper _is_degraded + reintento del fetch si degradado + no servir caché degradada antigua (respeta gaps genuinos tipo ETF vía ventana de 1h). Sanadas cachés ABNB/LITE. Verificado live.
- Fix coherencia gráfico (2026-07-12): el gráfico trimestral TTM anclaba el punto +2y en cierre fiscal+2 (2027Q4) aunque el valor TTM apuntaba a último trim.+2 (2028Q1), incoherente con la nota. buildQuarterlyChart ahora recibe horizonMode (ttm/annual) calculado del input activo: TTM ancla en lastDate(último trim TTM)+2 -> punto final 2028Q1; ANUAL ancla en annLastDate+2 -> 2027Q4. Verificado live ABNB (TTM->2028Q1E, ANUAL->2027Q4E).
- Enhancement (2026-07-12): etiqueta "Método: X" en la cabecera de los gráficos Ingresos y FCF (ChartBlock prop method). Ingresos: TTM/Anual/Manual. FCF: BU/BU+/TTM/Anual/Manual. Se detecta comparando el input activo (revenue_2y/fcf_2y) con los valores auto (revenue_2y_ttm/annual, bottom_up, cagr_breakdown TTM/annual). Cambia automáticamente al pulsar los botones en Inputs y proyecciones. Verificado live ABNB.
- Enhancement (2026-07-12): gráficos de Company mejorados. (1) Punto de proyección ya no se dobla sobre el último punto real (ProjDot dibuja solo en kind=proj); puntos con borde blanco para definirlos. (2) Eje X con más contraste (fill #111) y mayor tamaño de fuente. (3) Los 3 gráficos (Ingresos, FCF, POC/POV) ahora son ampliables en modal (botón Maximize2, testids *-expand / *-modal / *-modal-close). Verificado live ABNB.
- Enhancement (2026-07-12): la etiqueta "Método" de los gráficos Ingresos/FCF ahora es un botón clicable que alterna TTM<->Anual (icono ArrowLeftRight) y escribe el valor en la ficha (updateInput revenue_2y/fcf_2y), recalculando gráfico, nota y ratios. Clicable solo si existen ambos valores (revCanToggle/fcfCanToggle); FCF en BU->primer clic va a TTM. Verificado live ABNB (TTM 20,10B <-> ANUAL 19,45B).
- UI (2026-07-12): añadida palabra "gráfico" entre el título (Ingresos/FCF históricos) y el badge ANUAL/TTM en las cabeceras de ChartBlock, para distinguir el modo del gráfico del botón Método.
- Screener email (2026-07-12): fila de empresa ahora muestra ticker (subrayado) + nombre completo en idioma original (data.name) y es un enlace a PUBLIC_APP_URL/company/{ticker}. Aviso corregido: "tu fórmula propia" -> "una fórmula propia". screener.py _build_email_html + evento incluye name.
- Content (2026-07-15): incorporado el manual final del usuario en /instrucciones (Instructions.jsx CONTENT es+en, 14 secciones estructuradas, ortografia corregida: Yahoo Finance, market cap, como->cómo, angulo 45C->ángulo 45°, varian->varían, situa->sitúa, didacticos->didácticos). URL de descarga del .docx validada (HTTP 200) y conservada; archivo público /Valuation_Studio_Manual.docx reemplazado por el nuevo (52KB). Añadido botón "Descargar Word" enlazando a esa URL, junto al "Descargar PDF". P2 completado.
- Tour (2026-07-15): añadidos 3 pasos al tour guiado (lib/tour.jsx) entre Tesis y Ayuda: Visual (/visual, visual-page), KPIs (/kpis, kpis-page) y Macro (/macro, macro-page). Paso final actualizado para mencionar descarga PDF y Word. Tour pasa de 8 a 11 pasos.
- Feature (2026-07-16): columna "Próx. result." en Visual junto a "Actualiz.". Backend: valuation.py añade next_earnings_date/next_earnings_estimated (info.earningsTimestamp); schema-guard exige next_earnings_date (refresco perezoso); routes/thesis.py propaga via earn_map en dashboard + /thesis/visual. Frontend: Visual.jsx EarningsBadge (rojo/negrita si <=7 dias, gris si pasada, ≈ si estimada), columna ordenable (DATE_KEYS). Refrescadas cachés de 39 tickers con tesis. Verificado live: NOW/GOOG/TSLA 22jul en rojo, pasadas en gris.
- Task 2 (2026-07-16): confirmado que KPIs ya colorea la antiguedad en rojo cuando hay trimestre posterior al analisis (freshnessInfo + most_recent_quarter, misma logica que Visual FreshnessBadge). No requería cambios.
