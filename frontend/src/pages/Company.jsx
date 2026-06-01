import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getCompany, recalc, translateSummary } from "@/lib/api";
import { api } from "@/lib/api";
import { fmtNum, fmtPct, fmtPrice, fmtPctSigned, fmtCompact, ratioColor, signalLabel } from "@/lib/format";
import LocaleNumberInput from "@/components/LocaleNumberInput";
import { saveToWatchlist, removeFromWatchlist, getWatchlistEntry } from "@/lib/storage";
import { getPortfolioEntry, savePortfolioOverrides, removePosition } from "@/lib/portfolio";
import { computeCustomRatios, autoInputsFromData, valuesEqual, computeOverrides } from "@/lib/customRatios";
import { useThresholds } from "@/lib/useThresholds";
import { useFx } from "@/lib/fx";
import HoverTip from "@/components/HoverTip";
import CompanyQualCard from "@/components/thesis/CompanyQualCard";
import { Star, RefreshCw, AlertCircle, Save, X, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ComposedChart, Legend } from "recharts";

const ratioRows = [
    ["Trailing P/E", "trailing_pe", null, "Precio entre beneficio neto últimos 12m. Mide cuántos años de beneficios actuales pagas por la acción. < 15 suele ser barato, 15-25 normal, > 30 caro. Ojo: muy dependiente del sector y del momento del ciclo."],
    ["Forward P/E", "forward_pe", null, "Precio entre beneficio esperado a 12m vista. Más útil que el trailing si la empresa va a crecer/decrecer mucho. Usa las estimaciones de analistas (revisa Forward P/E vs Trailing para ver si esperan mejora)."],
    ["PEG Ratio", "peg_ratio", null, "Forward P/E dividido por el crecimiento esperado de beneficios. < 1 sugiere infravalorado vs su crecimiento, 1-2 razonable, > 2 caro. Inventado por Peter Lynch."],
    ["P/B", "price_to_book", null, "Precio entre valor contable (patrimonio neto / acciones). < 1 cotiza por debajo del valor contable. Útil en bancos e industria pesada; poco útil en tech (mucho intangible no contabilizado)."],
    ["P/S", "price_to_sales", null, "Precio entre ventas por acción. Útil cuando no hay beneficio (early stage, ciclos bajos). < 1 barato, 1-3 normal, > 10 muy caro salvo crecimiento extremo."],
    ["EV/EBITDA", "ev_to_ebitda", null, "Enterprise Value (mcap + deuda neta) entre EBITDA. Más justo que P/E porque normaliza estructura de capital e impuestos. < 8 barato, 8-15 normal, > 20 caro."],
    ["EV/Revenue", "ev_to_revenue", null, "Enterprise Value entre ventas. Variante de P/S que incluye la deuda. Útil para empresas con poca rentabilidad o pre-beneficio."],
    ["ROE", "roe", "pct", "Return on Equity: beneficio neto / patrimonio. Cuánto rinde el capital propio. > 15% bueno, > 20% excelente. Cuidado: un ROE alto con mucha deuda puede ser frágil."],
    ["ROA", "roa", "pct", "Return on Assets: beneficio neto / activos totales. Mide eficiencia del balance completo. > 5% decente, > 10% muy bueno. Mejor que ROE para comparar empresas con apalancamientos distintos."],
    ["Profit margin", "profit_margin", "pct", "Beneficio neto / ingresos. > 10% saludable, > 20% excelente. Negativos = pérdidas. Compara siempre dentro del mismo sector (retail ~3%, software ~20%)."],
    ["Debt/Equity", "debt_to_equity", null, "Deuda total / patrimonio. < 0,5 conservador, 0,5-1,5 normal, > 2 apalancado. Depende mucho del sector (utilities y bancos toleran más)."],
    ["Current ratio", "current_ratio", null, "Activo corriente / pasivo corriente. Liquidez a corto plazo. > 1,5 saludable, < 1 riesgo. > 3 puede indicar caja parada sin uso productivo."],
    ["Dividend yield", "dividend_yield", "pct", "Dividendo anual / precio. 0% en growth, 2-4% normal, > 6% sospechoso (puede ser trampa de valor o dividendo en peligro)."],
    ["Beta", "beta", null, "Volatilidad relativa al mercado. 1 = se mueve como el índice, < 1 menos volátil (defensivas), > 1 más volátil (tech, ciclícas). Beta histórico no predice futuro perfectamente."],
    ["Analyst target", "target_mean_price", null, "Precio objetivo medio de los analistas que cubren el valor. Útil como referencia pero ten en cuenta que suelen ser optimistas y reaccionar tarde a malas noticias."],
];

// Growth metrics — especially relevant for small high-growth companies that are
// not yet profitable. Source: data.growth_metrics (computed in backend).
const growthRows = [
    ["Crec. Ingresos (YoY)", "revenue_growth_yoy", "pct", "Crecimiento de ingresos del último año fiscal sobre el anterior. Para growth real ≥ 20% es bueno, ≥ 40% excelente. < 0% es contracción."],
    ["CAGR Ingresos 3y (histórico)", "revenue_cagr_3y_hist", "pct", "Crecimiento anual compuesto histórico de los últimos años. Más estable que el YoY puntual; suaviza altibajos. Compara con el YoY para ver si la empresa acelera o desacelera."],
    ["Margen FCF (TTM)", "fcf_margin_ttm", "pct", "Free Cash Flow / Ingresos. Mide cuánto efectivo libre genera cada euro de ventas. > 15% sano, > 25% excepcional. Negativo = quema caja (típico en early-stage)."],
    ["Rule of 40", "rule_of_40", "rule40", "Suma de Crec. Ingresos % + Margen FCF %. Indicador clásico de salud para SaaS y growth: < 20 débil, 20-40 mejorable, > 40 saludable, > 60 excepcional. Equilibra crecimiento y rentabilidad."],
];

const marginRowsInfo = {
    gross_margin: "Ingresos − coste directo del producto, en %. Mide eficiencia productiva. > 40% suele ser bueno (escala, marca, software). En retail/manufactura puede ser <25% sin que sea mala señal.",
    operating_margin: "Beneficio operativo (antes de impuestos e intereses) / ingresos. Mide eficiencia del negocio core. > 15% sólido, > 25% excelente. Negativo = pierde dinero operando.",
};

// Common Yahoo Finance exchange codes → human-readable name.
// Lookup is case-insensitive and matches the full code returned by yfinance.
const EXCHANGE_NAMES = {
    NMS: "NASDAQ Global Select Market",
    NGM: "NASDAQ Global Market",
    NCM: "NASDAQ Capital Market",
    NAS: "NASDAQ",
    NASDAQ: "NASDAQ",
    NYQ: "New York Stock Exchange (NYSE)",
    NYE: "New York Stock Exchange (NYSE)",
    ASE: "NYSE American (antes AMEX)",
    PCX: "NYSE Arca",
    BATS: "Cboe BZX Exchange",
    BTS: "Cboe BZX Exchange",
    OTC: "OTC Markets (extrabursátil EE. UU.)",
    OQB: "OTCQB Venture Market",
    OQX: "OTCQX Best Market",
    PNK: "Pink Sheets (OTC)",
    LSE: "London Stock Exchange",
    LON: "London Stock Exchange",
    IOB: "International Order Book (LSE)",
    MCE: "Bolsa de Madrid (BME)",
    BME: "Bolsas y Mercados Españoles",
    GER: "Deutsche Börse Xetra",
    XETR: "Deutsche Börse Xetra",
    FRA: "Bolsa de Fráncfort",
    AMS: "Euronext Amsterdam",
    PAR: "Euronext París",
    EBR: "Euronext Bruselas",
    LIS: "Euronext Lisboa",
    MIL: "Borsa Italiana (Milán)",
    BIT: "Borsa Italiana (Milán)",
    SWX: "SIX Swiss Exchange",
    EBS: "SIX Swiss Exchange",
    VIE: "Wiener Börse (Viena)",
    STO: "Nasdaq Estocolmo",
    HEL: "Nasdaq Helsinki",
    CPH: "Nasdaq Copenhague",
    OSL: "Oslo Børs",
    WSE: "Bolsa de Varsovia",
    ATH: "Bolsa de Atenas",
    IST: "Bolsa de Estambul",
    JNB: "Johannesburg Stock Exchange",
    MOEX: "Bolsa de Moscú",
    BUE: "Bolsa de Buenos Aires",
    SAO: "B3 (Bolsa de São Paulo)",
    MEX: "Bolsa Mexicana de Valores",
    SGO: "Bolsa de Santiago de Chile",
    TOR: "Toronto Stock Exchange",
    TSX: "Toronto Stock Exchange",
    VAN: "TSX Venture Exchange",
    CNQ: "Canadian Securities Exchange",
    NEO: "NEO Exchange (Canadá)",
    ASX: "Australian Securities Exchange",
    NZE: "New Zealand Stock Exchange",
    TSE: "Tokyo Stock Exchange",
    TYO: "Tokyo Stock Exchange",
    OSE: "Osaka Exchange",
    HKG: "Bolsa de Hong Kong",
    HKE: "Bolsa de Hong Kong",
    SHH: "Bolsa de Shanghái",
    SHZ: "Bolsa de Shenzhen",
    KSC: "KOSPI (Bolsa de Seúl)",
    KOE: "KOSDAQ",
    TAI: "Bolsa de Taiwán",
    SES: "Bolsa de Singapur",
    KLS: "Bolsa de Malasia",
    JKT: "Bolsa de Indonesia",
    BSE: "Bombay Stock Exchange",
    NSI: "National Stock Exchange of India",
    BKK: "Bolsa de Tailandia",
    TLV: "Bolsa de Tel Aviv",
    SAU: "Tadawul (Bolsa Saudí)",
    DFM: "Bolsa de Dubái",
};
const exchangeFullName = (code) => {
    if (!code) return null;
    const key = String(code).toUpperCase().trim();
    return EXCHANGE_NAMES[key] || null;
};

