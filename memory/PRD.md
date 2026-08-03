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
- **✅ Visual: 3 ajustes UI (3 ago 2026, verificado screenshots+medidas):**
  1. **Controles de zoom reordenados** (`PinchZoomPane.jsx`): orden arriba→abajo `reset (↺) · + · −` (el "volver" encima de la lupa +). Leyenda "Pellizca para hacer zoom…" pegada al eje X (`pb-0` en el contenedor + `py-0.5 -mt-1` en la leyenda) → más superficie para las burbujas en el modal a pantalla completa.
  2. **Filtro "Nivel" ensanchado** (`Visual.jsx`): la caja pasa a `col-span-2` (≈567px en desktop, ancho completo en móvil) para que "Ambas/Nivel 1/Nivel 2" quepan sin salirse; el resto de campos (Score min, etc.) ceden ese ancho.
  3. **Tabla con 2 primeras columnas fijas** (`Visual.jsx`): casilla (`sticky left-0`) y Ticker (`sticky left-[40px]`, `border-r`) congeladas con `z-30`(header)/`z-20`(body) y fondo opaco; el resto de columnas hace scroll horizontal. Verificado a 390px: x de casilla/Ticker constante al desplazar.
- **✅ Refactor de rendimiento (3 ago 2026, testing_agent iteration_31 100% · 7/7 pytest + frontend):** sin romper login ni sync.
  1. **25 índices MongoDB al arranque** (`server.py` `_ensure_indexes`, no-únicos + try/except por índice, idempotentes) en los campos calientes: `user_sessions.session_token` (se consulta en CADA request → mayor ganancia), `users`, `theses` (compuestos `user_id+id`, `user_id+type`, `user_id+folder_id`, `user_id+type+companies.ticker`), `fundamentals.ticker`, `user_watchlists/user_portfolios.user_id`, `qual_snapshots`, `thesis_jobs`, `kpi_files`, `translations`, etc. Antes NO había ningún índice (full scans).
  2. **Contenedor del gráfico Visual con unidades relativas CSS** (`Visual.jsx` ~L745): `h-[60vh] min-h-[300px] max-h-[460px] landscape:max-md:h-[85vh]` + `ResponsiveContainer height="100%"`. Eliminado el efecto JS `chartH` (resize/orientationchange) — ahora responde al instante por CSS (verificado: ancho 324→714 al ensanchar sin recargar).
  3. **Código muerto eliminado**: bloque inalcanzable tras `return out` en `_normalize_urls` (`routes/thesis.py`).
  - Verificado: auth por Bearer 200, sync Nivel 2 (alta MSFT persiste + borrado), Nivel 1 GET 200, páginas /watchlist /visual /compare /thesis /macro /portfolio sin errores.
- **✅ Login Google mantiene el preview al lado del chat (popup + relay de token, 3 ago 2026, mecanismo Bearer verificado):** mejora sobre el fix anterior. Como Google no renderiza dentro del iframe, el login se abre en un **popup** a nivel superior conservando `window.opener` (`lib/googleAuth.js`). IMPORTANTE (fix 3 ago 2026): NO leer `window.top.*` (outerHeight/screenX…) dentro del iframe — el top es cross-origin y lanza `SecurityError` (causó un "uncaught runtime error" al pulsar ENTRAR). `window.open` se llama sin posicionar y todo va en try/catch. El backend ahora devuelve `session_token` en el cuerpo de `/api/auth/google` (`_finalize_login`); `GoogleCallback.jsx` hace `window.opener.postMessage({type:"vs:google-login", token})` y **cierra el popup**. `AuthProvider` (`auth.jsx`) escucha `message` (mismo origin), guarda el token en `localStorage vs:token` y refresca — así el panel dentro del iframe queda logueado **sin depender de cookies de terceros** (que los navegadores bloquean/particionan). `api.js` añade un interceptor que envía `Authorization: Bearer <vs:token>` en cada request; el backend ya aceptaba Bearer (`_resolve_token`). Verificado e2e el mecanismo Bearer (sin cookie, con `vs:token` → `/api/auth/me` 200 y Nivel 2 logueado en el iframe). NO probado con cuenta Google real el paso popup→postMessage (requiere login humano); si el navegador bloquea el popup, hace fallback a `window.top.location`.
- **✅ FIX login Google 403 dentro del iframe de preview (3 ago 2026):** el usuario recibía `403 disallowed_useragent` al pulsar ENTRAR — Google no renderiza su pantalla de consentimiento dentro de un `<iframe>` (la vista previa del chat es un iframe). Solución en `lib/googleAuth.js`: si `window.self !== window.top` (framed) el login se abre en una **pestaña nueva** a nivel superior (`window.open(url, "_blank")`; fallback a `window.top.location`); fuera del iframe sigue el redirect normal. Sincronización de sesión entre pestañas: `GoogleCallback.jsx` escribe `localStorage vs:auth-changed` al terminar y `AuthProvider` (auth.jsx) escucha `storage`+`focus` para re-chequear `/api/auth/me`. La cookie ya era `SameSite=None; Secure`. NOTA: no probado e2e (requiere cuenta Google real + contexto iframe); guía al usuario: abrir la preview en pestaña nueva si persiste.
- **↩️ REVERTIDO (3 ago 2026): inversión de ejes en móvil.** A petición del usuario se deshizo el cambio del 3 ago que ponía Score en vertical y Ratio Compra en horizontal en móvil. El gráfico de `Visual.jsx` vuelve a su estado original en TODOS los tamaños: Score cualitativo en X, Ratio Compra % en Y, `QuadrantLabels` sin prop `inverted`, `tlTrails` sin swap, y eliminado el estado `isMobile`. (El fix responsive de altura `chartH` se mantiene.)
- **✅ Visual móvil RESPONSIVE sin forzar rotación (2 ago 2026, testing_agent iteration_30 100% 5/5):** a petición del usuario se ELIMINÓ el efecto que auto-abría el modal a pantalla completa al girar el móvil. Ahora el contenedor del gráfico es responsive: `ResponsiveContainer width="100%"` re-renderiza el ancho al girar vía ResizeObserver, y una altura calculada (`chartH`) llena el alto disponible — en móvil táctil (`pointer:coarse`) en horizontal (w>h, lado corto≤560) usa ~78vh, en vertical/escritorio 460px. Verificado: vertical 390x844 svg 324px, horizontal 844x390 svg 714px/alto 304px (re-render), vuelta a vertical 324px/460px; botón manual "Ampliar" sigue abriendo el fullscreen; escritorio 460px. `Visual.jsx` ~L278-297 (efecto chartH) y ~L765 (ResponsiveContainer height={chartH}).
- **✅ FIX Visual móvil: auto-horizontal + filtro "Nivel" (2 ago 2026, verificado screenshot 360px):** (1) La rotación automática a horizontal al girar el móvil YA funciona (testing_agent iteration_29: PASS en 390x844 portrait cerrado, 844x390 landscape auto-abre `visual-chart-fullscreen`, vuelta a portrait auto-cierra; desktop no auto-abre por guard `pointer:coarse`). Implementado con listeners `resize`+`orientationchange` y heurística lado-corto≤560. (2) Los botones del segmentado "Nivel" (Ambas/Nivel 1/Nivel 2) se desbordaban en pantallas ≤390px por falta de `min-w-0` (flex items no encogían bajo `whitespace-nowrap`). FIX: añadido `min-w-0 basis-0 flex-1` en `Visual.jsx` ~L884 → anchos iguales (45/46/46px) y sin desbordamiento del contenedor.
- **✅ FIX Nivel 2 móvil: encabezado a todo el ancho + botón "Añadir" (29 jul 2026, verificado por testing_agent 100%):** el encabezado de `/watchlist` (`Watchlist.jsx` ~línea 218) pasó a `flex justify-between items-end mb-6 gap-3 flex-wrap` (paridad con Portfolio/Nivel 1): en móvil los controles (Tabla/Tarjetas, Añadir, Comparar) envuelven a fila inferior sin apretarse. Añadido botón `watchlist-add-btn` que abre diálogo `watchlist-add-dialog` con `TickerAutocomplete` (`watchlist-add-input`) para añadir una acción a Nivel 2 vía `saveToWatchlist` (funciona logueado→nube y anónimo→localStorage). testing_agent (iteration_20): sin desbordamiento a 390x844, alta de AAPL crea fila + toast, Cancelar cierra. Nota no bloqueante del review: Watchlist.jsx es grande (435 líneas) — considerar extraer los diálogos a componentes (P3).
- **✅ Google Auth propio (credenciales del usuario) reemplaza a Emergent-managed (24 jul 2026, wiring verificado):** flujo Authorization Code con Client ID/Secret propios. Backend `POST /api/auth/google` (en `auth.py`, helper `_finalize_login`) intercambia el code server-side y abre sesión (cookie httpOnly 7d). Frontend `lib/googleAuth.js` (`startGoogleLogin`), `pages/GoogleCallback.jsx`, ruta `/auth/google` en `App.js`; botones de `AuthButton`/`LoginNudge` repuntados a Google. Env: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (backend), `REACT_APP_GOOGLE_CLIENT_ID` (frontend). Verificado: endpoint llega a Google y rechaza code inválido (401); Client ID inyectado en el bundle. PENDIENTE por parte del USUARIO: registrar en Google Cloud Console el JavaScript origin y el redirect URI `<origin>/auth/google` (si no → redirect_uri_mismatch).
- **✅ ARQUITECTURA: MongoDB como fuente de verdad de Nivel 1/2 + React Query (sync casi instantánea) (24 jul 2026, verificado e2e):** con sesión iniciada, la cartera (Nivel 1) y la watchlist (Nivel 2) ya NO dependen de localStorage como origen de datos — MongoDB es la fuente de verdad y localStorage queda solo como caché local. Instalado `@tanstack/react-query` (`QueryClientProvider` en `App.js`). `WatchlistCloudSync` usa `useQuery({queryFn: runFullSync, refetchInterval: 10s, refetchOnWindowFocus, refetchOnReconnect, enabled:!!user})`: sondea la nube y aplica cambios remotos al caché **solo cuando difieren** (`runFullSync` ahora es "silencioso" con firmas `_sig` normalizadas → sin flicker ni refetch de Yahoo cada 10s). Mutaciones locales → write-through inmediato (PUT debounced / delete autoritativo). Anónimos siguen con localStorage (`enabled:false`). Fusión única en el primer login conservada (reconcile con `lastSyncAt`). `Watchlist.jsx onChange` ahora recarga filas cuando cambia el conjunto de tickers (altas/bajas remotas aparecen con datos). Verificado e2e: dispositivo nuevo (localStorage vacío) muestra la nube solo; alta desde "otro dispositivo" (GOOG) aparece en ~10s sin recargar; Nivel 1 idéntico.
- **✅ FIX DEFINITIVO borrado sync (causa real: clobbering + servidor no imponía borrados) (23 jul 2026, verificado curl+e2e):** la causa real era que un dispositivo con estado antiguo (localStorage con la empresa y sin tombstone, `lastSyncAt` vacío → fusión unión) reenviaba la empresa borrada a la nube con `deletions:{}`, sobreescribiendo el borrado (cloud del usuario `user_f2b26c58510b` tenía `WBTNF` presente y `deletions` vacío). Solución de raíz **en el servidor** (`auth.py`): (1) `PUT /auth/watchlist` y `/auth/portfolio` ahora **fusionan tombstones e imponen los borrados server-side** (`_merge_tombstones`+`_apply_tombstones`): una entrada con tombstone >= su `saved_at` se descarta SIEMPRE → ningún cliente obsoleto puede resucitarla; (2) nuevos endpoints **autoritativos** `POST /auth/watchlist/delete` y `/auth/portfolio/delete` que borran y registran el tombstone al instante. Frontend: `removeFromWatchlist`/`removePosition` emiten `vs:watchlist-deleted`/`vs:portfolio-deleted`; `WatchlistCloudSync` llama al endpoint de delete de inmediato. Verificado: delete + intento de resurrección por cliente obsoleto → el servidor mantiene el borrado; e2e desde UI (borrar TSLA → fuera de UI y de nube). WBTNF ya limpiado del cloud del usuario con tombstone.
  - *Borrado fiable de raíz*: además de tombstones, `lib/cloudSync.js` ahora es **autoritativo con la nube** — guarda `vs.cloudsync.last` (hora de la última sync OK) y en `reconcile(...,lastSyncAt)` una entrada local que ya NO está en la nube y cuyo `saved_at <= lastSyncAt` se considera borrada en otro dispositivo y se elimina (aunque el tombstone no haya llegado). Las añadidas después de la última sync (offline) se conservan. `upsertPosition` ahora sella `saved_at` (para que el heurístico funcione en Nivel 1). `WatchlistCloudSync` hace **flush** de los cambios pendientes en `pagehide`/`visibilitychange:hidden` para que un borrado llegue a la nube aunque cierres la pestaña antes del debounce. Verificado con 4+4 escenarios node (incluye el caso exacto del usuario: nube sin tombstone → se borra igual).
  - *Tooltip botón 🔄*: `AuthButton` usa `HoverTip` explicando qué hace (sync Nivel 1+2, baja de otros dispositivos, resuelve conflictos/borrados, = recargar).
  - *Aviso "Entra con Google"*: nuevo `components/LoginNudge.jsx` montado en `Layout` (banner slim navy, descartable 7 días) visible en todas las páginas cuando no hay sesión.
  - *Confirmación al borrar*: nuevo `components/ConfirmDialog.jsx` usado en `Watchlist.jsx` (Nivel 2) y `Portfolio.jsx` (Nivel 1): pregunta antes de eliminar y avisa de que el borrado se sincroniza.
