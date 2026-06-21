import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Bookmark, X, Flame, ExternalLink, TrendingUp, Layers } from "lucide-react";
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

function fmtCagr(v) {
    if (v == null || isNaN(v)) return null;
    return `${v > 0 ? "+" : ""}${v}%`;
}

function MetricBadge({ value, label, note, color = "#1E7D45", testid }) {
    if (!value) return null;
    const inner = (
        <div className="flex flex-col items-center gap-0.5" data-testid={testid}>
            <div className="font-mono font-bold leading-none text-2xl" style={{ color }}>{value}</div>
            <span className="overline text-[#4A4A4A] text-center leading-tight">{label}</span>
        </div>
    );
    return note
        ? <HoverTip text={note} maxWidth={300}><div className="cursor-help">{inner}</div></HoverTip>
        : inner;
}

/** Informational company card: category + role + why + "prepare thesis" link. */
function CompanyCard({ c, onDevelopCompany }) {
    const badge = catBadge(c.category);
    const key = c.ticker || _norm(c.name).slice(0, 10);
    return (
        <div className="border border-black bg-white p-4" data-testid={`tendencia-company-${key}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <span
                        className={`inline-block text-[10px] uppercase tracking-[0.12em] font-bold px-1.5 py-0.5 mb-1 ${badge.cls}`}
                        data-testid={`tendencia-category-${key}`}
                    >
                        {badge.txt}
                    </span>
                    <div className="font-serif text-lg font-medium leading-tight">{c.name}</div>
                    {c.value_chain_role && (
                        <div className="text-xs text-[#4A4A4A] mt-0.5">
                            <span className="font-semibold">En la cadena de valor:</span> {c.value_chain_role}
                        </div>
                    )}
                </div>
                {c.ticker && (
                    <Link to={`/company/${c.ticker}`}
                          title="Ver análisis cuantitativo"
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
                    title={`Te lleva a «Empresa → Tesis» con ${c.ticker} listo para que pulses Generar tesis (no se genera automáticamente).`}
                    className="mt-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] font-semibold border border-black px-2.5 py-1.5 hover:bg-black hover:text-[#FDF1E6] transition-colors"
                    data-testid={`tendencia-develop-${c.ticker}`}
                >
                    <Sparkles size={12} /> Preparar tesis de {c.ticker}
                </button>
            )}
        </div>
    );
}

function CategoryBlock({ title, color, companies, empty, onDevelopCompany, testid }) {
    return (
        <div data-testid={testid}>
            <div className="overline mb-2" style={{ color }}>{title}</div>
            <div className="space-y-4">
                {companies.length
                    ? companies.map((c, i) => <CompanyCard key={i} c={c} onDevelopCompany={onDevelopCompany} />)
                    : <div className="text-xs text-[#9CA3AF] border border-dashed border-black/20 p-3" data-testid={`${testid}-empty`}>{empty}</div>}
            </div>
        </div>
    );
}

export default function TendenciaResult({ tendencia, onDevelopCompany, onSave, onDiscard, saved = false, saving = false, canSave = true }) {
    if (!tendencia) return null;
    const companies = tendencia.companies || [];
    const leaders = companies.filter((c) => c.category === "leader");
    const competitors = companies.filter((c) => c.category === "competitor");
    const disruptors = companies.filter((c) => c.category === "disruptor");
    const paragraphs = (tendencia.summary || "").split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);

    return (
        <div data-testid="tendencia-result">
            {/* Header */}
            <div className="border border-black bg-white p-6 mb-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                        <div className="overline text-[#B32A22] mb-1 flex items-center gap-2">
                            Tendencia · análisis informativo
                            {tendencia.auto && <span className="inline-flex items-center gap-1 text-[#B8860B]"><Flame size={12} /> automática{tendencia.heat != null ? ` · heat ${tendencia.heat}` : ""}</span>}
                        </div>
                        <h1 className="font-serif text-3xl sm:text-4xl font-medium leading-tight">{tendencia.title}</h1>
                    </div>
                    <div className="flex items-start gap-6 shrink-0">
                        <MetricBadge
                            value={fmtTam(tendencia.tam?.global_busd)}
                            label={`TAM ${tendencia.tam?.year || 2027}e`}
                            note={tendencia.tam?.note ? `${tendencia.tam.note}\n\n(TAM en miles de millones de USD · estimación informativa)` : null}
                            testid="tendencia-tam-badge"
                        />
                        <MetricBadge
                            value={fmtCagr(tendencia.cagr_4y)}
                            label="Crecimiento 4a (CAGR)"
                            color="#052049"
                            note={tendencia.cagr_note ? `${tendencia.cagr_note}\n\n(Crecimiento compuesto anual estimado del mercado a 4 años · estimación informativa)` : "Crecimiento compuesto anual estimado del mercado a 4 años (informativo)."}
                            testid="tendencia-cagr-badge"
                        />
                    </div>
                </div>

                {/* Half-page explanation (4-8 paragraphs) */}
                {paragraphs.length > 0 && (
                    <div className="mt-4 space-y-3" data-testid="tendencia-summary">
                        {paragraphs.map((p, i) => (
                            <p key={i} className="text-base leading-relaxed text-[#1a1a1a]">{p}</p>
                        ))}
                    </div>
                )}
                {tendencia.why_now && (
                    <p className="text-sm mt-3 leading-relaxed text-[#7a5a10] border-l-2 border-[#B8860B] pl-3">
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

            {/* Companies — 3 flat blocks (up to 2 each). Value-chain role shown per card. */}
            <div className="flex items-baseline justify-between gap-2 mb-3">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5"><TrendingUp size={13} /> Empresas en la tendencia</div>
                <div className="overline text-[#9CA3AF] hidden sm:block">Prepara una tesis desde cualquiera</div>
            </div>
            <div className="grid md:grid-cols-3 gap-5">
                <CategoryBlock
                    title="Líderes esperados" color="#052049" companies={leaders}
                    empty="No se ha identificado un líder claro." onDevelopCompany={onDevelopCompany}
                    testid="tendencia-leaders"
                />
                <CategoryBlock
                    title="Competidores que ganan terreno" color="#4A4A4A" companies={competitors}
                    empty="No se han identificado competidores claros." onDevelopCompany={onDevelopCompany}
                    testid="tendencia-competitors"
                />
                <CategoryBlock
                    title="Disruptores" color="#B32A22" companies={disruptors}
                    empty="No se han identificado disruptores." onDevelopCompany={onDevelopCompany}
                    testid="tendencia-disruptors"
                />
            </div>

            {/* Thematic ETFs / funds */}
            {tendencia.etfs?.length > 0 && (
                <div className="mt-8" data-testid="tendencia-etfs">
                    <div className="flex items-center gap-2 mb-1">
                        <Layers size={15} className="text-[#052049]" />
                        <h3 className="font-serif text-xl">ETFs / Fondos de esta temática</h3>
                    </div>
                    <p className="text-[11px] text-[#9CA3AF] leading-snug mb-3 max-w-3xl">
                        Vehículos diversificados para exponerte a la tendencia sin elegir una sola empresa. Pulsa el título para buscar la ficha oficial (gestora, política y composición). Información orientativa: verifica siempre el folleto antes de invertir.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                        {tendencia.etfs.map((e, i) => (
                            <div key={i} className="border border-black/15 bg-white p-3" data-testid={`tendencia-etf-${i}`}>
                                <div className="flex items-start justify-between gap-2">
                                    <a
                                        href={`https://duckduckgo.com/?q=${encodeURIComponent(`${e.name} ${e.provider || ""} ETF fondo ficha`)}`}
                                        target="_blank" rel="noopener noreferrer"
                                        className="font-semibold text-[#052049] hover:underline inline-flex items-start gap-1 leading-tight"
                                        data-testid={`tendencia-etf-link-${i}`}
                                    >
                                        {e.name}
                                        <ExternalLink size={12} className="shrink-0 mt-0.5" />
                                    </a>
                                    <span className="shrink-0 overline px-1.5 py-0.5 border border-black/30 text-[#4A4A4A]">{e.kind || "ETF"}</span>
                                </div>
                                <div className="text-[11px] text-[#9CA3AF] mt-0.5">
                                    {e.provider}{e.provider && e.ticker ? " · " : ""}{e.ticker && <span className="font-mono">{e.ticker}</span>}
                                </div>
                                {e.universe && <p className="text-xs text-[#4A4A4A] leading-snug mt-1.5">{e.universe}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Sources */}
            {tendencia.sources?.length > 0 && (
                <div className="mt-6" data-testid="tendencia-sources">
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