// Health colour for a given ratio key + value. Returns {color, label} or null
// when no rule applies (e.g. Beta, Analyst target — they don't have a clean good/bad axis).
const G = "#1D7044", A = "#D97706", R = "#B32A22";
const ratioHealth = (key, v) => {
    if (v == null || isNaN(v)) return null;
    switch (key) {
        case "trailing_pe":
        case "forward_pe":
            if (v < 0) return { color: R, label: "Negativo (pérdidas)" };
            if (v < 15) return { color: G, label: "Barato" };
            if (v < 25) return { color: A, label: "Normal" };
            return { color: R, label: "Caro" };
        case "peg_ratio":
            if (v <= 0) return { color: R, label: "No utilizable" };
            if (v < 1) return { color: G, label: "Infravalorado vs crecimiento" };
            if (v < 2) return { color: A, label: "Razonable" };
            return { color: R, label: "Caro vs crecimiento" };
        case "price_to_book":
            if (v < 0) return { color: R, label: "Patrimonio negativo" };
            if (v < 1) return { color: G, label: "Por debajo de book value" };
            if (v < 3) return { color: A, label: "Normal" };
            return { color: R, label: "Alto" };
        case "price_to_sales":
            if (v < 1) return { color: G, label: "Barato" };
            if (v < 5) return { color: A, label: "Normal" };
            return { color: R, label: "Caro" };
        case "ev_to_ebitda":
            if (v < 0) return { color: R, label: "EBITDA negativo" };
            if (v < 8) return { color: G, label: "Barato" };
            if (v < 15) return { color: A, label: "Normal" };
            return { color: R, label: "Caro" };
        case "ev_to_revenue":
            if (v < 2) return { color: G, label: "Barato" };
            if (v < 10) return { color: A, label: "Normal" };
            return { color: R, label: "Caro" };
        case "roe":
            if (v < 0) return { color: R, label: "Pérdidas" };
            if (v < 0.08) return { color: R, label: "Bajo" };
            if (v < 0.15) return { color: A, label: "Aceptable" };
            return { color: G, label: "Bueno" };
        case "roa":
            if (v < 0) return { color: R, label: "Pérdidas" };
            if (v < 0.02) return { color: R, label: "Bajo" };
            if (v < 0.05) return { color: A, label: "Aceptable" };
            return { color: G, label: "Bueno" };
        case "profit_margin":
            if (v < 0) return { color: R, label: "Pérdidas" };
            if (v < 0.05) return { color: A, label: "Bajo" };
            if (v < 0.10) return { color: A, label: "Aceptable" };
            return { color: G, label: "Bueno" };
        case "debt_to_equity":
            // yfinance returns this as % (e.g. 150 means 1.5). Normalize.
            { const vv = v > 10 ? v / 100 : v;
            if (vv < 0.5) return { color: G, label: "Conservador" };
            if (vv < 1.5) return { color: A, label: "Normal" };
            return { color: R, label: "Apalancado" }; }
        case "current_ratio":
            if (v < 1) return { color: R, label: "Riesgo liquidez" };
            if (v < 1.5) return { color: A, label: "Justo" };
            if (v <= 3) return { color: G, label: "Saludable" };
            return { color: A, label: "Caja parada" };
        case "dividend_yield":
            if (v === 0) return null;
            if (v < 0.02) return { color: A, label: "Bajo" };
            if (v <= 0.05) return { color: G, label: "Saludable" };
            if (v <= 0.07) return { color: A, label: "Alto" };
            return { color: R, label: "Posible trampa" };
        case "gross_margin":
            if (v < 0) return { color: R, label: "Negativo" };
            if (v < 0.20) return { color: R, label: "Bajo" };
            if (v < 0.40) return { color: A, label: "Aceptable" };
            return { color: G, label: "Bueno" };
        case "operating_margin":
            if (v < 0) return { color: R, label: "Pérdidas operativas" };
            if (v < 0.05) return { color: A, label: "Bajo" };
            if (v < 0.15) return { color: A, label: "Aceptable" };
            return { color: G, label: "Bueno" };
        case "revenue_growth_yoy":
        case "revenue_cagr_3y_hist":
            if (v < 0) return { color: R, label: "Contracción" };
            if (v < 0.05) return { color: A, label: "Bajo" };
            if (v < 0.20) return { color: A, label: "Aceptable" };
            return { color: G, label: "Alto" };
        case "fcf_margin_ttm":
            if (v < 0) return { color: R, label: "Quema caja" };
            if (v < 0.05) return { color: A, label: "Bajo" };
            if (v < 0.15) return { color: A, label: "Aceptable" };
            return { color: G, label: "Bueno" };
        case "rule_of_40":
            if (v < 20) return { color: R, label: "Débil" };
            if (v < 40) return { color: A, label: "Mejorable" };
            if (v < 60) return { color: G, label: "Saludable" };
            return { color: G, label: "Excepcional" };
        default:
            return null;
    }
};