- **✅ Sync nube robusto — borrados se propagan (tombstones) + botón = sync completo (23 jul 2026, verificado curl + node + screenshot):** antes la sincronización fusionaba (unión) nube+local, así que un borrado hecho en un dispositivo "resucitaba" desde otro. Ahora cada borrado deja un *tombstone* `{TICKER: deletedAtISO}` (en `storage.js` y `portfolio.js`), que se sincroniza a la nube (`deletions` en `WatchlistPayload`/`PortfolioPayload`, `user_watchlists`/`user_portfolios`). Nueva reconciliación en `lib/cloudSync.js` (`reconcile`/`runFullSync`): une entradas por ticker (gana `saved_at` más reciente), descarta las borradas después de su último guardado, y si se re-añaden después del borrado ganan (se limpia el tombstone); tombstones caducan a 60 días. `WatchlistCloudSync` usa `runFullSync` en login/reload y empuja `deletions` en cada cambio. El botón 🔄 del header ahora ejecuta el MISMO `runFullSync` (Nivel 1 **y** Nivel 2) — idéntico a recargar, útil como reintento ante cuelgues. Verificado: 4 escenarios de reconcile PASS (borrado propaga, re-add gana, add offline se conserva, borrado local elimina item de nube), round-trip backend de `deletions`, y toast del botón "Sincronizado con la nube (Nivel 1: N · Nivel 2: N)".
- **✅ FIX PWA — login de Google en app instalada (22 jul 2026):** en modo `display: standalone` + `apple-mobile-web-app-capable`, el login OAuth por redirección externa rompía en iOS (salta a Safari, la cookie de sesión queda en Safari y no en la app aislada → siempre anónimo). Solución: manifest `display: "browser"` + `display_override: ["minimal-ui","standalone"]` (Android/Chrome sigue siendo instalable con install-prompt vía minimal-ui; iOS abre el icono en contexto Safari que comparte cookies → login funciona). Eliminadas las metas `apple-mobile-web-app-capable` / `mobile-web-app-capable` / `status-bar-style`. `PWAInstallPrompt.isStandalone()` ahora también detecta minimal-ui. IMPORTANTE: quien ya instaló la versión antigua debe borrar el icono y volver a añadirlo (iOS cachea el manifest al instalar).
- **✅ PWA — app instalable iOS + Android (Responsive Fase 3) (22 jul 2026, verificado por curl + screenshot):**
  - `public/manifest.json` (name/short_name, display standalone, start_url ".", scope "/", theme/background `#FDF1E6`, iconos 192/512 `any maskable` + 180 apple-touch + favicons) generados a partir de un icono de marca (salmón FT + monograma navy) con PIL.
  - `public/service-worker.js` network-first (nunca cachea `/api`, fallback offline a `/index.html`), registrado en `src/index.js` en `load`.
  - `index.html`: meta `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `application-name`, `viewport-fit=cover`, link manifest + apple-touch-icon, `<title>` de marca.
  - `components/PWAInstallPrompt.jsx` (montado en `App.js`): banner flotante que usa `beforeinstallprompt` en Android/Chrome/Edge (`pwa-install-btn`) y, en iOS Safari, muestra la instrucción manual "Compartir → Añadir a pantalla de inicio". Descartable 14 días (localStorage). No aparece si ya está en modo standalone.
  - Verificado: manifest/sw/iconos sirven 200, SW registra (1 registration), banner renderiza. NOTA: en el preview (dev server) el SW registra igual; en deploy también.
- **✅ Responsive Fase 2 + Lectura IR inmediata + Aviso IR sin leer (22 jul 2026, verificado por curl + screenshots móvil/desktop):**
  - *Aviso IR*: el job diario de IR marca `ir_unread` (nº de novedades) en la empresa; `GET /kpis/kpi-companies` lo expone y la lista de KPIs muestra un punto ámbar pulsante junto al ticker (`kpi-ir-unread-<TICKER>`), que se limpia al abrir la empresa (`GET /kpis`). El refresh manual/instantáneo no marca unread. Verificado: set ir_unread=3 → aparece en API/UI → abrir empresa → vuelve a 0.
  - *Lectura IR inmediata*: al añadir una fuente IR (`KpiNews.addIr`) se guarda y se dispara `refreshIr()` al momento (sin esperar al chequeo diario 06:15 UTC).
  - *Responsive Macro*: tarjeta del coeficiente ya no se apelotona a 390px — cajas Caro/Barato `grid-cols-1 sm:grid-cols-2` y "Valores usados" `grid-cols-2 sm:grid-cols-3` (etiquetas legibles). Company.jsx ya apilaba bien en móvil (sin cambios).
- **✅ Noticias IR (Investor Relations) en KPIs (22 jul 2026, verificado por curl + screenshot):** en la sección "Noticias" del módulo KPIs se puede pegar la URL de la sala de prensa/resultados (IR) de la empresa (admite RSS, máx. 10). Se revisan automáticamente cada día (job APScheduler `_scheduled_ir_news_run`, 06:15 UTC) y también manualmente con el botón "Actualizar desde IR". Las novedades se añaden a las noticias, marcan el KPI como "pendiente actualizar" (stale) y se suman al Radar semanal — SIN disparar re-análisis IA automático (ahorro de créditos). Dedupe por contenido (`ir_last_hash`): si nada cambió desde la última revisión, no llama al LLM. Endpoints: `GET/PUT /api/thesis/{id}/kpis/ir-sources`, `POST /api/thesis/{id}/kpis/ir-refresh` (job). Front: `KpiNews.jsx` (bloque "Fuentes IR"). Back: `routes/thesis.py` (`_ir_fetch_sources`, `_ir_extract_sync`, `_run_ir_for_company`).
- **✅ UX particiones → auto-marca plan "split" (Feb 2026, verificado por usuario en PLTR):** en la ficha de driver durante planificación, al desplegar manualmente el panel "Se puede dividir en N partes" se cambia automáticamente el botón preseleccionado de "Conjunto" a "Particiones" (si no estaba ya). El usuario mantiene control total: puede colapsar/expandir y forzar cualquiera de los dos botones manualmente. Sólo aplica antes de generar (`!planningLocked`). Cambio: `ThesisResult.jsx` (handler del toggle).
- **✅ P1 verificado E2E (Jun 2026): emails Screener nocturno + Radar semanal funcionando con Resend:**
  - Smoke test directo Resend → API key válida, sender `onboarding@resend.dev` autorizado para `joseaq.2m@gmail.com` (modo sandbox).
  - Screener nocturno: ejecutado vía `POST /api/admin/run-screener`, detectó 1 cruce en la watchlist real (TSLA/MU/QCOM/REGN/META/LLY/COST/AVGO/BKNG/ANET/AMD/AMZN, etc.) → 1 email enviado y recibido en bandeja.
  - Radar semanal: ejecutado vía `POST /api/admin/run-radar` con `radar_state.seen` limpiado para forzar tendencias nuevas → 5 candidatas LLM, 4 nuevas con heat ≥ 7, 1 email enviado y recibido.
  - **Mejora añadida en el email del radar (Jun 2026)**: cada título de tendencia es ahora un **enlace clickable** que abre `/thesis?explore=<tendencia urlencoded>`. La página de Tesis detecta el parámetro, conmuta a modo "Tendencias → Empresas" y pre-rellena el buscador SIN auto-ejecutar — el usuario decide pulsar "Explorar tendencia". Nueva env var `PUBLIC_APP_URL` en backend/.env. Cambios: `radar.py` (URL encoding + `<a>` wrapper) + `Thesis.jsx` (handler `explore` en el useEffect existente). Verificado end-to-end con email real y test mock.
- **✅ Empresa→Tesis · MODELO DE DRIVERS DE CRECIMIENTO (Jun 2026, e2e LLM real NVDA+DDOG + screenshot) — modelo vigente:**
  - Definición acordada con el usuario: una tesis = apuesta de ALTA CONVICCIÓN sobre un DRIVER DE CRECIMIENTO independiente (TAM propio, no solapado), etiquetada Actual (núcleo en expansión) o Futura (apuesta de futuro / adyacencia con sinergia+moat).
  - 3 pasadas: (1) `_map_growth_drivers` mapea drivers actuales (núcleo descompuesto en sub-drivers independientes) + futuros/adyacentes; (2) `_reconcile_drivers` fusiona drivers correlacionados/mismo pool de TAM, descarta baja convicción, garantiza TAMs mutuamente excluyentes (el más alto posible) sin reglas deterministas ni info de solapamiento visible; (3) `_synthesize_company_trends` puntúa. Convicción = juicio cualitativo del modelo (sin corte numérico, por petición del usuario).
  - Principio único "driver independiente": dos cosas son drivers distintos si su crecimiento es independiente; si crecen por la misma causa, son uno → produce la asimetría grande/pequeña, parte NVIDIA sin romper Datadog y garantiza exclusividad de TAM por construcción.
  - Verificado: NVDA → 5 tesis (3 actuales + 2 futuras: robótica+simulación, gemelos digitales); DDOG → 5 (observabilidad core unificada + seguridad/CNAPP como TAM aparte + FinOps/DX + AIOps futura). Frontend muestra badge "Crecimiento actual"/"Apuesta futura" por tesis (verificado por screenshot). Lint OK.
  - Sustituye a los enfoques anteriores (descomposición por áreas/segmentos, disyuntiva de solapamiento), todos retirados.
  - **Split opcional de cores grandes (Jun 2026):** cada tesis puede traer un `splits[]` (solo cores grandes descomponibles); el backend reescala las sub-partes para que SUMEN EXACTAMENTE el TAM del padre (conservación). La UI muestra "Dividir en N partes" con un botón Generar por sub-parte + "Generar tesis (conjunto)". Verificado: NVDA "Cómputo acelerado IA" $800B → Entrenamiento $450B + Inferencia $350B (=$800B); las tesis pequeñas no traen split.
- **✅ Empresa→Tesis · descomposición granular por DOBLE PASADA (Jun 2026) [SUPERADO por el modelo de drivers de crecimiento]:**
  - Problema detectado por el usuario: la granularidad era inconsistente (a veces 3 segmentos amplios, a veces 6 finos) porque era una *preferencia blanda* del prompt, no un mecanismo. El usuario eligió la opción **B (doble pasada determinista)** para no depender de un umbral fijo.
  - Implementación en `run_company_thesis`: **Pass 1** `_identify_business_areas` (GPT-5.2) identifica las grandes áreas de negocio ganadoras; **Pass 2** `_decompose_areas` (GPT-5.2) OBLIGA a dividir cada área en sus sub-segmentos más granulares con entidad propia (cualitativa + TAM propio); luego el **Synthesizer** (Claude) puntúa. Cada sub-segmento lleva `area` + `tam_busd`. Fallback a áreas si Pass 2 vuelve vacío. ~3 llamadas LLM, en background (~50s).
  - Verificado: NVDA → 2 áreas → 4 sub-segmentos ($420B/$85B/$75B/$45B); DDOG → 2 áreas → 7 sub-segmentos pequeños ($6-18B). Granularidad ahora consistente (cada área se descompone siempre).
- **✅ Empresa→Tesis: descomposición en SEGMENTOS DE NEGOCIO granulares (Jun 2026, e2e LLM real NVDA + screenshot):**
  - Reformulación pedida por el usuario: en lugar de proponer megatendencias amplias (y gestionar solapamientos), la IA **descompone el negocio de la empresa en los segmentos más GRANULARES** que tienen entidad propia, tanto **cualitativa** (apuesta estratégica ganadora con tracción) como **cuantitativa** (TAM propio significativo), y los propone por separado.
  - Regla de granularidad (clave): prefiere SIEMPRE el nivel más fino — si "Infraestructura de IA" (~850B) se descompone en 4-5 sub-segmentos (~150-200B cada uno) que califican por separado, propone los sub-segmentos, NO el amplio. Nunca propone a la vez un segmento y sus sub-segmentos. El nº de segmentos depende de la empresa: 1-2 en pequeñas/pure-play de pocos B, 4-8 en grandes diversificadas; sin número fijo.
  - Backend: `INVESTIGATOR_COMPANY_SYS` + prompt reescritos para descomposición granular; el investigador asigna `tam_busd` por segmento. El sintetizador puntúa (relevancia/probabilidad). Cada `trends[]` lleva su `tam_busd`. **SE ELIMINARON** los `overlap_groups` y toda la lógica de disyuntiva/solapamiento (el enfoque anterior).
  - Frontend (`ThesisResult`, Bloque 1.2 "Segmentos de negocio · nuevas tesis"): grid de `NewThesisCard`, cada una con su "TAM estimado $X". Se eliminó `DisjunctiveTrendGroup` y el agrupado por solapamiento.
  - Verificado: NVDA real → 6 segmentos granulares (GPU entrenamiento $250B, inferencia $200B, interconexión $80B, software IA empresarial $120B, DPUs/SmartNICs $35B, robotaxis L4 $90B), sin overlap_groups; UI renderizó las 6 fichas con TAM (screenshot).
  - NOTA: la jerarquía padre-hijo del dashboard (parent_id, sidebar parent select, banner parent-suggestion, aggregate_folder_tam) sigue presente; el usuario la eliminará al reformular "Tesis → Empresas".
- **✅ [OBSOLETO/eliminado] Propuestas con TAM excluyente · disyuntiva (Jun 2026):** sustituido el mismo día por la descomposición granular (arriba). Se retiró el bloque "mercados solapados / elige una" y `overlap_groups`.
- **✅ Jerarquía TAM padre-hijo · anti doble conteo (Jun 2026, testing agent frontend 100% iteration_16 + pytest 5/5 + e2e curl):**
  - Decisiones del usuario: (1) TAM de la megatendencia = **solo la madre** (la hija anidada NO suma su TAM); (2) detección de solapamiento **automática con LLM**; (3) anidado **siempre con confirmación manual**; (4) relación padre-hijo **entre cualquier par** de tesis de tendencia.
  - Backend: campo `parent_id` en `theses`. `PUT /api/thesis/{id}/parent` `{parent_id}` anida/limpia (valida: no auto-madre, madre debe ser trend, sin ciclo directo → 400/404). `GET /thesis/dashboard` expone `parent_id`+`is_child` por tendencia y calcula el TAM de carpeta con `aggregate_folder_tam` (función pura, excluye hijas). Al generar una tesis de tendencia NUEVA, `detect_parent_thesis` (Claude) sugiere madre si es sub-segmento → resultado lleva `parent_suggestion` (no persistido).
  - Frontend: banner `parent-suggestion` en `ThesisResult` (botón `parent-nest-btn` "Anidar" + "Mantener separada"); selector de madre por tesis en el sidebar (`sidebar-trend-parent-{id}`) con nota `sidebar-trend-parent-note-{id}` "↳ sub-tesis de «…» · TAM no sumado"; treemap marca hijas con "↳"+badge "sub-tesis" y caption explica la exclusión. Undo/redo soporta `assign_parent`. `assignThesisParent` llama `reload()` → el treemap auto-refresca.
  - Verificado: carpeta con madre(700)+hija(450) → TAM **700** anidada, **1150** independiente; validaciones de ciclo OK. Tests: `backend/tests/test_folder_tam_hierarchy.py` (5/5).
- **✅ Comparador de novedad al regenerar una tesis de empresa (Jun 2026, pytest 5/5 + e2e curl):**
  - Al **regenerar** (sobrescribir) una tesis de EMPRESA, `_run_generate_job` compara la nueva con la guardada vía `_company_thesis_changes` (en `routes/thesis.py`): empareja tendencias por **solapamiento de tokens (Jaccard ≥ 0.5)** para tolerar reformulaciones, y compara relevancia global (tol ±6), probabilidad (tol ±1), relevancia y probabilidad ganadora por tendencia, más tendencias nuevas/eliminadas.
  - **Sin novedades** (lista vacía) → NO sobrescribe; conserva la tesis guardada y devuelve `no_changes:true` → banner `no-changes-note` + toast "Sin novedades relevantes". 
  - **Con cambios** → sobrescribe y devuelve `changes:[...]` (solo en el resultado, no se persiste) → banner verde `changes-note` con la lista + toast "Tesis actualizada · N cambios".
  - Solo aplica a empresas (las tendencias regeneran como antes). Tests: `backend/tests/test_company_thesis_changes.py` (5/5). E2e: regen MSFT → changes [relevancia 88→95, prob →9, nuevas/eliminadas].
- **✅ Fixes flujo Empresa→Tesis: botón Generar + regeneración sin "nada encontrado" (Jun 2026, screenshot + curl):**
  - **Problema 1 — "Generar tesis" no generaba tras el auto-cambio:** cuando el aviso de sobreescritura (`dedup-warning`) ya está visible para esa empresa, un clic en el botón principal **"Generar tesis"** ahora **confirma la sobreescritura** (mismo efecto que "Reescribir igualmente": se añade `overwriteId` y arranca la generación). Verificado por screenshot (Microsoft: tras el aviso, "Generar tesis" → "GENERANDO…", aviso desaparece).
  - **Problema 2 — regeneración devolvía "no se encontró nada":** con los prompts estrictos, el investigador podía devolver 0 tendencias para una empresa real → error. Ahora `run_company_thesis` **reintenta el investigador** y el prompt pide **AL MENOS 1 tendencia** para una empresa cotizada real (no vacío salvo que no exista/cotice). Así la regeneración produce la nueva tesis y **sobrescribe** la anterior. Verificado por curl (PATH/UiPath → 1 tendencia ganadora, overall 72). NOTA: un error de generación NO sobrescribe la tesis existente (se preserva).
- **✅ Avisos de búsqueda + badge "tendencia ganadora" (Jun 2026, verificado screenshot + curl):**
  - **Bug 1 — empresa en el buscador de tendencias + auto-generación (Jun 2026, screenshot OK):** el input de «Tesis → Empresas» abre un **desplegable de empresas** (`trend-company-suggestions`, `/api/search`→`EQUITY`, debounce 250ms) cuando lo escrito coincide con una empresa; las frases de tendencia no devuelven resultados. Al **pinchar** una empresa (`trend-company-opt-{symbol}`), el sistema cambia a «Empresa → Tesis» y **genera directamente** su tesis si no existe; si **ya está guardada**, muestra el aviso de sobreescritura (`dedup-warning`, con la nota del refresco semanal) en vez de generar. Si se escribe el nombre completo y se pulsa Generar sin pinchar, se detecta igual (`matchCompany`) y converge en el mismo flujo. Verificado: ASML (nueva)→genera directo; Microsoft (guardada)→aviso de sobreescritura.
  - **Bug 2 — reposicionamiento del aviso de sobreescritura:** el `dedup-warning` (que informa del refresco semanal automático y pregunta si reescribir) se muestra ahora **justo debajo del buscador y encima del recuadro de Megatendencias** (orden DOM verificado).
  - **Mejora — badge "Ganadora":** cada ficha de **nueva tesis sugerida** (`NewThesisCard`) muestra un badge `winning-badge` con la **probabilidad ganadora 0–10** (`win_probability`, nuevo campo del sintetizador + merge en `run_company_thesis`), con HoverTip explicativo, para priorizar de un vistazo las apuestas con más momentum. Verificado por curl (PLTR: win_probability 9/8/8).
- **✅ Lógica ganadora + robustez de relevancia + UI de encaje en Empresa→Tesis (Jun 2026, testing agent frontend 100%, iteration_15):**
  - **#1 Robustez de relevancia (bug transitorio resuelto):** `overall_relevance` + `relevance_score` quedaban en blanco SIN aviso si la llamada a Claude fallaba o el JSON no parseaba. Solución: `_synthesize_company_trends` **reintenta una vez**; el merge usa `_align_syn_trends` (exacto → solapamiento de tokens → posicional) para no descartar relevancia por un nombre reformulado; si aun así falla, `flags.relevance_unavailable=true` y la UI muestra aviso (`relevance-unavailable-note`).
  - **#3 Lógica ganadora/estratégica:** los prompts de empresa (investigador/sintetizador/matcher) exigen incluir una tendencia SOLO si es **ganadora**, la empresa hace una **apuesta estratégica** explícita y hay **resultado/tracción observable** (0, 1 o varias; sin número fijo). `gather_sources` añade consultas de estrategia/tracción reciente. Verificado por curl (CRWD overall 92, fits "Apuesta estratégica… net new ARR récord").
  - **#2 UI filas que encajan (bloque 1.1b):** cada fila muestra una **explicación de encaje** (`matched-thesis-fit-{id}`) y dos botones: **"Añadir a tesis"** directo (`matched-thesis-add-direct-{id}`) y **"Calcular score"** (`matched-thesis-eval-{id}` → preview de ambos scores → "Confirmar" `matched-thesis-add-{id}`). El "Score global tendencia" lleva HoverTip explicativo igual que el TAM Score.
- **✅ Rediseño/simplificación del flujo Empresa → Tesis (Jun 2026, testing agent frontend 100%, iteration_13):**
  - Al generar una tesis de EMPRESA el resultado se divide en DOS bloques claros (sin mezclarse):
    - **Bloque 1.1 "Tesis ya generadas"**: (a) recuadro reutilizado de la página de empresa (`CompanyQualCard` con prop `hideEmpty` + `refreshKey`) con las tesis de tendencia donde la empresa YA es miembro (títulos + Score global + TAM Score + medias); (b) lista `existing-matches` (`MatchedThesisRow`) con las tesis de tendencia existentes que encajan pero donde la empresa AÚN NO está incluida, cada una con botón **"Añadir {TICKER}"** (anti-duplicación: la empresa se une a la tesis existente en vez de crear una casi-duplicada).
    - **Bloque 1.2 "Nuevas tesis sugeridas"** (`NewThesisCard`): fichas informativas SOLO con temas NUEVOS no cubiertos por ninguna tesis existente (derivados de `link-suggestions.to_create`), cada una con botón "Generar tesis". Estado vacío `new-trends-empty` cuando todo está cubierto.
  - Se ELIMINÓ el antiguo aviso rojo de duplicado por ficha (`trend-dup-warning-*`), el botón "Generar de todas formas" por ficha y la lógica `findMatch`. La clasificación usa `POST /thesis/{id}/link-suggestions` → `to_add` (con `already_in`, filtramos los no incluidos para 1.1b) y `to_create` (1.2).
  - **Desplegable lateral (sidebar) simplificado**: `CompanyTrendsDropdown` ahora lista SOLO las tesis ya generadas donde la empresa SÍ aparece (verde/incluida). Se quitaron los estados gris "no incluida" y naranja "no generada", la leyenda de 3 estados y el `STATE_COLOR` multi-estado. Backend `GET /thesis/dashboard` → `fit_trends` solo `state:"included"` (membresía real); se eliminó el backfill semántico (`_backfill_link_matches`, `_BACKFILL_INFLIGHT`) que ya no hace falta.
  - **Refresco tras añadir**: al pulsar "Añadir {TICKER}", `ThesisResult` incrementa `mutateTick` (re-fetch de `link-suggestions` + `CompanyQualCard`) y llama `onMutated={reload}` (recarga dashboard/sidebar). El desplegable lateral refleja la nueva membresía al recargar (cambio de página o botón Actualizar `refresh-data-btn`). Verificado E2E: MSFT pasó de "0 tesis" a "1 tesis" tras añadirla a `thesis_test_aidc`.
  - **✅ Borrar en el listado lateral, tesis Y empresas (Jun 2026):** el `CompanyRow` del sidebar tiene ahora un botón papelera (aparece al hover, data-testid `sidebar-company-remove-{ticker}`), igual que `TrendRow`. Reutiliza el handler `onRemoveThesis` (`removeThesis`) → borrado **deshacible** con los botones Deshacer/Rehacer de la cabecera (`pushAction` type `delete_thesis` + `POST /thesis/restore`). Verificado por curl el round-trip borrar→restaurar de una tesis de empresa (404→200).
  - **✅ Preview de AMBOS scores antes de confirmar (Jun 2026, testing agent frontend 100%, iteration_14):** el botón de añadir del bloque 1.1b es ahora de DOS PASOS. (1) "Calcular score" → `POST /thesis/{id}/evaluate-company` (job LLM, NO persiste) → previsualiza el **Score global tendencia** (`preview-overall-{id}`) y el **TAM Score** (`preview-tam-{id}`). (2) "Confirmar · Añadir {TICKER}" (`matched-thesis-add-{id}`) → `thesisAddCompany(..., entry)` reutiliza la evaluación precomputada (sin 2ª llamada LLM → persiste en ~3-4s). Botón "Cancelar" descarta el preview. Backend: `_run_eval_company_job` calcula overall + TAM (eslabón × revenue USD); `add-company` acepta `entry` opcional. `existingMatches` se **deduplica por `thesis_id`** (varias tendencias pueden mapear a la misma tesis). Verificado E2E (overall 74 / TAM 0.71; confirmar 4s).
- **✅ Rediseño dashboard de /thesis (Feb 2026, Fase A+B — testing agent 100%, 21/21):**
  - Layout: sidebar derecho "Mis tesis y empresas (N)" alineado arriba (junto al hero) con buscador desplegable en vivo.
  - Generador: botón "Tesis automática" movido junto a los tabs Tendencia/Empresa; eliminado el texto "¿Sin ideas?" y el placeholder "Genera tu primera tesis".
  - "Carpetas" renombrado a **Megatendencias** en toda la UI (icono carpeta conservado). Barra de gestión de megatendencias arriba (crear/eliminar). Cada Tendencia tiene selector inline de megatendencia en el sidebar; cada Empresa un desplegable de tendencias (verde=ya incluida / gris=no) con tooltip.
  - Backend nuevo: `GET /api/thesis/dashboard` → folders (TAM agregado = suma del TAM de sus tendencias), trends (con TAM + empresas), companies (avg_overall_score + sum_tam_score calculados SOLO desde caché de fundamentals, sin yfinance en vivo).
  - **ThesisExplore** (`components/thesis/ThesisExplore.jsx` + `lib/treemap.js` squarify propio): 4 vistas de cuadrados proporcionales con drilldown + breadcrumb: Megatendencias→Tendencias→Empresas, Tendencias→Empresas, Empresas·score medio, Empresas·TAM total. Color rojo(bajo)→dorado→verde(alto) relativo al conjunto. Clic en empresa → /company/{ticker}.
  - **Dedupe (punto 6):** al regenerar una tesis ya guardada, aviso (intercepta ANTES de la llamada LLM) mencionando el refresco automático semanal, con "Reescribir igualmente" (pasa `overwrite_thesis_id` → el backend actualiza el doc en sitio en vez de duplicar), "Abrir la existente" y "Cancelar".
  - **✅ Ajustes UI/UX dashboard Tesis — lote 2 (Feb 2026, testing agent 100%):**
    - Sidebar "Empresas": SOLO tesis de empresa (type=company), **deduplicadas por ticker** (solo la última búsqueda aparece). Link del nombre → /thesis/{company_thesis_id}. **Desplegable (coherente con la página de análisis):** verde/gris = pertenencia REAL en TODAS las tesis de tendencia; naranja = temas del análisis NO cubiertos. La cobertura usa la **resolución SEMÁNTICA** persistida (`doc.link_matches`, el mismo `match_company_to_theses` que usa link-suggestions/análisis), con **fallback léxico** y **auto-recálculo en segundo plano** (`_backfill_link_matches`, no bloqueante, con guard anti-spam y `sig` para detectar tesis añadidas/eliminadas). Garantiza que el desplegable y la página de análisis muestren siempre lo mismo.
    - Treemap: leyenda de color y caption invertidos (verde/alto a la izquierda → rojo/bajo a la derecha) para coherencia con los cuadrados; caption más grande (text-sm).
    - Breadcrumb del treemap: la entrada de una tesis es un link que navega a /thesis/{id}.
    - Refresco semanal: copy ampliado ("profundiza, refresca las tesis y empresas implicadas y te avisa").
    - Terminología: "tendencia/tendencias" → "tesis" en toda la página del dashboard (tabs "Tesis → Empresas" / "Empresa → Tesis", vista treemap "Tesis", etc.); "megatendencia(s)" se conserva.
    - Sidebar empresas: quitados los scores numéricos (ya están en el treemap central); el desplegable de tesis se movió a la derecha.
    - Punto 4 — Megatendencias: quitados los chips individuales (el cuadro solo tiene título + explicación + crear). Borrado desde el **treemap de Megatendencias** (papelera en cada cuadro) → modal que pregunta "Solo desagrupar (mantener tesis)" vs "Borrar también las tesis (cascada)" vs Cancelar.
    - **Deshacer/Rehacer GLOBAL** en la cabecera (junto al título): historial de todas las acciones mutadoras (crear/borrar megatendencia [cascada o desagrupar], borrar tesis, asignar megatendencia). Backend: `DELETE /thesis/folders/{id}?mode=ungroup|cascade` devuelve datos para undo + `POST /thesis/restore` (re-inserta folders/theses por id y reasigna). Round-trip cascade verificado por curl.
  - **Backlog/refactor sugerido (testing agent):** extraer `MegatrendsBar` y `DeleteFolderModal` de `Thesis.jsx` (~545 líneas) a componentes propios; atajo Escape para cerrar el modal. job APScheduler (martes 07:00 UTC) `thesis_refresh.py` para usuarios con `thesis_refresh.enabled`: (1) **refresco ligero** sin LLM — re-fetch de fundamentals de todos los tickers de las tesis guardadas (precios/proyecciones/TAM frescos); (2) **news watch** — 1 llamada LLM barata (`run_news_watch`, GPT-5.2) sobre las tendencias del usuario que marca SOLO desarrollos materiales; (3) **deepen acotado** (cap 2/usuario/run) — regenera en sitio solo las tesis con noticia importante; (4) **email** (Resend) con las novedades. Endpoints: `GET/POST /api/thesis/refresh/status|subscribe`, `POST /api/admin/run-thesis-refresh`. UI: toggle "Refresco semanal" en el sidebar. Verificado por curl (status/subscribe + admin run con 0 suscriptores = sin coste LLM); toggle renderiza.

- **Cartera real** (`/portfolio`) con posiciones (ticker, acciones, precio compra, moneda, fecha, nota), P/L vivo, P/L %, KPIs totales (invertido, valor actual, P/L absoluto, P/L %), sync cloud cuando logueado.
- **Posiciones "sólo seguimiento"** — `shares` y `buy_price` son opcionales al crear la posición. La fila aparece con etiqueta `SEGUIMIENTO` y datos en "—"; editar la fila más tarde rellena los datos y recalcula KPIs.
- **Alertas por fila** (campana on/off) en cada entrada de watchlist y cartera. La campana sólo es interactiva si estás logueado (toast de "Inicia sesión…" si no). El screener cruza con `alert_enabled` por entry y la preferencia global `notify.enabled`.
- **Toggle ES/EN** completo en cabecera (botón EN/ES junto al selector de moneda). Persistencia en localStorage `vs.lang`. Coberturas en EN: nav, page titles, columnas, hero, footer disclaimer. Tooltips y dialogs internos se quedan en español por ahora (primera pasada).
- `/api/auth/portfolio` GET/PUT y `WatchlistEntry.alert_enabled` añadidos.
- `WatchlistCloudSync` también sincroniza cartera ahora.
- `GET /api/company/{ticker}` — fundamentals + auto-projections + custom_ratios (cacheado 6h en Mongo).
- `POST /api/company/{ticker}/calculate` — recálculo en vivo con inputs editables.
- `GET /api/compare?tickers=...` — comparación side-by-side (1-6 tickers).
- `GET /api/search?q=...` — autocompletado de tickers.
- `GET /api/company/{ticker}/translate-summary` — traduce `long_business_summary` al español vía Emergent LLM (gpt-4.1-mini) + cache en Mongo por `source_hash`.
- `GET /api/company/{ticker}/ratio-history` — serie anual de Ratio Compra/Venta + precio cierre para detectar trampas de valor.
- Frontend: Home, Company (KPIs hero, inputs editables, ratios clásicos + sección de crecimiento + breakeven, gráficos de ingresos/FCF/ratios+precio, breakdown POC, modo sensibilidad), Watchlist, Compare.
- Soporte global: AAPL, SAP.DE, SAN.MC, VOD.L, ASML.AS, etc.
- Formato europeo es-ES en todos los números.
- **Modo oscuro** (toggle en cabecera) con paleta dedicada y overrides para Recharts.
- **Umbrales configurables** cara/justa/barata por Ratio Compra y Venta independientes (sliders + inputs, localStorage).
- **Aviso legal** persistente en el footer.
- **Tooltip de código de mercado** (NMS → NASDAQ Global Select, etc.) sobre +50 exchanges.

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
- **🔨 EN CURSO (Feb 2026) — Thesis Engine v2 (decisiones cerradas con el usuario, construir con E2+Opus):**
  - **✅ Botón "Generar tesis" + aviso anti-duplicado en tarjetas de tendencia (hecho, Feb 2026):** en el modo "Empresa → Tendencias", cada `TrendCard` lleva ahora un botón **"Generar tesis"** (deep-link `/thesis?trend=...&auto=1`, que auto-genera al llegar). Al cargar una tesis de empresa, `ThesisResult` llama a `POST /thesis/{id}/link-suggestions` (matcher LLM, Claude) y, para cada tendencia que **ya tiene una tesis de tendencia desarrollada que encaja**, muestra un **AVISO** (enlace a la tesis existente + botón "Añadir {ticker} a esa tesis" vía `add-company`) para evitar duplicar tesis e inflar el valor atribuido a la empresa. Optimización: el matcher hace **short-circuit sin LLM** si el usuario no tiene tesis de tendencia, y **cachea** el resultado en el doc (`link_matches` con firma del conjunto de tesis) → solo recalcula cuando cambia ese conjunto (1ª llamada ~6s, siguientes ~0.2s). Se retiró el bloque manual `CompanyThesisLinker` (sustituido por la integración por tarjeta). Verificado: testing agent **frontend 100% (5/5)** + curl (cache + matcher). **Refinamiento (Feb 2026):** cada coincidencia (`to_add`) incluye ahora `already_in` (calculado en cada llamada: si el ticker ya está en `companies` de esa tesis). Si la empresa **no** está → botón "Añadir {ticker} a esa tesis"; si **ya está** → aviso "{empresa} ya está en esta tesis: {título}. Si generas esta tesis {empresa} no aparecerá para no duplicar su valor" (sin botón Añadir; con botón con contorno "Generar de todas formas"). Verificado: testing agent **frontend 100%** (MSFT no-está / NVDA ya-está) + curl.
  - **✅ Garantía determinista anti-duplicación "primer botón gana" (hecho, Feb 2026):** una empresa vive en **una sola tesis por tendencia**, la del primer botón pulsado. (1) "Generar de todas formas" pasa `&matched={thesis_id}`; al generar, la nueva tesis **excluye** las empresas ya presentes en la tesis que encaja y sus hermanas, y se marca con `trend_match_id={matched}` (banner `omitted-companies-note`). (2) `already_in` ("cubierta") = la empresa está en la tesis que encaja **o** en cualquier hermana (`trend_match_id`) → si está cubierta no se ofrece "Añadir". Leyenda (no cubierta): "Puedes añadir {empresa} a esa tesis y/o generar de todas formas; {empresa} no se duplicará para no inflar su valor". Flujos verificados: añadir→generar (excluye), generar→volver→añadir (ya cubierta, sin botón). En la tesis hermana generada se muestra un **aviso** ("{empresa} no aparece en esta tesis porque ya está en **{título de la tesis que encaja}** [enlace]. Se ha omitido para no duplicar su valor"), persistido en el doc (`omitted_companies` + `omitted_for_thesis`). Verificado: testing agent frontend 100% (iteraciones 7 y 8) + curl E2E (generación con matched omitió NVDA/MSFT; banner con título; cobertura por hermana detectada).
  - **✅ Autocompletado de tickers en Tesis (hecho, Feb 2026):** la pestaña "Empresa → Tendencias" usa ahora el mismo `TickerAutocomplete` (Yahoo `/api/search`) que el resto de la app: al teclear sale el desplegable de tickers coincidentes (flechas + Enter para seleccionar; Enter sin selección genera la tesis vía nuevo prop `onEnter`). La pestaña "Tendencia → Empresas" mantiene el input de texto libre. Verificado (curl + dropdown NVDA en UI).
  - **✅ TAM Score en tarjetas de empresa (hecho, Feb 2026):** badge "TAM Score" (mono, ×) junto al Score global en cada `CompanyCard` de una tesis de TENDENCIA. Fórmula: `(overall_score/100 × TAM_del_eslabón_2027e) / Ingresos_proyectados_2027_de_la_empresa`. Ingresos = `auto_projections.revenue_2y` (misma base que POC/POV) **convertidos a USD** vía `fx.py` (el TAM está en miles de millones USD). Backend: función pura `compute_tam_score` en `services/thesis.py`; endpoint **stateless** `POST /api/thesis/tam-scores` (patrón job en background → `job_id` → polling, para no exceder el timeout de 60s del ingress al consultar yfinance de varias empresas) que **funciona anónimo** (no requiere login ni persistir la tesis); reusa la cache `db.fundamentals` 6h. Frontend (`ThesisResult.jsx`): `useEffect` resuelve el TAM por `value_chain_role`, llama a `thesisTamScores`, muestra spinner mientras carga y el badge **con dos decimales y sin "×"** en el recuadro de la tarjeta (verde >1, ámbar <1) con tooltip explicativo. Verificado: curl (NVDA 0.55, TSLA 4.33, SAP.DE EUR→USD 3.24), 11 tests pytest, render UI.
  - **✅ Refinado UI del TAM Score + tabla cualitativa en empresa (hecho, Feb 2026):** (1) En `CompanyCard` (tesis de tendencia): el "Score global" pasó a llamarse **"Score global tendencia"** y el **TAM Score se sitúa DEBAJO** con el mismo aspecto de número en recuadro (`ValueBox` compartido en `ScoreBar.jsx`). (2) `CompanyQualCard` (en la página cuantitativa `/company/{ticker}`) reescrita: ahora es una **tabla** con una línea por cada tesis de tendencia guardada donde encaja la empresa (tendencia en negrita enlazada a la tesis completa), columnas **Score global tendencia** y **TAM Score** (cabeceras encima), y una fila de agregados: **media** de los score global tendencia (calidad general) y **suma** de los TAM scores (potencial total). Se quitaron la explicación de la tendencia y los 4 sub-scores parciales. Backend nuevo: `GET /api/thesis/company/{ticker}/profile` (todas las tesis trend con el ticker + tam_score por fila + avg/sum + tesis inversa opcional). Verificado por **testing agent (frontend 100%, 4/4 tests)** con usuario sembrado: NVDA 2 filas (0.6× y 0.3×), media 85, suma 0.8×, navegación y estado anónimo OK.
  - **✅ F5 — Vinculación cruzada empresa↔tesis (hecho):** en una tesis de EMPRESA (logueado), panel `CompanyThesisLinker` con botón "Buscar vínculos" → `POST /api/thesis/{id}/link-suggestions` (Claude empareja semánticamente las tendencias de la empresa con las tesis de tendencia guardadas del usuario): `to_add` (tesis existentes → botón "Añadir" que lanza `POST /api/thesis/{trendThesisId}/add-company`, job que evalúa la empresa en esa tendencia con `evaluate_company_for_trend` y la añade a `companies` + `qual_snapshots`) y `to_create` (tendencias sin tesis → link "Crear tesis" a `/thesis?trend=...`). Backend: `match_company_to_theses`, `evaluate_company_for_trend` en `services/thesis.py`. Verificado end-to-end (Microsoft → IA matchea tesis existente, Ciberseguridad → crear; add-company evaluó MSFT como líder score 92).
  - **✅ Post-F5 — Radar semanal por email (hecho):** `radar.py` (mirror de `screener.py`): job semanal (lunes 07:00 UTC vía APScheduler) que ejecuta el descubrimiento (`run_discover` en hilo), compara con tendencias ya vistas (`db.radar_state.seen`), y envía email (Resend) a los usuarios suscritos (`user.radar.enabled`) con las tendencias NUEVAS de heat≥7. Endpoints: `GET/POST /api/thesis/radar/status|subscribe`, `POST /api/admin/run-radar` (trigger manual). UI: toggle "Radar semanal" en el sidebar de Tesis. Verificado (run-radar: 5 candidatas/3 nuevas/1 suscriptor; emails_sent=0 con email de prueba ficticio — la infra de envío es la misma del screener ya verificado). **Limitación conocida:** el dedupe de "nuevas" es por nombre normalizado; como el descubrimiento varía cada ejecución, puede contar como nueva una tendencia ya vista con otro nombre (mejorable con dedup semántico).
  - **✅ F4 — Tesis automática / descubrimiento (hecho):** botón "Tesis automática" en la página principal. `POST /api/thesis/discover` (job async, sin login necesario) hace una búsqueda web amplia (`gather_discovery_sources`: megatendencias/disrupción/papers) y GPT-5.2 (`run_discover`, `DISCOVERER_SYS`) propone 4-5 tendencias emergentes distintas, cada una con `name`, `sector`, `why_now` y `heat` 0-10 (momentum). Frontend (`Thesis.jsx`): tarjetas "Tendencias emergentes detectadas" con llama+heat y botón "Desarrollar tesis" que dispara la generación completa normal (reutiliza el flujo F1-F3). Refactor: `_run_searches` compartido. Verificado end-to-end (curl + UI: descubrió IA industrializada, renacimiento nuclear/SMRs, defensa, recursos críticos… y desarrolló la tesis al pulsar). Esto controla créditos: descubrir es 1 llamada barata; el usuario elige cuál desarrollar.
  - **✅ F3 — TAM + 2 columnas líderes/disruptores (hecho):** el investigador de tendencia ahora estima **TAM global** (miles de millones USD, 2027 TTM) con nota, y **TAM por cada eslabón** de la cadena de valor; clasifica cada empresa como `leader` o `disruptor` y garantiza **≥1 de cada por capa**. Backend: `_busd`/`_normalize_tam`/`_normalize_value_chain` en `services/thesis.py`; campos `tam`, `value_chain[].tam_busd`, `companies[].category`. Frontend (`ThesisResult.jsx`): badge TAM global en cabecera (verde, hover con nota), y matriz **CADENA DE VALOR · LÍDERES VS. DISRUPTORES** — por cada eslabón (con su TAM): columna izquierda *Líderes establecidos* (pill azul) y derecha *Disruptores/líderes del cambio* (pill rojo); empresas agrupadas por `value_chain_role` con fallback "Otros". `fmtTam` muestra $B/$T. Verificado end-to-end (Vehículos eléctricos: TAM $796B, 4 capas, TSLA líder vs BYD disruptor, LG líder vs CATL disruptor) + screenshot.
  - **✅ F1 — Bug de carpetas (hecho en E1):** la creación de carpetas YA funcionaba; faltaba poder mover tesis del historial a carpetas. Añadido un `<select>` de carpeta por cada tesis en "Mis tesis" (`assignThesisFolder` en `Thesis.jsx`) + texto de ayuda. Verificado con cookie en Playwright.
  - **✅ F2 — Probabilidad + contratesis (hecho y CORREGIDO):** círculo de probabilidad 0-10 (0 rojo → 10 verde) calculado por Claude con justificación al **hover** (`ProbabilityCircle.jsx` + `HoverTip`), arriba junto al título. **Semántica de contratesis CORREGIDA (importante):** NO es "si la tesis falla", sino la **consecuencia DERIVADA** de que la tendencia SÍ ocurra → los **perdedores** (sectores/empresas perjudicados por disrupción/comoditización/sustitución *porque* la tendencia avanza). Tesis y contratesis son COMPATIBLES y ambas pueden tener probabilidad alta (verificado: Computación cuántica → tesis 6 / contra 7). Para empresa: contratesis = en qué cambios estructurales la empresa queda en el lado perdedor. Render: bloque salmón/rojo de baja presencia entre título y cadena de valor, con su propio círculo de probabilidad + cadena de valor afectada + empresas perjudicadas (trend) o `losing_trends` (company). Botón "Añadir contratesis" bajo demanda.
  - **✅ Arquitectura ASÍNCRONA de jobs (crítico):** el ingress de Kubernetes corta conexiones a ~60s, y las generaciones LLM tardan ~60-120s → daban 502 aunque el backend terminara. Solución: `POST /api/thesis/generate` y `POST /api/thesis/{id}/contra` devuelven `{job_id}` al instante y crean un job en `thesis_jobs` (status pending→done/error); el pipeline corre en un hilo (`asyncio.to_thread` + `asyncio.run`) para no bloquear el event loop (las llamadas de emergentintegrations son síncronas). Frontend hace **polling** a `GET /api/thesis/job/{id}` cada 3s (encapsulado en `api.js`, sin cambiar los componentes). Verificado end-to-end en UI (Palantir + contra) sin 502.
  - **F2 — Probabilidad + contratesis:** círculo de probabilidad 0-10 (0 rojo → 10 verde, certeza) calculado por la IA según evidencia de fuentes, con **justificación al hover**. Va arriba junto al título. **Contratesis bajo demanda** (botón opcional "añadir contratesis" para ahorrar créditos): aviso en rojo, menos presencia visual, entre título y cadena de valor; tiene su PROPIO círculo de probabilidad, su cadena de valor y empresas más perjudicadas (antítesis). En búsqueda de empresa: arriba la tesis/contratesis ganadora (mayor probabilidad) y debajo la contraria.
  - **F3 — TAM + 2 columnas:** TAM global de la tendencia proyectado a **2027 (TTM), en miles de millones de USD** + un **TAM por cada capa** de la cadena de valor. Empresas en **2 columnas: líderes (izq.) y disruptores/líderes del cambio (der.)**, con **≥1 de cada categoría por capa** de la cadena de valor.
  - **F4 — Tesis automática:** botón en la página principal que escanea fuentes vía **búsqueda web en vivo gratis** (noticias/analistas/foros/papers; sin claves de X/Reddit/ArXiv por ahora) para detectar tendencias emergentes y generar tesis sin partir de un input.
  - **F5 — Vinculación cruzada empresa↔tesis:** al buscar una empresa, si encaja fuerte en tendencias que YA tienen tesis generada, preguntar si añadir la empresa a esas tesis; si encaja en tendencias SIN tesis, preguntar si elaborar tesis de esa tendencia.
  - Notas técnicas: cambios de esquema en `theses`/`qual_snapshots` (probabilidad, contratesis, TAM, categoría líder/disruptor, capa). Las generaciones tardan ~40-90s (tesis) y casi el doble con contratesis. Mantener estética FT salmón.
- **✅ COMPLETADO (Feb 2026)** — **Thesis Engine MVP (módulo cualitativo con IA)**:
  - Arquitectura IA dual vía Emergent LLM Key: GPT-5.2 (Investigador) + Claude Sonnet 4.5 (Sintetizador).
  - **Búsqueda web en vivo**: el proxy de Emergent NO soporta web-search nativa de OpenAI (`web_search_options`/`web_search_preview` rechazados; solo tools `function`/`custom`). Solución: el backend hace la búsqueda en tiempo real con **DuckDuckGo (`ddgs`)** y pasa los resultados frescos a GPT-5.2, que estructura cadena de valor + empresas con TICKER canónico citando fuentes; Claude asigna scores cualitativos.
  - **Flujo A** (Tendencia → cadena de valor → empresas líderes + 4 sub-scores [posición competitiva, momentum sector, calidad management, resiliencia financiera] + score global + tesis + riesgos).
  - **Flujo B inverso** (Empresa → tendencias donde encaja + rol en cadena + score de relevancia + relevancia temática global).
  - **Datos**: cada empresa indexada por TICKER en `qual_snapshots` para enlazar con `/company/{ticker}`. Guardado en carpetas (`thesis_folders`, `theses`).
  - Backend nuevo: `services/thesis.py`, `routes/thesis.py`. Endpoints `/api/thesis/{generate,list,folders,folders/{id},{id},{id}/folder,company/{ticker}}`. Generación funciona anónima (efímera); guardar/listar requiere login Google.
  - Frontend nuevo: `pages/Thesis.jsx`, `pages/ThesisDetail.jsx`, `components/thesis/{ThesisResult,ScoreBar,CompanyQualCard}.jsx`. Nav "Tesis". Estética FT salmón. Timeout API 180s (generación ~40-90s).
  - **Puente cuanti↔cuali (Feb 2026)**: `CompanyQualCard` en `Company.jsx` (tras la cabecera) muestra la tesis cualitativa guardada del ticker (scores + tendencia + tesis + riesgos + enlace a la tesis completa) o un CTA "Generar tesis" → `/thesis?company=TICKER` (la página Tesis lee el query param y precarga modo empresa). Anónimo ve un prompt de login.
  - Screener nocturno verificado tras los cambios: `/api/admin/run-screener` corre sin errores (users_scanned ok, 0 cruces = esperado). Email real pendiente de verificación del usuario con una alerta activa.
  - Tested: ambos flujos vía curl (NVDA/MSFT/AVGO, ASML); CRUD con login vía Bearer seed; render UI vía screenshot (Tesis + CompanyQualCard); 7 tests pytest de helpers puros. NO probado por testing_agent (para no consumir créditos de generación LLM).
- **✅ COMPLETADO (Feb 2026)** — **Phase B completa**: Google Auth opcional (Emergent-managed), watchlist sync entre dispositivos, multimoneda (166 monedas vía open.er-api.com), screener nocturno con Resend + APScheduler cron 06:00 UTC, traducción de resumen empresa al español con cache permanente.
  - Backend nuevo: `auth.py`, `fx.py`, `screener.py`. Endpoints: `/api/auth/{session,me,logout,watchlist,notify}`, `/api/fx/rates`, `/api/admin/run-screener`, `/api/company/{ticker}/translate-summary` (truncado a 1400 chars).
  - Frontend nuevo: `AuthProvider`, `AuthCallback`, `AuthButton`, `WatchlistCloudSync`, `FxProvider`, `CurrencySelector`, banner login + card de notificaciones en Watchlist.
- **✅ COMPLETADO (Feb 2026)** — **Métricas de crecimiento + breakeven + health indicators**:
  - Backend: `data.growth_metrics` con `revenue_growth_yoy`, `revenue_cagr_3y_hist`, `fcf_margin_ttm`, `rule_of_40`, `breakeven_year_op`, `breakeven_year_fcf` (regresión lineal sobre los últimos 4 años del histórico de operating income / FCF, con horizonte máximo 15 años). También expone `operating_income_history`.
  - Frontend: nueva sección "Crecimiento y rentabilidad futura" debajo de los ratios clásicos (más justa para growth/empresas pre-rentables): Crec. Ingresos YoY, CAGR 3y histórico, Margen FCF (TTM), Rule of 40 (clásico de SaaS), y dos filas de breakeven estimado (operativo y FCF) con etiquetas humanas: "Ya rentable (YYYY)" verde, "YYYY" + "≈ N años si la tendencia se mantiene" ámbar/rojo, "No converge" rojo con subtítulo explicando.
  - Mini punto de salud verde/ámbar/rojo a la izquierda del valor en todas las filas (clásicas + crecimiento + márgenes). Lógica `ratioHealth(key, v)` con rangos por ratio (P/E < 15 verde, ROE < 8% rojo, etc.), normaliza debt_to_equity (yfinance lo devuelve en formato escalado). Hover sobre el punto muestra etiqueta corta ("Barato", "Pérdidas", "Saludable", "Excepcional"...).
- **✅ COMPLETADO (Feb 2026)** — **Auto-corregir + tooltips didácticos en ratios clásicos**:
  - Botón "Aplicar N correcciones" en el panel de anomalías POC/POV. Heurísticas: clip de márgenes a 0% si < 0, clip de CAGRs a −30% si < −100%, ajuste de net_debt para llevar x_raw a −50% si está colapsado. Cada corrección muestra preview "valor antiguo → valor nuevo" con razón. Aplicar deja las correcciones marcadas como `session edits` (ámbar) para que el usuario revise antes de guardar.
  - Tooltip rico (HoverTip) en los 17 ratios clásicos (P/E, PEG, P/B, P/S, EV/EBITDA, EV/Revenue, ROE, ROA, Profit margin, Debt/Equity, Current ratio, Dividend yield, Beta, Analyst target, Gross margin, Operating margin). Explica qué mide y los rangos "barato/normal/caro" como referencia educativa.
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
- **✅ COMPLETADO (Feb 2026)** — **Refactor modular ligero (backend)**:
  - Extraída toda la lógica de valuación pura de `server.py` a un módulo nuevo `backend/services/valuation.py` (helpers financieros + `fetch_fundamentals_sync` + `compute_custom_ratios`). `server.py` pasó de **1234 → 460 líneas**; `valuation.py` = 800 líneas.
  - `server.py` ahora solo contiene: setup FastAPI/Mongo, modelos, rutas API y scheduler. Importa `fetch_fundamentals_sync, compute_custom_ratios, _safe_float, _cagr` desde `services.valuation`.
  - Comportamiento byte-idéntico verificado (AAPL/MSFT/compare/calculate/ratio-history/run-screener) + 22/22 tests pasan. Test `test_calculate_math` actualizado: la expectativa estaba desactualizada (POC 297 sin capar) → ahora 198, documentando el cap de `x_factor` a 10.
  - Motivo: preparar terreno modular antes de integrar el módulo cualitativo ("Thesis Engine") y reducir el coste por tarea futura.
- **✅ COMPLETADO (Feb 2026)** — **Ordenamiento de columnas en Watchlist y Cartera**:
  - Nuevo componente reutilizable `components/SortableTh.jsx` (encabezado clicable con flecha asc/desc + helpers `makeSorter` y `nextSort`).
  - **Watchlist**: ordena por Ticker, Empresa (alfabético), Precio, MCap, Ratio Compra, Ratio Venta (numérico). Strings → asc por defecto; números → desc por defecto. Nulos/errores siempre al fondo.
  - **Cartera**: ordena por Ticker, Acciones, Precio compra, Invertido, Precio, MCap, Valor actual, P/L, P/L %, Ratio Compra, Ratio Venta. Valores numéricos convertidos a la moneda de visualización antes de comparar para orden correcto cross-divisa.
  - Ordenamiento 100% client-side sobre las filas ya cargadas (no re-fetch). Las columnas de señal/modo/alerta no son ordenables (derivadas).
- **P1** — Histórico de ratios (gráfico de evolución temporal de Ratio Compra/Venta).- **P1** — Umbrales de señal configurables por el usuario (sliders cheap/expensive).
- **P1** — Aviso visual cuando una proyección automática viene de un CAGR extremo (capado), para que el usuario sepa que debe revisar manualmente.
- **P2** — Exportar análisis a PDF / Excel.
- **P2** — Modo "Sensibilidad": cómo cambia POC al variar márgenes/crecimientos ±10%.
- **P2** — Login (Emergent Google Auth) para sincronizar watchlist entre dispositivos.
- **P2** — Alertas por email cuando Ratio Compra cruza un umbral (SendGrid/Resend).
- **P2** — Screener nocturno sobre watchlist: notifica solo cuando una empresa cruza de rojo a verde.
- **P3** — Soporte multimoneda con conversión FX para comparar empresas globales.
- **P3** — Modo oscuro alternativo.


---

## CHANGELOG — Rediseño flujo de tendencias (4 jun 2026)

### Fix previo
- **Bug split (Empresa→Tesis)**: al desarrollar un split, el matcher reclasificaba el core a `to_add` y el filtro `newTrends` lo eliminaba → desaparecía la nota + el split pendiente. FIX: un core con `split_dev` se muestra SIEMPRE como tarjeta (estado nota) y se excluye del bloque 1.1b. (ThesisResult.jsx)

### Rediseño "Tendencias" (secundario) — confirmado por el usuario
- **Empresa → Tesis = flujo principal y por defecto** (izquierda, botón negro). Al desarrollar una tesis propuesta (driver/split) se ejecuta DIRECTAMENTE in-place (force:true, sin rellenar el buscador) vía `onDevelop` → `DevelopAction`.
- **Tendencias → Empresas** (renombrado, antes "Tesis→Empresas"): ahora INFORMATIVO. `POST /api/thesis/explore` → `run_trend_explore` (1 sola llamada LLM, estructural, SIN scores): cadena de valor + ≥1 líder y ≥1 disruptor por eslabón, cada empresa con papel/protagonismo y botón "Generar tesis de {TICKER}". Componente `TendenciaResult.jsx`. Guardar (`/api/thesis/tendencia/save`, type="tendencia") / Descartar (cliente).
- **Tendencia automática** (antes "Tesis automática"): `POST /api/thesis/auto-trend` {exclude} → `run_auto_trend` descubre UNA tendencia emergente por momentum evitando las ya mostradas/guardadas, y la explora en formato informativo (badge automática + heat). Guardar/Descartar.
- **Sidebar** (`ThesisSidebar.jsx`): 3 secciones → **Tendencias / Tesis / Empresas**. ELIMINADO el desplegable de jerarquía/madre TAM. Dashboard añade `tendencias`.
- **Megatendencias → Megatesis** en toda la UI (sidebar, treemap, barra de gestión, modal).
- **Barra de guardado**: resultado type=company → SOLO "Ver en detalle" (más visible, sin selector). type=trend (tesis desarrollada) → selector de Megatesis + ver detalle.
- Eliminado el banner de sugerencia de madre (jerarquía TAM) en ThesisResult y la llamada a `_suggest_parent` en el backend.
- `ThesisDetail.jsx` ahora renderiza `TendenciaResult` para type="tendencia".
- Fix UX: `TickerAutocomplete` cierra el dropdown en blur (evita interceptar el clic en "Generar").
- **Testing**: backend por curl (explore/auto-trend/save/dashboard OK) + testing_agent frontend 85% (layout, sidebar 3 secciones sin TAM, explore informativo sin scores, auto-trend+guardar, descartar, regresión splits OK) + verificación E2E Empresa→Tesis (ASML): barra solo "Ver en detalle". iteration_17.json.

### Pendiente (próximos pasos)
- **P1** — Verificar entrega real de emails (Screener nocturno + Radar semanal) con sesión Google válida (Resend).
- **P2** — Fusión cuantitativa + cualitativa (master screener: tesis fuerte + buen ratio de valoración).
- **P3** — PWA/móvil · Suscripción Stripe (4,99€/9,99€) · Refactor de Company.jsx (~1600 líneas) y Thesis.jsx (~640 líneas).

## CHANGELOG — Selector de modelos coste/calidad (5 jun 2026, DEV-only)
- 3 presets conmutables en runtime (services/thesis.py MODEL_PRESETS, leidos por _inv_model()/_syn_model()):
  - minimo_coste: gemini-2.5-flash-lite (inv+syn)
  - equilibrado: gemini-3-flash-preview (inv) + claude-haiku-4-5 (syn)
  - pro: gpt-5.2 (inv) + claude-sonnet-4-5 (syn) [config actual]
- Estimacion de coste en EUR por tokens (PRICE_EUR_PER_MTOK, editable) acumulada via ContextVar _cost_acc + run_costed(); contadores por preset en app_settings doc id=thesis_usage.
- Endpoints: GET /api/thesis/models (presets+active+contadores), PUT /api/thesis/models {preset} (auth). Preset persistido en app_settings id=thesis_models, carga perezosa _ensure_preset_loaded().
- UI: components/thesis/ModelPicker.jsx (data-testid model-picker, model-preset-{key}, model-counter-{key}); tooltip HoverTip con modelos; contadores tesis + EUR. Montado encima del generador en Thesis.jsx, refresco via genCount.
- GATING: solo visible si REACT_APP_ENABLE_MODEL_PANEL=true (añadido a frontend/.env para PREVIEW). Para PRODUCCION: poner a false / quitar la var en el deployment.
- Manejo de errores LLM: _friendly_err() traduce budget-exceeded / rate-limit / timeout a mensajes claros en ES en todos los flujos.

## CHANGELOG — Competidor vs Disruptor (6 jun 2026)
- Columna derecha de cadena de valor renombrada "Competidores / disruptores". Tercera categoria de empresa: leader|competitor|disruptor.
- Backend services/thesis.py: INVESTIGATOR_TREND_SYS define los 3 criterios para reservar "disruptor" (cambio de paradigma vs lider / apuesta arriesgada que amenaza al lider / enfoque radicalmente distinto con evidencia de superioridad; ej. Tesla, Iovance-TIL, Moderna). Por defecto no-lider = "competitor". Esquemas JSON y normalizacion (trend, explore, eval) aceptan competitor; invalido->competitor.
- Frontend ThesisResult.jsx + TendenciaResult.jsx: helper catBadge() (Lider azul / Competidor gris / Disruptor rojo); agrupacion izquierda=leader, derecha=no-leader (competitor+disruptor); cabeceras y textos vacios actualizados.
- Opcion (a): tesis EXISTENTES conservan su category actual (sus no-lideres siguen como "disruptor" hasta regenerar). El matiz competidor/disruptor aplica a generaciones nuevas.
- Nota toolchain: la regla eslint react-hooks/set-state-in-effect NO existe en CRA/react-scripts; NO usar comentarios disable de esa regla (rompen la compilacion). Los efectos de fetch en ThesisResult.jsx se refactorizaron a IIFE async para evitar setState sincrono en el cuerpo del efecto.

## CHANGELOG — Refresco unificado + TAM congelado + cascada (8 jun 2026)
Objetivo del usuario: simplificar código, evitar bugs, llevar al refresco sin llamadas LLM recurrentes y mantener coherencia de TAM dentro de fichas y entre fichas↔tesis.

### TAM Score CONGELADO (fin de los saltos 53→56)
- `thesis_refresh.recompute_and_store_tam(db, uid, thesis_ids=None)`: calcula y PERSISTE `companies[].tam_score` y `companies[].projected_revenue_busd` (USD B) en cada tesis de tendencia. Matemática pura sobre la caché `db.fundamentals` (sin LLM, sin yfinance).
- Lecturas leen el valor almacenado (fallback a cálculo desde caché si falta): dashboard, `company/{ticker}/profile`, y `GET /thesis/{id}` (backfill en lectura para tesis antiguas).
- `ThesisResult.jsx` ya NO llama a `/thesis/tam-scores` en vivo: lee `c.tam_score` del doc → estable y coherente con la ficha de empresa. (endpoint tam-scores se mantiene pero sin uso en frontend).
- Se recalcula+persiste tras: generar tendencia, add-company, merge/unmerge/merge-thesis/unmerge-thesis, y refresco.

### Refresco unificado (manual + semanal), SIN noticias/email/LLM
- `thesis_refresh.refresh_user_data(db, uid, tickers)`: re-fetch fundamentales de los tickers + recompute_and_store_tam(all) + stamp `users.thesis_refresh.last_refresh_at`. Lógica compartida por manual y semanal.
- `run_thesis_refresh` reescrito: por usuario suscrito, corre solo si han pasado ≥7 días desde `last_refresh_at` (manual o semanal). Eliminada toda la vigilancia de noticias, "profundizar" (LLM) y email de noticias.
- Nuevo `POST /api/thesis/refresh/run` body `{thesis_id?, ticker?}` (auth): scope tesis (todas sus empresas), empresa (esa empresa en todas sus tesis) o todo. Devuelve la tesis refrescada si es trend.
- `GET /api/thesis/refresh/status` devuelve también `last_refresh_at`.
- Frontend: `RefreshButton.jsx` compartido (icono + tooltip `REFRESH_LEGEND`). Botón en ThesisDetail (`thesis-detail-refresh`), botón "Refrescar datos" del dashboard (`refresh-data-btn`→`thesisRefreshRun()`), y la ficha de empresa (`doRefresh` también llama `thesisRefreshRun({ticker})` + bump `qualRefreshKey`). Leyenda semanal del sidebar reescrita (sin noticias).

### Borrado/Reescritura = partir de 0 (cascada, opción a)
- `DELETE /api/thesis/{id}`: si type=="company", borra también las tesis de tendencia desarrolladas a partir de ella (`split_dev[].developed_id`), enteras. Devuelve `deleted_ids`.
- Reescritura de empresa en `_run_generate_job` (overwrite): borra las developed previas, limpia `split_dev` y `link_matches`.
- Propagación a otras empresas (p.ej. MSFT/AMD): su línea de TAM desaparece (perfil lee pertenencia viva → baja la Suma TAM) y el tema vuelve a "pendiente de generar".
- Frontend: modal de confirmación `delete-company-modal` (sin deshacer, opción 2a) en Thesis.jsx; aviso de reescritura ampliado ("…y borrará las tesis generadas previamente a partir de esta empresa").

### Tests
- `tests/test_tam_freeze.py` (2 tests, congelado + revenue ausente). Suite: 61 passed (excluye `test_portfolio_alerts.py` que requiere servidor live).
- Verificado e2e por curl: refresh/run (all + ticker), profile con TAM congelado, cascada de borrado, job semanal admin.

## CHANGELOG — Cola serial de generación (8 jun 2026)
Objetivo: nunca dos generaciones de tesis en paralelo (coherencia de TAM + control de gasto LLM).

### Backend (routes/thesis.py + server.py)
- `GenerateRequest.queue: bool` nuevo. `POST /thesis/generate` ahora serializa POR USUARIO:
  - Si hay una generación `processing`/`queued` y `queue=false` → devuelve `{status:"busy", active:{subject,kind}}` (NO crea job).
  - Si `queue=true` → crea job `status:"queued"` con `params` y devuelve `{job_id, status:"queued", position}`.
  - Si libre → `status:"processing"` y arranca. (Anónimos: sin cola, arrancan directo.)
- `_run_generate_job` añade `finally` → `_start_next_queued(user_id)`: al terminar (y guardarse), arranca el `queued` más antiguo (FIFO, ilimitado). Estados: `processing`/`queued`/`done`/`error`.
- `server.py` startup: limpia jobs `generate` huérfanos (`processing`/`queued` → `error`) para no bloquear la cola tras un reinicio.

### Frontend (api.js + Thesis.jsx)
- `startAndPoll` detecta `status:"busy"` → lanza error con `e.busy`. `pollThesisJob` acepta `onStatus` y NO expira mientras `queued` (resetea la ventana).
- `Thesis.jsx`: al recibir busy muestra modal `queue-modal` ("Ya hay una generación en curso… ¿dejar en cola?"). `confirmQueue` re-lanza con `queue:true`. Indicador "En cola…" en botón y mensaje. Cancela si no encola.
- Develop desde ThesisDetail navega a /thesis (misma lógica). Contra-tesis es otro `kind`, no se serializa.

### Tests
- `tests/test_gen_queue.py` (FIFO). Suite: 62 passed. Validado por API (curl): busy + queued (sin gastar LLM; jobs de prueba limpiados).

## PENDIENTE DE DECISIÓN DEL USUARIO (no construir hasta su OK)
- **Fusión determinista (P1):** el desplegable de fusión ofrece un mismo tema en dos grupos ("suma TAM" = propuesta hermana vs "no suma" = tesis guardada que ya lo cubre). Si un nombre cae en AMBOS grupos, hoy gana "suma" (`isCovered=false` en ThesisResult.jsx ~L535) aunque se elija "no suma" → la etiqueta contradice la acción. Raíz: exclusividad mutua garantizada SOLO dentro de una generación, no en la costura nueva↔guardada. Fix propuesto (a decidir): deduplicar para que un tema esté en un solo grupo, o auto-decidir sumar/cubierta con `detect_parent_thesis`. El usuario dijo que responderá qué hacer.

## CHANGELOG — Opción A: Partición autoridad + planificación/bloqueo (8 jun 2026)
Objetivo: TAM mutuamente excluyentes y conservados en CUALQUIER estado (sin generar / generadas / mixto); fusión suma, partición reparte; coherencia de tam_score en todas las páginas.

### Motor de conservación (backend)
- Tesis desarrollada lleva `origin_ticker` + `allocated_tam_busd` (el trozo heredado de la partición de la empresa). Se calcula al desarrollar en `_run_generate_job` (driver entero → `driver.tam_busd`; split → `split.tam_busd` NORMALIZADO para que los splits sumen al driver; el driver manda).
- `recompute_and_store_tam` (thesis_refresh.py): para la empresa de ORIGEN usa `allocated_tam_busd`; el resto de empresas usan el TAM del eslabón. Score-TAM congelado y coherente.
- `backfill_allocated_tam.py`: ancla tesis ya guardadas desde `split_dev` (idempotente). Ejecutado.

### Fase de planificación + bloqueo
- `get_thesis` devuelve `planning_locked` para fichas de empresa: locked si hay `split_dev` o un job de generación en vuelo (`params.from_company`). Reabre al borrar todas las tesis / reescribir desde 0.
- Frontend (ThesisResult): aviso `planning-notice` encima de los drivers; al bloquearse, `planning-locked-notice`. Bloqueado → se ocultan fusión y "generar todas las particiones" (solo queda "Generar conjunto").

### Fusión/partición solo en planificación
- Fusión restringida a drivers hermanos (siempre SUMA); eliminado el grupo "ya cubierta (no suma)" y con él el bug de etiqueta/acción.
- "Partir" = dos opciones: "Generar tesis (conjunto)" o "Generar todas las particiones" (lote: 1ª arranca, resto en cola vía `thesisGenerateRaw` + `queue:true`). Implementado en Thesis.jsx (`developAllPartitions`) y ThesisDetail.jsx (toast.promise + navigate).
- Quitada la fusión POST-generación (Fase B) de CompanyQualCard (`canMerge=false`); se mantiene revertir merges existentes.

### Tests
- `tests/test_tam_freeze.py`: +test origin usa trozo (0.64) vs otra empresa usa eslabón (3.2). Suite: 63 passed.
- Verificado en UI (sin gastar LLM, caché de matcher precargada): aviso de planificación, splits con leyenda del TAM del conjunto, botones conjunto/particiones/fusionar.

### Decisiones del usuario (cerradas)
1a lock al lanzar 1ª gen, reabre al borrar/reescribir · 2a fusión solo hermanos (quitar cubierta) · 3a particiones encolan todas · 4a quitar Fase B · 5a el driver manda (normalizar splits).

## CHANGELOG — Planificar → Ejecutar (Plan → Execute) (9 jun 2026)
Objetivo del usuario: separar la FASE DE PLANIFICACIÓN (marcar/fusionar/partir drivers para dejar el TAM 100% mutuamente excluyente) de la FASE DE EJECUCIÓN (generar todas las tesis planificadas de golpe, en cola serial), sin re-evaluaciones LLM que cambien TAM o la lista de propuestas al recargar.

### Backend (ya existía, verificado por curl)
- `POST /api/thesis/{id}/plan` {core, plan:"whole"|"split"} → marca el driver en `trends[].plan` (sin LLM, sin generar). 409 si la planificación está cerrada; 400 si se intenta `split` en un driver sin `splits`. Devuelve el doc actualizado.
- `POST /api/thesis/{id}/generate-plan` → encola UNA generación por cada driver no fusionado (whole → 1 tesis; split → todas sus particiones), todas en serie vía `_enqueue_generation`, ancladas a su trozo de TAM congelado. Bloquea la planificación. Devuelve {ok, count, first_job_id}.

### Frontend (NUEVO en esta sesión)
- `api.js`: `thesisSetPlan(id, core, plan)` + `thesisGeneratePlan(id)`.
- `ThesisResult.jsx`: las tarjetas de driver (`NewThesisCard`) ya NO generan al instante. En planificación muestran marcadores **Conjunto** / **Particiones (N)** (`plan-whole-*` / `plan-split-*` → `/plan`), con texto del efecto. Se eliminó el botón "Generar todas las particiones" y el "Generar tesis (conjunto)" por tarjeta. Barra **"Generar plan · N tesis"** (`generate-plan-bar` / `generate-plan-btn`) bien visible TRAS los drivers; N = suma reactiva (split→nº particiones, resto→1). Sin opción "Excluir" (constraint usuario 1b: si no quieres un driver, lo fusionas → su TAM se suma al destino, conservación 100%).
- Durante la planificación, `newTrends` muestra TODOS los drivers no fusionados (independiente del matcher LLM `link-suggestions`) → lista estable al recargar, partición completa. El matcher solo se sigue usando para el bloque "Tesis ya generadas que encajan" (anti-duplicación).
- Al bloquear (tras Generar plan), las tarjetas no desarrolladas muestran "En cola para generarse…" y desaparecen fusión/marcadores.
- Handlers `generatePlan` en `Thesis.jsx` y `ThesisDetail.jsx` (poll del 1er job + recarga del doc para reflejar locked/pending).

### Pruebas (self-test, SIN testing_agent ni gasto LLM)
- curl `/plan`: marca whole/split, rechaza split en no-divisible (400), GET devuelve `planning_locked:false` + `trends[].plan`.
- screenshot (usuario sembrado `co_plan_ui`, NVDA con driver divisible): marcadores resaltados, barra "Generar plan · 4 tesis"; al cambiar Particiones→Conjunto el contador baja a 3 en vivo.
- NO se ejecutó `/generate-plan` en vivo (evitar coste LLM); reusa `_enqueue_generation` ya cubierto por `test_gen_queue.py`.
- Seed nuevo: `backend/tests/seed_plan_test.py` → `co_plan_ui`.

## CHANGELOG — Vista trimestral TTM en gráficos de Company (11 jun 2026)
Petición del usuario: en los gráficos Ingresos, FCF e Histórico POC/POV, tocar el título alterna una vista con eje X trimestral TTM. Ingresos/FCF: hacia delante con proyecciones (interpolación geométrica trimestral hasta fin de 2027) y hacia atrás rellenando el eje (opción 2a: híbrido — trimestres reales + interpolación desde anuales marcada como "Aprox."). POC/POV: el usuario pidió después "cuantos más puntos mejor" → serie completa (real + aprox) con precios de cierre trimestrales reales; el último punto (2026Q1) es real.

### Backend (`server.py`)
- `GET /api/company/{ticker}/quarterly-history` (caché 12h en colección `quarterly_history`):
  - `revenue_ttm` / `fcf_ttm`: TTM real (suma móvil de 4 trimestres consecutivos de `quarterly_financials`/`quarterly_cashflow`, ~2-3 puntos) + backfill `kind:"approx"` interpolado (geométrico) desde `revenue_history`/`fcf_history` anuales. Merge por etiqueta de trimestre (real gana).
  - `ratio_ttm`: POC/POV por trimestre sobre la serie TTM completa (real+aprox) con precio de cierre trimestral real (`history(period="max", interval="1mo")`), mcap = precio × acciones actuales, CAGR proxy desde el primer año anual (`_cagr_to_point`). Campo `kind` real/approx.
  - Helpers módulo: `_q_label`, `_rolling_ttm`, `_approx_quarterly_from_annual`, `_merge_ttm`, `_cagr_to_point`. Import añadido: `_series_to_pairs`, `_get_row`.
- `.env`: `CORS_ORIGINS` ahora lista explícita (localhost:3000 + ambos hosts preview) en vez de `*` (necesario para tests headless; el proxy de plataforma añade sus propios headers).

### Frontend (`Company.jsx`)
- Estado `qHist`/`qHistLoading` + `requestQuarterly` (fetch perezoso al primer toggle; se resetea al cambiar de ticker).
- `buildQuarterlyChart`: mapea serie TTM (real/approx) y construye proyección trimestral hacia delante (geométrica) desde el último TTM → proj 1y → proj 2y anclada a fin de año fiscal +1/+2; respeta ediciones manuales de revenue_2y/fcf_2y (`interpolate`).
- `ChartBlock` y `RatioHistoryChart`: título clicable (HoverTip explicativo + badge `ANUAL`/`TTM TRIM.`, data-testids `revenue-chart-title-toggle`, `fcf-chart-title-toggle`, `ratio-history-title-toggle`). Línea/serie "Aprox." en trazo punteado tenue; barras FCF aprox con opacidad 0.3; en POC/POV punto pequeño tenue = aprox, grande = real, con nota en tooltip ("TTM aproximado…"). Fix preexistente: eje Y de POC/POV usaba fmtCompact (mostraba "280 B" para precios) → fmtNum.

### Pruebas (self-test, sin testing_agent, sin gasto LLM)
- curl AAPL: 15 puntos rev/fcf TTM (2022Q3→2026Q1, 2 reales), ratio_ttm 15 puntos (último 2026Q1 real).
- Screenshots (preview stock-fundamentals-13, same-origin): los 3 gráficos alternan ANUAL↔TTM en cada click, proyección hasta 2027Q3E, vuelta a anual sin regresión.
- NOTA: el navegador headless contra `ai-valuation-desk.preview...` sirve la página estática "wake servers"; usar `https://valuation-studio.preview.emergentagent.com` (el de frontend/.env) para screenshots.

