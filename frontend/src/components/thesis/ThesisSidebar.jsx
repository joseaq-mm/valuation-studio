import React, { useMemo, useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, TrendingUp, Building2, Folder, Trash2, Bell, ChevronDown, Check, RefreshCw, Plus } from "lucide-react";

const _norm = (s) => (s || "").trim().toLowerCase();

const STATE_COLOR = { included: "#1E7D45", not_included: "#9CA3AF", not_generated: "#C2410C" };

/** Dropdown for an actively-searched company: lists the tesis it fits, coloured
 *  green (already included), grey (existing but not included) or orange (not yet
 *  generated). Each row links to that tesis (or to create it). */
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
        else navigate(`/thesis?trend=${encodeURIComponent(ft.name)}`);
    };

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
                title="Tesis donde encaja. Verde: ya incluida · gris: no incluida · naranja: no generada. Clic para ir."
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider border border-black/25 px-1.5 py-0.5 hover:bg-[#F5E4D4] transition-colors"
                data-testid={`company-trends-toggle-${company.ticker}`}
            >
                <TrendingUp size={10} /> {fits.length} tesis <ChevronDown size={10} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
            {open && (
                <div className="absolute right-0 z-30 mt-1 w-64 max-h-60 overflow-auto border border-black bg-white shadow-lg" data-testid={`company-trends-menu-${company.ticker}`}>
                    <div className="px-2 py-1.5 text-[10px] text-[#4A4A4A] border-b border-black/10 bg-[#FDF1E6] leading-snug">
                        <span style={{ color: STATE_COLOR.included }} className="font-semibold">incluida</span> · <span style={{ color: STATE_COLOR.not_included }} className="font-semibold">no incluida</span> · <span style={{ color: STATE_COLOR.not_generated }} className="font-semibold">no generada</span>
                    </div>
                    {fits.length === 0 && <div className="px-2 py-2 text-xs text-[#9CA3AF]">Sin tesis identificadas.</div>}
                    {fits.map((ft, i) => (
                        <button
                            key={i}
                            onClick={() => goTo(ft)}
                            className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-1.5 hover:bg-[#F5E4D4] transition-colors"
                            style={{ color: STATE_COLOR[ft.state] || "#9CA3AF" }}
                            title={ft.state === "not_generated" ? "Aún no generada — clic para crearla" : ft.state === "included" ? "La empresa ya está incluida — clic para abrir" : "Tesis existente — la empresa aún no está incluida"}
                            data-testid={`company-trend-opt-${company.ticker}-${i}`}
                        >
                            {ft.state === "included" ? <Check size={11} className="shrink-0" /> : ft.state === "not_generated" ? <Plus size={11} className="shrink-0" /> : <span className="w-[11px] shrink-0" />}
                            <span className="truncate">{ft.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function TrendRow({ t, folders, onAssignFolder, onRemove }) {
    return (
        <div className="border border-black/20 px-2 py-1.5 hover:bg-[#F5E4D4] group" data-testid={`sidebar-trend-${t.id}`}>
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-[#B32A22] flex items-center gap-1 shrink-0">
                    <TrendingUp size={10} /> Tesis
                </span>
                <select
                    value={t.folder_id || ""}
                    onChange={(e) => onAssignFolder(t.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 border border-black/20 bg-white px-1 py-0.5 text-[10px] outline-none cursor-pointer"
                    title="Asignar a una megatendencia"
                    data-testid={`sidebar-trend-folder-${t.id}`}
                >
                    <option value="">— Megatendencia —</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button onClick={() => onRemove(t.id)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" title="Eliminar tesis">
                    <Trash2 size={12} />
                </button>
            </div>
            <Link to={`/thesis/${t.id}`} className="block mt-1.5 text-sm font-medium leading-tight truncate hover:underline" data-testid={`sidebar-trend-title-${t.id}`}>
                {t.title}
            </Link>
        </div>
    );
}

function CompanyRow({ c }) {
    return (
        <div className="border border-black/20 px-2 py-1.5 hover:bg-[#F5E4D4]" data-testid={`sidebar-company-${c.ticker}`}>
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-[#052049] flex items-center gap-1 shrink-0">
                    <Building2 size={10} /> Empresa
                </span>
                <div className="ml-auto shrink-0">
                    <CompanyTrendsDropdown company={c} />
                </div>
            </div>
            <Link to={`/thesis/${c.id}`} className="block mt-1.5 text-sm font-medium leading-tight truncate hover:underline" data-testid={`sidebar-company-title-${c.ticker}`}>
                {c.title || c.ticker} {c.ticker && <span className="font-mono text-[11px] text-[#4A4A4A]">{c.ticker}</span>}
            </Link>
        </div>
    );
}

export default function ThesisSidebar({
    trends = [], companyTheses = [], folders = [],
    onAssignFolder, onRemoveThesis,
    radarEnabled, onToggleRadar,
    refreshEnabled, onToggleRefresh,
}) {
    const [q, setQ] = useState("");

    const items = useMemo(() => {
        const ti = trends.map((t) => ({ kind: "trend", key: `t-${t.id}`, search: _norm(t.title), data: t }));
        const ci = companyTheses.map((c) => ({ kind: "company", key: `c-${c.id}`, search: `${_norm(c.title)} ${_norm(c.ticker)}`, data: c }));
        return [...ti, ...ci];
    }, [trends, companyTheses]);

    const nq = _norm(q);
    const filtered = nq ? items.filter((it) => it.search.includes(nq)) : items;

    return (
        <aside className="border border-black bg-white p-4 lg:sticky lg:top-4" data-testid="thesis-sidebar">
            <div className="overline text-black mb-2 flex items-center gap-1">
                Mis tesis y empresas ({items.length})
            </div>

            {/* Search with live dropdown */}
            <div className="relative mb-3">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#4A4A4A]" />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar tesis o empresa…"
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
                                {it.kind === "trend"
                                    ? <TrendingUp size={11} className="text-[#B32A22] shrink-0" />
                                    : <Building2 size={11} className="text-[#052049] shrink-0" />}
                                <span className="truncate">{it.data.title}</span>
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-1.5 max-h-[60vh] overflow-auto pr-0.5" data-testid="sidebar-list">
                {items.length === 0 && <div className="text-xs text-[#4A4A4A]">Aún no hay tesis ni empresas guardadas.</div>}
                {trends.map((t) => (
                    <TrendRow key={`t-${t.id}`} t={t} folders={folders} onAssignFolder={onAssignFolder} onRemove={onRemoveThesis} />
                ))}
                {companyTheses.map((c) => (
                    <CompanyRow key={`c-${c.id}`} c={c} />
                ))}
            </div>

            {/* Weekly trend radar */}
            <div className="mt-5 pt-4 border-t border-black/10" data-testid="radar-toggle-wrap">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="overline text-black flex items-center gap-1"><Bell size={12} /> Radar semanal</div>
                        <p className="text-[11px] text-[#4A4A4A] mt-1 leading-snug">Recibe un email cuando la IA detecte una tesis emergente con fuerte momentum.</p>
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

            {/* Weekly thesis refresh + news watch */}
            <div className="mt-4 pt-4 border-t border-black/10" data-testid="refresh-toggle-wrap">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="overline text-black flex items-center gap-1"><RefreshCw size={12} /> Refresco semanal</div>
                        <p className="text-[11px] text-[#4A4A4A] mt-1 leading-snug">Actualiza precios y TAM de tus tesis cada semana y, si hay una noticia importante, profundiza, refresca las tesis y empresas implicadas y te avisa por email.</p>
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