export default function Company() {
    const { ticker } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    // Watchlist state
    const [wlEntry, setWlEntry] = useState(null); // {ticker, mode, overrides, saved_at} or null
    const [pfEntry, setPfEntry] = useState(null); // portfolio position (also carries optional overrides)
    const [confirmOverwrite, setConfirmOverwrite] = useState(false);
    const [confirmOverwritePortfolio, setConfirmOverwritePortfolio] = useState(false);
    const [confirmRefresh, setConfirmRefresh] = useState(false);

    // Inputs lifecycle
    const [autoInputs, setAutoInputs] = useState(null);    // pure Yahoo values
    const [inputs, setInputs] = useState(null);            // current shown values (auto + saved overrides + session edits)
    const [sessionEdits, setSessionEdits] = useState({});  // {field: true} for fields edited this session
    const [customRatios, setCustomRatios] = useState(null);
    const [summaryEs, setSummaryEs] = useState(null); // translated description (null = not yet loaded)
    const [translating, setTranslating] = useState(false);
    const [ratioHistory, setRatioHistory] = useState([]); // [{year, price, ratio_compra_pct, ratio_venta_pct}]
    useThresholds(); // subscribe to threshold changes so colours/labels live-update
    const { display: displayCur, convert: fxConvert } = useFx();

    const hasSessionEdits = Object.keys(sessionEdits).length > 0;

    const load = useCallback(async (refresh = false, ignoreOverrides = false) => {
        try {
            setLoading(true); setError(null);
            const d = await getCompany(ticker, refresh);
            const auto = autoInputsFromData(d);
            const entry = ignoreOverrides ? null : getWatchlistEntry(ticker);
            const pf = ignoreOverrides ? null : getPortfolioEntry(ticker);
            setWlEntry(ignoreOverrides ? (getWatchlistEntry(ticker) || null) : entry);
            setPfEntry(ignoreOverrides ? (getPortfolioEntry(ticker) || null) : pf);
            // Apply saved overrides on top of auto values. Watchlist takes priority
            // over portfolio when both have overrides (user-facing convention).
            const merged = { ...auto };
            const savedOverrides = (entry && entry.overrides) || (pf && pf.overrides) || null;
            if (savedOverrides) {
                for (const [k, v] of Object.entries(savedOverrides)) {
                    if (k === "current_price") continue;
                    merged[k] = v;
                }
            }
            setData(d);
            setAutoInputs(auto);
            setInputs(merged);
            setSessionEdits({});
            setCustomRatios(computeCustomRatios(merged));
        } catch (e) {
            setError(e?.response?.data?.detail || e.message || "Error al cargar");
        } finally { setLoading(false); }
    }, [ticker]);

    useEffect(() => { load(); }, [load]);

    // Fetch Spanish translation lazily once the company is loaded and has a summary.
    // The backend caches per ticker+source_hash so subsequent visits are instant.
    useEffect(() => {
        if (!data?.long_business_summary || !data?.ticker) return;
        let cancelled = false;
        setSummaryEs(null);
        setTranslating(true);
        translateSummary(data.ticker)
            .then(r => { if (!cancelled) setSummaryEs(r?.summary_es || null); })
            .catch(() => { /* fall back silently to the English version */ })
            .finally(() => { if (!cancelled) setTranslating(false); });
        return () => { cancelled = true; };
    }, [data?.ticker, data?.long_business_summary]);

    // Fetch yearly ratio history (POC/POV + price trend) once company is loaded.
    useEffect(() => {
        if (!data?.ticker) return;
        let cancelled = false;
        setRatioHistory([]);
        api.get(`/company/${encodeURIComponent(data.ticker)}/ratio-history`)
            .then(r => { if (!cancelled) setRatioHistory(r.data?.series || []); })
            .catch(() => { /* silently ignore — chart will just hide */ });
        return () => { cancelled = true; };
    }, [data?.ticker]);

    // Navigation guard for unsaved session edits.
    // - Internal links: intercept anchor clicks; show modal.
    // - Tab close / external nav: beforeunload (below).
    const navigate = useNavigate();
    const [pendingNav, setPendingNav] = useState(null);

    useEffect(() => {
        if (!hasSessionEdits) return;
        const handler = (e) => {
            const anchor = e.target.closest && e.target.closest("a");
            if (!anchor) return;
            const href = anchor.getAttribute("href");
            if (!href) return;
            if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto")) return;
            if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            if (href === window.location.pathname) return;
            e.preventDefault();
            e.stopPropagation();
            setPendingNav(href);
        };
        document.addEventListener("click", handler, true);
        return () => document.removeEventListener("click", handler, true);
    }, [hasSessionEdits]);

    // beforeunload (tab close, refresh, external nav)
    useEffect(() => {
        const handler = (e) => {
            if (hasSessionEdits) {
                e.preventDefault();
                e.returnValue = "";
                return "";
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasSessionEdits]);

    const handleRefresh = () => {
        // Refresh re-fetches from Yahoo AND discards any saved overrides for this view.
        // If there's anything to lose, ask first.
        const hasSavedOverrides = wlEntry && wlEntry.overrides && Object.keys(wlEntry.overrides).length > 0;
        if (hasSessionEdits || hasSavedOverrides) {
            setConfirmRefresh(true);
            return;
        }
        doRefresh();
    };

    const doRefresh = async () => {
        setRefreshing(true);
        // If the ticker has saved overrides, downgrade the watchlist entry to "auto" (overrides removed).
        const hasSavedOverrides = wlEntry && wlEntry.overrides && Object.keys(wlEntry.overrides).length > 0;
        if (hasSavedOverrides) {
            saveToWatchlist(ticker, null); // resets entry to mode=auto, no overrides
        }
        await load(true, true); // refresh from Yahoo + ignore overrides
        setRefreshing(false);
        setConfirmRefresh(false);
        toast.success("Datos restaurados desde Yahoo");
    };

    // "Save snapshot" — captures current overrides (diff vs auto) and stores in watchlist
    const handleSaveToWatchlist = () => {
        if (!inputs || !autoInputs) return;
        const overrides = computeOverrides(inputs, autoInputs);
        // If already in watchlist, ask before overwriting
        if (wlEntry && (wlEntry.overrides || hasSessionEdits)) {
            setConfirmOverwrite(true);
            return;
        }
        const list = saveToWatchlist(ticker, overrides);
        const newEntry = list.find(e => e.ticker === ticker.toUpperCase());
        setWlEntry(newEntry);
        setSessionEdits({});
        toast.success(Object.keys(overrides).length ? "Guardada con tus overrides" : "Añadida a watchlist");
    };

    const doConfirmOverwrite = () => {
        const overrides = computeOverrides(inputs, autoInputs);
        const list = saveToWatchlist(ticker, overrides);
        const newEntry = list.find(e => e.ticker === ticker.toUpperCase());
        setWlEntry(newEntry);
        setSessionEdits({});
        setConfirmOverwrite(false);
        toast.success("Watchlist actualizada");
    };

    const handleRemoveFromWatchlist = () => {
        removeFromWatchlist(ticker);
        setWlEntry(null);
        toast("Quitada de watchlist");
    };

    const handleSaveToPortfolio = () => {
        const overrides = computeOverrides(inputs, autoInputs);
        // If already in portfolio with manual snapshot or session edits, prompt overwrite
        if (pfEntry && (pfEntry.overrides || hasSessionEdits)) {
            setConfirmOverwritePortfolio(true);
            return;
        }
        const list = savePortfolioOverrides(ticker, Object.keys(overrides).length ? overrides : null);
        const newEntry = list.find(e => (e.ticker || "").toUpperCase() === ticker.toUpperCase());
        setPfEntry(newEntry);
        setSessionEdits({});
        toast.success(Object.keys(overrides).length ? "Añadida a cartera con tus overrides" : "Añadida a cartera");
    };

    const doConfirmOverwritePortfolio = () => {
        const overrides = computeOverrides(inputs, autoInputs);
        const list = savePortfolioOverrides(ticker, Object.keys(overrides).length ? overrides : null);
        const newEntry = list.find(e => (e.ticker || "").toUpperCase() === ticker.toUpperCase());
        setPfEntry(newEntry);
        setSessionEdits({});
        setConfirmOverwritePortfolio(false);
        toast.success("Cartera actualizada");
    };

    const handleRemoveFromPortfolio = () => {
        removePosition(ticker);
        setPfEntry(null);
        toast("Quitada de cartera");
    };

    const updateInput = (key, num) => {
        setInputs(prev => {
            const next = { ...prev, [key]: num };
            // Track as session edit only if it differs from the loaded state
            const savedFromWl = wlEntry?.overrides?.[key];
            const savedFromPf = pfEntry?.overrides?.[key];
            const loaded = (savedFromWl !== undefined) ? savedFromWl
                         : (savedFromPf !== undefined) ? savedFromPf
                         : autoInputs?.[key];
            setSessionEdits(prevEdits => {
                const ne = { ...prevEdits };
                if (!valuesEqual(num, loaded)) ne[key] = true;
                else delete ne[key];
                return ne;
            });
            setCustomRatios(computeCustomRatios(next));
            return next;
        });
    };

    const handleRecalc = async () => {
        // Recompute via backend for parity check (and to keep breakdown in sync)
        try {
            const r = await recalc(ticker, inputs);
            setCustomRatios(r);
            toast.success("Ratios recalculados");
        } catch (e) { toast.error("Error al recalcular"); }
    };

    const handleReset = () => {
        if (!data || !autoInputs) return;
        // Reset to the "loaded" state: auto + saved overrides (watchlist preferred)
        const merged = { ...autoInputs };
        const savedOverrides = wlEntry?.overrides || pfEntry?.overrides || null;
        if (savedOverrides) {
            for (const [k, v] of Object.entries(savedOverrides)) {
                if (k === "current_price") continue;
                merged[k] = v;
            }
        }
        setInputs(merged);
        setSessionEdits({});
        setCustomRatios(computeCustomRatios(merged));
    };

    // Determine status of each input field for color coding
    const fieldStatus = (key) => {
        if (sessionEdits[key]) return "session"; // unsaved session edit — amber
        if (wlEntry?.overrides && wlEntry.overrides[key] !== undefined) return "saved";
        if (pfEntry?.overrides && pfEntry.overrides[key] !== undefined) return "saved";
        return "auto"; // Yahoo default — neutral
    };

    if (loading) return <div className="py-20 text-center font-mono" data-testid="loading">Cargando {ticker}…</div>;
    if (error) return (
        <div className="border border-[#B32A22] bg-white p-8" data-testid="error-state">
            <AlertCircle className="text-[#B32A22] mb-2" />
            <div className="font-serif text-2xl mb-2">No se pudo cargar {ticker}</div>
            <div className="text-sm text-[#4A4A4A] mb-4">{error}</div>
            <Link to="/" className="btn-ghost">← Volver al inicio</Link>
        </div>
    );
    if (!data) return null;

    const cr = customRatios || {};
    const nativeCur = data.currency || "USD";
    // Effective currency for ALL price/monetary displays
    const cur = (displayCur === "NATIVE" || !displayCur) ? nativeCur : displayCur;
    // Convert a value from native currency to display currency; null-safe.
    const convertCur = (v) => (v == null || isNaN(v)) ? v : fxConvert(v, nativeCur);

    const fyLabel = `FY${new Date().getFullYear() + 1} con base TTM`;

    // Determine if user has edited the 2y projection vs the auto value (small epsilon to avoid float jitter)
    const isEdited = (a, b) => {
        if (a == null || b == null) return false;
        if (a === 0 && b === 0) return false;
        const diff = Math.abs(a - b);
        const scale = Math.max(Math.abs(a), Math.abs(b), 1);
        return diff / scale > 0.001;
    };
    const revEdited = isEdited(inputs?.revenue_2y, data.auto_projections.revenue_2y);
    const fcfEdited = isEdited(inputs?.fcf_2y, data.auto_projections.fcf_2y);

    // Geometric midpoint (smooth compound growth) for the intermediate year.
    // Falls back to linear midpoint if either value is non-positive.
    const interpolate = (a, b) => {
        if (a == null || b == null) return null;
        if (a > 0 && b > 0) return Math.sqrt(a * b);
        return (a + b) / 2;
    };

    const buildChartData = (history, proj1Auto, proj2Auto, userProj2, userEdited, bridge = true) => {
        if (!history || history.length === 0) return [];
        const out = history.map(p => ({
            year: p.date.slice(0, 4),
            historical: p.value / 1e9,
            projection: null,
            kind: "real",
            value: p.value / 1e9,
        }));
        const last = out[out.length - 1];
        if (bridge) last.projection = last.historical;
        const lastYear = parseInt(last.year, 10) || new Date().getFullYear();
        const lastVal = last.historical;

        // Use user value when edited; otherwise the auto projection.
        const proj2 = userEdited ? userProj2 : proj2Auto;
        // For +1y: if user edited the +2y, interpolate between last real and user proj2 to avoid a visual jump.
        // Otherwise use the model's auto +1y projection.
        const proj1 = userEdited
            ? (lastVal != null && proj2 != null ? interpolate(lastVal, proj2 / 1e9) : null)
            : (proj1Auto != null ? proj1Auto / 1e9 : null);

        if (proj1 != null && !isNaN(proj1)) {
            out.push({ year: String(lastYear + 1) + "E", historical: null, projection: proj1, kind: "proj", value: proj1 });
        }
        if (proj2 != null && !isNaN(proj2)) {
            const v = userEdited ? proj2 / 1e9 : proj2 / 1e9;
            out.push({ year: String(lastYear + 2) + "E", historical: null, projection: v, kind: "proj", value: v });
        }
        return out;
    };

    const revChart = buildChartData(data.revenue_history, data.auto_projections.revenue_1y, data.auto_projections.revenue_2y, inputs?.revenue_2y, revEdited, true);
    const fcfChart = buildChartData(data.fcf_history, data.auto_projections.fcf_1y, data.auto_projections.fcf_2y, inputs?.fcf_2y, fcfEdited, false);

    // Detect anomalies in POC/POV and explain them based on the actual inputs.
    // Each item also contributes suggested corrections (clipping rules) that the
    // user can apply in one click. Corrections are deduped by field, keeping the
    // first one (anomalies are checked in order of severity).
    const { pocPovAnomalies, pocPovCorrections } = (() => {
        const anomalies = [];
        const corrByField = new Map(); // field -> {field, from, to, reason}
        const addCorr = (field, from, to, reason) => {
            if (corrByField.has(field)) return;
            corrByField.set(field, { field, from, to, reason });
        };
        if (!cr || !inputs || cr.poc == null || cr.pov == null) {
            return { pocPovAnomalies: anomalies, pocPovCorrections: [] };
        }
        const poc = cr.poc, pov = cr.pov;
        const b = cr.breakdown || {};
        const gm = inputs.gross_margin;
        const om = inputs.operating_margin;
        const revC = inputs.revenue_cagr_4y;
        const fcfC = inputs.fcf_cagr_4y;
        const rev2y = inputs.revenue_2y;
        const xRaw = b.x_raw_pct;

        // POC ≤ 0 — pinpoint which factor flips the sign.
        if (poc <= 0) {
            const reasons = [];
            if (rev2y != null && rev2y < 0) {
                reasons.push(`Ingresos proyectados a 2y son negativos (${fmtCompact(rev2y)}). El primer factor de la fórmula (Ingresos/acción) ya nace negativo.`);
                // No safe auto-fix for negative revenue; user must decide.
            }
            if (gm != null && (1 + gm) < 0) {
                reasons.push(`Margen bruto = ${(gm * 100).toFixed(1)}% → factor (1 + margen) = ${(1 + gm).toFixed(2)} es negativo.`);
                addCorr("gross_margin", gm, 0, "Clip margen bruto a 0% (neutraliza el factor sin invertirlo).");
            }
            if (xRaw != null && xRaw < -100) {
                reasons.push(`(FCF 2y − Deuda neta) / MCap = ${xRaw.toFixed(1)}%. Como es < −100%, el factor ajustado (1 + x/100 = ${(1 + xRaw / 100).toFixed(2)}) es negativo. Suele indicar deuda neta muy alta o FCF muy negativo respecto a la capitalización.`);
                // Heuristic: reduce net_debt so that x_raw becomes -50% (penaliza pero no anula).
                if (inputs.fcf_2y != null && inputs.market_cap != null) {
                    const safeNetDebt = inputs.fcf_2y + 0.5 * inputs.market_cap;
                    if (Number.isFinite(safeNetDebt)) {
                        addCorr("net_debt", inputs.net_debt, safeNetDebt, "Recorta la deuda neta para que x_raw = −50% (penaliza pero no colapsa).");
                    }
                }
            }
            if (revC != null && (1 + revC) < 0) {
                reasons.push(`CAGR ingresos 4y = ${(revC * 100).toFixed(1)}% → factor (1 + CAGR) negativo.`);
                addCorr("revenue_cagr_4y", revC, -0.30, "Clip CAGR ingresos a −30% (suelo razonable para empresas en deterioro).");
            }
            if (fcfC != null && (1 + fcfC) < 0) {
                reasons.push(`CAGR FCF 4y = ${(fcfC * 100).toFixed(1)}% → factor (1 + CAGR) negativo.`);
                addCorr("fcf_cagr_4y", fcfC, -0.30, "Clip CAGR FCF a −30% (suelo razonable).");
            }
            if (!reasons.length) reasons.push("La combinación de factores deja un POC ≤ 0. Revisa manualmente Ingresos 2y, márgenes y CAGRs.");
            anomalies.push({
                title: `POC ≤ 0 → ${fmtPrice(convertCur(poc), cur)}`,
                detail: "El precio objetivo de compra no es utilizable porque uno o más factores de la fórmula están colapsando el resultado:",
                bullets: reasons,
            });
        }

        // POV < POC — operating margin is dragging POV below POC.
        if (poc > 0 && pov > 0 && pov < poc) {
            const yPct = (om ?? 0) * 100;
            anomalies.push({
                title: `POV (${fmtPrice(convertCur(pov), cur)}) < POC (${fmtPrice(convertCur(poc), cur)})`,
                detail: "Tu precio objetivo de venta queda por debajo del de compra, lo que invierte la lógica esperada. Causa concreta según la fórmula:",
                bullets: [
                    `Margen operativo = ${yPct.toFixed(2)}% → factor ajustado y = ${b.y_factor != null ? b.y_factor.toFixed(3) : "—"} (cuando y < 0%, el factor se aplica como 1 + y/100, que es < 1, así que POV = POC × y_factor termina menor que POC).`,
                    "Sugerencia: si crees que la empresa va a recuperar márgenes, edita manualmente 'Margen operativo' a un valor positivo para que POV vuelva a quedar por encima de POC.",
                ],
            });
            addCorr("operating_margin", om, 0, "Clip margen operativo a 0% (neutraliza el factor, POV = POC).");
        }

        // POV ≤ 0 with POC > 0 — rare, only if operating margin < -100%
        if (poc > 0 && pov <= 0) {
            const yPct = (om ?? 0) * 100;
            anomalies.push({
                title: `POV ≤ 0 → ${fmtPrice(convertCur(pov), cur)}`,
                detail: "El precio objetivo de venta colapsa por culpa del margen operativo:",
                bullets: [
                    `Margen operativo = ${yPct.toFixed(2)}%. Como es < −100%, el factor (1 + y/100) es ≤ 0 y arrastra POV a territorio negativo.`,
                    "Edita manualmente 'Margen operativo' a un valor más realista (ej. la media histórica del sector) para obtener un POV válido.",
                ],
            });
            addCorr("operating_margin", om, 0, "Clip margen operativo a 0% (neutraliza el factor, POV = POC).");
        }

        // Extreme upside (>1000%) — opportunity or value trap.
        const rc = cr.ratio_compra_pct, rv = cr.ratio_venta_pct;
        const extremeRC = rc != null && rc > 1000;
        const extremeRV = rv != null && rv > 1000;
        if (extremeRC || extremeRV) {
            const which = extremeRC && extremeRV ? "Ratio Compra y Ratio Venta" : extremeRC ? "Ratio Compra" : "Ratio Venta";
            anomalies.push({
                title: `${which} > +1000%`,
                detail: "Un upside extremadamente elevado puede tener dos lecturas opuestas. Antes de actuar, pregúntate cuál crees que aplica aquí:",
                bullets: [
                    "🟢 Oportunidad real: el mercado está penalizando temporalmente a una empresa con buenos fundamentales (sector deprimido, evento puntual, noticia negativa exagerada). En este caso, los datos automáticos sí reflejan el negocio y los CAGRs son fiables.",
                    "🔴 Trampa de valor: el mercado está descontando un deterioro estructural que la fórmula no capta (deuda escondida, regulación, disrupción del producto, contabilidad agresiva, riesgo de quiebra). Los datos del pasado mienten sobre el futuro.",
                    "Sugerencia: revisa los avisos sobre proyecciones automáticas, compara con el precio objetivo medio de analistas (sección 'Ratios clásicos'), y si los CAGRs son anormalmente altos, recórtalos manualmente para ver si el upside aguanta.",
                ],
            });
        }
        // Symmetric: extreme downside (<-1000%) — likely garbage inputs.
        if ((rc != null && rc < -1000) || (rv != null && rv < -1000)) {
            anomalies.push({
                title: `Ratio < −1000%`,
                detail: "Un downside extremo casi siempre indica que algún input está descalibrado (no es una señal de venta real):",
                bullets: [
                    "Lo más habitual: el POC es negativo o casi cero por culpa de un factor colapsado. Mira las anomalías de arriba para identificar el factor.",
                    "Acción: usa 'Auto-corregir' o edita manualmente los inputs sospechosos antes de tomar conclusiones.",
                ],
            });
        }

        return { pocPovAnomalies: anomalies, pocPovCorrections: Array.from(corrByField.values()) };
    })();

    const applyAutoCorrections = () => {
        if (!pocPovCorrections.length) return;
        setInputs(prev => {
            const next = { ...prev };
            for (const c of pocPovCorrections) next[c.field] = c.to;
            setSessionEdits(prevEdits => {
                const ne = { ...prevEdits };
                for (const c of pocPovCorrections) {
                    const loaded = wlEntry?.overrides?.[c.field] !== undefined ? wlEntry.overrides[c.field] : autoInputs?.[c.field];
                    if (!valuesEqual(c.to, loaded)) ne[c.field] = true;
                    else delete ne[c.field];
                }
                return ne;
            });
            setCustomRatios(computeCustomRatios(next));
            return next;
        });
        toast.success(`${pocPovCorrections.length} input(s) auto-corregido(s). Revisa, edita o guarda.`);
    };

    // Map field key to its display label (used in the corrections preview)
    const fieldLabels = {
        gross_margin: "Margen bruto",
        operating_margin: "Margen operativo",
        revenue_cagr_4y: "CAGR ingresos 4y",
        fcf_cagr_4y: "CAGR FCF 4y",
        net_debt: "Deuda neta",
        revenue_2y: "Ingresos proyectados 2y",
        fcf_2y: "FCF proyectado 2y",
    };
    const fmtCorrValue = (field, v) => {
        if (v == null || isNaN(v)) return "—";
        if (field === "gross_margin" || field === "operating_margin" || field === "revenue_cagr_4y" || field === "fcf_cagr_4y") return `${(v * 100).toFixed(2)}%`;
        return fmtCompact(v);
    };

    return (
        <div data-testid="company-page">
            {/* Header */}
            <div className="border border-black bg-white p-6 mb-6" data-testid="company-header">
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <HoverTip text={`${exchangeFullName(data.exchange) || data.exchange}${data.currency ? ` · Moneda: ${data.currency}` : ""}${data.sector ? ` · Sector: ${data.sector}` : ""}`}>
                            <div className="overline text-[#4A4A4A] cursor-help" data-testid="exchange-code">
                                {data.exchange}
                                {" · "}{data.currency}{data.sector ? ` · ${data.sector}` : ""}
                            </div>
                        </HoverTip>
                        <h1 className="font-serif text-4xl sm:text-5xl tracking-tight mt-1" data-testid="company-name">{data.name}</h1>
                        <div className="font-mono text-lg text-[#052049] mt-1" data-testid="company-ticker">{data.ticker}</div>
                    </div>
                    <div className="text-right">
                        <div className="overline text-[#4A4A4A]">Precio actual</div>
                        <div className="font-mono text-4xl sm:text-5xl font-medium" data-testid="company-price">{fmtPrice(convertCur(data.current_price), cur)}</div>
                        <div className="text-xs text-[#4A4A4A] font-mono mt-1">MCap {fmtNum(convertCur(data.market_cap))} {cur !== nativeCur && <span className="text-[10px]">({cur})</span>}</div>
                    </div>
                </div>
                <div className="flex gap-2 mt-4 flex-wrap items-center">
                    {wlEntry ? (
                        <>
                            <button
                                onClick={handleSaveToWatchlist}
                                className={hasSessionEdits ? "btn-primary flex items-center gap-2" : "btn-ghost flex items-center gap-2"}
                                data-testid="watchlist-save"
                                title={hasSessionEdits ? "Guardar cambios actuales en watchlist" : "Ya guardada"}
                            >
                                <Save size={14} /> {hasSessionEdits ? "Guardar en watchlist" : "En watchlist"}
                            </button>
                            <button onClick={handleRemoveFromWatchlist} className="btn-ghost flex items-center gap-2" data-testid="watchlist-remove">
                                <X size={14} /> Quitar de watchlist
                            </button>
                            {wlEntry.mode === "manual" && (
                                <span className="overline px-2 py-1 border border-[#1D7044] text-[#1D7044] bg-white" data-testid="manual-badge">MANUAL</span>
                            )}
                        </>
                    ) : (
                        <button onClick={handleSaveToWatchlist} className="btn-ghost flex items-center gap-2" data-testid="watchlist-add">
                            <Star size={14} /> Añadir a watchlist
                        </button>
                    )}

                    {pfEntry ? (
                        <>
                            <button
                                onClick={handleSaveToPortfolio}
                                className={hasSessionEdits ? "btn-primary flex items-center gap-2" : "btn-ghost flex items-center gap-2"}
                                data-testid="portfolio-save"
                                title={hasSessionEdits ? "Guardar cambios actuales en cartera" : "Ya en cartera"}
                            >
                                <Save size={14} /> {hasSessionEdits ? "Guardar en cartera" : "En cartera"}
                            </button>
                            <button onClick={handleRemoveFromPortfolio} className="btn-ghost flex items-center gap-2" data-testid="portfolio-remove-btn">
                                <X size={14} /> Quitar de cartera
                            </button>
                            {pfEntry.mode === "manual" && (
                                <span className="overline px-2 py-1 border border-[#1D7044] text-[#1D7044] bg-white" data-testid="manual-badge-pf">MANUAL</span>
                            )}
                        </>
                    ) : (
                        <button onClick={handleSaveToPortfolio} className="btn-ghost flex items-center gap-2" data-testid="portfolio-add-btn">
                            <Briefcase size={14} /> Añadir a cartera
                        </button>
                    )}

                    <button onClick={handleRefresh} className="btn-ghost flex items-center gap-2" data-testid="refresh-button" disabled={refreshing}>
                        <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refrescar
                    </button>
                    {hasSessionEdits && (
                        <span className="text-xs font-mono text-[#D97706]" data-testid="unsaved-indicator" title="Pulsa 'Guardar en watchlist' o 'Guardar en cartera' para conservar estos cambios">
                            ● Cambios sin guardar, añade a cartera o watchlist
                        </span>
                    )}
                </div>
                {data.long_business_summary && (
                    <div className="text-sm text-[#4A4A4A] mt-4 max-w-3xl" data-testid="business-summary">
                        {summaryEs ? (
                            <p>{summaryEs}</p>
                        ) : translating ? (
                            <>
                                <p className="italic">{data.long_business_summary}</p>
                                <p className="text-[10px] font-mono text-[#4A4A4A]/70 mt-1">Traduciendo al español…</p>
                            </>
                        ) : (
                            <p>{data.long_business_summary}</p>
                        )}
                    </div>
                )}
            </div>

            {/* Qualitative thesis bridge (Thesis Engine ↔ quant dashboard) */}
            <CompanyQualCard ticker={data.ticker} />

            {/* Hero KPIs - Ratio Compra & Venta */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border border-black mb-6" data-testid="hero-kpis">
                <div className="bg-white p-6 md:border-r border-black border-b md:border-b-0" data-testid="ratio-compra-card">
                    <div className="overline text-[#4A4A4A]">Ratio de Compra</div>
                    <div className="font-mono text-5xl sm:text-6xl font-medium mt-2" style={{ color: ratioColor(cr.ratio_compra_pct) }} data-testid="ratio-compra-value">
                        {fmtPctSigned(cr.ratio_compra_pct)}
                    </div>
                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                        <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(cr.ratio_compra_pct) }} data-testid="signal-compra">{signalLabel(cr.ratio_compra_pct)}</span>
                        <HoverTip text="POC = Precio Objetivo de Compra. Precio al que la acción te parecería barata según tu fórmula.">
                            <span className="text-lg font-mono font-semibold text-black underline decoration-dotted underline-offset-2 cursor-help" data-testid="poc-label">POC {cr.poc != null ? fmtPrice(convertCur(cr.poc), cur) : "—"}</span>
                        </HoverTip>
                    </div>
                    <div className="text-xs text-[#4A4A4A] mt-3">Upside hasta el precio objetivo de compra.</div>
                </div>
                <div className="bg-white p-6" data-testid="ratio-venta-card">
                    <div className="overline text-[#4A4A4A]">Ratio de Venta</div>
                    <div className="font-mono text-5xl sm:text-6xl font-medium mt-2" style={{ color: ratioColor(cr.ratio_venta_pct, "venta") }} data-testid="ratio-venta-value">
                        {fmtPctSigned(cr.ratio_venta_pct)}
                    </div>
                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                        <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(cr.ratio_venta_pct, "venta") }} data-testid="signal-venta">{signalLabel(cr.ratio_venta_pct, "venta")}</span>
                        <HoverTip text="POV = Precio Objetivo de Venta. Precio al que la acción te parecería cara según tu fórmula.">
                            <span className="text-lg font-mono font-semibold text-black underline decoration-dotted underline-offset-2 cursor-help" data-testid="pov-label">POV {cr.pov != null ? fmtPrice(convertCur(cr.pov), cur) : "—"}</span>
                        </HoverTip>
                    </div>
                    <div className="text-xs text-[#4A4A4A] mt-3">Upside hasta el precio objetivo de venta.</div>
                </div>
            </div>

            {cr.missing_inputs && cr.missing_inputs.length > 0 && (
                <div className="border border-[#D97706] bg-white p-3 mb-6 text-xs font-mono flex items-center gap-2" data-testid="missing-inputs-warning">
                    <AlertCircle size={14} className="text-[#D97706]" />
                    Faltan datos para calcular: {cr.missing_inputs.join(", ")}. Edita manualmente los inputs abajo.
                </div>
            )}

            {pocPovAnomalies.length > 0 && (
                <div className="border border-[#B32A22] bg-white p-4 mb-6" data-testid="poc-pov-anomalies">
                    <div className="flex items-center gap-2 mb-3">
                        <AlertCircle size={16} className="text-[#B32A22]" />
                        <div className="overline text-[#B32A22]">Precio objetivo anómalo — revisa los inputs</div>
                    </div>
                    <div className="space-y-3">
                        {pocPovAnomalies.map((a, i) => (
                            <div key={i} data-testid={`anomaly-${i}`} className="border-l-2 border-[#B32A22] pl-3">
                                <div className="font-mono text-sm font-semibold text-black">{a.title}</div>
                                <div className="text-xs text-[#4A4A4A] mt-1">{a.detail}</div>
                                <ul className="text-xs text-[#4A4A4A] mt-1 list-disc pl-5 space-y-1 font-sans">
                                    {a.bullets.map((b, j) => <li key={j}>{b}</li>)}
                                </ul>
                            </div>
                        ))}
                    </div>
                    {pocPovCorrections.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-black/10" data-testid="auto-correct-section">
                            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                                <div>
                                    <div className="overline text-[#1D7044]">Auto-corregir</div>
                                    <div className="text-xs text-[#4A4A4A]">Aplica heurísticas sensatas a los inputs problemáticos. Quedará marcado como edición sin guardar para que revises antes de guardarlo en watchlist.</div>
                                </div>
                                <button onClick={applyAutoCorrections} className="btn-primary whitespace-nowrap" data-testid="auto-correct-apply">
                                    Aplicar {pocPovCorrections.length} corrección{pocPovCorrections.length > 1 ? "es" : ""}
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                                {pocPovCorrections.map((c, idx) => (
                                    <div key={c.field} className="border border-black/10 bg-[#FAF6EE] p-2 text-xs font-mono" data-testid={`correction-${idx}`}>
                                        <div className="font-sans text-[#4A4A4A]">{fieldLabels[c.field] || c.field}</div>
                                        <div className="mt-1">
                                            <span className="text-[#B32A22]">{fmtCorrValue(c.field, c.from)}</span>
                                            <span className="mx-1 text-[#4A4A4A]">→</span>
                                            <span className="text-[#1D7044]">{fmtCorrValue(c.field, c.to)}</span>
                                        </div>
                                        <div className="text-[10px] text-[#4A4A4A] mt-1 font-sans">{c.reason}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {data.auto_projections?.flags && (() => {
                const f = data.auto_projections.flags;
                const warnings = [];
                if (f.revenue_analyst_suspicious) warnings.push("La estimación de ingresos de analistas parece anómala (muy distinta del último año real). Revisa Ingresos 2y.");
                if (f.revenue_projection_capped) warnings.push("El crecimiento implícito de ingresos se ha capado (>+50% o <−30%). La proyección puede ser conservadora.");
                if (f.fcf_history_has_negatives) warnings.push("El histórico de FCF contiene años negativos. La proyección usa un fallback simplificado.");
                if (f.fcf_projection_capped) warnings.push("El crecimiento histórico del FCF se ha capado para evitar extrapolaciones extremas.");
                if (f.fcf_cagr_fallback) warnings.push("CAGR del FCF a 4 años calculado por fallback (no por la fórmula estándar 2y atrás → 2y adelante).");
                if (f.revenue_cagr_fallback) warnings.push("CAGR de ingresos a 4 años calculado por fallback.");
                if (f.fcf_bottom_up_ni_suspicious) warnings.push("La estimación de Net Income de analistas parecía anómala (crecimiento >150% o <−50%). La proyección de FCF se ha hecho con el método histórico como precaución.");

                // TTM stale: explicit warning when the backend dropped Yahoo's TTM FCF and
                // switched to the last annual value as the base for the CAGR projection.
                const cb = data.auto_projections.cagr_breakdown;
                if (cb?.base_source === "annual_latest_yahoo_ttm_stale") {
                    const fmtBn = (n) => n == null ? "—" : (Math.abs(n) >= 1e9 ? `${(n/1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `${(n/1e6).toFixed(0)}M` : `${n.toFixed(0)}`);
                    const gap = (cb.fcf_ttm && cb.latest_annual) ? Math.round((1 - cb.fcf_ttm / cb.latest_annual) * 100) : null;
                    warnings.push(`Yahoo TTM FCF (${fmtBn(cb.fcf_ttm)}) cae ${gap != null ? gap + "% " : ""}por debajo del último FCF anual (${fmtBn(cb.latest_annual)}). Suele indicar dato Yahoo desactualizado o agregación trimestral incompleta. Por seguridad usamos el ANUAL como base por defecto; puedes cambiar a TTM con el botón si confías en el dato.`);
                }

                if (!warnings.length) return null;
                return (
                    <div className="border border-[#D97706] bg-white p-4 mb-6" data-testid="projection-warnings">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertCircle size={16} className="text-[#D97706]" />
                            <div className="overline text-[#D97706]">Avisos sobre las proyecciones automáticas</div>
                        </div>
                        <ul className="text-xs text-[#4A4A4A] space-y-1 list-disc pl-5 font-sans">
                            {warnings.map((w, i) => <li key={i} data-testid={`warning-${i}`}>{w}</li>)}
                        </ul>
                        <div className="text-[10px] text-[#4A4A4A] mt-2 font-mono">
                            Recomendación: revisa los inputs abajo y ajústalos a tu criterio antes de tomar decisiones.
                        </div>
                    </div>
                );
            })()}

            {/* Inputs grid */}
            <div className="border border-black bg-white mb-6" data-testid="inputs-section">
                <div className="p-4 border-b border-black flex justify-between items-center">
                    <div>
                        <div className="overline text-[#B32A22]">Tus fórmulas</div>
                        <div className="font-serif text-2xl">Inputs y proyecciones</div>
                    </div>
                    <div className="flex gap-2">
                        {hasSessionEdits && <button onClick={handleReset} className="btn-ghost" data-testid="reset-inputs">Descartar cambios</button>}
                        <button onClick={handleRecalc} className="btn-primary" data-testid="recalc-button">Recalcular</button>
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                        // [label, key, isPercent, magnitudeUnit, helperText]
                        ["Ingresos proyectados 2y", "revenue_2y", false, true, fyLabel],
                        ["FCF proyectado 2y", "fcf_2y", false, true, fyLabel],
                        ["Acciones en circulación", "shares_outstanding", false, true, ""],
                        ["Margen bruto", "gross_margin", true, false, ""],
                        ["Margen operativo", "operating_margin", true, false, ""],
                        ["Deuda neta", "net_debt", false, true, ""],
                        ["Capitalización", "market_cap", false, true, ""],
                        ["CAGR ingresos 4y", "revenue_cagr_4y", true, false, fyLabel],
                        ["CAGR FCF 4y", "fcf_cagr_4y", true, false, fyLabel],
                        ["Precio acción", "current_price", false, false, cur],
                    ].map(([label, key, isPercent, isMagnitude, hint]) => {
                        const status = fieldStatus(key);
                        const statusColor = status === "session" ? "#D97706" : status === "saved" ? "#1D7044" : "var(--text-primary)";
                        const statusLabel = status === "session" ? "Editado, sin guardar" : status === "saved" ? "Guardado por ti" : "Auto (Yahoo)";
                        const statusDot = status === "session" ? "●" : status === "saved" ? "●" : "○";
                        // Per user's spec: % suffix removed for margins & CAGRs; magnitude inputs
                        // are displayed in compact form (M/B/T) when not focused, expanding to the
                        // full number on focus for precise editing.
                        const v = inputs?.[key];
                        // Badge with the projection method for FCF 2y so the user knows whether the
                        // number came from the bottom-up analyst-based model or the historical
                        // CAGR fallback.
                        const isFcfRow = key === "fcf_2y";
                        const method = data?.auto_projections?.projection_method;
                        const bu = data?.auto_projections?.bottom_up_breakdown;
                        const methodBadge = (isFcfRow && method) ? (() => {
                            const cb = data?.auto_projections?.cagr_breakdown;
                            // Format helpers for the tooltip
                            const fmtBn = (n) => n == null ? "—" : (Math.abs(n) >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n/1e6).toFixed(0)}M` : `$${n.toFixed(0)}`);
                            const buText = `Método: BOTTOM-UP (analistas + intensidad CapEx)\n\nFCF +1y = OCF +1y − CapEx +1y\nOCF +1y = NI estimado por analistas × ratio OCF/NI histórica (${bu?.ocf_to_ni_ratio}x)\nCapEx +1y = intensidad CapEx/Ventas histórica (${((bu?.capex_intensity || 0) * 100).toFixed(2)}%) × Ingresos +1y\n\nAjustes aplicados:\n• Tendencia reciente: ×${bu?.trend_factor}\n• Momento de earnings: ×${bu?.earnings_mod}\n• Apalancamiento: ×${bu?.leverage_mod}`;
                            const baseSourceLabel = {
                                "ttm_yahoo": "TTM Yahoo (últimos 12 meses)",
                                "annual_latest_yahoo_ttm_stale": "último anual (TTM Yahoo era inconsistente)",
                                "annual_latest": "último anual",
                            }[cb?.base_source] || cb?.base_source || "desconocido";
                            const cagrText = cb
                                ? `Método: CAGR HISTÓRICO (fallback)\n\nPaso 1 — Base usada: ${fmtBn(cb.base_value)} (fuente: ${baseSourceLabel})\n   • TTM Yahoo:        ${fmtBn(cb.fcf_ttm)}\n   • Último FCF anual: ${fmtBn(cb.latest_annual)}\n\nPaso 2 — Crecimiento: ${cb.growth_pct != null ? `${(cb.growth_pct*100).toFixed(1)}% anual` : "—"} (CAGR de ${cb.positive_years_used} año(s) positivo(s) del histórico)\n\nPaso 3 — Proyección:\n   FCF +1y = base × (1 + g)\n   FCF +2y = base × (1 + g)²\n\nNota: este método se usa cuando los datos de analistas de NI no permiten el modelo bottom-up (NI negativo, histórico corto, etc.).`
                                : "Método: CAGR HISTÓRICO\nUsamos la CAGR de FCF positivo histórico aplicada al último FCF disponible.";

                            // Compute alternative base projections so the user can swap with one
                            // click. Available whenever the historical CAGR can be computed —
                            // even for bottom-up companies (offered as 2nd/3rd manual options).
                            const canSwap = cb && cb.growth_pct != null && cb.fcf_ttm && cb.latest_annual && cb.latest_annual > 0;
                            const g = canSwap ? cb.growth_pct : 0;
                            const projFromTtm = canSwap ? cb.fcf_ttm * Math.pow(1 + g, 2) : null;
                            const projFromAnnual = canSwap ? cb.latest_annual * Math.pow(1 + g, 2) : null;
                            const currentVal = inputs?.fcf_2y;
                            const within = (a, b) => a != null && b != null && Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) < 0.001;
                            const isUsingTtm = canSwap && within(currentVal, projFromTtm);
                            const isUsingAnnual = canSwap && within(currentVal, projFromAnnual);

                            const buFcfPlus2y = (method === "bottom-up" && bu) ? data?.auto_projections?.fcf_2y : null;
                            const isUsingBu = buFcfPlus2y != null && within(currentVal, buFcfPlus2y);

                            // Build a uniform [BU?] [TTM] [ANUAL] toolbar. The CAGR informational
                            // badge is intentionally NOT rendered: the hover tooltip on each
                            // button explains everything without adding noise to the label.
                            return (
                                <span className="inline-flex items-center gap-1 ml-2">
                                    {method === "bottom-up" && buFcfPlus2y != null && (
                                        <HoverTip text={buText}>
                                            <button
                                                type="button"
                                                onClick={() => updateInput("fcf_2y", buFcfPlus2y)}
                                                className="overline px-1.5 py-0.5 border text-[9px] hover:opacity-70"
                                                style={{
                                                    background: isUsingBu ? "#1D7044" : "transparent",
                                                    color: isUsingBu ? "white" : "#1D7044",
                                                    borderColor: "#1D7044",
                                                }}
                                                data-testid="fcf-method-badge"
                                                aria-pressed={isUsingBu}
                                            >BU</button>
                                        </HoverTip>
                                    )}
                                    {canSwap && (
                                        <>
                                            <HoverTip text={`Usar TTM Yahoo como base CAGR: ${fmtBn(cb.fcf_ttm)} × (1+${(g*100).toFixed(1)}%)² = ${fmtBn(projFromTtm)}\n\n${cagrText}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => updateInput("fcf_2y", projFromTtm)}
                                                    className="overline px-1.5 py-0.5 border text-[9px] hover:opacity-70"
                                                    style={{
                                                        background: isUsingTtm ? "#052049" : "transparent",
                                                        color: isUsingTtm ? "white" : "#052049",
                                                        borderColor: "#052049",
                                                    }}
                                                    data-testid="fcf-base-ttm"
                                                    aria-pressed={isUsingTtm}
                                                >TTM</button>
                                            </HoverTip>
                                            <HoverTip text={`Usar último FCF anual como base CAGR: ${fmtBn(cb.latest_annual)} × (1+${(g*100).toFixed(1)}%)² = ${fmtBn(projFromAnnual)}\n\n${cagrText}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => updateInput("fcf_2y", projFromAnnual)}
                                                    className="overline px-1.5 py-0.5 border text-[9px] hover:opacity-70"
                                                    style={{
                                                        background: isUsingAnnual ? "#052049" : "transparent",
                                                        color: isUsingAnnual ? "white" : "#052049",
                                                        borderColor: "#052049",
                                                    }}
                                                    data-testid="fcf-base-annual"
                                                    aria-pressed={isUsingAnnual}
                                                >ANUAL</button>
                                            </HoverTip>
                                        </>
                                    )}
                                </span>
                            );
                        })() : null;
                        return (
                            <div key={key} className="p-4 grid-cell">
                                <div className="flex items-center justify-between mb-1">
                                    <label className="overline text-[#4A4A4A] flex items-center">{label}{methodBadge}</label>
                                    <span className="text-xs font-mono" style={{ color: statusColor }} title={statusLabel} data-testid={`input-status-${key}`}>{statusDot}</span>
                                </div>
                                <LocaleNumberInput
                                    className="input-paper text-base"
                                    style={{ color: statusColor, fontStyle: status === "session" ? "italic" : "normal", fontWeight: status === "saved" ? 600 : 400 }}
                                    value={v}
                                    percent={isPercent}
                                    compact={isMagnitude}
                                    onChange={(num) => updateInput(key, num)}
                                    data-testid={`input-${key}`}
                                />
                                <div className="text-[10px] text-[#4A4A4A] mt-1 font-mono min-h-[14px]">{hint}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Two-column: Classic ratios + Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="border border-black bg-white" data-testid="classic-ratios">
                    <div className="p-4 border-b border-black">
                        <div className="overline text-[#4A4A4A]">Ratios clásicos</div>
                        <div className="font-serif text-2xl">Valoración estándar</div>
                    </div>
                    <table className="w-full text-sm">
                        <tbody>
                            {ratioRows.map(([label, key, fmt, info]) => {
                                const v = data.classic_ratios?.[key];
                                const display = v == null ? "—" : fmt === "pct" ? fmtPct(v) : fmtNum(v);
                                return <RatioRow key={key} rowKey={key} label={label} info={info} display={display} value={v} />;
                            })}
                            <RatioRow rowKey="gross_margin" label="Gross margin" info={marginRowsInfo.gross_margin} display={fmtPct(data.gross_margin)} value={data.gross_margin} />
                            <RatioRow rowKey="operating_margin" label="Operating margin" info={marginRowsInfo.operating_margin} display={fmtPct(data.operating_margin)} value={data.operating_margin} />
                        </tbody>
                    </table>

                    {data.growth_metrics && (
                        <>
                            <div className="p-4 border-t border-b border-black bg-[#FAF6EE]">
                                <div className="overline text-[#4A4A4A]">Crecimiento y rentabilidad futura</div>
                                <div className="font-serif text-xl">Para growth y empresas no rentables</div>
                            </div>
                            <table className="w-full text-sm" data-testid="growth-ratios">
                                <tbody>
                                    {growthRows.map(([label, key, fmt, info]) => {
                                        const v = data.growth_metrics?.[key];
                                        let display = "—";
                                        if (v != null && !isNaN(v)) {
                                            if (fmt === "pct") display = fmtPct(v);
                                            else if (fmt === "rule40") display = `${v.toFixed(1)}`;
                                            else display = fmtNum(v);
                                        }
                                        return <RatioRow key={key} rowKey={key} label={label} info={info} display={display} value={v} />;
                                    })}
                                    <BreakevenRow label="Breakeven operativo (estimado)"
                                                  year={data.growth_metrics?.breakeven_year_op}
                                                  isProfitable={data.growth_metrics?.is_profitable_op}
                                                  history={data.operating_income_history}
                                                  info="Año estimado en que el beneficio operativo cruzaría 0 según la trayectoria histórica reciente (regresión lineal sobre los últimos años). Si la empresa ya es rentable se muestra ese año; si la tendencia no converge, se indica 'No converge'." />
                                    <BreakevenRow label="Breakeven FCF (estimado)"
                                                  year={data.growth_metrics?.breakeven_year_fcf}
                                                  isProfitable={data.growth_metrics?.is_profitable_fcf}
                                                  history={data.fcf_history}
                                                  info="Año estimado en que el Free Cash Flow cruzaría 0 según la trayectoria reciente. Más relevante que el beneficio operativo para empresas con mucho intangible (software): un FCF positivo es la verdadera señal de autosuficiencia." />
                                </tbody>
                            </table>
                        </>
                    )}
                </div>

                <div className="space-y-6">
                    <ChartBlock title="Ingresos históricos" data={revChart} unit="B" color="#052049" testid="revenue-chart" userEdited={revEdited} />
                    <ChartBlock title="Free Cash Flow histórico" data={fcfChart} unit="B" color="#1D7044" type="bar" testid="fcf-chart" userEdited={fcfEdited} />
                    <RatioHistoryChart series={ratioHistory.map(s => ({ ...s, price: convertCur(s.price), poc: convertCur(s.poc), pov: convertCur(s.pov) }))} currency={cur} />
                </div>
            </div>

            {/* Breakdown */}
            {cr.breakdown && (
                <div className="border border-black bg-white p-4" data-testid="breakdown-section">
                    <div className="overline text-[#4A4A4A] mb-2">Desglose del cálculo POC / POV</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-sm font-mono">
                        <Stat label="Rev/Acción 2y"
                              value={fmtNum(cr.breakdown.rev_per_share_2y)}
                              tooltip={`Ingresos 2y / Acciones en circulación = ${fmtNum(inputs?.revenue_2y || 0)} / ${fmtNum(inputs?.shares_outstanding || 0)}`} />
                        <Stat label="× Margen bruto"
                              value={fmtNum(cr.breakdown.margin_factor)}
                              tooltip={`1 + Margen bruto = 1 + ${((inputs?.gross_margin || 0) * 100).toFixed(2)}%`} />
                        <Stat label="× (FCF-NetDebt)/MCap"
                              value={cr.breakdown.x_raw_pct != null ? fmtNum(cr.breakdown.x_raw_pct) : "—"}
                              tooltip={`((FCF 2y − Deuda neta) / Capitalización) × 100 = ((${fmtNum(inputs?.fcf_2y || 0)} − ${fmtNum(inputs?.net_debt || 0)}) / ${fmtNum(inputs?.market_cap || 0)}) × 100`} />
                        <Stat label="× (FCF-NetDebt)/MCap (ajustado)"
                              value={fmtNum(cr.breakdown.fcf_minus_netdebt_over_mcap_pct)}
                              tooltip={`Ajuste sobre el factor anterior:\n• si x < 0  → 1 + x/100  (penaliza pero no anula)\n• si 0 ≤ x ≤ 1  → 1  (neutralidad financiera)\n• si 1 < x ≤ 10  → x  (sin cambio)\n• si x > 10  → 10  (tope superior: yields anormalmente altos suelen indicar caja sin reinvertir o sin remunerar al accionista)`} />
                        <Stat label="× CAGR Ingresos 4y"
                              value={fmtNum(cr.breakdown.rev_growth_factor)}
                              tooltip={`1 + CAGR ingresos 4y = 1 + ${((inputs?.revenue_cagr_4y || 0) * 100).toFixed(2)}%`} />
                        <Stat label="× CAGR FCF 4y"
                              value={fmtNum(cr.breakdown.fcf_growth_factor)}
                              tooltip={`1 + CAGR FCF 4y = 1 + ${((inputs?.fcf_cagr_4y || 0) * 100).toFixed(2)}%`} />
                        <Stat label="× Margen operativo"
                              value={fmtNum(1 + (inputs?.operating_margin || 0))}
                              tooltip={`1 + Margen operativo = 1 + ${((inputs?.operating_margin || 0) * 100).toFixed(2)}% (coeficiente sin ajustar)`} />
                        <Stat label="× Margen operativo (ajustado)"
                              value={cr.breakdown.y_factor != null ? fmtNum(cr.breakdown.y_factor) : "—"}
                              tooltip={`Ajuste sobre el margen operativo (factor en POV = POC × este factor):\n• si y < 0%  → 1 + y/100  (penaliza pero no anula)\n• si 0% ≤ y ≤ 1%  → 1  (neutralidad)\n• si y > 1%  → 1 + y/100  (sin cambio)`} />
                    </div>
                </div>
            )}

            {inputs && cr.poc != null && (
                <SensitivityMatrix inputs={inputs} basePoc={cr.poc} basePov={cr.pov} basePrice={inputs.current_price} currency={cur} convertCur={convertCur} />
            )}

            {/* Navigation guard modal */}
            {pendingNav && (
                <Modal title="Cambios sin guardar" testid="nav-guard-modal">
                    <p className="text-sm text-[#4A4A4A] mb-4">
                        Tienes cambios manuales en los inputs que no se han guardado en la watchlist. Si sales ahora se perderán.
                    </p>
                    <p className="text-xs font-mono text-[#4A4A4A] mb-6">
                        Tip: pulsa "Guardar cambios" en la cabecera para añadir esta acción a la watchlist con tus valores actuales.
                    </p>
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setPendingNav(null)} className="btn-ghost" data-testid="nav-guard-stay">Quedarme aquí</button>
                        <button onClick={() => { const target = pendingNav; setPendingNav(null); setSessionEdits({}); navigate(target); }} className="btn-primary" data-testid="nav-guard-leave">Salir igualmente</button>
                    </div>
                </Modal>
            )}

            {/* Confirm overwrite modal — Watchlist */}
            {confirmOverwrite && (
                <Modal title="Sobrescribir snapshot guardado" testid="overwrite-modal">
                    <p className="text-sm text-[#4A4A4A] mb-4">
                        Esta acción ya está en tu watchlist con valores guardados.
                        Vas a sobrescribir ese snapshot con los valores actuales (incluidos los cambios sin guardar).
                    </p>
                    <p className="text-xs font-mono text-[#4A4A4A] mb-6">
                        ¿Continuar?
                    </p>
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setConfirmOverwrite(false)} className="btn-ghost" data-testid="overwrite-cancel">Cancelar</button>
                        <button onClick={doConfirmOverwrite} className="btn-primary" data-testid="overwrite-confirm">Sobrescribir</button>
                    </div>
                </Modal>
            )}

            {/* Confirm overwrite modal — Portfolio */}
            {confirmOverwritePortfolio && (
                <Modal title="Sobrescribir snapshot en cartera" testid="overwrite-portfolio-modal">
                    <p className="text-sm text-[#4A4A4A] mb-4">
                        Esta acción ya está en tu cartera con valores guardados.
                        Vas a sobrescribir ese snapshot con los valores actuales (incluidos los cambios sin guardar).
                    </p>
                    <p className="text-xs font-mono text-[#4A4A4A] mb-6">¿Continuar?</p>
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setConfirmOverwritePortfolio(false)} className="btn-ghost" data-testid="overwrite-portfolio-cancel">Cancelar</button>
                        <button onClick={doConfirmOverwritePortfolio} className="btn-primary" data-testid="overwrite-portfolio-confirm">Sobrescribir</button>
                    </div>
                </Modal>
            )}

            {/* Confirm refresh (discard overrides) modal */}
            {confirmRefresh && (() => {
                const hasWlOverrides = wlEntry && wlEntry.overrides && Object.keys(wlEntry.overrides).length > 0;
                const hasPfOverrides = pfEntry && pfEntry.overrides && Object.keys(pfEntry.overrides).length > 0;
                return (
                    <Modal title="Volver a los datos de Yahoo" testid="refresh-modal">
                        <p className="text-sm text-[#4A4A4A] mb-3">
                            Refrescar recarga los fundamentales actualizados desde Yahoo Finance y descarta cualquier valor manual aplicado a esta vista.
                        </p>
                        {hasWlOverrides && (
                            <p className="text-sm text-[#B32A22] mb-3" data-testid="refresh-warning-saved">
                                ⚠ Esta acción está en tu watchlist en modo MANUAL. Los valores guardados se eliminarán y volverá a modo AUTO. El ticker seguirá en la watchlist.
                            </p>
                        )}
                        {hasPfOverrides && (
                            <p className="text-sm text-[#B32A22] mb-3" data-testid="refresh-warning-pf">
                                ⚠ Esta acción está en tu cartera en modo MANUAL. Los valores guardados se eliminarán y volverá a modo AUTO. La posición se mantiene.
                            </p>
                        )}
                        {hasSessionEdits && (
                            <p className="text-sm text-[#D97706] mb-3" data-testid="refresh-warning-session">
                                ⚠ Tienes cambios sin guardar. Pulsa cancelar y luego "Guardar en watchlist" o "Guardar en cartera" para conservarlos.
                            </p>
                        )}
                        <p className="text-xs font-mono text-[#4A4A4A] mb-6">¿Continuar?</p>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setConfirmRefresh(false)} className="btn-ghost" data-testid="refresh-cancel">Cancelar</button>
                            <button onClick={doRefresh} className="btn-primary" data-testid="refresh-confirm">Volver a Yahoo</button>
                        </div>
                    </Modal>
                );
            })()}
        </div>
    );
}

function Modal({ title, children, testid }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid={testid} style={{ background: "rgba(17,17,17,0.4)" }}>
            <div className="bg-white border border-black w-full max-w-md p-6">
                <div className="overline text-[#B32A22] mb-2">Aviso</div>
                <h2 className="font-serif text-2xl mb-4">{title}</h2>
                {children}
            </div>
        </div>
    );
}

function RatioRow({ rowKey, label, info, display, value }) {
    const h = ratioHealth(rowKey, value);
    return (
        <tr className="border-b border-black/10 hover:bg-[#F5E4D4]" data-testid={`row-${rowKey}`}>
            <td className="px-4 py-2 text-[#4A4A4A]">
                <HoverTip text={info}>
                    <span className="underline decoration-dotted underline-offset-2 cursor-help" data-testid={`ratio-label-${rowKey}`}>{label}</span>
                </HoverTip>
            </td>
            <td className="px-4 py-2 text-right font-mono" data-testid={`ratio-${rowKey}`}>
                <span className="inline-flex items-center gap-2 justify-end">
                    {h && (
                        <HoverTip text={h.label}>
                            <span className="inline-block w-2 h-2 rounded-full" style={{ background: h.color }} data-testid={`health-${rowKey}`} />
                        </HoverTip>
                    )}
                    <span>{display}</span>
                </span>
            </td>
        </tr>
    );
}

function BreakevenRow({ label, year, isProfitable, history, info }) {
    let display, color = null, sublabel = null;
    const currentYear = new Date().getUTCFullYear();
    if (isProfitable) {
        display = `Ya rentable (${year ?? "—"})`;
        color = "#1D7044";
    } else if (year == null) {
        // Either no history or trajectory not converging
        const hasHistory = Array.isArray(history) && history.length > 0;
        display = hasHistory ? "No converge" : "Sin datos";
        color = hasHistory ? "#B32A22" : "#4A4A4A";
        sublabel = hasHistory ? "La tendencia reciente es plana o se deteriora" : null;
    } else {
        const delta = year - currentYear;
        display = `${year}`;
        if (delta <= 1) color = "#1D7044";
        else if (delta <= 3) color = "#D97706";
        else color = "#B32A22";
        sublabel = delta <= 0 ? "Ya o en el año actual" : `≈ ${delta} año${delta > 1 ? "s" : ""} si la tendencia se mantiene`;
    }
    return (
        <tr className="border-b border-black/10 hover:bg-[#F5E4D4]" data-testid={`breakeven-row-${label.replace(/\s+/g, "-").toLowerCase()}`}>
            <td className="px-4 py-2 text-[#4A4A4A]">
                <HoverTip text={info}>
                    <span className="underline decoration-dotted underline-offset-2 cursor-help">{label}</span>
                </HoverTip>
                {sublabel && <div className="text-[10px] text-[#4A4A4A] mt-0.5 font-mono">{sublabel}</div>}
            </td>
            <td className="px-4 py-2 text-right font-mono" style={{ color }}>{display}</td>
        </tr>
    );
}

function Stat({ label, value, tooltip }) {
    return (
        <HoverTip text={tooltip}>
            <div className="grid-cell p-2 cursor-help" data-testid="stat-cell">
                <div className="overline text-[#4A4A4A] underline decoration-dotted underline-offset-2">{label}</div>
                <div className="text-base">{value}</div>
            </div>
        </HoverTip>
    );
}

function CompactTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;
    // Find the first non-null value across all series at this point
    const p = payload.find(x => x && x.value != null) || payload[0];
    const v = p?.value;
    return (
        <div className="bg-white border border-black px-2 py-1 font-mono text-xs">
            <div className="text-[#4A4A4A]">{label}</div>
            <div className="text-black">{fmtCompact(v)}</div>
        </div>
    );
}

function ChartBlock({ title, data, unit, color, type = "line", testid, userEdited = false }) {
    if (!data || data.length === 0) {
        return (
            <div className="border border-black bg-white p-4" data-testid={testid}>
                <div className="overline text-[#4A4A4A] mb-2">{title}</div>
                <div className="text-sm text-[#4A4A4A]">Sin datos disponibles</div>
            </div>
        );
    }
    const projColor = userEdited ? "#052049" : "#B32A22";
    const projLabel = userEdited ? "Estimado por usuario" : "Proyección";
    return (
        <div className="border border-black bg-white p-4" data-testid={testid}>
            <div className="flex items-start justify-between mb-1">
                <div>
                    <div className="overline text-[#4A4A4A]">{title}</div>
                    <div className="font-serif text-xl">en miles de millones ({unit})</div>
                </div>
                <div className="flex gap-3 text-[10px] font-mono mt-1" data-testid={`${testid}-legend`}>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-[2px]" style={{ background: color }} />Real</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-0 border-t-2 border-dashed" style={{ borderColor: projColor }} />{projLabel}</span>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
                {type === "bar" ? (
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#11111120" />
                        <XAxis dataKey="year" stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <YAxis stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} tickFormatter={(v) => fmtCompact(v)} />
                        <Tooltip content={<CompactTooltip />} cursor={{ fill: "#11111110" }} />
                        <Bar dataKey="value" name="FCF">
                            {data.map((entry, i) => (
                                <Cell key={i} fill={entry.kind === "proj" ? projColor : color} fillOpacity={entry.kind === "proj" ? 0.45 : 1} stroke={entry.kind === "proj" ? projColor : "none"} strokeDasharray={entry.kind === "proj" ? "3 3" : "0"} />
                            ))}
                        </Bar>
                    </BarChart>
                ) : (
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#11111120" />
                        <XAxis dataKey="year" stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <YAxis stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} tickFormatter={(v) => fmtCompact(v)} />
                        <Tooltip content={<CompactTooltip />} />
                        <Line type="monotone" dataKey="historical" stroke={color} strokeWidth={2} dot={{ r: 4, fill: color }} name="Real" connectNulls={false} />
                        <Line type="monotone" dataKey="projection" stroke={projColor} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, fill: projColor }} name={projLabel} connectNulls={false} />
                    </LineChart>
                )}
            </ResponsiveContainer>
        </div>
    );
}