## CHANGELOG — Filtro `source_company_thesis_id` en vista de plan (Feb 2026)
Fix UX pedido por el usuario: en la vista de un plan de empresa (`/thesis/{co_id}`), el recuadro de "tesis cualitativa" mostraba tesis de tendencia donde la empresa aparece **automáticamente añadida por el LLM** en planes de OTRAS empresas — tesis "fantasma" sin contexto, confusas para el usuario.

### Decisión (opción C, cerrada con el usuario)
Rastrear de qué plan nace cada tesis de tendencia desarrollada → mostrar SOLO esas en la vista del plan; las membresías auto-añadidas siguen visibles en `/company/{TICKER}` (vista cuantitativa).

### Backend
- Nuevo campo `source_company_thesis_id` en `theses` (type=trend). Se persiste en `_run_generate_job` cuando `from_company` está presente (línea ~561, `routes/thesis.py`). El campo apunta al id de la tesis de empresa origen del plan que la generó.
- `GET /api/thesis/company/{ticker}/profile` acepta query opcional `from_company`: si se pasa, devuelve SOLO trend theses con `source_company_thesis_id == from_company`. Sin el param, comportamiento idéntico al anterior (todas las membresías) — la vista `/company/{TICKER}` y el resto de la UI no cambian.
- Backfill retroactivo: `backend/backfill_source_company_thesis.py` (idempotente). Recorre todas las `type=company` y para cada `split_dev[].developed_id` setea `source_company_thesis_id = <company_id>`. Ejecutado en este job: 25 tesis etiquetadas.

