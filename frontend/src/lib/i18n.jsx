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
        // Home
        "home.tag": "Análisis fundamental",
        "home.hero_title": "Tu fórmula de valoración propia, automatizada",
        "home.hero_sub": "Conecta los datos de Yahoo Finance con tu cálculo personalizado de Ratio Compra/Venta. Edita inputs, guarda en watchlist y compara empresas.",
        // Company hero
        "company.price_now": "Precio actual",
        "company.add_watchlist": "Añadir a watchlist",
        "company.remove_watchlist": "Quitar de watchlist",
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
        "watchlist.col_rc": "R. Compra",
        "watchlist.col_rv": "R. Venta",
        "watchlist.col_signal": "Señal",
        "watchlist.col_alert": "Alerta",
        "watchlist.login_prompt_tag": "¿Cambias entre móvil y ordenador?",
        "watchlist.login_prompt_text": "Tu watchlist se guarda solo en este navegador. Inicia sesión con Google (botón Entrar arriba) para sincronizarla automáticamente entre tus dispositivos y activar alertas opcionales por email cuando una acción cruce tu zona de compra/venta.",
        // Portfolio
        "portfolio.tag": "Tus posiciones reales",
        "portfolio.title": "Cartera",
        "portfolio.empty_title": "Aún no hay posiciones",
        "portfolio.empty_sub": "Añade las acciones que ya tienes en cartera para ver P/L vivo y compararlo con tus precios objetivo.",
        "portfolio.add_position": "Añadir posición",
        "portfolio.col_shares": "Acciones",
        "portfolio.col_buy_price": "Precio compra",
        "portfolio.col_invested": "Invertido",
        "portfolio.col_now": "Valor actual",
        "portfolio.col_pl": "P/L",
        "portfolio.col_pl_pct": "P/L %",
        "portfolio.col_buy_date": "Fecha",
        "portfolio.col_note": "Nota",
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
        // Alerts
        "alerts.tag": "Alertas por email",
        "alerts.row_on": "Alertas activadas (cruces a/de barata)",
        "alerts.row_off": "Activar alertas para este ticker",
        "alerts.requires_login": "Inicia sesión para activar alertas por email",
        // Footer
        "footer.legal_tag": "AVISO LEGAL ·",
        "footer.legal": "Esta aplicación tiene fines exclusivamente didácticos y orientativos. La información mostrada no constituye recomendación, asesoramiento ni invitación a operar con valores. Los cálculos se basan en una fórmula propia del usuario y en datos automáticos de Yahoo Finance que pueden contener errores o estar desactualizados. Cada inversor debe realizar su propio análisis y, si procede, consultar a un profesional registrado. Invertir conlleva riesgo de pérdida del capital.",
    },
    en: {
        // Nav
        "nav.home": "Home",
        "nav.watchlist": "Watchlist",
        "nav.portfolio": "Portfolio",
        "nav.compare": "Compare",
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
        // Home
        "home.tag": "Fundamental analysis",
        "home.hero_title": "Your own valuation formula, automated",
        "home.hero_sub": "Plug Yahoo Finance data into your custom Buy/Sell Ratio. Edit inputs, save to your watchlist, and compare companies.",
        // Company hero
        "company.price_now": "Current price",
        "company.add_watchlist": "Add to watchlist",
        "company.remove_watchlist": "Remove from watchlist",
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
        "watchlist.col_rc": "Buy R.",
        "watchlist.col_rv": "Sell R.",
        "watchlist.col_signal": "Signal",
        "watchlist.col_alert": "Alert",
        "watchlist.login_prompt_tag": "Switching between phone and laptop?",
        "watchlist.login_prompt_text": "Your watchlist is stored only in this browser. Sign in with Google (button above) to sync it automatically across devices and to enable optional email alerts when a stock crosses your buy/sell zone.",
        // Portfolio
        "portfolio.tag": "Your real positions",
        "portfolio.title": "Portfolio",
        "portfolio.empty_title": "No positions yet",
        "portfolio.empty_sub": "Add the shares you already own to see live P/L and compare against your target prices.",
        "portfolio.add_position": "Add position",
        "portfolio.col_shares": "Shares",
        "portfolio.col_buy_price": "Buy price",
        "portfolio.col_invested": "Invested",
        "portfolio.col_now": "Current value",
        "portfolio.col_pl": "P/L",
        "portfolio.col_pl_pct": "P/L %",
        "portfolio.col_buy_date": "Date",
        "portfolio.col_note": "Note",
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
        // Alerts
        "alerts.tag": "Email alerts",
        "alerts.row_on": "Alerts on (crosses in/out of cheap zone)",
        "alerts.row_off": "Enable email alerts for this ticker",
        "alerts.requires_login": "Sign in to enable email alerts",
        // Footer
        "footer.legal_tag": "DISCLAIMER ·",
        "footer.legal": "This application is for educational and illustrative purposes only. The information shown is not investment advice or a solicitation to trade securities. The calculations rely on the user's own formula and on automated data from Yahoo Finance that may contain errors or be outdated. Each investor must do their own research and, if needed, consult a registered professional. Investing carries the risk of capital loss.",
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
