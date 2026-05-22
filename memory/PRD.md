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

## Backlog priorizado
- **P1** — Histórico de ratios (gráfico de evolución temporal de Ratio Compra/Venta).
- **P1** — Umbrales de señal configurables por el usuario (sliders cheap/expensive).
- **P2** — Exportar análisis a PDF / Excel.
- **P2** — Modo "Sensibilidad": cómo cambia POC al variar márgenes/crecimientos ±10%.
- **P2** — Login (Emergent Google Auth) para sincronizar watchlist entre dispositivos.
- **P2** — Alertas por email cuando Ratio Compra cruza un umbral (SendGrid/Resend).
- **P3** — Soporte multimoneda con conversión FX para comparar empresas globales.
- **P3** — Modo oscuro alternativo.