### Frontend
- `lib/api.js`: `thesisCompanyProfile(ticker, fromCompany=null)` → pasa `?from_company=` al backend.
- `CompanyQualCard.jsx`: nueva prop `fromCompanyId`. Cuando se pasa, (1) la API se llama con filtro, (2) el título cambia a "Tesis generadas desde este plan", (3) se oculta el link "Buscar más tesis" (no aplica en el contexto del plan).
- `ThesisResult.jsx`: en la vista de empresa (`!isTrend`), se monta `<CompanyQualCard ticker={...} hideEmpty fromCompanyId={thesis.id} />` ENCIMA de "Drivers de crecimiento · nuevas tesis". Solo renderiza si hay filas (hideEmpty), por lo que en planes nuevos sin tesis desarrolladas no aparece nada.

### Pruebas (self-test, sin testing_agent)
- curl con seed manipulado (ALNY con 1 tesis legítima `co_locked_ui` + 1 fantasma desde `co_other_unrelated`): sin filtro devuelve 2 rows; con `?from_company=co_locked_ui` devuelve 1 row (solo la legítima). ✅
- Backend pytest: 63/63 pasan. Lint OK (Python + JS).
- Backfill verificado: ALNY (caso real del usuario) tenía 4 trend theses, ahora con `source_company_thesis_id` solo se filtran a las 3 generadas desde su plan; la 4ª ("Alzheimer", generada desde otro plan) queda excluida correctamente.