// Custom tooltip used by the historical POC/POV vs price chart.
function RatioHistoryTooltip({ active, payload, label, currency }) {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]?.payload || {};
    const aboveBuy = row.price != null && row.poc != null ? (row.price <= row.poc) : null;
    const belowSell = row.price != null && row.pov != null ? (row.price <= row.pov) : null;
    return (
        <div className="bg-white border border-black px-3 py-2 font-mono text-xs">
            <div className="text-[#4A4A4A] mb-1">{label}</div>
            <div>POC: <span style={{ color: "#B32A22" }}>{fmtPrice(row.poc, currency)}</span></div>
            <div>POV: <span style={{ color: "#1D7044" }}>{fmtPrice(row.pov, currency)}</span></div>
            <div className="mt-1">Precio cierre: <span style={{ color: "#052049" }}>{fmtPrice(row.price, currency)}</span></div>
            {aboveBuy != null && (
                <div className="mt-1 text-[10px] text-[#4A4A4A]">
                    Vs POC: {aboveBuy ? "precio ≤ POC (barata)" : "precio > POC"}
                    {belowSell != null && ` · Vs POV: ${belowSell ? "precio ≤ POV" : "precio > POV"}`}
                </div>
            )}
        </div>
    );
}

function RatioHistoryChart({ series, currency }) {
    if (!series || series.length === 0) {
        return (
            <div className="border border-black bg-white p-4" data-testid="ratio-history-chart">
                <div className="overline text-[#4A4A4A] mb-1">Histórico POC / POV vs Precio</div>
                <div className="text-sm text-[#4A4A4A]">Sin datos históricos suficientes para reconstruir la serie.</div>
            </div>
        );
    }
    const data = series.map(s => ({
        year: String(s.year),
        poc: s.poc,
        pov: s.pov,
        price: s.price,
    }));
    return (
        <div className="border border-black bg-white p-4" data-testid="ratio-history-chart">
            <div className="flex items-start justify-between mb-1">
                <div>
                    <div className="overline text-[#4A4A4A]">Histórico POC / POV vs Precio</div>
                    <div className="font-serif text-xl">Tendencia anual</div>
                    <div className="text-[10px] font-mono text-[#4A4A4A] mt-1 max-w-md leading-relaxed">
                        Compara precio de cierre contra <span style={{ color: "#B32A22" }} className="font-semibold">POC</span> (precio objetivo de compra) y <span style={{ color: "#1D7044" }} className="font-semibold">POV</span> (precio objetivo de venta). Si el precio cae por debajo del POC: zona barata histórica. Si los POC/POV caen con el precio: deterioro fundamental real. Si los POC/POV suben mientras el precio cae: posible oportunidad.
                    </div>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#11111120" />
                    <XAxis dataKey="year" stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                    <YAxis stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
                           tickFormatter={(v) => fmtCompact(v)} label={{ value: `${currency}`, angle: -90, position: "insideLeft", style: { fontSize: 10, fontFamily: "IBM Plex Mono", fill: "#4A4A4A" } }} />
                    <Tooltip content={<RatioHistoryTooltip currency={currency} />} />
                    <Legend wrapperStyle={{ fontSize: 10, fontFamily: "IBM Plex Mono" }} />
                    <Line type="monotone" dataKey="poc" name="POC (objetivo compra)" stroke="#B32A22" strokeWidth={2} dot={{ r: 4, fill: "#B32A22" }} connectNulls />
                    <Line type="monotone" dataKey="pov" name="POV (objetivo venta)" stroke="#1D7044" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 4, fill: "#1D7044" }} connectNulls />
                    <Line type="monotone" dataKey="price" name="Precio cierre" stroke="#052049" strokeWidth={2.5} dot={{ r: 3, fill: "#052049" }} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}


