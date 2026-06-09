import React, { useMemo, useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, TrendingUp, Building2, Trash2, Bell, ChevronDown, Check, RefreshCw } from "lucide-react";

const _norm = (s) => (s || "").trim().toLowerCase();

/** Dropdown for a saved company: lists ONLY the trend theses already generated where
 *  the company actually appears (membership). Each row links to that thesis. */
function CompanyTrendsDropdown({ company }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const navigate = useNavigate();
    const fits = company.fit_trends || [];
    useEffect(() => {
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, []);

    const goTo = (ft) => {
        setOpen(false);
        if (ft.thesis_id) navigate(`/thesis/${ft.thesis_id}`);
    };

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
                title="Tesis ya generadas donde la empresa está incluida. Clic para abrir."
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider border border-black/25 px-1.5 py-0.5 hover:bg-[#F5E4D4] transition-colors"
                data-testid={`company-trends-toggle-${company.ticker}`}
            >
                <TrendingUp size={10} /> {fits.length} tesis <ChevronDown size={10} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
            {open && (
                <div className="absolute right-0 z-30 mt-1 w-64 max-h-60 overflow-auto border border-black bg-white shadow-lg" data-testid={`company-trends-menu-${company.ticker}`}>
                    <div className="px-2 py-1.5 text-[10px] text-[#4A4A4A] border-b border-black/10 bg-[#FDF1E6] leading-snug">
                        Tesis donde <span className="font-mono font-semibold">{company.ticker}</span> ya está incluida
                    </div>
                    {fits.length === 0 && <div className="px-2 py-2 text-xs text-[#9CA3AF]">Aún no aparece en ninguna tesis.</div>}
                    {fits.map((ft, i) => (
                        <button
                            key={i}
                            onClick={() => goTo(ft)}
                            className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-1.5 hover:bg-[#F5E4D4] transition-colors text-[#1E7D45]"
                            title={`Ya incluida en: ${ft.name} — clic para abrir`}
                            data-testid={`company-trend-opt-${company.ticker}-${i}`}
                        >
                            <Check size={11} className="shrink-0" />
                            <span className="truncate">{ft.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** A saved 'tendencia' (Tendencias → Empresas). Groups into a megatendencia (folder)
 *  and shows its forward CAGR + TAM at a glance. */
function TendenciaRow({ t, folders, onAssignFolder, onRemove }) {
    const tam = t.tam_busd != null ? (t.tam_busd >= 1000 ? `$${(t.tam_busd / 1000).toFixed(1)}T` : `$${Math.round(t.tam_busd)}B`) : null;
    return (
        <div className="border border-black/20 px-2 py-1.5 hover:bg-[#F5E4D4] group" data-testid={`sidebar-tendencia-${t.id}`}>
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-[#B8860B] flex items-center gap-1 shrink-0">
                    <TrendingUp size={10} /> Tendencia
                </span>
                <select
                    value={t.folder_id || ""}
                    onChange={(e) => onAssignFolder(t.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 border border-black/20 bg-white px-1 py-0.5 text-[10px] outline-none cursor-pointer"
                    title="Asignar a una megatendencia"
                    data-testid={`sidebar-tendencia-folder-${t.id}`}
                >
                    <option value="">— Megatendencia —</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button onClick={() => onRemove(t.id)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" title="Eliminar tendencia" data-testid={`sidebar-tendencia-remove-${t.id}`}>
                    <Trash2 size={12} />
                </button>
            </div>
            <Link to={`/thesis/${t.id}`} title={t.title} className="block mt-1.5 text-sm font-medium leading-tight truncate hover:underline" data-testid={`sidebar-tendencia-title-${t.id}`}>
                {t.title}
            </Link>
            {(t.cagr_4y != null || tam) && (
                <div className="mt-1 flex items-center gap-2.5 text-[10px] font-mono">
                    {t.cagr_4y != null && <span className="text-[#052049] font-bold">{t.cagr_4y > 0 ? "+" : ""}{t.cagr_4y}% CAGR</span>}
                    {tam && <span className="text-[#1E7D45]">{tam} TAM</span>}
                </div>
            )}
        </div>
    );
}

function CompanyRow({ c, onRemove }) {
    return (
        <div className="border border-black/20 px-2 py-1.5 hover:bg-[#F5E4D4] group" data-testid={`sidebar-company-${c.ticker}`}>
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-[#052049] flex items-center gap-1 shrink-0">
                    <Building2 size={10} /> Empresa
                </span>
                <div className="ml-auto shrink-0">
                    <CompanyTrendsDropdown company={c} />
                </div>
                <button onClick={() => onRemove(c.id)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" title="Eliminar tesis de empresa" data-testid={`sidebar-company-remove-${c.ticker}`}>
                    <Trash2 size={12} />
                </button>
            </div>
            <Link to={`/thesis/${c.id}`} title={`${c.title || c.ticker}${c.ticker ? ` · ${c.ticker}` : ""}`} className="block mt-1.5 text-sm font-medium leading-tight truncate hover:underline" data-testid={`sidebar-company-title-${c.ticker}`}>
                {c.title || c.ticker} {c.ticker && <span className="font-mono text-[11px] text-[#4A4A4A]">{c.ticker}</span>}
            </Link>
        </div>
    );
}

function Section({ title, count, children }) {
    if (!count) return null;
    return (
        <div className="space-y-1.5">
            <div className="overline text-[#4A4A4A] pt-1">{title} ({count})</div>
            {children}
        </div>
    );
}

export default function ThesisSidebar({
    tendencias = [], companyTheses = [], folders = [],
    onAssignFolder, onRemoveThesis,
    radarEnabled, onToggleRadar,
    refreshEnabled, onToggleRefresh,
}) {
    const [q, setQ] = useState("");

    const items = useMemo(() => {
        const dn = tendencias.map((t) => ({ kind: "tendencia", key: `d-${t.id}`, search: _norm(t.title), data: t }));
        const ci = companyTheses.map((c) => ({ kind: "company", key: `c-${c.id}`, search: `${_norm(c.title)} ${_norm(c.ticker)}`, data: c }));
        return [...dn, ...ci];
    }, [tendencias, companyTheses]);

    const nq = _norm(q);
    const filtered = nq ? items.filter((it) => it.search.includes(nq)) : items;

    const iconFor = (kind) =>
        kind === "company" ? <Building2 size={11} className="text-[#052049] shrink-0" />
            : <TrendingUp size={11} className="text-[#B8860B] shrink-0" />;

    return (
        <aside className="border border-black bg-white p-4 lg:sticky lg:top-4" data-testid="thesis-sidebar">
            <div className="overline text-black mb-2 flex items-center gap-1">
                Tendencias y empresas ({items.length})
            </div>

            {/* Search with live dropdown */}
            <div className="relative mb-3">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#4A4A4A]" />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar tendencia o empresa…"
                    className="w-full border border-black/30 pl-7 pr-2 py-1.5 text-xs outline-none focus:border-black"
                    data-testid="sidebar-search"
                />
                {nq && (
                    <div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto border border-black bg-white shadow-lg" data-testid="sidebar-search-results">
                        {filtered.length === 0 && <div className="px-2 py-2 text-xs text-[#9CA3AF]">Sin coincidencias.</div>}
                        {filtered.slice(0, 10).map((it) => (
                            <Link
                                key={it.key}
                                to={`/thesis/${it.data.id}`}
                                onClick={() => setQ("")}
                                className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-[#F5E4D4] transition-colors"
                                data-testid={`sidebar-search-opt-${it.key}`}
                            >
                                {iconFor(it.kind)}
                                <span className="truncate" title={it.data.title}>{it.data.title}</span>
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-auto pr-0.5" data-testid="sidebar-list">
                {items.length === 0 && <div className="text-xs text-[#4A4A4A]">Aún no hay tendencias ni empresas guardadas.</div>}

                <Section title="Tendencias" count={tendencias.length}>
                    {tendencias.map((t) => <TendenciaRow key={`d-${t.id}`} t={t} folders={folders} onAssignFolder={onAssignFolder} onRemove={onRemoveThesis} />)}
                </Section>

                <Section title="Empresas" count={companyTheses.length}>
                    {companyTheses.map((c) => <CompanyRow key={`c-${c.id}`} c={c} onRemove={onRemoveThesis} />)}
                </Section>
            </div>

            {/* Weekly trend radar */}
            <div className="mt-5 pt-4 border-t border-black/10" data-testid="radar-toggle-wrap">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="overline text-black flex items-center gap-1"><Bell size={12} /> Radar semanal</div>
                        <p className="text-[11px] text-[#4A4A4A] mt-1 leading-snug">Recibe un email cuando la IA detecte una tendencia emergente con fuerte momentum.</p>
                    </div>
                    <button
                        onClick={onToggleRadar}
                        role="switch"
                        aria-checked={radarEnabled}
                        className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${radarEnabled ? "bg-[#1E7D45]" : "bg-black/20"}`}
                        data-testid="radar-toggle"
                    >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${radarEnabled ? "translate-x-5" : ""}`} />
                    </button>
                </div>
            </div>

            {/* Weekly data refresh (same logic & effect as the manual Refresh button) */}
            <div className="mt-4 pt-4 border-t border-black/10" data-testid="refresh-toggle-wrap">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="overline text-black flex items-center gap-1"><RefreshCw size={12} /> Refresco semanal</div>
                        <p className="text-[11px] text-[#4A4A4A] mt-1 leading-snug">Actualiza automáticamente precios, fundamentales y TAM de tus empresas y tesis una vez por semana, contando desde tu último refresco (manual o semanal). Mismo efecto que el botón de refrescar.</p>
                    </div>
                    <button
                        onClick={onToggleRefresh}
                        role="switch"
                        aria-checked={refreshEnabled}
                        className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${refreshEnabled ? "bg-[#1E7D45]" : "bg-black/20"}`}
                        data-testid="refresh-toggle"
                    >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${refreshEnabled ? "translate-x-5" : ""}`} />
                    </button>
                </div>
            </div>
        </aside>
    );
}