## CHANGELOG — Coherencia total: dashboard ↔ plan ↔ ficha de empresa (Feb 2026)
Petición del usuario tras detectar discrepancia 5,16 (treemap) vs 1,77 (plan) en Eli Lilly:

> "el tam score suma debe ser solo la suma de los tam scores de las tesis que han nacido del plan de esa empresa, eso es lo que debe mandar también en el maptree, en company/{ticker}, donde aparezca en otras tesis desde otras empresas o desde tendencias estará ahí pero informativo. Siempre que apriete refrescar la aplicación debería refrescar datos y comprobar coherencia entre páginas."

### Cambios backend (`routes/thesis.py`)
- **`GET /thesis/company/{ticker}/profile`**: ahora devuelve DOS conjuntos:
  - `trend_rows`: tesis de tendencia NACIDAS del plan de la empresa (autoresuelve `plan_id` = tesis de empresa más reciente del ticker; aceptable override con `?from_company=`).
  - `other_rows`: tesis donde el ticker aparece pero NO nacieron de este plan (auto-añadidas por LLM desde otros planes / generadas como tesis-de-tendencia independiente). Solo informativo.
  - `avg_overall_score` y `sum_tam_score` se calculan **solo sobre `trend_rows`** (suma del plan). Devuelve también `plan_id`.