const SENS_AXES = [
    { key: "revenue_2y", label: "Ingresos 2y", isPercent: false },
    { key: "fcf_2y", label: "FCF 2y", isPercent: false },
    { key: "gross_margin", label: "Margen bruto", isPercent: true },
    { key: "operating_margin", label: "Margen operativo", isPercent: true },
    { key: "revenue_cagr_4y", label: "CAGR Ingresos 4y", isPercent: true },
    { key: "fcf_cagr_4y", label: "CAGR FCF 4y", isPercent: true },
];

function SensitivityMatrix({ inputs, basePoc, basePov, basePrice, currency, convertCur }) {
    const [axisX, setAxisX] = useState("fcf_cagr_4y");
    const [axisY, setAxisY] = useState("revenue_cagr_4y");
    const [delta, setDelta] = useState(10); // ±%
    const [metric, setMetric] = useState("ratio_compra"); // "ratio_compra" | "ratio_venta" | "poc" | "pov"

    if (axisX === axisY) {
        // Auto-pick a different default to avoid degenerate 1D matrix
        const fallback = SENS_AXES.find(a => a.key !== axisX)?.key || axisX;
        if (axisY !== fallback) setAxisY(fallback);
    }

    const steps = [-delta, 0, +delta];

    // Bump an input value by a relative %.
    const bump = (val, pct) => (val == null ? null : val * (1 + pct / 100));

    const cells = steps.map(dy => steps.map(dx => {
        const next = { ...inputs };
        next[axisX] = bump(inputs[axisX], dx);
        next[axisY] = bump(inputs[axisY], dy);
        const r = computeCustomRatios(next);
        return { dx, dy, r };
    }));

    const valFor = (r) => {
        if (!r) return null;
        if (metric === "ratio_compra") return r.ratio_compra_pct;
        if (metric === "ratio_venta") return r.ratio_venta_pct;
        if (metric === "poc") return r.poc;
        if (metric === "pov") return r.pov;
        return null;
    };
    const fmtCell = (v) => {
        if (v == null || isNaN(v)) return "—";
        if (metric === "ratio_compra" || metric === "ratio_venta") return fmtPctSigned(v);
        const conv = convertCur ? convertCur(v) : v;
        return fmtPrice(conv, currency);
    };
    const cellColor = (v) => {
        if (v == null || isNaN(v)) return "#4A4A4A";
        if (metric === "ratio_compra") return ratioColor(v, "compra");
        if (metric === "ratio_venta") return ratioColor(v, "venta");
        // POC/POV vs base price: green if above price, red if below
        if (basePrice == null) return "#111";
        const pct = (v / basePrice - 1) * 100;
        return ratioColor(pct, metric === "pov" ? "venta" : "compra");
    };

    // Base value to highlight the center cell
    const baseVal = metric === "ratio_compra" ? (basePoc != null && basePrice ? (basePoc / basePrice - 1) * 100 : null)
                  : metric === "ratio_venta" ? (basePov != null && basePrice ? (basePov / basePrice - 1) * 100 : null)
                  : metric === "poc" ? basePoc
                  : basePov;

    const labelFor = (key) => SENS_AXES.find(a => a.key === key)?.label || key;
    const stepFmt = (s) => s === 0 ? "Base" : `${s > 0 ? "+" : ""}${s}%`;

    return (
        <div className="border border-black bg-white p-4 mt-6" data-testid="sensitivity-matrix">
            <div className="flex flex-wrap items-end gap-3 mb-3">
                <div>
                    <div className="overline text-[#B32A22]">Modo Sensibilidad</div>
                    <div className="font-serif text-2xl">¿Cuán frágil es tu valoración?</div>
                </div>
                <div className="ml-auto grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <label className="flex flex-col">
                        <span className="overline text-[#4A4A4A]">Eje X</span>
                        <select value={axisX} onChange={e => setAxisX(e.target.value)} className="input-paper font-mono" data-testid="sens-axis-x">
                            {SENS_AXES.map(a => <option key={a.key} value={a.key} disabled={a.key === axisY}>{a.label}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col">
                        <span className="overline text-[#4A4A4A]">Eje Y</span>
                        <select value={axisY} onChange={e => setAxisY(e.target.value)} className="input-paper font-mono" data-testid="sens-axis-y">
                            {SENS_AXES.map(a => <option key={a.key} value={a.key} disabled={a.key === axisX}>{a.label}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col">
                        <span className="overline text-[#4A4A4A]">Métrica</span>
                        <select value={metric} onChange={e => setMetric(e.target.value)} className="input-paper font-mono" data-testid="sens-metric">
                            <option value="ratio_compra">Ratio Compra</option>
                            <option value="ratio_venta">Ratio Venta</option>
                            <option value="poc">POC</option>
                            <option value="pov">POV</option>
                        </select>
                    </label>
                    <label className="flex flex-col">
                        <span className="overline text-[#4A4A4A]">Δ {delta}%</span>
                        <input type="range" min="2" max="30" step="1" value={delta} onChange={e => setDelta(parseInt(e.target.value, 10))} data-testid="sens-delta" />
                    </label>
                </div>
            </div>

            <p className="text-xs text-[#4A4A4A] mb-3 max-w-3xl">
                Muestra cómo cambia <span className="font-mono font-semibold">{({ ratio_compra: "Ratio Compra", ratio_venta: "Ratio Venta", poc: "POC", pov: "POV" })[metric]}</span> al mover <span className="font-mono">{labelFor(axisX)}</span> y <span className="font-mono">{labelFor(axisY)}</span> ±{delta}%. Si los extremos varían mucho respecto a la celda central, tu tesis es <span className="text-[#B32A22]">frágil</span>. Si apenas cambian, la valoración es <span className="text-[#1D7044]">robusta</span>.
            </p>

            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse" data-testid="sens-table">
                    <thead>
                        <tr>
                            <th className="px-2 py-2 text-left overline text-[#4A4A4A] border-b border-r border-black/20"></th>
                            {steps.map(s => (
                                <th key={s} className="px-2 py-2 text-center overline text-[#4A4A4A] border-b border-black/20">
                                    {labelFor(axisX)} {stepFmt(s)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {cells.map((row, i) => (
                            <tr key={steps[i]}>
                                <td className="px-2 py-2 overline text-[#4A4A4A] border-r border-black/20 whitespace-nowrap">
                                    {labelFor(axisY)} {stepFmt(steps[i])}
                                </td>
                                {row.map((c, j) => {
                                    const v = valFor(c.r);
                                    const isBase = c.dx === 0 && c.dy === 0;
                                    return (
                                        <td key={j}
                                            className={`px-3 py-3 text-center font-mono ${isBase ? "bg-[#FAF6EE] font-semibold" : ""} border border-black/10`}
                                            data-testid={`sens-cell-${i}-${j}`}
                                            style={{ color: cellColor(v) }}>
                                            {fmtCell(v)}
                                            {isBase && baseVal != null && (
                                                <div className="text-[10px] text-[#4A4A4A] font-mono mt-1 font-normal">(base)</div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
