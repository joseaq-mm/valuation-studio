// Lightweight i18n. Stores selected language in localStorage and exposes
// a t(key, vars) helper. Falls back to Spanish (the original language) when
// a key is missing in English.
import React, { createContext, useContext, useState, useEffect, useMemo } from "react";

const KEY = "vs.lang";
const SUPPORTED = ["es", "en"];

// Dictionary keyed first by language, then by key.
// Coverage focus: navigation, page headers, hero KPIs, watchlist/portfolio columns,
// dialogs, primary buttons. Tooltips and dynamic strings remain in Spanish.
const DICT = {
    es: {
        // Nav
        "nav.home": "Inicio",
        "nav.watchlist": "Watchlist",
        "nav.portfolio": "Cartera",
        "nav.compare": "Comparar",
        "nav.thesis": "Tesis",
        "nav.thresholds": "Umbrales",
        "nav.login": "Entrar",
        "nav.search_placeholder": "Buscar ticker (AAPL, SAN.MC, SAP.DE, VOD.L)...",
        "nav.search_button": "Ir",
        // Common
        "common.cancel": "Cancelar",
        "common.save": "Guardar",
        "common.delete": "Eliminar",
        "common.add": "Añadir",
        "common.refresh": "Refrescar",
        "common.loading": "Cargando…",
        "common.no_data": "Sin datos",
        "common.actions": "Acciones",
        "common.edit": "Editar",
        "common.discard": "Descartar cambios",
        // Home
        "home.tag": "Equity research · Análisis fundamental",
        "home.hero_title_pre": "Calcula si una acción está",
        "home.hero_title_em_cara": "cara",
        "home.hero_title_or": "o",
        "home.hero_title_em_barata": "barata",
        "home.hero_sub": "Valuation Studio es un sistema de valoración basado en proyecciones de ingresos y FCF, deuda neta, márgenes y crecimientos compuestos. Aplicado a cualquier empresa cotizada del mundo, con datos siempre actualizados.",
        "home.try_with": "Prueba con",
        "home.method_01_t": "Ingiere",
        "home.method_01_d": "Conecta cualquier ticker global (NYSE, NASDAQ, BME, Xetra, LSE, Euronext…) y descarga estados financieros e ingresos proyectados.",
        "home.method_02_t": "Calcula",
        "home.method_02_d": "Aplica las fórmulas de Valuation Studio: Ratio Compra y Ratio Venta, con proyecciones a 2 años, márgenes, FCF y crecimientos compuestos a 4 años.",
        "home.method_03_t": "Decide",
        "home.method_03_d": "Visualiza la señal en verde / ámbar / rojo. Compara empresas, ajusta proyecciones a mano y mantén una watchlist.",
        "home.popular_title": "Mercados destacados",
        "home.compare_companies": "Comparar empresas",
        // Compare
        "compare.tag": "Side-by-side",
        "compare.title": "Comparar empresas",
        "compare.search_placeholder": "Buscar empresa o ticker (AAPL, Apple, SAN.MC…)",
        "compare.load_watchlist": "Cargar watchlist",
        "compare.run": "Comparar",
        "compare.running": "Cargando…",
        "compare.max_companies": "Máximo 6 empresas",
        "compare.metric": "Métrica",
        "compare.row_price": "Precio",
        "compare.row_poc": "POC (objetivo compra)",
        "compare.row_pov": "POV (objetivo venta)",
        "compare.row_mcap": "Market Cap",
        "compare.row_currency": "Moneda",
        "compare.row_signal": "Señal",
        // Company hero / actions
        "company.price_now": "Precio actual",
        "company.add_watchlist": "Añadir a watchlist",
        "company.remove_watchlist": "Quitar de watchlist",
        "company.in_watchlist": "En watchlist",
        "company.save_watchlist": "Guardar en watchlist",
        "company.add_portfolio": "Añadir a cartera",
        "company.ratio_compra": "Ratio de Compra",
        "company.ratio_venta": "Ratio de Venta",
        "company.upside_to_poc": "Upside hasta el precio objetivo de compra.",
        "company.upside_to_pov": "Upside hasta el precio objetivo de venta.",
        // Watchlist
        "watchlist.tag": "Tu cartera de seguimiento",
        "watchlist.title": "Watchlist",
        "watchlist.empty_title": "Aún no hay empresas guardadas",
        "watchlist.empty_sub": "Busca un ticker arriba y guarda empresas con el botón ★",
        "watchlist.empty_cta": "Empezar",
        "watchlist.col_ticker": "Ticker",
        "watchlist.col_company": "Empresa",
        "watchlist.col_mode": "Modo",
        "watchlist.col_price": "Precio",
        "watchlist.col_mcap": "Mcap",
        "watchlist.col_rc": "R.C.",
        "watchlist.col_rv": "R.V.",
        "watchlist.col_signal": "Señal C.",
        "watchlist.col_signal_sell": "Señal V.",
        "watchlist.col_alert": "🔔",
        "watchlist.count_companies": "{n} empresas",
        "watchlist.count_with_alert": "{n} con alerta activa",
        "watchlist.login_prompt_tag": "¿Cambias entre móvil y ordenador?",
        "watchlist.login_prompt_text": "Tu watchlist se guarda solo en este navegador. Inicia sesión con Google (botón Entrar arriba) para sincronizarla automáticamente entre tus dispositivos y activar alertas opcionales por email cuando una acción cruce tu zona de compra/venta.",
        // Portfolio
        "portfolio.tag": "Tus posiciones reales",
        "portfolio.title": "Cartera",
        "portfolio.empty_title": "Aún no hay posiciones",
        "portfolio.empty_sub": "Añade las acciones que ya tienes en cartera para ver P/L vivo y compararlo con tus precios objetivo.",
        "portfolio.add_position": "Añadir posición",
        "portfolio.col_shares": "Núm.",
        "portfolio.col_buy_price": "Compra",
        "portfolio.col_invested": "Invertido",
        "portfolio.col_now": "Valor",
        "portfolio.col_pl": "P/L",
        "portfolio.col_pl_pct": "P/L %",
        "portfolio.col_buy_date": "Fecha",
        "portfolio.col_note": "Nota",
        "portfolio.count_positions": "{n} posiciones",
        "portfolio.count_with_data": "{n} con datos",
        "portfolio.count_tracked": "{n} en seguimiento",
        "portfolio.tracked_badge": "SEG",
        "portfolio.tracked_tooltip": "Seguimiento (sin posición real registrada)",
        "portfolio.total_invested": "Total invertido",
        "portfolio.total_now": "Valor actual total",
        "portfolio.total_pl": "P/L total",
        "portfolio.dialog_title": "Añadir / editar posición",
        "portfolio.field_ticker": "Ticker",
        "portfolio.field_shares": "Nº de acciones",
        "portfolio.field_buy_price": "Precio de compra (acción)",
        "portfolio.field_buy_currency": "Moneda de compra",
        "portfolio.field_buy_date": "Fecha de compra",
        "portfolio.field_note": "Nota (opcional)",
        "portfolio.tt_pl": "P/L = Profit/Loss (Ganancia/Pérdida)\n\nFórmula: valor actual − cantidad invertida\nEj.: invertiste 500 €, ahora vale 700 € → P/L = +200 €",
        "portfolio.tt_pl_pct": "P/L % = Ganancia/Pérdida en porcentaje sobre lo invertido\n\nFórmula: (precio actual / precio compra − 1) × 100\nEj.: compraste a 100, cotiza a 215 → P/L % = +115,3%",
        "portfolio.tt_buy_signal": "Señal de COMPRA basada en Ratio de Compra:\n• BARATA si supera tu umbral 'cheap'\n• JUSTA entre fair y cheap\n• CARA por debajo de tu umbral 'fair'\nConfigurable en Umbrales (cabecera).",
        "portfolio.tt_sell_signal": "Señal de VENTA basada en Ratio de Venta:\nMismas zonas que la señal de compra pero referidas a tu Precio Objetivo de Venta.",
        // Alerts banner
        "alerts.banner.eyebrow": "Alertas por email — campanita",
        "alerts.banner.intro": "Cuando una acción tiene la campanita {bell_active} activada, cada noche (06:00 UTC) revisamos sus ratios y te enviamos un email en dos situaciones:",
        "alerts.banner.case_buy": "El precio {cheap} cruza a BARATA según tu Ratio Compra (precio actual ≤ POC, tu precio objetivo de compra).",
        "alerts.banner.case_sell": "El precio {expensive} cruza a CARA según tu Ratio Venta (precio actual ≥ POV, tu precio objetivo de venta — momento natural de plantearse vender).",
        "alerts.banner.master": "La campanita de la cabecera activa/desactiva todas las filas a la vez.",
        "alerts.banner.default_portfolio": "En esta página las alertas se {active} activan por defecto al añadir una posición (te interesa que te avisen de lo que ya tienes en cartera).",
        "alerts.banner.default_watchlist": "En esta página las alertas vienen {off} desactivadas por defecto al añadir una empresa, para evitar ruido en listas amplias de seguimiento — activa la campanita en las que de verdad quieras vigilar.",
        "alerts.banner.login_req": "Requiere iniciar sesión con Google para recibir los emails.",
        // Alerts
        "alerts.tag": "Alertas por email",
        "alerts.row_on": "Alertas activadas (cruces a/de barata)",
        "alerts.row_off": "Activar alertas para este ticker",
        "alerts.requires_login": "Inicia sesión para activar alertas por email",
        // Footer
        "footer.legal_tag": "AVISO LEGAL ·",
        "footer.legal": "Esta aplicación tiene fines exclusivamente didácticos y orientativos. La información mostrada no constituye recomendación, asesoramiento ni invitación a operar con valores. Los cálculos se basan en la fórmula propia de Valuation Studio y en datos automáticos de Yahoo Finance que pueden contener errores o estar desactualizados. Cada inversor debe realizar su propio análisis y, si procede, consultar a un profesional registrado. Invertir conlleva riesgo de pérdida del capital.",
    },
    en: {
        // Nav
        "nav.home": "Home",
        "nav.watchlist": "Watchlist",
        "nav.portfolio": "Portfolio",
        "nav.compare": "Compare",
        "nav.thesis": "Theses",
        "nav.thresholds": "Thresholds",
        "nav.login": "Sign in",
        "nav.search_placeholder": "Search ticker (AAPL, SAN.MC, SAP.DE, VOD.L)...",
        "nav.search_button": "Go",
        // Common
        "common.cancel": "Cancel",
        "common.save": "Save",
        "common.delete": "Delete",
        "common.add": "Add",
        "common.refresh": "Refresh",
        "common.loading": "Loading…",
        "common.no_data": "No data",
        "common.actions": "Actions",
        "common.edit": "Edit",
        "common.discard": "Discard changes",
        // Home
        "home.tag": "Equity research · Fundamental analysis",
        "home.hero_title_pre": "Find out whether a stock is",
        "home.hero_title_em_cara": "expensive",
        "home.hero_title_or": "or",
        "home.hero_title_em_barata": "cheap",
        "home.hero_sub": "Valuation Studio is a valuation system based on revenue and FCF projections, net debt, margins and compounded growth rates. Works for any listed company in the world, with always-updated data.",
        "home.try_with": "Try with",
        "home.method_01_t": "Ingest",
        "home.method_01_d": "Plug in any global ticker (NYSE, NASDAQ, BME, Xetra, LSE, Euronext…) and pull financial statements and forward revenue.",
        "home.method_02_t": "Compute",
        "home.method_02_d": "Apply the Valuation Studio formulas: Buy Ratio and Sell Ratio, with 2y projections, margins, FCF and 4y compounded growth.",
        "home.method_03_t": "Decide",
        "home.method_03_d": "See the signal in green / amber / red. Compare companies, tweak projections manually and keep a watchlist.",
        "home.popular_title": "Featured markets",
        "home.compare_companies": "Compare companies",
        // Compare
        "compare.tag": "Side-by-side",
        "compare.title": "Compare companies",
        "compare.search_placeholder": "Search company or ticker (AAPL, Apple, SAN.MC…)",
        "compare.load_watchlist": "Load watchlist",
        "compare.run": "Compare",
        "compare.running": "Loading…",
        "compare.max_companies": "Maximum 6 companies",
        "compare.metric": "Metric",
        "compare.row_price": "Price",
        "compare.row_poc": "POC (buy target)",
        "compare.row_pov": "POV (sell target)",
        "compare.row_mcap": "Market Cap",
        "compare.row_currency": "Currency",
        "compare.row_signal": "Signal",
        // Company hero / actions
        "company.price_now": "Current price",
        "company.add_watchlist": "Add to watchlist",
        "company.remove_watchlist": "Remove from watchlist",
        "company.in_watchlist": "In watchlist",
        "company.save_watchlist": "Save to watchlist",
        "company.add_portfolio": "Add to portfolio",
        "company.ratio_compra": "Buy Ratio",
        "company.ratio_venta": "Sell Ratio",
        "company.upside_to_poc": "Upside to your buy target price.",
        "company.upside_to_pov": "Upside to your sell target price.",
        // Watchlist
        "watchlist.tag": "Your tracked companies",
        "watchlist.title": "Watchlist",
        "watchlist.empty_title": "No companies saved yet",
        "watchlist.empty_sub": "Search for a ticker above and save companies with the ★ button.",
        "watchlist.empty_cta": "Get started",
        "watchlist.col_ticker": "Ticker",
        "watchlist.col_company": "Company",
        "watchlist.col_mode": "Mode",
        "watchlist.col_price": "Price",
        "watchlist.col_mcap": "Mcap",
        "watchlist.col_rc": "B.R.",
        "watchlist.col_rv": "S.R.",
        "watchlist.col_signal": "B. sig.",
        "watchlist.col_signal_sell": "S. sig.",
        "watchlist.col_alert": "🔔",
        "watchlist.count_companies": "{n} companies",
        "watchlist.count_with_alert": "{n} with active alert",
        "watchlist.login_prompt_tag": "Switching between phone and laptop?",
        "watchlist.login_prompt_text": "Your watchlist is stored only in this browser. Sign in with Google (button above) to sync it automatically across devices and to enable optional email alerts when a stock crosses your buy/sell zone.",
        // Portfolio
        "portfolio.tag": "Your real positions",
        "portfolio.title": "Portfolio",
        "portfolio.empty_title": "No positions yet",
        "portfolio.empty_sub": "Add the shares you already own to see live P/L and compare against your target prices.",
        "portfolio.add_position": "Add position",
        "portfolio.col_shares": "Qty.",
        "portfolio.col_buy_price": "Buy",
        "portfolio.col_invested": "Invested",
        "portfolio.col_now": "Value",
        "portfolio.col_pl": "P/L",
        "portfolio.col_pl_pct": "P/L %",
        "portfolio.col_buy_date": "Date",
        "portfolio.col_note": "Note",
        "portfolio.count_positions": "{n} positions",
        "portfolio.count_with_data": "{n} with data",
        "portfolio.count_tracked": "{n} tracking-only",
        "portfolio.tracked_badge": "TRK",
        "portfolio.tracked_tooltip": "Tracking only (no real position recorded)",
        "portfolio.total_invested": "Total invested",
        "portfolio.total_now": "Current total value",
        "portfolio.total_pl": "Total P/L",
        "portfolio.dialog_title": "Add / edit position",
        "portfolio.field_ticker": "Ticker",
        "portfolio.field_shares": "Number of shares",
        "portfolio.field_buy_price": "Buy price (per share)",
        "portfolio.field_buy_currency": "Buy currency",
        "portfolio.field_buy_date": "Buy date",
        "portfolio.field_note": "Note (optional)",
        "portfolio.tt_pl": "P/L = Profit/Loss\n\nFormula: current value − amount invested\nEx.: invested €500, now worth €700 → P/L = +€200",
        "portfolio.tt_pl_pct": "P/L % = Profit/Loss as a percentage of the amount invested\n\nFormula: (current price / buy price − 1) × 100\nEx.: bought at 100, now 215 → P/L % = +115.3%",
        "portfolio.tt_buy_signal": "BUY signal based on Buy Ratio:\n• CHEAP if above your 'cheap' threshold\n• FAIR between fair and cheap\n• EXPENSIVE below your 'fair' threshold\nConfigurable in Thresholds (header).",
        "portfolio.tt_sell_signal": "SELL signal based on Sell Ratio:\nSame zones as the buy signal but relative to your Sell Target Price.",
        // Alerts banner
        "alerts.banner.eyebrow": "Email alerts — bell",
        "alerts.banner.intro": "When a stock has the bell {bell_active} on, every night (06:00 UTC) we review its ratios and email you in two situations:",
        "alerts.banner.case_buy": "Price {cheap} crosses to CHEAP via Buy Ratio (current price ≤ POC, your buy target).",
        "alerts.banner.case_sell": "Price {expensive} crosses to EXPENSIVE via Sell Ratio (current price ≥ POV, your sell target — a natural moment to consider selling).",
        "alerts.banner.master": "The bell in the header toggles every row at once.",
        "alerts.banner.default_portfolio": "On this page alerts are {active} ENABLED by default when you add a position (you'll want to be notified about what you already own).",
        "alerts.banner.default_watchlist": "On this page alerts come {off} DISABLED by default when you add a company, to avoid noise on long tracking lists — turn on the bell only on the ones you really want to monitor.",
        "alerts.banner.login_req": "Requires signing in with Google to receive the emails.",
        // Alerts
        "alerts.tag": "Email alerts",
        "alerts.row_on": "Alerts on (crosses in/out of cheap zone)",
        "alerts.row_off": "Enable email alerts for this ticker",
        "alerts.requires_login": "Sign in to enable email alerts",
        // Footer
        "footer.legal_tag": "DISCLAIMER ·",
        "footer.legal": "This application is for educational and illustrative purposes only. The information shown is not investment advice or a solicitation to trade securities. The calculations rely on Valuation Studio's own formula and on automated data from Yahoo Finance that may contain errors or be outdated. Each investor must do their own research and, if needed, consult a registered professional. Investing carries the risk of capital loss.",
    },
};

const I18nContext = createContext({ lang: "es", t: (k) => k, setLang: () => {} });

export function I18nProvider({ children }) {
    const [lang, setLang] = useState(() => {
        try {
            const stored = window.localStorage.getItem(KEY);
            if (stored && SUPPORTED.includes(stored)) return stored;
        } catch { /* ignore */ }
        return "es";
    });
    useEffect(() => {
        try { window.localStorage.setItem(KEY, lang); } catch { /* ignore */ }
        try { document.documentElement.setAttribute("lang", lang); } catch { /* ignore */ }
    }, [lang]);

    const value = useMemo(() => ({
        lang,
        setLang: (l) => SUPPORTED.includes(l) && setLang(l),
        t: (key, vars) => {
            const table = DICT[lang] || DICT.es;
            let s = table[key];
            if (s == null) s = DICT.es[key] != null ? DICT.es[key] : key;
            if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
            return s;
        },
    }), [lang]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
