import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Bookmark, X, Flame, ExternalLink } from "lucide-react";
import HoverTip from "@/components/HoverTip";

const _norm = (s) => (s || "").trim().toLowerCase();

// 'disruptor' is reserved for genuine paradigm-shift / risky bets that threaten the
// leader / radically-superior approaches; any other non-leader is a 'competitor'.
function catBadge(category) {
    if (category === "disruptor") return { txt: "Disruptor", cls: "bg-[#B32A22] text-white" };
    if (category === "leader") return { txt: "Líder", cls: "bg-[#052049] text-[#FDF1E6]" };
    return { txt: "Competidor", cls: "bg-[#4A4A4A] text-white" };
}

// TAM expressed in USD billions. Show $B, or $T when ≥1000.
function fmtTam(busd) {
    if (busd == null || isNaN(busd)) return null;
    if (busd >= 1000) return `$${(busd / 1000).toFixed(busd >= 10000 ? 0 : 1)} T`;
    if (busd >= 10) return `$${Math.round(busd)} B`;
    return `$${busd} B`;
}

function TamBadge({ busd, label, note }) {
    const txt = fmtTam(busd);
    if (!txt) return null;
    const inner = (
        <div className="flex flex-col items-center gap-0.5" data-testid="tendencia-tam-badge">
            <div className="font-mono font-bold leading-none text-[#1E7D45] text-2xl">{txt}</div>
            <span className="overline text-[#4A4A4A] text-center leading-tight">{label}</span>
        </div>
    );
    return note
        ? <HoverTip text={`${note}\n\n(TAM en miles de millones de USD · estimación informativa)`} maxWidth={300}><div className="cursor-help">{inner}</div></HoverTip>
        : inner;
}