- **`GET /thesis/dashboard`**: la agregación por empresa (`comp_agg`) ahora gatea cada contribución de `tam_score` / `overall_score` por `trend.source_company_thesis_id == ticker_to_plan_id[tk]`. Construye el mapa `ticker → plan_id` (latest complete company thesis por ticker). Surface también las empresas completas que aún no tienen ningún developed (avg/sum = None) para no perder filas en el treemap. Pulla el `name` del propio doc de company como fallback.

### Cambios frontend
- **`CompanyQualCard.jsx`**: nueva sección "También aparece en (informativo · no suma)" debajo de los agregados, listando `other_rows` con estilo atenuado (opacity-70) y nota explicativa. Solo se renderiza si `fromCompanyId` es null (en `/company/{ticker}`) — en la vista de plan se oculta para no introducir confusión.
- **`ThesisDetail.jsx` (botón refrescar)**: `refresh()` ahora llama a `thesisRefreshRun({})` (scope completo) en vez de `{thesis_id: id}`. El backend re-fetchea fundamentals de TODOS los tickers del usuario y dispara `recompute_and_store_tam(uid, None)` que repuntea los `tam_score` en todas las tesis. Resultado: pulsar refrescar garantiza coherencia entre las tres vistas (dashboard, plan, ficha de empresa).

### Verificación (curl + Eli Lilly real)
Caso real LLY antes del fix: 9 trend memberships, 5 nacidas del plan + 4 fantasma (Madrigal/Crinetics/Apellis).
- Plan suma: 0.32+0.19+0.62+0.37+0.27 = **1.77** (correcto)
- Fantasmas suma: 0.92+2.25+0.11+0.11 = 3.39
- Total legacy (mal): 5.16 ← lo que mostraba el treemap

Tras el fix:
- `/thesis/{plan_lly}` → 1.77 ✅
- Dashboard `/thesis` (treemap Empresas TAM) → 1.77 ✅
- `/company/LLY` profile auto → 1.77 (plan) + 4 filas informativas con sus scores ✅

Tests pytest: 63/63 ✅. Lint Python+JS ✅. Backfill anterior (25 tesis con `source_company_thesis_id`) sigue siendo el ancla del nuevo filtro.

## CHANGELOG — Limpieza, validación ticker y fuzzy 80% (Feb 2026)
Tras conversación sobre tiers y refresco cualitativo, el usuario pidió simplificar el flujo:

### Punto 3 · Borrar trío muerto (link-suggestions / add-company / evaluate-company)
Era código backend completo (3 rutas + 2 job runners + 2 modelos de request + 1 servicio LLM `evaluate_company_for_trend`) orbitando alrededor del componente `CompanyThesisLinker.jsx`, que nunca se montaba en ninguna página. Borrado:
- Backend: rutas `POST /thesis/{id}/{link-suggestions, add-company, evaluate-company}`, helpers `_eval_company_sync`, `_run_addcompany_job`, `_run_eval_company_job`, modelos `AddCompanyRequest` / `EvaluateCompanyRequest`, import de `evaluate_company_for_trend`.
- Servicio `services/thesis.py`: borrada función `evaluate_company_for_trend` y prompt `EVALUATOR_SYS`.
- Frontend: `CompanyThesisLinker.jsx` (eliminado del repo), `thesisLinkSuggestions`/`thesisAddCompany`/`thesisEvaluateCompany` borrados de `api.js`.
- Decisión del usuario: para actualizar cualitativamente una empresa hoy → borrar/sobreescribir desde el buscador. No añadimos botón granular de "re-evaluar".

### Punto 2 · Copys engañosos sobre el refresco
Fundamentals/precios SE refrescan automáticamente (cron + botón). El cualitativo (overall_score, value_chain TAM, narrativa, TAM global de la tendencia) NO se actualiza nunca solo. Reescritos los textos en:
- `RefreshButton.jsx` (`REFRESH_LEGEND`): ahora dice explícitamente "actualiza fundamentales y recalcula TAM Scores; lo CUALITATIVO no se actualiza aquí".
- `ThesisSidebar.jsx`: copy del toggle "Refresco semanal" reescrito en la misma línea.
- `Thesis.jsx` línea 580 (`dedup-warning`): borrada la falsedad "El Thesis Engine la refresca automáticamente cada semana"; texto nuevo aclara que regenerar es lo único que actualiza lo cualitativo, mientras el botón Refrescar sólo toca lo cuantitativo.
- `Thesis.jsx` línea 469 (tooltip botón Refrescar dashboard): aclarado.

### Punto 4a · Validación ticker-only en buscador de empresa
Regex `^[A-Z0-9]{1,6}(\.[A-Z]{1,3})?(-[A-Z])?$` (acepta NVDA, BRK.B, 7203.T, 9988.HK, VOD.L; rechaza "obesidad", "APPLE INC", etc.). UX:
- El input se auto-uppercases mientras tecleas.
- Si el contenido no matchea ticker, aparece un hint rojo inline (`data-testid="thesis-input-hint"`) "Solo tickers. Para buscar por nombre/concepto usa Tendencias → Empresas".
- El botón "Generar tesis" queda deshabilitado (50% opacity, cursor-not-allowed).
- Gate adicional en `generate()` con toast por si el usuario intenta saltarse el disabled.

### Punto 4b3 · Aviso dedup con fuzzy 80% (Sørensen-Dice sobre bigramas)
El antiguo matcher usaba `includes` substring (demasiado agresivo y a la vez no detectaba el caso real). Ahora `findDup`:
- **Trend ↔ Trend**: best fuzzy match contra todos los títulos de tendencias guardadas; si score ≥ 0.80 → warning "Ya tienes esta tendencia guardada... Reescribir igualmente / Abrir la existente / Cancelar".
- **Trend ↔ Company (cross-match)**: además, contra todos los títulos de tesis de empresa; si score ≥ 0.80 → warning especial "Ya tienes una tesis de empresa con un nombre parecido. Se generará una tendencia nueva; la tesis de empresa NO se toca". Botón: "Generar tendencia igualmente" (NO sobreescribe el plan).
- **Company ↔ Company**: ticker exact match (la validación ticker-only ya estrecha el input).
- Accent-insensitive (`_norm` ahora hace `normalize('NFD')` y strip diacríticos).

### Verificación
- Tests pytest backend: 62/62 (sin contar test_compare pre-existente roto).
- Lint Python + JS limpio (warning pre-existente sobre eslint-disable directive no relacionado).
- Unit test inline en Node de `isValidTicker` + `similarity`: ✅
  - "obesidad" vs título largo "Ecosistema de Salud Metabólica..." → 0.264 → new trend (correcto, era el observed-bug del usuario).
  - "Ecosistema Salud Metabolica Obesidad" → 0.835 → dup warning.
  - "Hims & Hers" → 0.833 contra "Hims & Hers Health" → cross-match warning.
  - Tickers: NVDA, BRK.B, 7203.T, 9988.HK, VOD.L → válidos; "obesidad", "APPLE INC" → rechazados.
- Smoke test: app arranca sin errores en consola; CompanyThesisLinker eliminado sin imports rotos.

## CHANGELOG · Punto 4b3 refinado (Feb 2026)
Tras feedback del usuario, el dedup-warning ahora tiene la matriz de botones correcta:

| Escenario | Botones |
|---|---|
| Trend search ↔ trend (≥80%) | Reescribir (machacar) · Generar como nueva · Abrir · Cancelar |
| Trend search ↔ company (cross, ≥80%) | Generar como tendencia · Abrir · Cancelar (no se permite sobreescribir el plan desde aquí) |
| Company search ↔ ticker exact | Reescribir (machacar) · Abrir · Cancelar |

Implementación en `Thesis.jsx`:
- `dedup-rewrite-btn`: sólo aparece si NO es cross-match (la tesis de empresa solo se sobreescribe desde el flujo Empresa → Tesis).
- `dedup-generate-new-btn`: aparece para cualquier búsqueda en modo trend (same-kind o cross). Llama a `generate(..., { force: true })` SIN `overwriteId` → crea una tendencia nueva que coexiste con la existente.
- En modo company search, se mantiene solo el botón Reescribir (un segundo plan para el mismo ticker no tiene sentido).

## CHANGELOG · Bug crítico: `runExplore` se saltaba el dedup-warning (Feb 2026)
**Reporte usuario**: tecleó "computación cuántica" en "Tendencias → Empresas" (que tenía guardada con título ≥80% similar) y la app gastó ~60s de LLM sin disparar el aviso de duplicado introducido en el changelog anterior.

**Causa**: el dedup `findDup` solo se invocaba dentro de `generate()`. El modo "Tendencias → Empresas" llama a `runExplore()` (una función distinta, exploración informativa estructural), que nunca consultaba `findDup`. El fuzzy 80% del changelog previo cubría la mitad del flujo.

**Fix** en `Thesis.jsx`:
- `runExplore(opts)` ahora hace el check `findDup("trend", subject)` al inicio. Si hay match ≥80% → `setPendingDup({ ..., origin: "explore" })` y `return` sin llamar al LLM.
- Botones del dedup-warning ahora usan `pendingDup.origin`:
  - **Reescribir (machacar)** → siempre dispara `generate(...)` heavy (porque machacar tendencia guardada exige LLM completo, no la exploración informativa).
  - **Generar como nueva / Generar como tendencia**: si `origin === "explore"` → `runExplore({ force: true })` (mantiene el flujo ligero original del usuario). Si `origin === "generate"` → `generate(..., { force: true })` (heavy).
- `runAutoTrend` no necesita dedup (no acepta texto del usuario).

Verificación: lint OK, 62/62 pytest. Mismo warning eslint pre-existente.

## CHANGELOG · Bug crítico: findDup ignoraba dash.tendencias (Feb 2026)
**Reporte usuario**: tecleó "computación cuántica" en "Tendencias → Empresas" (que ya tenía guardada como TENDENCIA informativa) y el aviso fuzzy ≥80% siguió sin saltar.

**Causa raíz**: confusión de terminología en el código. El modelo de datos tiene 3 tipos:
- `type="tendencia"` → tendencia informativa (botón "Tendencias → Empresas" + Guardar).
- `type="trend"` → tesis-tendencia (desarrollada desde un driver del plan).
- `type="company"` → tesis de empresa (plan completo).

El dashboard los expone como `dash.tendencias`, `dash.trends`, `dash.company_theses`. La función `findDup` introducida en el fix anterior **solo miraba en `dash.trends` y `dash.company_theses`**, ignorando `dash.tendencias`. La tendencia "Computación Cuántica" del usuario está en `tendencias` → invisible al check → la app gastaba ~60s de LLM regenerando sin avisar.

**Terminología pactada con el usuario** (importante para futuras conversaciones):
- "tendencia" = type=tendencia (informativa)
- "tesis" = type=trend O type=company (developed o plan)

**Fixes en este turno**:
1. `findDup("trend", s)` ahora itera las 3 listas (`tendencias`, `trends`, `company_theses`) y devuelve el mejor match con `_dup_kind ∈ {"tendencia","trend","company"}`.
2. Matriz de botones del dedup-warning actualizada con la regla `isSameKind`:
   - same-kind = type==company AND kind==company → reescribir OK.
   - same-kind = type==trend AND origin==explore AND kind==tendencia → reescribir OK.
   - same-kind = type==trend AND origin==generate AND kind==trend → reescribir OK.
   - resto → cross-match, solo "Generar como (tendencia) nueva" + Abrir + Cancelar.
3. Backend `POST /thesis/tendencia/save` extendido con `overwrite_id` opcional → si se pasa, borra el doc antiguo de type=tendencia antes de insertar el nuevo. Implementación atómica (delete + insert) y solo aplica si el id existe para ese user_id+type=tendencia.
4. Frontend: nuevo state `overwriteTendenciaId` que viaja entre `runExplore({force:true, overwriteTendenciaId})` y `saveTendencia()` → la próxima Guardar machaca la vieja. Toast cambia a "Tendencia reescrita" cuando aplica.
5. Mensaje del aviso usa la terminología del usuario ("tendencia parecida", "tesis parecida", "tesis de empresa").

### Verificación
- curl test backend: creada tendencia A, llamada save con `overwrite_id=A` + nueva tendencia B → A queda eliminada, B creada. ✅
- pytest: 62/62. Lint Python+JS limpio (warning eslint-disable pre-existente, no relacionado).

## CHANGELOG · Radar semanal: sección "Noticias de tus empresas" (Feb 2026)
**Petición del usuario**: añadir al radar semanal una segunda sección con noticias relevantes sobre sus empresas con plan completo (las que ve en el maptree), con días desde generación del plan, y un aviso de que si la noticia es material o han pasado >60 días, debería regenerar la empresa para refrescar lo cualitativo.

### Backend
- **`services/thesis.py`** · nueva función `run_company_news_watch(companies)`. Una llamada LLM batch que clasifica noticias materiales solo (sé exigente, NO inventes) sobre la unión de tickers. Cap 8 empresas, 1 query DDG por empresa, max_results=2. Retorna `{important: [{ticker, headline, summary, why_it_matters, url}]}`.
- **`radar.py` reescrito**:
  - `collect_user_companies(db, user_id)` — empresas con plan completo (= con al menos un developed driver). Mirror del `complete_tickers` del dashboard.
  - `_build_radar_email_html(name, trends, companies, news_by_ticker)` — render con DOS secciones, intro adaptativo, banner rojo si alguna empresa ≥60 días.
  - `run_radar(db)` — agrega todas las empresas de los suscriptores opt-in en una sola llamada `run_company_news_watch` para coste mínimo. Cada email solo lleva las empresas del usuario y sus noticias filtradas.
  - `build_preview_for_user(db, user_id, trends=None)` — helper para QA.
