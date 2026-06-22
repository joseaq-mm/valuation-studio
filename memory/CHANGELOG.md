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
