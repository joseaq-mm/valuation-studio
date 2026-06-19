import React, { useState, useEffect, useCallback } from "react";
import { BarChart3, Sparkles, Loader2, ExternalLink, Pencil, Check, X, RefreshCw, Search } from "lucide-react";
import { kpiCompanies, kpiGet, kpiRun, kpiEdit, kpiSearch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import KpiDocuments from "@/components/kpi/KpiDocuments";
import { toast } from "sonner";

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
    const [snap, setSnap] = useState(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);   // analysis progress text
    const [editing, setEditing] = useState(false);
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

    const analyze = async () => {
        if (!selId) return;
        setStatus("Buscando resultados y comunicados…"); setLoading(true);
        try {
            const res = await kpiRun(selId, (s) => setStatus(s?.message || "Analizando KPIs con IA…"));
            const result = res?.result || res;
            setSnap(result);
            await loadCompanies();
            toast.success("KPIs analizados");
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
            <div className="flex flex-wrap gap-2 mb-6" data-testid="kpi-company-selector">
                {companies.map((c) => (
                    <button
                        key={c.id}
                        onClick={() => selectCompany(c.id)}
                        className={`text-xs font-semibold px-3 py-1.5 border transition-colors flex items-center gap-1.5 ${selId === c.id ? "bg-black text-[#FDF1E6] border-black" : "bg-white text-black border-black/30 hover:border-black"}`}
                        data-testid={`kpi-company-${c.ticker}`}
                    >
                        {c.ticker}
                        {c.has_kpis && c.coef_global != null && (
                            <span className="tabular-nums" style={{ color: selId === c.id ? "#fff" : coefColor(c.coef_global) }}>· {c.coef_global.toFixed(2)}</span>
                        )}
                    </button>
                ))}
                {companies.length === 0 && <span className="text-sm text-[#4A4A4A]">No tienes empresas con tesis desarrollada todavía.</span>}
            </div>

            {!selId && <div className="text-sm text-[#4A4A4A] border border-dashed border-black/30 p-6 text-center">Elige una empresa para empezar.</div>}

            {/* Document sources (available before & after analysis) */}
            {selId && <KpiDocuments companyId={selId} />}

            {selId && loading && !status && (
                <div className="flex items-center gap-2 text-[#4A4A4A] py-8 justify-center"><Loader2 className="animate-spin" size={18} /> Cargando…</div>
            )}

            {selId && status && (
                <div className="border border-black bg-white p-8 text-center" data-testid="kpi-analyzing">
                    <Loader2 className="animate-spin mx-auto mb-3 text-[#B32A22]" size={28} />
                    <div className="font-serif text-lg">{selCompany?.name}</div>
                    <div className="text-sm text-[#4A4A4A] mt-1">{status}</div>
                    <div className="text-xs text-[#7A7A7A] mt-2">Puede tardar ~30–60s (búsqueda en vivo + IA).</div>
                </div>
            )}

            {/* No snapshot yet → analyze CTA */}
            {selId && !loading && !status && !snap && (
                <div className="border border-black bg-white p-8 text-center" data-testid="kpi-empty">
                    <div className="font-serif text-xl mb-1">{selCompany?.name}</div>
                    <p className="text-sm text-[#4A4A4A] mb-4">Aún no se han analizado los KPIs operativos de esta empresa.</p>
                    <button onClick={analyze} className="btn-primary inline-flex items-center gap-2" data-testid="kpi-analyze-btn">
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
                            <CoefBadge c={snap.coef_global} signal={snap.signal_global} />
                            <div className="text-xs text-[#7A7A7A] mt-1">
                                {snap.period ? `Periodo: ${snap.period} · ` : ""}{snap.generated_at ? `Analizado ${fmtDate(snap.generated_at)}` : ""}{snap.edited_at ? " · editado" : ""}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {!editing ? (
                                <>
                                    {snap.kpis?.length > 0 && (
                                        <button onClick={startEdit} className="btn-ghost inline-flex items-center gap-1.5" data-testid="kpi-edit-btn"><Pencil size={13} /> Editar</button>
                                    )}
                                    <button onClick={analyze} className="btn-ghost inline-flex items-center gap-1.5" data-testid="kpi-reanalyze-btn"><RefreshCw size={13} /> Reanalizar</button>
                                </>
                            ) : (
                                <>
                                    <button onClick={() => setEditing(false)} className="btn-ghost inline-flex items-center gap-1.5" data-testid="kpi-cancel-edit"><X size={13} /> Cancelar</button>
                                    <button onClick={saveEdit} className="btn-primary inline-flex items-center gap-1.5" data-testid="kpi-save-edit"><Check size={13} /> Guardar</button>
                                </>
                            )}
                        </div>
                    </div>

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
                                        <th className="p-2">KPI</th>
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
                                                    ? <a href={k.source_url} target="_blank" rel="noreferrer" className="text-[#052049] inline-flex items-center gap-0.5 text-xs hover:underline" title={k.source_quote}><ExternalLink size={12} /> ver</a>
                                                    : <span className="text-[#9A9A9A] text-xs">—</span>}
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