- **`server.py`** · endpoints:
  - `POST /api/admin/preview-radar/{user_id}` → lanza un job de preview (no envía email). Devuelve `{job_id, status}`.
  - `GET /api/admin/preview-radar/job/{job_id}?html=true` → polling; con `html=true` y status=done devuelve el body renderizado.

### Verificación E2E
Preview real ejecutado contra user_f2b26c58510b (11 empresas, plan reciente 0-9 días). Resultado:
- 6 empresas con noticias materiales verificables: TEM (guidance up Q1), NVDA (+85% YoY Q1 FY27), LLY (guidance up 82-85B), REGN (+19%), DDOG (>$1B Q1), NET (+34%).
- 5 empresas sin noticias materiales (ALNY, IOVA, HIMS, NBIX, CRWD) — aparecen igualmente con su antigüedad.
- Screenshot del email renderizado en `/tmp/radar_email_full.png`.
- Test simulado de banner stale (199 días): banner rojo aparece sobre la lista.
- Tests pytest 62/62. Lint OK. Backend supervisorctl restart ✅.

### Decisión pendiente del usuario (a discutir)
- ¿Activar este radar enriquecido en el cron actual de lunes 07:00 UTC para tu cuenta o esperar?
- El email ahora puede ser largo (11 empresas). ¿Limitamos a las N más antiguas o con noticias materiales solamente?

## CHANGELOG · Radar semanal: schedule configurable + envío manual (Feb 2026)
**Petición usuario**: activar el cron del nuevo radar enriquecido, permitir saber/configurar día y hora de envío, y añadir botón de envío único manual sin alterar la frecuencia.

### Backend
- `RadarSubscribeRequest`: ahora acepta `weekday` (0=Lun…6=Dom UTC) y `hour_utc` (0-23) opcionales.
- `GET /api/thesis/radar/status` devuelve `{enabled, weekday, hour_utc, last_sent_at, next_send_at}`. `next_send_at` se calcula sobre la marcha desde la configuración del usuario.
- `POST /api/thesis/radar/subscribe` actualiza enabled+weekday+hour_utc atómicamente (cualquier omisión conserva el valor previo).
- `POST /api/thesis/radar/send-now` lanza job background `radarsend_*` que reutiliza el cache de candidatos (≤7 días) y dispara `run_radar_for_user`.
- `radar.py` refactor: `run_radar(db, target_user_ids=None)` ahora puede limitar a un subconjunto de suscriptores. Cache de discovery (skip si `last_run` <6 días). Helpers `compute_next_send_at`, `_dispatch_to_users`, `run_radar_for_user`. Persiste `users.radar.last_sent_at` tras cada envío.
- `server.py`: scheduler radar pasa de `CronTrigger(day_of_week="mon", hour=7)` a `CronTrigger(minute=0)` (cada hora). El job interno filtra usuarios por `radar.weekday == now.weekday() AND radar.hour_utc == now.hour`.

### Frontend
- `ThesisSidebar`: la sección Radar incluye, cuando está activado:
  - Selectores Día (Lunes-Domingo) y Hora (00:00-23:00) UTC.
  - "Próximo envío: ..." con formato es-ES.
  - "Último envío: ..." (si hay historial).
  - Botón "Enviar ahora" → toast "Envío manual en curso · llegará en 1-2 min".
- `Thesis.jsx`: nuevo state `radarSchedule`, función `updateRadarSchedule(weekday, hour_utc)` que llama al endpoint y actualiza la UI con la respuesta canónica.
- `lib/api.js`: `thesisRadarSubscribe(payload)` ahora acepta el objeto entero (no solo `enabled`).

### Verificación
- curl: subscribe → status → subscribe (weekday=2, hour_utc=14) → next_send_at calculado al miércoles 14:00 UTC → send-now → job done sent=1 → email entregado vía Resend (id 62272d91...) → last_sent_at persistido.
- pytest 62/62. Lint Python+JS OK.

Cron horario activo desde el restart del backend (Feb 2026). El radar enriquecido (sección noticias-empresas + banner stale) se entrega automáticamente según la config de cada usuario.

## CHANGELOG · Limpieza refresco semanal + hora local radar + fechas noticias (Feb 2026)
### Punto 1: borrado del refresco semanal redundante
El refresco semanal opcional (`thesis_refresh.run_thesis_refresh`) solo hacía fundamentals + TAM, idéntico al cron diario del screener (06:00 UTC) y al botón manual de arriba a la derecha. Eliminado para reducir superficie:
- Backend: borrado `run_thesis_refresh` (la función), scheduler job `_scheduled_thesis_refresh_run`, rutas `GET /refresh/status` y `POST /refresh/subscribe`, endpoint admin `POST /admin/run-thesis-refresh`, import `from thesis_refresh import run_thesis_refresh`.
- Frontend: borrado toggle "Refresco semanal" del sidebar, `thesisRefreshStatus`/`thesisRefreshSubscribe` de api.js, state `refreshEnabled`, función `toggleRefresh`, props relacionadas.
- Mantenido `refresh_user_data` y `recompute_and_store_tam` porque los usa el botón manual (`POST /thesis/refresh/run`) y otros flujos internos.

### Punto 2: hora local en selectores del radar
Sidebar muestra "Día (Lunes…)" + "Hora (CEST/EDT/…)" usando la zona horaria del navegador. Backend sigue almacenando UTC; helpers JS `localToUtc/utcToLocal` traducen en ambas direcciones anclando en el wall clock del usuario (robusto a DST). Label de TZ se infiere con `Intl.DateTimeFormat.formatToParts`.

### Punto 3: fecha de noticia en email + banner reescrito
- Prompt LLM `COMPANY_NEWS_WATCH_SYS` ahora pide `published_at` (YYYY-MM-DD) en cada noticia; instrucción explícita de NO inventar fechas.
- Render email: fecha en monospace dorado arriba a la derecha de cada news block (`#7a5a10`).
- Banner stale reescrito: ahora pide al usuario comparar fecha de noticia vs antigüedad del plan: si la noticia es anterior al plan, no hace falta regenerar; si es posterior y material, sí.

### Verificación E2E
- pytest 62/62, lint Python+JS OK.
- Send-now real → email entregado con 5 noticias datadas (2026-05-29 TEM FDA, 2026-05-20 NVDA Q1, 2026-04-30 LLY guidance, 2026-05-07 DDOG/NET resultados). Screenshot capturado en `/tmp/radar_v2.png`.

## CHANGELOG · Bug: /visual ignoraba los umbrales del usuario (Feb 2026)
**Reporte**: usuario cambió "justa" a −20% en Umbrales y Eli Lilly no cambió a ámbar en `/visual`.

**Causa**: `Visual.jsx` tenía colores hardcoded en dos sitios:
- `colorForRv` (línea 47): `>=20` verde, `>=0` ámbar, `<0` rojo — ignoraba localStorage.
- Tabla de empresas (líneas 314-315): clases tailwind con thresholds fijos (`>0` verde, `<0` rojo).

**Fix**: reemplazado todo por `signalFor(pct, kind)` de `lib/thresholds.js`, que ya lee localStorage en cada llamada. Además:
- Suscripción al evento `vs:thresholds-changed` para re-render automático cuando el usuario edita umbrales sin recargar la página.
- Leyenda del gráfico ahora muestra los thresholds dinámicos (lee `vs.thresholds.v1` de localStorage).
- Celdas de tabla `ratio_compra_pct` y `ratio_venta_pct` usan cada una su umbral correspondiente.

Tests 62/62, lint OK.

## CHANGELOG — Onboarding: Instrucciones + Tour + Ayuda (18 jun 2026)
Objetivo del usuario: facilitar el arranque de usuarios principiantes con 3 botones.
- **Botones**: Inicio (hero, `home-help-buttons`) → "Instrucciones" (`home-btn-instructions`, link a `/instrucciones`) + "Tour" (`home-btn-tour`, lanza el tour). Cabecera (Layout) → "Ayuda" (`help-chat-open`).
- **Instrucciones** (`pages/Instructions.jsx`, ruta `/instrucciones`): guía de ~2 páginas con conmutador ES/EN (`instructions-lang-es|en`, independiente del idioma global) y descarga PDF (`instructions-download-pdf`) vía `html2pdf.js` (import dinámico, genera desde el DOM `instructions-doc`). CONTENIDO PROVISIONAL en el objeto `CONTENT` (es/en) — el usuario entregará el documento final y solo hay que sustituir ese objeto.
- **Tour** (`lib/tour.jsx`, `TourProvider` envuelve `AppRouter` en App.js): tour personalizado (sin deps, React 19) cross-page con spotlight (box-shadow) + tarjeta (`tour-card`, `tour-next/prev/skip/close`). 8 pasos navegando por Inicio→Empresa(AAPL)→Watchlist→Cartera→Comparar→Tesis→Inicio. Bilingüe (usa `lang` de i18n). Navega y hace polling del target (selector data-testid) hasta 6s; fallback a tarjeta centrada. Escape cierra.
- **Ayuda** (`components/HelpChat.jsx` + backend `routes/help.py`): chat interno (`help-chat-dialog`) que responde dudas sobre la app. Backend `POST /api/help/chat` {session_id, message} usa Emergent LLM Key con **Gemini Flash `gemini-2.5-flash`** (NOTA: `gemini-2.5-flash-lite` ya NO es válido para la key; verificar con /v1/models). Memoria de conversación POR SESIÓN in-process (instancia LlmChat cacheada por session_id en `_sessions`). Bilingüe (es/en según i18n). Sugerencias iniciales. Errores LLM traducidos (budget/rate/genérico).
- Verificado: curl (chat con memoria: POC→POV en relación a lo anterior, OK) + screenshot (los 3 botones, dialog Ayuda, tour 1/8 y 2/8 con spotlight, Instrucciones ES/EN). Frontend compila (solo warning benigno de source-map de html2pdf).
- PENDIENTE: el usuario entregará el documento final de Instrucciones para sustituir el contenido provisional de `CONTENT` en `Instructions.jsx`.

## CHANGELOG — Conservar narrativa del driver tras desarrollar la tesis (19 jun 2026)
Petición del usuario: las tarjetas de driver (`NewThesisCard`) PERDÍAN su narrativa al desarrollar la tesis (pasaban a un mini-aviso). Las quería conservar como info de referencia (contienen más detalle que la entrada de la empresa en el eslabón de la tesis desarrollada).
- **Cambio (solo frontend, `ThesisResult.jsx` · `NewThesisCard`)**: se fusionaron los estados A/B/C. La tarjeta SIEMPRE pinta su narrativa (badge Actual/Futura, TAM, probabilidad ganadora, descripción de encaje, rol en cadena, rationale, lista de splits). Cuando está desarrollada añade:
  - Distintivo verde `Tesis generada` + enlace `Ver la tesis` (`core-whole-note-*` / `core-split-note-*`) — icono `Check`.
  - Sección `splits-status-*`: cada partición con su estado — `tesis generada` (enlace) / `incluida en el conjunto` (si se desarrolló el conjunto) / botón `Generar` (split-generate-*) si está pendiente.
  - Controles de planificación (Conjunto/Particiones, Fusionar, "Pendiente de generarse") ocultos cuando `isDeveloped`.
- **RETROACTIVO**: la narrativa nunca se borraba (`_record_split_dev` solo añade a `split_dev`, no toca `trends[]`); solo dejaba de pintarse. Verificado en BD: 23 empresas desarrolladas conservan narrativa en todos sus trends. Verificado por screenshot (ALNY `thesis_6c056cbc1db0`: 3 tarjetas con narrativa + badges verdes + particiones con estado).
- Limpieza: se eliminaron `pendingSplits`/`devSplitSet` (sin uso). Backend/datos sin cambios.

## CHANGELOG — Visual: columna "Combinado cualitativo" + tooltips de cabecera (19 jun 2026)
- Nueva columna **"Combinado cualitativo"** en la tabla de `/visual`, ENTRE "TAM Score" y "Compra %". Fórmula `computeCombinedQual` = media normalizada de Score (/100) + TAM Score (/30 cap), mostrada en % (0–100%). Ordenable (key `combined_qual`).
- Última columna renombrada **"Combinado" → "Combinado total"** (key `combined`, las 4 variables).
- **Tooltips de cabecera** (HoverTip) en TODAS las columnas de Score a Combinado total: Score, TAM Score, Combinado cualitativo, Compra %, Venta %, Combinado total (objeto `TIP`). `SortableTh` acepta prop `tip` y envuelve el label en HoverTip (mantiene el click de ordenamiento). colSpan 8→9.
- Solo frontend (`Visual.jsx`). Verificado por screenshot (cabeceras + tooltip + datos reales del usuario).

## CHANGELOG — Visual: ordenación de Ticker/Nombre + cabeceras 2 líneas (19 jun 2026)
- Cabeceras "Combinado cualitativo" y "Combinado total" ahora en DOS líneas (flex-col) para columnas equidistantes.
- Columnas **Ticker** (`ticker`) y **Nombre** (`name`) ahora ordenables (alfabético, `localeCompare` es, sensitivity base). `SortableTh` acepta `align` (left/right) + `className`; `STRING_KEYS` define orden alfabético; columnas string arrancan en asc, numéricas en desc. Solo frontend (`Visual.jsx`).

## CHANGELOG — Módulo KPIs: validación operativa de la tesis (19 jun 2026)
Piloto: validar/refutar la tesis de empresas YA desarrolladas mediante KPIs operativos extraídos por IA (ARR, NRR, clientes, backlog, suscriptores, ARPU, book-to-bill…).
- **Backend** `services/kpi.py`: pipeline 2 pasos — extractor **Gemini Flash** (`gemini-2.5-flash`) lee búsqueda en vivo (`gather_kpi_sources` reusa `_run_searches`) y extrae KPIs (valor actual/anterior, periodo, higher_is_better, driver, fuente+cita, confianza); juez **Claude Sonnet** (`claude-sonnet-4-5-20250929`) asigna señal s∈[-1,1] + peso w∈[0,1] + rationale por KPI y verdict por driver. Coeficiente DETERMINISTA en backend: `compute_kpi_coefficients` → S=Σ(w·s)/Σw, **C=1+α·S con α=0.5** (rango 0,5–1,5), por driver y global (verde>1.05/ámbar/rojo<0.95).
- **Endpoints** (en `routes/thesis.py`, declarados ANTES de `/{thesis_id}` para no colisionar): `GET /thesis/kpi-companies` (empresas con tesis completa, dedupe por ticker), `POST /thesis/{id}/kpis` (job async, patrón thesis_jobs + _spawn), `GET /thesis/{id}/kpis`, `PUT /thesis/{id}/kpis` (edición manual → recálculo determinista sin LLM, conserva verdicts/period/sources). Snapshot guardado en `theses.kpi_snapshot` (congelado hasta Reanalizar). Modelo `EditKpisRequest`.
- **Frontend** `pages/Kpis.jsx` + ruta `/kpis` + nav `nav-link-kpis`: selector de empresas (chip muestra coef), CTA "Analizar KPIs" (polling ~30-60s), cabecera coef global, tarjetas por driver con verdict, tabla KPIs (actual/anterior/YoY/señal/peso/driver/fuente/rationale), modo **Editar** (inputs señal/peso/valores → Guardar recalcula) y **Reanalizar**. api.js: `kpiCompanies/kpiGet/kpiRun/kpiEdit`.
- Decisiones usuario: disparo bajo demanda (a), α=0.5, Gemini+Claude, piloto DDOG/NOW/CRWD/NET/MDB+DUOL+RBLX, edición operativa SÍ.
- Verificado end-to-end: DUOL coef_global 1,24 (validándose), edición baja a 1,02 al poner señal −0,8 en Paid Subscribers. Screenshots OK (selector 26, drivers, tabla, edición).
- NOTA: KPIs extraídos por IA → mostrar siempre fuente y permitir corrección (ya implementado). Consumo: ~2 llamadas LLM por empresa.

## CHANGELOG — KPIs: buscador puntual de KPI específico (19 jun 2026)
- En la ficha de empresa de /kpis, caja **"Buscar un KPI específico"** (`kpi-search-box`/`kpi-search-input`/`kpi-search-btn`): el usuario pide un dato (p. ej. "número de suscriptores") → IA busca en vivo + extrae (Gemini) + juzga (Claude) → se **incorpora al snapshot y recalcula el coeficiente**.
- Backend `services/kpi.py`: `gather_kpi_search_sources` + `run_kpi_search` (SEARCH_EXTRACTOR_SYS enfocado a la petición; reutiliza `_judge_kpis`/`_merge_judge`). Endpoint `POST /thesis/{id}/kpis/search` (job async `_run_kpi_search_job`): mergea el KPI nuevo en el snapshot (dedupe por name+driver: el nuevo reemplaza), recompute determinista, **preserva verdicts/ediciones/period**, mergea fuentes; si no encuentra dato → conserva snapshot + `search_note`. Modelo `KpiSearchRequest`. api.js `kpiSearch`.
- Verificado: HIMS "suscriptores" → no hallado, snapshot intacto + nota; DUOL "crecimiento de ingresos" → añade KPI "Ingresos 292M" (n_kpis 4→5), coef 1,02→1,10, preserva edición previa (Paid Subscribers s=-0.8). Screenshot UI OK.