/** Informational company card (no scores): role + prominence + "Generar tesis". */
function CompanyCard({ c, onDevelopCompany }) {
    const badge = catBadge(c.category);
    return (
        <div className="border border-black bg-white p-4" data-testid={`tendencia-company-${c.ticker || _norm(c.name).slice(0, 10)}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <span
                        className={`inline-block text-[10px] uppercase tracking-[0.12em] font-bold px-1.5 py-0.5 mb-1 ${badge.cls}`}
                        data-testid={`tendencia-category-${c.ticker || _norm(c.name).slice(0, 10)}`}
                    >
                        {badge.txt}
                    </span>
                    <div className="font-serif text-lg font-medium leading-tight">{c.name}</div>
                    <div className="overline text-[#4A4A4A] mt-0.5">{c.value_chain_role}</div>
                </div>
                {c.ticker && (
                    <Link to={`/company/${c.ticker}`}
                          className="shrink-0 inline-flex items-center gap-1 font-mono text-xs font-semibold bg-black text-[#FDF1E6] px-2 py-1 hover:bg-[#052049] transition-colors"
                          data-testid={`tendencia-company-link-${c.ticker}`}>
                        {c.ticker} <ArrowRight size={12} />
                    </Link>
                )}
            </div>

            {c.why && <p className="text-sm mt-2.5 text-[#1a1a1a] leading-relaxed">{c.why}</p>}

            {c.ticker && (
                <button
                    onClick={() => onDevelopCompany?.(c.ticker, c.name)}
                    className="mt-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] font-semibold border border-black px-2.5 py-1.5 hover:bg-black hover:text-[#FDF1E6] transition-colors"
                    data-testid={`tendencia-develop-${c.ticker}`}
                >
                    <Sparkles size={12} /> Generar tesis de {c.ticker}
                </button>
            )}
        </div>
    );
}

function StageRow({ stage, leaders, disruptors, onDevelopCompany }) {
    return (
        <div className="mb-8" data-testid={`tendencia-stage-${_norm(stage.stage).slice(0, 16)}`}>
            <div className="flex items-end justify-between gap-3 border-b-2 border-black pb-1.5 mb-3">
                <div className="min-w-0">
                    <div className="font-serif text-lg font-medium leading-tight">{stage.stage}</div>
                    {stage.description && <div className="text-xs text-[#4A4A4A] leading-snug mt-0.5">{stage.description}</div>}
                </div>
                <TamBadge busd={stage.tam_busd} label="TAM 2027e" />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
                <div>
                    <div className="overline text-[#052049] mb-2">Líderes establecidos</div>
                    <div className="space-y-4">
                        {leaders.length
                            ? leaders.map((c, i) => <CompanyCard key={i} c={c} onDevelopCompany={onDevelopCompany} />)
                            : <div className="text-xs text-[#9CA3AF] border border-dashed border-black/20 p-3">Sin líder identificado en este eslabón.</div>}
                    </div>
                </div>
                <div>
                    <div className="overline text-[#B32A22] mb-2">Competidores / disruptores</div>
                    <div className="space-y-4">
                        {disruptors.length
                            ? disruptors.map((c, i) => <CompanyCard key={i} c={c} onDevelopCompany={onDevelopCompany} />)
                            : <div className="text-xs text-[#9CA3AF] border border-dashed border-black/20 p-3">Sin competidores identificados en este eslabón.</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function TendenciaResult({ tendencia, onDevelopCompany, onSave, onDiscard, saved = false, saving = false, canSave = true }) {
    if (!tendencia) return null;
    const stages = tendencia.value_chain || [];
    const companies = tendencia.companies || [];
    const used = new Set();
    const groups = stages.map((s) => {
        const inStage = companies.filter((c) => _norm(c.value_chain_role) === _norm(s.stage));
        inStage.forEach((c) => used.add(c.ticker || c.name));
        return {
            stage: s,
            leaders: inStage.filter((c) => c.category === "leader"),
            disruptors: inStage.filter((c) => c.category !== "leader"),
        };
    });
    const leftover = companies.filter((c) => !used.has(c.ticker || c.name));
    if (leftover.length) {
        groups.push({
            stage: { stage: stages.length ? "Otros" : "Empresas", description: "", tam_busd: null },
            leaders: leftover.filter((c) => c.category === "leader"),
            disruptors: leftover.filter((c) => c.category !== "leader"),
        });
    }

    return (
        <div data-testid="tendencia-result">
            {/* Header */}
            <div className="border border-black bg-white p-6 mb-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                        <div className="overline text-[#B32A22] mb-1 flex items-center gap-2">
                            Tendencia · cadena de valor (informativa)
                            {tendencia.auto && <span className="inline-flex items-center gap-1 text-[#B8860B]"><Flame size={12} /> automática{tendencia.heat != null ? ` · heat ${tendencia.heat}` : ""}</span>}
                        </div>
                        <h1 className="font-serif text-3xl sm:text-4xl font-medium leading-tight">{tendencia.title}</h1>
                    </div>
                    <div className="flex items-start gap-5 shrink-0">
                        {tendencia.tam?.global_busd != null && (
                            <TamBadge busd={tendencia.tam.global_busd} label={`TAM ${tendencia.tam?.year || 2027}e`} note={tendencia.tam?.note} />
                        )}
                    </div>
                </div>
                {tendencia.summary && <p className="text-base mt-4 leading-relaxed text-[#1a1a1a]">{tendencia.summary}</p>}
                {tendencia.why_now && (
                    <p className="text-sm mt-2 leading-relaxed text-[#7a5a10] border-l-2 border-[#B8860B] pl-3">
                        <span className="font-semibold">Por qué ahora:</span> {tendencia.why_now}
                    </p>
                )}

                {/* Save / Discard */}
                <div className="flex items-center gap-2 mt-5 flex-wrap" data-testid="tendencia-actions">
                    {saved ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1E7D45]" data-testid="tendencia-saved">
                            <Bookmark size={14} className="fill-current" /> Tendencia guardada
                        </span>
                    ) : canSave ? (
                        <button
                            onClick={onSave}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] font-semibold bg-black text-[#FDF1E6] px-3 py-2 hover:bg-[#052049] transition-colors disabled:opacity-60"
                            data-testid="tendencia-save-btn"
                        >
                            <Bookmark size={13} /> {saving ? "Guardando…" : "Guardar tendencia"}
                        </button>
                    ) : (
                        <span className="text-xs text-[#4A4A4A]">Inicia sesión para guardar esta tendencia.</span>
                    )}
                    <button
                        onClick={onDiscard}
                        className={`inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] font-semibold border border-black px-3 py-2 hover:bg-[#F5E4D4] transition-colors ${onDiscard ? "" : "hidden"}`}
                        data-testid="tendencia-discard-btn"
                    >
                        <X size={13} /> Descartar
                    </button>
                </div>
            </div>

            {/* Value chain (leaders vs disruptors, informational) */}
            <div className="flex items-baseline justify-between gap-2 mb-3">
                <div className="overline text-[#4A4A4A]">Cadena de valor · líderes vs. competidores/disruptores</div>
                <div className="overline text-[#9CA3AF] hidden sm:block">Genera una tesis desde cualquier empresa</div>
            </div>
            {groups.map((g, i) => (
                <StageRow key={i} stage={g.stage} leaders={g.leaders} disruptors={g.disruptors} onDevelopCompany={onDevelopCompany} />
            ))}

            {/* Sources */}
            {tendencia.sources?.length > 0 && (
                <div className="mt-4" data-testid="tendencia-sources">
                    <div className="overline text-[#4A4A4A] mb-2">Fuentes (búsqueda web en vivo)</div>
                    <ul className="space-y-1">
                        {tendencia.sources.slice(0, 10).map((s, i) => (
                            <li key={i} className="text-xs flex gap-2">
                                <span className="font-mono text-[#4A4A4A]">[{i + 1}]</span>
                                <a href={s.url} target="_blank" rel="noopener noreferrer"
                                   className="text-[#052049] hover:underline flex items-center gap-1 truncate">
                                    {s.title || s.url}
                                    <ExternalLink size={11} className="shrink-0" />
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
