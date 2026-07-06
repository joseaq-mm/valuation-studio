import React, { useState, useEffect, useCallback, useMemo } from "react";
import { BarChart3, Sparkles, Loader2, ExternalLink, Pencil, Check, X, RefreshCw, Search, AlertTriangle, Zap, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { kpiCompanies, kpiGet, kpiRun, kpiEdit, kpiSearch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import KpiDocuments from "@/components/kpi/KpiDocuments";
import KpiNews from "@/components/kpi/KpiNews";
import HoverTip from "@/components/HoverTip";
import { freshnessInfo, freshnessTip } from "@/lib/freshness";
import { toast } from "sonner";

const COEF_TIP = "Coeficiente de validación (C = 1 + α·S, α=0,5): resume si los KPIs validan la tesis. >1 (verde) se valida, <1 (rojo) se deteriora, ≈1 neutral. La S es la señal agregada (−1 a +1): el promedio, ponderado por la relevancia de cada KPI, de cuánto apoyan (+) o contradicen (−) la tesis. Ej.: S=+0,5 → C=1,25; S=0 → C=1,00; S=−0,5 → C=0,75.";

const coefColor = (c) => {
    if (c == null) return "#7A7A7A";
    if (c >= 1.05) return "#1D7044";
    if (c <= 0.95) return "#B32A22";
    return "#B8860B";
};
const coefLabel = (c) => {
    if (c == null) return "Sin datos";
    if (c >= 1.05) return "Validándose";
    if (c <= 0.95) return "Deteriorándose";
    return "Neutral";
};
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }); } catch { return ""; } };

const srcDomain = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

// Trend indicator: compares the latest coefficient with the previous (re)analysis.
const CoefTrend = ({ history }) => {
    if (!history || history.length < 2) return null;
    const last = history[history.length - 1].coef;
    const prev = history[history.length - 2].coef;
    const delta = last - prev;
    const up = delta > 0.005, down = delta < -0.005;
    const color = up ? "#1D7044" : down ? "#B32A22" : "#7A7A7A";
    const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
    const tip = "Evolución del coeficiente entre reanálisis (más reciente abajo):\n\n" +
        history.slice(-8).map((h) => `${h.date}: ${Number(h.coef).toFixed(2)}`).join("\n");
    return (
        <HoverTip text={tip}>
            <span className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums cursor-help" style={{ color }} data-testid="kpi-coef-trend">
                <Icon size={14} /> {delta > 0 ? "+" : ""}{delta.toFixed(2)} vs análisis previo
            </span>
        </HoverTip>
    );
};

const CoefBadge = ({ c, signal, size = "lg" }) => (
    <div className="inline-flex items-center gap-2" data-testid="coef-badge">
        <span
            className={`font-serif tabular-nums font-medium ${size === "lg" ? "text-4xl" : "text-xl"}`}
            style={{ color: coefColor(c) }}
        >
            {c == null ? "—" : c.toFixed(2)}
        </span>
        <span className="text-xs uppercase tracking-[0.12em] font-semibold" style={{ color: coefColor(c) }}>
            {coefLabel(c)}{signal != null ? ` · S=${signal.toFixed(2)}` : ""}
        </span>
    </div>
);