## CHANGELOG — KPIs: documentos como fuente (upload PDF/imagen + transcript) (19 jun 2026)
Permite subir documentos (deck/gráfico) y pegar transcript para alimentar el análisis de KPIs con datos que la web no tiene (p. ej. suscriptores de Hims).
- **Almacenamiento** `backend/storage.py`: Emergent object storage (EMERGENT_LLM_KEY), `init_storage` en startup de server.py, `put_object/get_object`, prefijo `valuation-studio/kpi-files/{user}/{uuid}.{ext}`. Sin delete API → soft-delete en DB.
- **Pre-extracción al subir** `services/kpi.py::extract_document_text` (Gemini Flash multimodal vía `FileContentWithMimeType`): lee PDF/imagen → digest de KPIs en texto, cacheado en `kpi_files.extracted_text`. Así no se re-paga visión en cada análisis.
- **Colección** `kpi_files`: {id,user_id,company_id,storage_path,original_filename,content_type,size,ext,kind(file/transcript),status(processing/ready/error),selected,is_deleted,extracted_text}. Límites: **100 MB/archivo, máx 10/empresa**, ext pdf/png/jpg/webp/gif.
- **Endpoints** (routes/thesis.py): `POST /{id}/kpis/files` (multipart, sube+spawn extracción), `POST /{id}/kpis/files/transcript` (texto, ready directo), `GET /{id}/kpis/files`, `PATCH .../{file_id}` (selected), `DELETE .../{file_id}` (soft), `GET .../{file_id}/download` (auth por token/query). Modelos `KpiTranscriptRequest`, `KpiFileSelectRequest`.
- **Wiring**: `_run_kpi_job` y `_run_kpi_search_job` cargan los archivos `selected+ready` → `_selected_doc_sources` los inyecta como "fuentes" (title `[Documento]`, url `doc:{id}`, snippet=digest) → el extractor cita `source_url=doc:...`.
- **Frontend** `components/kpi/KpiDocuments.jsx` (en /kpis al elegir empresa): lista con checkbox/estado/borrar, subir PDF/imagen, pegar transcript, polling mientras `processing`. api.js: `kpiFilesList/Upload/TranscriptAdd/Toggle/Delete`.
- Decisiones usuario: Fase1 PDF+imágenes (vídeo a Fase2), Gemini Flash, pre-extracción, transcript SÍ, 100MB/10.
- Verificado E2E: PDF HIMS → extrae "Suscriptores 2,4M vs 1,5M / NRR 112% / AOV 95" → análisis los usa citando `doc:...` (la web no los hallaba), coef 1,38. Screenshots panel + transcript OK. (Fix: faltaba `import os` en services/kpi.py).

## CHANGELOG — KPIs: noticias cualitativas con decaimiento (19 jun 2026)
Las noticias INFORMAN los scores (no sub-índice). Vida media 45 días, máx 15. Refresco al Reanalizar + botón propio "Buscar noticias" + incorpora las del Radar.
- **Backend** `services/kpi.py`: `gather_news_sources`/`gather_news_search_sources` + `run_company_news` (Gemini Flash, NEWS_EXTRACTOR_SYS → headline/summary/why_it_matters/published_at/sentiment/relevance/driver/url). Decaimiento determinista: `news_effective_relevance` = relevance·0.5^(edad/45), `prune_news` (top 15, eff≥0.04 → "olvida" el resto). `merge_prune_news(db,...)` compartido (dedupe por headline normalizado, upsert en colección `kpi_news`, prune). `_judge_kpis`/`run_company_kpis` aceptan `context_news` → bloque de noticias al juez Claude (matizan señal/peso/verdict; el dato cuantitativo manda).
- **Endpoints** (routes/thesis.py): `GET /{id}/kpis/news` (lista decaída), `POST /{id}/kpis/news` (job `_run_kpi_news_job`, query opcional), `DELETE /{id}/kpis/news/{news_id}`. `_run_kpi_job` ahora refresca noticias (origin="analysis") y pasa la lista podada como contexto al juzgar. Modelo `KpiNewsRequest`.
- **Radar** `radar.py`: persiste las noticias del radar por usuario/empresa en `kpi_news` (origin="radar") vía `merge_prune_news` (mapea ticker→plan_id).
- **Frontend** `components/kpi/KpiNews.jsx` (en /kpis): lista con sentimiento (+/−/•), why_it_matters, fecha, sello Radar, fuente, borrar; botón "Buscar noticias"; aviso de que matizan al Reanalizar. api.js: `kpiNewsList/kpiNewsSearch/kpiNewsDelete`.
- Verificado E2E: DUOL buscar noticias → 7 con decaimiento correcto (16-jun eff0.85, 6-may 0.50, 29-mar 0.21); Reanalizar → refresca a 10, juez cita contexto ("se REFUERZA por noticias de diversificación: matemáticas, música"), coef 1.39. Screenshot panel OK.
- Decisiones usuario: solo informan, vida media 45d, máx 15, refresco al reanalizar + Radar + botón propio.

## CHANGELOG — KPIs: renombrar/describir documentos + tooltip de sentimiento (19 jun 2026)
- **Documentos**: `kpi_files` ahora con `display_name` y `description` editables. PATCH `/{id}/kpis/files/{file_id}` acepta parcial {selected?, display_name?, description?} y devuelve el file actualizado. `_file_public` expone display_name (||original) y description. Frontend `KpiDocuments.jsx`: botón lápiz por archivo → inputs nombre+descripción (save/cancel), muestra display_name + descripción. api.js `kpiFileUpdate`. Verificado por API (rename "Deck resultados Q4 2025" + descripción).
- **Noticias**: tooltip (HoverTip) en el indicador de sentimiento (símbolo +/−/• y en cabecera "contexto cualitativo") explicando verde(+)=favorable, rojo(−)=desfavorable, gris(•)=neutral. `KpiNews.jsx`. Verificado por screenshot.

## CHANGELOG — KPIs: auto-renombrado de documentos por IA (19 jun 2026)
- La pre-extracción (Gemini Flash) ahora también sugiere un TÍTULO descriptivo: `DOC_EXTRACT_SYS` pide 1ª línea `TÍTULO: <tipo + periodo/tema>` (p. ej. "Presentación resultados Q1 2026", "Gráfico TTM suscriptores desde 2021"). `_doc_extract_sync` (routes) parsea la 1ª línea (robusto a markdown/acentos) → {title, text}; `_run_doc_extract` setea `display_name=title` automáticamente y `extracted_text=body` (sin la línea del título). El usuario puede renombrar manualmente (botón lápiz se mantiene). Transcripts conservan el título que pone el usuario.
- Verificado: subir hims_kpi.pdf → auto-renombrado a "Hims & Hers Investor Update Q4 2025".

## CHANGELOG — Fix: POC/POV/ratios faltantes en Nivel 1 por `info` parcial de yfinance (29 jul 2026)
Bug reportado: en Nivel 1 (Portfolio) varias empresas (AMD, TSLA, SHOP, NVDA, CRWD…) no mostraban POC/POV ni Ratio Compra/Venta.
- **Causa raíz**: yfinance devuelve a veces `t.info` PARCIAL → `sharesOutstanding` y/o `marketCap` en `null` (ej. AMD), aunque el dato existe en `fast_info`/`get_shares_full()`. La fórmula POC/POV exige los 10 campos; un solo `null` anula todo. Además ese payload degradado se cacheaba en MongoDB (`fundamentals`) y se servía vía `/api/compare` durante horas.
- **Fix backend** `services/valuation.py` (`fetch_fundamentals_sync`, ~L190): fallbacks para `shares_outstanding` (`fast_info.shares` → `impliedSharesOutstanding`/`floatShares` → `get_shares_full()` → `market_cap/current_price`) y `market_cap` (`fast_info.market_cap` → `shares×current_price`).
- **Fix caché** `server.py`: `_payload_is_degraded` extraído a nivel de módulo (ahora también marca degradado si falta `shares_outstanding` o `market_cap`); usado en `GET /company/{ticker}` y `GET /compare` para no servir/re-fetchar caché envenenada. Se limpiaron 8 entradas envenenadas de MongoDB (NVDA, IOVA, CRWD, UPST, TSLA, BKNG, AMD, SHOP).
- **Verificado** (testing_agent, iteration_21.json): `/api/compare` devuelve POC/POV/RC/RV completos (missing_inputs=[]) para AMD/TSLA/SHOP/NVDA/CRWD; UI de Nivel 1 y Compare renderizan valores + señales (CARA/BARATA/JUSTA) sin celdas '—'. Backend 100%, frontend 100%, sin issues.

## CHANGELOG — Fix: "Al comparar me da error" (502 por fetches seriales) + tooltip de título (31 jul 2026)
- **Bug Comparar (502)**: `GET /api/compare` hacía fetches de yfinance en serie (y un cambio previo añadía doble-fetch + saltar caché para datos degradados). Con la caché vacía, comparar varios tickers superaba el timeout del ingress → 502 → toast "Error al comparar" (`Compare.jsx::loadAll`). **Fix** (`server.py::compare`): revertida la lógica agresiva y reescrito para (1) servir caché fresca, (2) fetchear los tickers faltantes EN PARALELO (`asyncio.gather` + `run_in_threadpool`), (3) ensamblar en el orden original; ticker inválido devuelve `{error}` por-item sin romper el lote. Verificado (testing_agent iter_22): 6 tickers en frío 200 en ~1-3s, POC/POV correctos, sin toast de error.
- **Tooltip de título de tesis** (`CompanyQualCard.jsx::ThesisTitleLink`): si el título está recortado, un toque muestra tooltip con el título completo; doble toque en el título o toque en la flecha › abre la tesis. Re-mide truncado tras cargar fuentes. Verificado por screenshots.

## CHANGELOG — CTA "Generar plan" para empresas sin tesis propias + generador centrado (1 ago 2026)
- En la ficha de empresa (`CompanyQualCard.jsx`), cuando la empresa NO tiene tesis propias desarrolladas (`trend_rows` vacío) el CTA ya no dice "Buscar más tesis" sino **"Esta empresa todavía no tiene tesis propias desarrolladas · Generar plan"**. Aplica tanto al estado vacío (`company-qual-empty`, botón "Generar plan") como a la cabecera de la tarjeta con solo `other_rows` (`company-qual-add`). Si hay tesis propias pero el plan no está completo, se mantiene "Buscar más tesis".
- Al clicar va a `/thesis?company=TICKER`: `Thesis.jsx` prefija modo "Empresa → Tesis" + `subject` y ahora hace **scroll centrado al generador** (`generatorRef.scrollIntoView block:'center'`) para que el buscador aparezca listo sin buscarlo. Verificado por screenshots (KO estado vacío, NVDA cabecera, clic → generador centrado con NVDA prefijado).

## CHANGELOG — Pasada responsive móvil/landscape + ampliar gráfico Visual (1 ago 2026)
Reporte (Android/Chrome): ancho no encaja en móvil, scores descolocados al generar plan, gráfico Visual muy estrecho (poder ampliar), landscape no adapta.
- **Scores al generar plan** (`ThesisResult.jsx`): (a) cabecera de `NewThesisCard` con `min-w-0` en el nombre + `shrink-0` en el ScoreBadge (el nombre envuelve, el score no se solapa); (b) cabecera superior del plan apila en móvil (`flex-col sm:flex-row`, `w-full sm:w-auto`) para que ScoreBadge + ProbabilityCircle no se recorten.
- **Visual — ampliar gráfico** (`Visual.jsx`): botón `visual-expand-chart` ('Ampliar') abre overlay a pantalla completa (`visual-chart-fullscreen`, cerrar con `visual-chart-fullscreen-close`, ESC y lock de scroll) con el gráfico al 100% del viewport → resuelve estrechez y aprovecha landscape. Padding móvil reducido (`px-0 sm:px-6`). `chartNode` reutilizado inline y en el modal.
- **Barra de pestañas** (`ThesisExplore.jsx`): grupos `w-fit` (MEGATENDENCIAS/TENDENCIAS/CONVERGENCIA) envueltos en `min-w-0 max-w-full overflow-x-auto` → elimina el desborde de 77px en `/thesis`.
- **Verificado** (testing_agent iter_23 + iter_24, emulación Android 393x852 y landscape 852x393): las 10 páginas con overflow horizontal = 0 en vertical; 4/4 páginas sin romperse en landscape; scores dentro de tarjeta; Visual fullscreen OK en vertical y horizontal.

## CHANGELOG — Fix tooltips "pegados" en móvil (HoverTip) (1 ago 2026)
Bug (Android): en /compare, al pulsar 'Cargar Nivel 1/2' o 'Comparar' el tooltip aparecía pero se quedaba fijo (posición `fixed`) y no se iba al scrollear/mover.
- **Causa**: `HoverTip` solo mostraba en hover/focus y no escuchaba scroll ni tap-fuera; en táctil el estado "hover" persiste tras el tap → tooltip pegado.
- **Fix** (`HoverTip.jsx`, global): (1) rastrear `pointerType` en `onPointerDown`; (2) hover (pointerEnter/Leave) solo si es ratón; (3) en táctil, `onClick` togglea (re-tap cierra); (4) mientras está abierto, listeners de `scroll`/`resize` (capture) y `pointerdown` fuera → ocultan. Escritorio conserva hover.
- **Verificado** (testing_agent iter_25, emulación touch + ratón): tap abre, re-tap cierra, scroll cierra, tap-fuera cierra, hover desktop OK. 100%.

## CHANGELOG — Zoom táctil (Visual + treemaps) + treemap ampliable + texto Convergencia + fix sticky (2 ago 2026)
- **Nuevo** `components/PinchZoomPane.jsx`: zoom táctil reutilizable (pinch 2 dedos, arrastre 1 dedo con zoom>1, doble-toque reset, botones +/−/reset, rueda con Ctrl). Escala vía CSS transform (nítido en SVG y treemap).
- **Visual**: el gráfico ampliado a pantalla completa ahora tiene zoom táctil (envuelto en PinchZoomPane).
- **Treemaps (ThesisExplore)**: nuevo `<TreemapSurface>` (mide su caja y hace squarify) → botón 'Ampliar' (`explore-expand-treemap`) que abre el treemap a pantalla completa (`explore-treemap-fullscreen`) con zoom táctil, igual que los gráficos.
- **Convergencia**: leyenda del borde dorado ahora dice "Borde dorado en la empresa o empresas incluidas en más tendencias".
- **Fix desborde móvil /thesis**: causa raíz = barra de pestañas w-fit; resuelto con wrapper `overflow-x-auto` + `min-w-0` en columnas + `overflowX:'clip'` en la columna principal (no en la raíz, para no romper sticky).
- **Fix regresión sticky** del sidebar en escritorio: wrapper del sidebar con `lg:self-stretch` (le da altura de grid para que el `lg:sticky` tenga recorrido).
- **Verificado** (testing_agent iter_27, móvil 393x852 + landscape 852x393 + desktop 1280x800): 5/5 OK — overflow móvil 0 en todos los modos, treemap y Visual fullscreen con zoom (scale 1→1.69→reset), texto convergencia correcto, sticky top=16 tras scroll. Sin issues.

## CHANGELOG — Treemap: revelar etiquetas al hacer zoom (2 ago 2026)
- `PinchZoomPane` ahora expone el nivel de zoom (`onZoom`).
- `ThesisExplore`: estado `treeZoom` (redondeado a pasos de 0.5) alimenta `TreemapSurface`→`renderCell`. Las etiquetas se muestran según el TAMAÑO EFECTIVO (it.w×zoom, it.h×zoom): al ampliar el treemap a pantalla completa, las cajas pequeñas revelan su nombre. A zoom=1 el comportamiento es idéntico al anterior (sin regresión). Se resetea al cerrar el modal.
- Verificado: el fullscreen renderiza etiquetas correctamente a zoom=1 (labelVisible=true) y el zoom/in/out/reset funciona (iter_27). Nota: no fue posible una demo en vivo del revelado con muchas celdas porque el test user solo tiene 2 megatendencias grandes; el mecanismo (umbral por tamaño efectivo) queda verificado por lógica + cableado.

## CHANGELOG — Tooltips congelados: unificación con HoverTip en toda la app (2 ago 2026)
Bug recurrente: los tooltips de explicación de los botones del treemap (ViewBtn en ThesisExplore) usaban un tooltip propio (btnTip con onMouseEnter/Leave) y se quedaban congelados en táctil.
- **ThesisExplore**: `ViewBtn` ahora envuelve el botón en `<HoverTip text={v.desc}>` (eliminado btnTip/setBtnTip/onTip y su render manual). El tooltip de celda (`tip`/CellTooltip) añade descarte por scroll/resize/touchstart.
- **CompanyQualCard** (ThesisTitleLink): ahora también cierra en scroll/resize (además de tap-fuera).
- **Auditoría**: los únicos tooltips fixed propios estaban en HoverTip (ya arreglado), CompanyQualCard y ThesisExplore. Todos comparten ahora la misma lógica de descarte (tap toggle, scroll/resize/pointerdown-fuera).
- **Verificado** (testing_agent iter_28, táctil 393x852 + escritorio 1280x800): 100% — los 5 botones del treemap abren al tocar y cierran en re-tap/scroll/tap-fuera; hover desktop OK; segmented control intacto; Compare y regresiones OK. Nota no bloqueante: warning de hydration '<span> child of <option>' en ThesisSidebar (instrumentación dev, no afecta funcionalidad).

## CHANGELOG — Treemap ampliado: revelado de celdas pequeñas + texto a tamaño constante (2 ago 2026)
- `renderCell` en ThesisExplore ahora contraescala la capa de texto por 1/zoom (width/height × zoom + transform scale(1/zoom), origen top-left) → las etiquetas mantienen tamaño LEGIBLE CONSTANTE al hacer zoom en lugar de agrandarse desproporcionadamente.
- El revelado de etiquetas sigue por tamaño EFECTIVO (it.w×zoom, it.h×zoom): al acercarte a zonas densas, las celdas pequeñas que estaban sin datos muestran su nombre/valor. Paso de zoom afinado a 0.25.
- Verificado (seed temporal de 72 tendencias, luego eliminado): a pantalla completa las 72 celdas se etiquetan; con zoom el texto se mantiene en ~18px on-screen (constante) y las celdas pequeñas revelan datos. Funciona con pinch y con botones lupa +/−/reset.

## CHANGELOG — Visual: auto-landscape del gráfico al girar el móvil (2 ago 2026)
- `Visual.jsx`: nuevo efecto con matchMedia '(orientation: landscape) and (max-height: 600px)' → en un TELÉFONO en horizontal abre automáticamente el overlay ancho del gráfico (visual-chart-fullscreen), estirando el eje X para que las burbujas no se amontonen; al volver a vertical se cierra solo. No se activa en desktop/tablet (viewports altos).
- Verificado (screenshot + matchMedia): portrait 390x844 → no abre; landscape 844x390 → abre ancho con eje X completo + zoom; vuelta a portrait → cierra.
