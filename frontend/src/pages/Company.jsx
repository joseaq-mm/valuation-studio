import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getCompany, recalc } from "@/lib/api";
import { fmtNum, fmtPct, fmtPrice, fmtPctSigned, fmtCompact, ratioColor, signalLabel } from "@/lib/format";
import LocaleNumberInput from "@/components/LocaleNumberInput";
import { saveToWatchlist, removeFromWatchlist, getWatchlistEntry } from "@/lib/storage";
import { computeCustomRatios, autoInputsFromData, valuesEqual, computeOverrides } from "@/lib/customRatios";
import { Star, RefreshCw, AlertCircle, Save, X } from "lucide-react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

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

const marginRowsInfo = {
    gross_margin: "Ingresos − coste directo del producto, en %. Mide eficiencia productiva. > 40% suele ser bueno (escala, marca, software). En retail/manufactura puede ser <25% sin que sea mala señal.",
    operating_margin: "Beneficio operativo (antes de impuestos e intereses) / ingresos. Mide eficiencia del negocio core. > 15% sólido, > 25% excelente. Negativo = pierde dinero operando.",
};

export default function Company() {
    const { ticker } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    // Watchlist state
    const [wlEntry, setWlEntry] = useState(null); // {ticker, mode, overrides, saved_at} or null
    const [confirmOverwrite, setConfirmOverwrite] = useState(false);
    const [confirmRefresh, setConfirmRefresh] = useState(false);

    // Inputs lifecycle
    const [autoInputs, setAutoInputs] = useState(null);    // pure Yahoo values
    const [inputs, setInputs] = useState(null);            // current shown values (auto + saved overrides + session edits)
    const [sessionEdits, setSessionEdits] = useState({});  // {field: true} for fields edited this session
    const [customRatios, setCustomRatios] = useState(null);

    const hasSessionEdits = Object.keys(sessionEdits).length > 0;

    const load = useCallback(async (refresh = false, ignoreOverrides = false) => {
        try {
            setLoading(true); setError(null);
            const d = await getCompany(ticker, refresh);
            const auto = autoInputsFromData(d);
            const entry = ignoreOverrides ? null : getWatchlistEntry(ticker);
            setWlEntry(ignoreOverrides ? (getWatchlistEntry(ticker) || null) : entry);
            // Apply saved overrides (if any and not ignored) on top of auto values.
            const merged = { ...auto };
            if (entry && entry.overrides) {
                for (const [k, v] of Object.entries(entry.overrides)) {
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

    const updateInput = (key, num) => {
        setInputs(prev => {
            const next = { ...prev, [key]: num };
            // Track as session edit only if it differs from the "loaded" value
            const loaded = wlEntry?.overrides?.[key] !== undefined ? wlEntry.overrides[key] : autoInputs?.[key];
            setSessionEdits(prevEdits => {
                const ne = { ...prevEdits };
                if (!valuesEqual(num, loaded)) ne[key] = true;
                else delete ne[key];
                return ne;
            });
            // Live recompute ratios
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
        // Reset to the "loaded" state: auto + saved overrides (if any)
        const merged = { ...autoInputs };
        if (wlEntry?.overrides) {
            for (const [k, v] of Object.entries(wlEntry.overrides)) {
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
        if (wlEntry?.overrides && wlEntry.overrides[key] !== undefined) return "saved"; // user-saved override — green
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
    const cur = data.currency || "USD";

    // Smart unit suffix for magnitude values (B/M/K)
    const unitFor = (v) => {
        if (v == null || isNaN(v)) return "";
        const a = Math.abs(v);
        if (a >= 1e9) return "B";
        if (a >= 1e6) return "M";
        if (a >= 1e3) return "K";
        return "";
    };
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
                title: `POC ≤ 0 → ${fmtPrice(poc, cur)}`,
                detail: "El precio objetivo de compra no es utilizable porque uno o más factores de la fórmula están colapsando el resultado:",
                bullets: reasons,
            });
        }

        // POV < POC — operating margin is dragging POV below POC.
        if (poc > 0 && pov > 0 && pov < poc) {
            const yPct = (om ?? 0) * 100;
            anomalies.push({
                title: `POV (${fmtPrice(pov, cur)}) < POC (${fmtPrice(poc, cur)})`,
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
                title: `POV ≤ 0 → ${fmtPrice(pov, cur)}`,
                detail: "El precio objetivo de venta colapsa por culpa del margen operativo:",
                bullets: [
                    `Margen operativo = ${yPct.toFixed(2)}%. Como es < −100%, el factor (1 + y/100) es ≤ 0 y arrastra POV a territorio negativo.`,
                    "Edita manualmente 'Margen operativo' a un valor más realista (ej. la media histórica del sector) para obtener un POV válido.",
                ],
            });
            addCorr("operating_margin", om, 0, "Clip margen operativo a 0% (neutraliza el factor, POV = POC).");
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
                        <div className="overline text-[#4A4A4A]">{data.exchange} · {data.currency}{data.sector ? ` · ${data.sector}` : ""}</div>
                        <h1 className="font-serif text-4xl sm:text-5xl tracking-tight mt-1" data-testid="company-name">{data.name}</h1>
                        <div className="font-mono text-lg text-[#052049] mt-1" data-testid="company-ticker">{data.ticker}</div>
                    </div>
                    <div className="text-right">
                        <div className="overline text-[#4A4A4A]">Precio actual</div>
                        <div className="font-mono text-4xl sm:text-5xl font-medium" data-testid="company-price">{fmtPrice(data.current_price, cur)}</div>
                        <div className="text-xs text-[#4A4A4A] font-mono mt-1">MCap {fmtNum(data.market_cap)}</div>
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
                                <Save size={14} /> {hasSessionEdits ? "Guardar cambios" : "En watchlist"}
                            </button>
                            <button onClick={handleRemoveFromWatchlist} className="btn-ghost flex items-center gap-2" data-testid="watchlist-remove">
                                <X size={14} /> Quitar
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
                    <button onClick={handleRefresh} className="btn-ghost flex items-center gap-2" data-testid="refresh-button" disabled={refreshing}>
                        <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refrescar
                    </button>
                    {hasSessionEdits && (
                        <span className="text-xs font-mono text-[#D97706]" data-testid="unsaved-indicator">
                            ● Cambios sin guardar
                        </span>
                    )}
                </div>
                {data.long_business_summary && (
                    <p className="text-sm text-[#4A4A4A] mt-4 max-w-3xl">{data.long_business_summary}</p>
                )}
            </div>

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
                            <span className="text-lg font-mono font-semibold text-black underline decoration-dotted underline-offset-2 cursor-help" data-testid="poc-label">POC {cr.poc != null ? fmtPrice(cr.poc, cur) : "—"}</span>
                        </HoverTip>
                    </div>
                    <div className="text-xs text-[#4A4A4A] mt-3">Upside hasta el precio objetivo de compra.</div>
                </div>
                <div className="bg-white p-6" data-testid="ratio-venta-card">
                    <div className="overline text-[#4A4A4A]">Ratio de Venta</div>
                    <div className="font-mono text-5xl sm:text-6xl font-medium mt-2" style={{ color: ratioColor(cr.ratio_venta_pct) }} data-testid="ratio-venta-value">
                        {fmtPctSigned(cr.ratio_venta_pct)}
                    </div>
                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                        <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(cr.ratio_venta_pct) }} data-testid="signal-venta">{signalLabel(cr.ratio_venta_pct)}</span>
                        <HoverTip text="POV = Precio Objetivo de Venta. Precio al que la acción te parecería cara según tu fórmula.">
                            <span className="text-lg font-mono font-semibold text-black underline decoration-dotted underline-offset-2 cursor-help" data-testid="pov-label">POV {cr.pov != null ? fmtPrice(cr.pov, cur) : "—"}</span>
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
                        ["Acciones en circulación", "shares_outstanding", false, false, ""],
                        ["Margen bruto", "gross_margin", true, false, ""],
                        ["Margen operativo", "operating_margin", true, false, ""],
                        ["Deuda neta", "net_debt", false, true, ""],
                        ["Capitalización", "market_cap", false, true, ""],
                        ["CAGR ingresos 4y", "revenue_cagr_4y", true, false, fyLabel],
                        ["CAGR FCF 4y", "fcf_cagr_4y", true, false, fyLabel],
                        ["Precio acción", "current_price", false, false, cur],
                    ].map(([label, key, isPercent, isMagnitude, hint]) => {
                        const status = fieldStatus(key);
                        const statusColor = status === "session" ? "#D97706" : status === "saved" ? "#1D7044" : "#111111";
                        const statusLabel = status === "session" ? "Editado, sin guardar" : status === "saved" ? "Guardado por ti" : "Auto (Yahoo)";
                        const statusDot = status === "session" ? "●" : status === "saved" ? "●" : "○";
                        // Per user's spec: % suffix removed for margins & CAGRs; magnitude inputs get B/M/K when they have a value
                        const v = inputs?.[key];
                        const hasValue = v != null && !isNaN(v);
                        const sideSuffix = (isMagnitude && hasValue) ? unitFor(v) : "";
                        return (
                            <div key={key} className="p-4 grid-cell">
                                <div className="flex items-center justify-between mb-1">
                                    <label className="overline text-[#4A4A4A]">{label}</label>
                                    <span className="text-xs font-mono" style={{ color: statusColor }} title={statusLabel} data-testid={`input-status-${key}`}>{statusDot}</span>
                                </div>
                                <LocaleNumberInput
                                    className="input-paper text-base"
                                    style={{ color: statusColor, fontStyle: status === "session" ? "italic" : "normal", fontWeight: status === "saved" ? 600 : 400 }}
                                    value={inputs?.[key]}
                                    percent={isPercent}
                                    suffix={!isPercent ? sideSuffix : undefined}
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
                                return (
                                    <tr key={key} className="border-b border-black/10 hover:bg-[#F5E4D4]">
                                        <td className="px-4 py-2 text-[#4A4A4A]">
                                            <HoverTip text={info}>
                                                <span className="underline decoration-dotted underline-offset-2 cursor-help" data-testid={`ratio-label-${key}`}>{label}</span>
                                            </HoverTip>
                                        </td>
                                        <td className="px-4 py-2 text-right font-mono" data-testid={`ratio-${key}`}>{display}</td>
                                    </tr>
                                );
                            })}
                            <tr className="border-b border-black/10 hover:bg-[#F5E4D4]">
                                <td className="px-4 py-2 text-[#4A4A4A]">
                                    <HoverTip text={marginRowsInfo.gross_margin}>
                                        <span className="underline decoration-dotted underline-offset-2 cursor-help" data-testid="ratio-label-gross_margin">Gross margin</span>
                                    </HoverTip>
                                </td>
                                <td className="px-4 py-2 text-right font-mono">{fmtPct(data.gross_margin)}</td>
                            </tr>
                            <tr className="border-b border-black/10 hover:bg-[#F5E4D4]">
                                <td className="px-4 py-2 text-[#4A4A4A]">
                                    <HoverTip text={marginRowsInfo.operating_margin}>
                                        <span className="underline decoration-dotted underline-offset-2 cursor-help" data-testid="ratio-label-operating_margin">Operating margin</span>
                                    </HoverTip>
                                </td>
                                <td className="px-4 py-2 text-right font-mono">{fmtPct(data.operating_margin)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="space-y-6">
                    <ChartBlock title="Ingresos históricos" data={revChart} unit="B" color="#052049" testid="revenue-chart" userEdited={revEdited} />
                    <ChartBlock title="Free Cash Flow histórico" data={fcfChart} unit="B" color="#1D7044" type="bar" testid="fcf-chart" userEdited={fcfEdited} />
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
                              tooltip={`Ajuste sobre el factor anterior:\n• si x < 0  → 1 + x/100  (penaliza pero no anula)\n• si 0 ≤ x ≤ 1  → 1  (neutralidad financiera)\n• si x > 1  → x  (sin cambio)`} />
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

            {/* Confirm overwrite modal */}
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

            {/* Confirm refresh (discard overrides) modal */}
            {confirmRefresh && (() => {
                const hasSavedOverrides = wlEntry && wlEntry.overrides && Object.keys(wlEntry.overrides).length > 0;
                return (
                    <Modal title="Volver a los datos de Yahoo" testid="refresh-modal">
                        <p className="text-sm text-[#4A4A4A] mb-3">
                            Refrescar recarga los fundamentales actualizados desde Yahoo Finance y descarta cualquier valor manual aplicado a esta vista.
                        </p>
                        {hasSavedOverrides && (
                            <p className="text-sm text-[#B32A22] mb-3" data-testid="refresh-warning-saved">
                                ⚠ Esta acción está en tu watchlist en modo MANUAL. Los valores guardados se eliminarán y volverá a modo AUTO. El ticker seguirá en la watchlist.
                            </p>
                        )}
                        {hasSessionEdits && (
                            <p className="text-sm text-[#D97706] mb-3" data-testid="refresh-warning-session">
                                ⚠ Tienes cambios sin guardar que también se perderán.
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

// Lightweight controlled tooltip. Uses fixed positioning + viewport clamping so it never gets cut by overflow.
function HoverTip({ text, children }) {
    const [open, setOpen] = React.useState(false);
    const [pos, setPos] = React.useState({ top: 0, left: 0, placeAbove: false });
    const wrapRef = React.useRef(null);
    const tipRef = React.useRef(null);

    const show = () => {
        if (!wrapRef.current) return;
        const r = wrapRef.current.getBoundingClientRect();
        // First show the tooltip so we can measure it, then reposition next tick.
        setPos({ top: r.bottom + 8, left: r.left, placeAbove: false });
        setOpen(true);
    };
    const hide = () => setOpen(false);

    React.useLayoutEffect(() => {
        if (!open || !wrapRef.current || !tipRef.current) return;
        const wrap = wrapRef.current.getBoundingClientRect();
        const tip = tipRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;
        let left = wrap.left;
        // Clamp horizontally so the tooltip stays on screen
        if (left + tip.width + margin > vw) left = Math.max(margin, vw - tip.width - margin);
        if (left < margin) left = margin;
        // Flip above if there isn't enough room below
        const placeAbove = wrap.bottom + tip.height + margin > vh && wrap.top - tip.height - margin > 0;
        const top = placeAbove ? wrap.top - tip.height - 8 : wrap.bottom + 8;
        setPos({ top, left, placeAbove });
    }, [open]);

    if (!text) return children;
    return (
        <>
            <span
                ref={wrapRef}
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
                tabIndex={0}
                className="inline-block"
            >
                {children}
            </span>
            {open && (
                <div
                    ref={tipRef}
                    role="tooltip"
                    style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 60, maxWidth: 320, whiteSpace: "pre-line" }}
                    className="bg-[#111111] text-white text-xs font-mono px-3 py-2 border border-black shadow-md leading-relaxed pointer-events-none"
                >
                    {text}
                </div>
            )}
        </>
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