export default function Kpis() {
    const { user } = useAuth();
    const [companies, setCompanies] = useState([]);
    const [selId, setSelId] = useState(null);
    const [docsRefresh, setDocsRefresh] = useState(0);  // bump → KpiDocuments reloads (show auto-fetched docs after analysis)
    const [snap, setSnap] = useState(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);   // analysis progress text
    const [editing, setEditing] = useState(false);
    const [sortMode, setSortMode] = useState("thesis");  // thesis | analysis | alpha | coef

    const sortedCompanies = useMemo(() => {
        const arr = companies.map((c, i) => ({ c, i }));
        if (sortMode === "alpha") {
            arr.sort((a, b) => (a.c.ticker || "").localeCompare(b.c.ticker || "", "es"));
        } else if (sortMode === "coef") {
            // Highest coefficient first; companies without coefficient go last.
            arr.sort((a, b) => {
                const ca = a.c.coef_global, cb = b.c.coef_global;
                if (ca == null && cb == null) return a.i - b.i;
                if (ca == null) return 1;
                if (cb == null) return -1;
                return cb - ca;
            });
        } else if (sortMode === "analysis") {
            // Oldest analysis first; never-analyzed treated as oldest (need attention).
            arr.sort((a, b) => {
                const ta = a.c.kpi_generated_at ? Date.parse(a.c.kpi_generated_at) : 0;
                const tb = b.c.kpi_generated_at ? Date.parse(b.c.kpi_generated_at) : 0;
                return ta - tb;
            });
        } else {
            arr.sort((a, b) => a.i - b.i);  // API order = by thesis generation (default)
        }
        return arr.map((x) => x.c);
    }, [companies, sortMode]);
    const [draft, setDraft] = useState([]);
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchNote, setSearchNote] = useState(null);

    const loadCompanies = useCallback(async () => {
        if (!user) { setCompanies([]); return; }
        try {
            const d = await kpiCompanies();
            setCompanies(d.companies || []);
        } catch { setCompanies([]); }
    }, [user]);

    useEffect(() => { loadCompanies(); }, [loadCompanies]);

    const selectCompany = async (id) => {
        setSelId(id); setSnap(null); setEditing(false); setLoading(true);
        try {
            const d = await kpiGet(id);
            setSnap(d.kpi_snapshot || null);
        } catch { setSnap(null); }
        finally { setLoading(false); }
    };

    const analyze = async (mode = "full") => {
        if (!selId) return;
        const incr = mode === "incremental";
        setStatus(incr ? "Actualizando con los cambios…" : "Buscando resultados y comunicados…"); setLoading(true);
        try {
            const res = await kpiRun(selId, (s) => setStatus(s?.message || (incr ? "Actualizando KPIs…" : "Analizando KPIs con IA…")), mode);
            const result = res?.result || res;
            setSnap(result);
            await loadCompanies();
            setDocsRefresh((n) => n + 1);  // reveal auto-fetched docs (SEC/deck/página) added during the analysis
            toast.success(incr ? "KPIs actualizados" : "KPIs analizados");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error analizando KPIs");
        } finally { setStatus(null); setLoading(false); }
    };

    const startEdit = () => { setDraft((snap.kpis || []).map((k) => ({ ...k }))); setEditing(true); };    const setField = (i, field, val) => setDraft((d) => d.map((k, j) => (j === i ? { ...k, [field]: val } : k)));
    const saveEdit = async () => {
        setLoading(true);
        try {
            const payload = draft.map((k) => ({
                ...k,
                signal: k.signal === "" || k.signal == null ? null : Number(k.signal),
                weight: k.weight === "" || k.weight == null ? null : Number(k.weight),
            }));
            const d = await kpiEdit(selId, payload);
            setSnap(d.kpi_snapshot);
            setEditing(false);
            toast.success("Coeficiente recalculado");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error al guardar");
        } finally { setLoading(false); }
    };

    const rows = editing ? draft : (snap?.kpis || []);
    const selCompany = companies.find((c) => c.id === selId);

    const doSearch = async () => {
        const q = query.trim();
        if (!q || searching) return;
        setSearching(true); setSearchNote(null);
        try {
            const res = await kpiSearch(selId, q);
            const result = res?.result || res;
            setSnap(result);
            setQuery("");
            if (result?.search_note) { setSearchNote(result.search_note); toast.info(result.search_note); }
            else { toast.success("KPI añadido · coeficiente actualizado"); await loadCompanies(); }
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error buscando el dato");
        } finally { setSearching(false); }
    };

    if (!user) {
        return (
            <div data-testid="kpis-page">
                <div className="overline text-[#B32A22] mb-2">Validación operativa</div>
                <h1 className="font-serif text-4xl mb-4">KPIs</h1>
                <div className="border border-black bg-white p-8 text-center text-[#4A4A4A]">
                    Inicia sesión con Google para validar tus tesis con los KPIs operativos de cada empresa.
                </div>
            </div>
        );
    }

    return (
        <div data-testid="kpis-page">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
                <div>
                    <div className="overline text-[#B32A22] mb-1">Validación operativa de la tesis</div>
                    <h1 className="font-serif text-4xl leading-none flex items-center gap-2"><BarChart3 size={30} /> KPIs</h1>
                </div>
            </div>
            <p className="text-sm text-[#4A4A4A] max-w-2xl mb-6">
                Extrae por IA los KPIs operativos (ARR, NRR, clientes, backlog, suscriptores…) de los últimos resultados y calcula un
                <strong> coeficiente de validación</strong>: <span className="text-[#1D7044] font-semibold">&gt;1 la tesis se valida</span>,
                <span className="text-[#B32A22] font-semibold"> &lt;1 se deteriora</span>.
            </p>

            {/* Company selector */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2 text-[11px]" data-testid="kpi-sort-controls">
                <span className="uppercase tracking-wider text-[#7A7A7A] mr-1">Ordenar:</span>
                {[
                    { k: "analysis", label: "Antigüedad de análisis", tip: "Ordena por cuándo se analizó o reanalizó por última vez (lo más antiguo —o sin analizar— primero; lo que más conviene actualizar)." },
                    { k: "alpha", label: "Alfabético", tip: "Ordena las empresas por ticker, de la A a la Z." },
                    { k: "coef", label: "Por coeficiente", tip: "Ordena por el coeficiente de validación, de mayor a menor (las tesis que más se están validando primero; las que se deterioran al final). Las empresas sin coeficiente calculado quedan al final." },
                    { k: "thesis", label: "Por tesis", tip: "Orden por defecto: por antigüedad del plan de tesis. Una empresa aparece aquí cuando desarrollas su plan de tesis; se listan en el orden en que fuiste creando esos planes en tu cuenta (igual que en la página de Tesis)." },
                ].map((o) => (
                    <HoverTip key={o.k} text={o.tip}>
                        <button onClick={() => setSortMode(o.k)}
                            className={`px-2 py-0.5 border transition-colors ${sortMode === o.k ? "bg-black text-[#FDF1E6] border-black" : "bg-white text-black border-black/30 hover:border-black"}`}
                            data-testid={`kpi-sort-${o.k}`}>{o.label}</button>
                    </HoverTip>
                ))}
            </div>
            <div className="flex flex-wrap gap-2 mb-6" data-testid="kpi-company-selector">
                {sortedCompanies.map((c) => (
                    <button
                        key={c.id}
                        onClick={() => selectCompany(c.id)}
                        className={`text-xs font-semibold px-3 py-1.5 border transition-colors flex flex-col items-start gap-0.5 ${selId === c.id ? "bg-black text-[#FDF1E6] border-black" : "bg-white text-black border-black/30 hover:border-black"}`}
                        data-testid={`kpi-company-${c.ticker}`}
                    >
                        <span className="flex items-center gap-1.5">
                            {c.ticker}
                            {c.has_kpis && c.coef_global != null && (
                                <span className="tabular-nums" style={{ color: selId === c.id ? "#fff" : coefColor(c.coef_global) }}>· {c.coef_global.toFixed(2)}</span>
                            )}
                        </span>
                        {c.has_kpis && (() => {
                            const info = freshnessInfo(c.kpi_generated_at, c.most_recent_quarter);
                            if (!info) return null;
                            const col = info.stale ? (selId === c.id ? "#FCA5A5" : "#B32A22") : (selId === c.id ? "#D1D5DB" : "#111111");
                            return (
                                <span className="text-[9px] font-normal tabular-nums" style={{ color: col, fontWeight: info.stale ? 700 : 400 }}
                                    title={freshnessTip(info, "la última actualización del KPI")} data-testid={`kpi-fresh-${c.ticker}`}>
                                    hace {info.days}d
                                </span>
                            );
                        })()}
                    </button>
                ))}
                {companies.length === 0 && <span className="text-sm text-[#4A4A4A]">No tienes empresas con tesis desarrollada todavía.</span>}
            </div>

            {!selId && <div className="text-sm text-[#4A4A4A] border border-dashed border-black/30 p-6 text-center">Elige una empresa para empezar.</div>}

            {/* Document sources (available before & after analysis) */}
            {selId && <KpiDocuments companyId={selId} refreshKey={docsRefresh} />}

            {/* Qualitative news (informs scores; aged out over time) */}
            {selId && <KpiNews companyId={selId} />}

            {selId && loading && !status && (
                <div className="flex items-center gap-2 text-[#4A4A4A] py-8 justify-center"><Loader2 className="animate-spin" size={18} /> Cargando…</div>
            )}

            {selId && status && (
                <div className="border border-black bg-white p-8 text-center" data-testid="kpi-analyzing">
                    <Loader2 className="animate-spin mx-auto mb-3 text-[#B32A22]" size={28} />
                    <div className="font-serif text-lg">{selCompany?.name}</div>
                    <div className="text-sm text-[#4A4A4A] mt-1">{status}</div>
                    <div className="text-xs text-[#7A7A7A] mt-2">Puede tardar ~1–3 min (lee páginas y documentos en vivo + IA).</div>
                </div>
            )}

            {/* No snapshot yet → analyze CTA */}
            {selId && !loading && !status && !snap && (
                <div className="border border-black bg-white p-8 text-center" data-testid="kpi-empty">
                    <div className="font-serif text-xl mb-1">{selCompany?.name}</div>
                    <p className="text-sm text-[#4A4A4A] mb-4">Aún no se han analizado los KPIs operativos de esta empresa.</p>
                    <button onClick={() => analyze("full")} className="btn-primary inline-flex items-center gap-2" data-testid="kpi-analyze-btn">
                        <Sparkles size={15} /> Analizar KPIs
                    </button>
                </div>
            )}

            {/* Snapshot */}
            {selId && !status && snap && (
                <div data-testid="kpi-result">
                    {/* Global coefficient header */}
                    <div className="border border-black bg-white p-5 mb-4 flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <div className="overline text-[#4A4A4A] mb-1">Coeficiente global · {selCompany?.name}</div>
                            <div className="flex items-center gap-3 flex-wrap">
                                <CoefBadge c={snap.coef_global} signal={snap.signal_global} />
                                <CoefTrend history={snap.coef_history} />
                            </div>
                            <div className="text-xs text-[#7A7A7A] mt-1">
                                {snap.period ? `Periodo: ${snap.period} · ` : ""}{snap.generated_at ? `Analizado ${fmtDate(snap.generated_at)}` : ""}{snap.edited_at ? " · editado" : ""}
                            </div>
                            {(() => {
                                const uncovered = (snap.drivers || []).filter((d) => !d.n_kpis);
                                if (!uncovered.length) return null;
                                return (
                                    <div className="mt-2 flex items-start gap-1.5 text-[12px] bg-[#FBF3E0] border border-[#B8860B]/50 px-2.5 py-1.5 max-w-xl" data-testid="kpi-uncovered-warning">
                                        <AlertTriangle size={14} className="text-[#B8860B] shrink-0 mt-0.5" />
                                        <div className="text-[#7a5a10] leading-snug">
                                            {uncovered.length === 1 ? "1 área de la tesis sin KPIs" : `${uncovered.length} áreas de la tesis sin KPIs`} (<strong>{uncovered.map((d) => d.name).join(", ")}</strong>): el coeficiente solo refleja las áreas con datos. Busca o desarrolla KPIs de esas áreas para una validación más fiable y completa.
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="flex items-center gap-2">
                            {!editing && (
                                <>
                                    <HoverTip text="Incorpora solo los cambios desde el último análisis: noticias refrescadas y documentos añadidos. Rejuzga con el contexto actual sin volver a buscar ni re-parsear documentos. Rápido y barato; ideal para cambios pequeños y frecuentes.">
                                        <button onClick={() => analyze("incremental")} className="btn-ghost inline-flex items-center gap-1.5" data-testid="kpi-update-btn"><Zap size={13} /> Actualizar</button>
                                    </HoverTip>
                                    <HoverTip text="Reconstrucción completa desde cero: vuelve a buscar fuentes, descarga y re-parsea documentos, refresca noticias y recalcula todo. Más lento y con más coste; úsalo para cambios grandes (p. ej. tras resultados).">
                                        <button onClick={() => analyze("full")} className="btn-ghost inline-flex items-center gap-1.5" data-testid="kpi-reanalyze-btn"><RefreshCw size={13} /> Reanalizar</button>
                                    </HoverTip>
                                </>
                            )}
                        </div>
                    </div>

                    {snap.no_source_doc && (
                        <div className="border border-[#B32A22]/50 bg-[#FBE9E7] p-3 mb-4 flex items-start gap-2 max-w-3xl" data-testid="kpi-no-source-warning">
                            <AlertTriangle size={16} className="text-[#B32A22] shrink-0 mt-0.5" />
                            <div className="text-[13px] text-[#8a2318] leading-snug">
                                No se encontró ningún <strong>informe o deck oficial</strong> de {selCompany?.name} para descargar automáticamente, así que el coeficiente se ha calculado solo con búsquedas web (menos fiable).
                                Para una validación robusta, <strong>sube el PDF de resultados</strong> o <strong>pega el transcript</strong> de la llamada en la sección «Documentos como fuente» de abajo y pulsa <em>Actualizar</em>.
                            </div>
                        </div>
                    )}

                    {snap.note && <div className="border border-[#B8860B]/50 bg-[#FBF3E0] p-3 text-sm text-[#7a5a10] mb-4">{snap.note}</div>}

                    {/* Targeted KPI search — adds a specific datapoint and recomputes the coefficient */}
                    <div className="border border-[#052049]/30 bg-[#F4F6FA] p-3 mb-4" data-testid="kpi-search-box">
                        <div className="overline text-[#052049] mb-1.5 flex items-center gap-1.5"><Search size={13} /> Buscar un KPI específico</div>
                        <div className="flex items-center gap-2">
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
                                placeholder="p. ej. número de suscriptores, ARR, backlog…"
                                className="flex-1 border border-black/30 bg-white px-3 py-1.5 text-sm outline-none focus:border-black"
                                disabled={searching}
                                data-testid="kpi-search-input"
                            />
                            <button onClick={doSearch} disabled={searching || !query.trim()} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-40" data-testid="kpi-search-btn">
                                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                                {searching ? "Buscando…" : "Buscar y añadir"}
                            </button>
                        </div>
                        <p className="text-[11px] text-[#4A4A4A] mt-1.5">El dato se extrae por IA (con su fuente), se incorpora al cálculo y <strong>actualiza el coeficiente</strong>.</p>
                        {searchNote && <div className="text-xs text-[#B32A22] mt-1.5">{searchNote}</div>}
                    </div>

                    {/* Per-driver coefficients */}
                    {snap.drivers?.length > 0 && (
                        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }} data-testid="kpi-drivers">
                            {snap.drivers.map((d, i) => (
                                <div key={i} className="border border-black/20 bg-white p-3" data-testid={`kpi-driver-${i}`}>
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <div className="text-sm font-semibold leading-tight">{d.name}</div>
                                        <CoefBadge c={d.coef} size="sm" />
                                    </div>
                                    <div className="text-[11px] text-[#7A7A7A] mb-1">{d.n_kpis} KPI{d.n_kpis === 1 ? "" : "s"}</div>
                                    {d.verdict && <p className="text-xs text-[#3A3A3A] leading-relaxed">{d.verdict}</p>}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* KPI table */}
                    {rows.length > 0 && (
                        <div className="border border-black bg-white overflow-x-auto" data-testid="kpi-table">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-black text-left overline text-[#4A4A4A]">
                                        <th className="p-2">
                                            <div className="flex items-center gap-2">
                                                <span>KPI</span>
                                                {!editing ? (
                                                    <button onClick={startEdit} className="btn-ghost inline-flex items-center gap-1 !py-0.5 !px-1.5 normal-case text-xs" data-testid="kpi-edit-btn"><Pencil size={12} /> Editar</button>
                                                ) : (
                                                    <>
                                                        <button onClick={() => setEditing(false)} className="btn-ghost inline-flex items-center gap-1 !py-0.5 !px-1.5 normal-case text-xs" data-testid="kpi-cancel-edit"><X size={12} /> Cancelar</button>
                                                        <button onClick={saveEdit} className="btn-primary inline-flex items-center gap-1 !py-0.5 !px-1.5 normal-case text-xs" data-testid="kpi-save-edit"><Check size={12} /> Guardar</button>
                                                    </>
                                                )}
                                            </div>
                                        </th>
                                        <th className="p-2 text-right">Actual</th>
                                        <th className="p-2 text-right">Anterior</th>
                                        <th className="p-2 text-right">YoY</th>
                                        <th className="p-2 text-right">Señal</th>
                                        <th className="p-2 text-right">Peso</th>
                                        <th className="p-2">Driver</th>
                                        <th className="p-2">Fuente</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((k, i) => (
                                        <tr key={i} className="border-b border-black/10 align-top" data-testid={`kpi-row-${i}`}>
                                            <td className="p-2">
                                                <div className="font-medium">{k.name}</div>
                                                {k.rationale && !editing && <div className="text-[11px] text-[#7A7A7A] leading-snug mt-0.5">{k.rationale}</div>}
                                            </td>
                                            <td className="p-2 text-right tabular-nums">
                                                {editing
                                                    ? <input value={k.value_current ?? ""} onChange={(e) => setField(i, "value_current", e.target.value)} className="w-20 text-right border border-black/30 px-1 py-0.5" data-testid={`kpi-edit-val-${i}`} />
                                                    : <span className="font-semibold">{k.value_current ?? "—"}</span>}
                                            </td>
                                            <td className="p-2 text-right tabular-nums text-[#7A7A7A]">
                                                {editing
                                                    ? <input value={k.value_prior ?? ""} onChange={(e) => setField(i, "value_prior", e.target.value)} className="w-20 text-right border border-black/30 px-1 py-0.5" />
                                                    : (k.value_prior ?? "—")}
                                            </td>
                                            <td className="p-2 text-right tabular-nums text-xs">{k.yoy_change ?? "—"}</td>
                                            <td className="p-2 text-right tabular-nums" style={{ color: !editing ? (k.signal > 0 ? "#1D7044" : k.signal < 0 ? "#B32A22" : "#7A7A7A") : undefined }}>
                                                {editing
                                                    ? <input type="number" step="0.1" min="-1" max="1" value={k.signal ?? ""} onChange={(e) => setField(i, "signal", e.target.value)} className="w-16 text-right border border-black/30 px-1 py-0.5" data-testid={`kpi-edit-signal-${i}`} />
                                                    : (k.signal != null ? Number(k.signal).toFixed(2) : "—")}
                                            </td>
                                            <td className="p-2 text-right tabular-nums">
                                                {editing
                                                    ? <input type="number" step="0.1" min="0" max="1" value={k.weight ?? ""} onChange={(e) => setField(i, "weight", e.target.value)} className="w-16 text-right border border-black/30 px-1 py-0.5" data-testid={`kpi-edit-weight-${i}`} />
                                                    : (k.weight != null ? Number(k.weight).toFixed(2) : "—")}
                                            </td>
                                            <td className="p-2 text-xs text-[#4A4A4A]">{k.driver}</td>
                                            <td className="p-2">
                                                {k.source_url
                                                    ? <HoverTip text={`${k.source_quote || "Sin cita textual disponible"}${srcDomain(k.source_url) ? `\n\nFuente: ${srcDomain(k.source_url)}` : ""}`} maxWidth={340}>
                                                        <a href={k.source_url} target="_blank" rel="noreferrer" className="text-[#052049] inline-flex items-center gap-0.5 text-xs hover:underline cursor-help" data-testid={`kpi-source-${i}`}><ExternalLink size={12} /> ver</a>
                                                    </HoverTip>
                                                    : (k.source_quote
                                                        ? <HoverTip text={k.source_quote} maxWidth={340}><span className="text-[#7A7A7A] text-xs cursor-help border-b border-dotted border-[#7A7A7A]" data-testid={`kpi-source-${i}`}>cita</span></HoverTip>
                                                        : <span className="text-[#9A9A9A] text-xs">—</span>)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Sources */}
                    {snap.sources?.length > 0 && (
                        <div className="mt-4 text-xs text-[#7A7A7A]">
                            <span className="overline">Fuentes consultadas:</span>{" "}
                            {snap.sources.slice(0, 8).map((s, i) => (
                                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="hover:underline mr-2">[{i + 1}]</a>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
