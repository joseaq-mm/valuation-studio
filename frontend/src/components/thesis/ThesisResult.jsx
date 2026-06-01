import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, ArrowRight, TrendingUp, AlertTriangle, Loader2, ShieldAlert, Sparkles, Plus, Check } from "lucide-react";
import { ScoreBar, ScoreBadge, ValueBox, tamColor } from "./ScoreBar";
import ProbabilityCircle from "./ProbabilityCircle";
import HoverTip from "@/components/HoverTip";
import { thesisTamScores, thesisLinkSuggestions, thesisAddCompany } from "@/lib/api";

const DIMS = ["competitive_position", "sector_momentum", "management_quality", "financial_resilience"];

// TAM is expressed in USD billions (miles de millones). Show $B, or $T when ≥1000.
function fmtTam(busd) {
    if (busd == null || isNaN(busd)) return null;
    if (busd >= 1000) return `$${(busd / 1000).toFixed(busd >= 10000 ? 0 : 1)} T`;
    if (busd >= 10) return `$${Math.round(busd)} B`;
    return `$${busd} B`;
}

function TamBadge({ busd, label, note, big = false }) {
    const txt = fmtTam(busd);
    if (!txt) return null;
    const inner = (
        <div className="flex flex-col items-center gap-0.5" data-testid="tam-badge">
            <div className={`font-mono font-bold leading-none text-[#1E7D45] ${big ? "text-2xl" : "text-base"}`}>{txt}</div>
            <span className="overline text-[#4A4A4A] text-center leading-tight">{label}</span>
        </div>
    );
    return note
        ? <HoverTip text={`${note}\n\n(TAM en miles de millones de USD)`} maxWidth={300}><div className="cursor-help">{inner}</div></HoverTip>
        : <HoverTip text="TAM en miles de millones de USD" maxWidth={260}><div className="cursor-help">{inner}</div></HoverTip>;
}

function ContraSection({ contra, isTrend, canGenerate, onGenerate, generating }) {
    // Not generated yet → on-demand button (saves credits).
    if (!contra) {
        if (!canGenerate) return null;
        return (
            <div className="border border-[#B32A22]/40 bg-[#FBEAE8] px-4 py-3 mb-6 flex items-center justify-between gap-3 flex-wrap" data-testid="contra-cta-wrap">
                <div className="flex items-center gap-2 text-sm text-[#7a1d17]">
                    <ShieldAlert size={16} className="shrink-0" />
                    <span>{isTrend
                        ? <>Toda tendencia crea ganadores y <strong>perdedores</strong>. Genera la contratesis: sectores y empresas perjudicados <em>porque</em> esta tendencia avanza.</>
                        : <>Genera la <strong>contratesis</strong>: qué cambios estructurales, al ocurrir, dejarían a esta empresa en el lado perdedor.</>}</span>
                </div>
                <button
                    onClick={onGenerate}
                    disabled={generating}
                    className="text-xs uppercase tracking-[0.12em] font-semibold border border-[#B32A22] text-[#B32A22] px-3 py-1.5 hover:bg-[#B32A22] hover:text-white transition-colors flex items-center gap-2 shrink-0 disabled:opacity-60"
                    data-testid="contra-generate-btn"
                >
                    {generating ? <Loader2 size={13} className="animate-spin" /> : <ShieldAlert size={13} />}
                    {generating ? "Generando…" : "Añadir contratesis"}
                </button>
            </div>
        );
    }
    // Generated → red, low-visual-presence warning block.
    return (
        <div className="border border-[#B32A22]/50 bg-[#FBEAE8] px-4 py-3 mb-6" data-testid="contra-section">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                    <div className="overline text-[#B32A22] flex items-center gap-1"><ShieldAlert size={12} /> {isTrend ? "Contratesis · perdedores de la tendencia" : "Contratesis · riesgo de disrupción"}</div>
                    {contra.summary && <p className="text-sm text-[#7a1d17] mt-1 leading-relaxed max-w-3xl">{contra.summary}</p>}
                </div>
                <ProbabilityCircle value={contra.probability} rationale={contra.probability_rationale} label="Prob. contratesis" size="sm" testid="contra-probability" />
            </div>

            {isTrend ? (
                <>
                    {contra.value_chain?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {contra.value_chain.map((v, i) => (
                                <div key={i} className="border border-[#B32A22]/30 bg-white/60 px-2 py-1 max-w-xs">
                                    <div className="text-xs font-semibold text-[#7a1d17]">{v.stage}</div>
                                    <div className="text-[11px] text-[#7a1d17]/80 leading-snug">{v.description}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {contra.companies?.length > 0 && (
                        <div className="mt-3">
                            <div className="overline text-[#B32A22] mb-1">Empresas más perjudicadas</div>
                            <div className="space-y-1">
                                {contra.companies.map((c, i) => (
                                    <div key={i} className="text-xs text-[#7a1d17] flex gap-2" data-testid={`contra-company-${c.ticker || i}`}>
                                        {c.ticker
                                            ? <Link to={`/company/${c.ticker}`} className="font-mono font-semibold underline shrink-0">{c.ticker}</Link>
                                            : <span className="font-semibold shrink-0">{c.name}</span>}
                                        <span>{c.harm_reason}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            ) : (
                contra.losing_trends?.length > 0 && (
                    <div className="mt-3 space-y-1">
                        <div className="overline text-[#B32A22] mb-1">Tendencias perjudiciales</div>
                        {contra.losing_trends.map((t, i) => (
                            <div key={i} className="text-xs text-[#7a1d17]">
                                <span className="font-semibold">{t.name}:</span> {t.harm_reason}
                            </div>
                        ))}
                    </div>
                )
            )}
        </div>
    );
}

function SourcesList({ sources }) {
    if (!sources || !sources.length) return null;
    return (
        <div className="mt-8" data-testid="thesis-sources">
            <div className="overline text-[#4A4A4A] mb-2">Fuentes (búsqueda web en vivo)</div>
            <ul className="space-y-1">
                {sources.slice(0, 12).map((s, i) => (
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
    );
}

function TamScoreBadge({ data, loading, ticker }) {
    const isLoading = loading && !data;
    const v = data ? data.tam_score : null;
    const txt = isLoading ? null : (v == null || isNaN(v) ? null : v.toFixed(2));
    // Nothing to show (computed but null) and not loading → render nothing.
    if (!isLoading && txt == null) return null;
    const color = isLoading ? "#9CA3AF" : tamColor(v);
    const note =
        "TAM Score = (Score global tendencia / 100 × TAM del eslabón 2027e) / Ingresos proyectados 2027 de la empresa.\n\n" +
        (data ? `TAM del eslabón: $${data.stage_tam_busd} B · Ingresos 2027e: $${data.projected_revenue_busd} B (USD).\n\n` : "") +
        ">1× = el mercado direccionable (ponderado por calidad) supera el tamaño proyectado de la empresa → amplio recorrido. " +
        "<1× = la empresa ya es grande respecto al TAM del eslabón.";
    const box = (
        <div className="flex items-center gap-2" data-testid={isLoading ? `tam-score-loading-${ticker}` : `tam-score-${ticker}`}>
            {isLoading
                ? <div className="w-11 h-10 border-2 flex items-center justify-center shrink-0" style={{ borderColor: "#6B7280" }}><Loader2 size={14} className="animate-spin text-[#6B7280]" /></div>
                : <ValueBox text={txt} color={color} />}
            <span className="overline text-[#4A4A4A] leading-tight">TAM Score</span>
        </div>
    );
    return isLoading ? box : <HoverTip text={note} maxWidth={320}><div className="cursor-help">{box}</div></HoverTip>;
}

function CompanyCard({ c, tamData, tamLoading }) {
    const isDisruptor = c.category === "disruptor";
    return (
        <div className="border border-black bg-white p-5" data-testid={`thesis-company-${c.ticker}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <span
                        className={`inline-block text-[10px] uppercase tracking-[0.12em] font-bold px-1.5 py-0.5 mb-1 ${isDisruptor ? "bg-[#B32A22] text-white" : "bg-[#052049] text-[#FDF1E6]"}`}
                        data-testid={`category-${c.ticker}`}
                    >
                        {isDisruptor ? "Disruptor" : "Líder"}
                    </span>
                    <div className="font-serif text-xl font-medium leading-tight">{c.name}</div>
                    <div className="overline text-[#4A4A4A] mt-1">{c.value_chain_role}</div>
                </div>
                <div className="flex flex-col items-start gap-2 shrink-0">
                    <ScoreBadge value={c.overall_score} label="Score global tendencia" testid={`overall-${c.ticker}`} />
                    <TamScoreBadge data={tamData} loading={tamLoading} ticker={c.ticker} />
                </div>
            </div>

            {c.ticker && (
                <Link to={`/company/${c.ticker}`}
                      className="inline-flex items-center gap-1 mt-3 font-mono text-sm font-semibold bg-black text-[#FDF1E6] px-2 py-1 hover:bg-[#052049] transition-colors"
                      data-testid={`company-link-${c.ticker}`}>
                    {c.ticker} <ArrowRight size={13} />
                </Link>
            )}

            {c.why && <p className="text-sm mt-3 text-[#1a1a1a] leading-relaxed">{c.why}</p>}

            <div className="grid grid-cols-2 gap-x-5 gap-y-2 mt-4">
                {DIMS.map((d) => <ScoreBar key={d} dimension={d} value={(c.scores || {})[d]} />)}
            </div>

            {c.thesis && (
                <div className="mt-4 border-l-2 border-[#052049] pl-3">
                    <div className="overline text-[#4A4A4A] mb-1">Tesis</div>
                    <p className="text-sm leading-relaxed">{c.thesis}</p>
                </div>
            )}
            {c.key_risks && (
                <div className="mt-3 flex gap-2 text-xs text-[#B32A22]">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{c.key_risks}</span>
                </div>
            )}
        </div>
    );
}

const _norm = (s) => (s || "").trim().toLowerCase();

function StageRow({ group, tamScores, tamLoading }) {
    const { stage, leaders, disruptors } = group;
    return (
        <div className="mb-8" data-testid={`stage-row-${_norm(stage.stage).slice(0, 16)}`}>
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
                            ? leaders.map((c, i) => <CompanyCard key={i} c={c} tamData={tamScores ? tamScores[c.ticker] : undefined} tamLoading={tamLoading} />)
                            : <div className="text-xs text-[#9CA3AF] border border-dashed border-black/20 p-3">Sin líder identificado en este eslabón.</div>}
                    </div>
                </div>
                <div>
                    <div className="overline text-[#B32A22] mb-2">Disruptores / líderes del cambio</div>
                    <div className="space-y-4">
                        {disruptors.length
                            ? disruptors.map((c, i) => <CompanyCard key={i} c={c} tamData={tamScores ? tamScores[c.ticker] : undefined} tamLoading={tamLoading} />)
                            : <div className="text-xs text-[#9CA3AF] border border-dashed border-black/20 p-3">Sin disruptor identificado en este eslabón.</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function CompaniesByStage({ valueChain, companies, tamScores, tamLoading }) {
    const stages = valueChain || [];
    const used = new Set();
    const groups = stages.map((s) => {
        const inStage = (companies || []).filter((c) => _norm(c.value_chain_role) === _norm(s.stage));
        inStage.forEach((c) => used.add(c.ticker));
        return {
            stage: s,
            leaders: inStage.filter((c) => c.category !== "disruptor"),
            disruptors: inStage.filter((c) => c.category === "disruptor"),
        };
    });
    const leftover = (companies || []).filter((c) => !used.has(c.ticker));
    if (leftover.length) {
        groups.push({
            stage: { stage: stages.length ? "Otros" : "Empresas", description: "", tam_busd: null },
            leaders: leftover.filter((c) => c.category !== "disruptor"),
            disruptors: leftover.filter((c) => c.category === "disruptor"),
        });
    }
    return <>{groups.map((g, i) => <StageRow key={i} group={g} tamScores={tamScores} tamLoading={tamLoading} />)}</>;
}

function TrendCard({ t, match, company }) {
    const [adding, setAdding] = useState(false);
    const [added, setAdded] = useState(false);
    const c = t.relevance_score == null ? "#9CA3AF" : t.relevance_score >= 75 ? "#1E7D45" : t.relevance_score >= 50 ? "#B8860B" : "#B32A22";
    const slug = _norm(t.name).slice(0, 16);
    const trendQuery = encodeURIComponent(t.name || "");

    const addToExisting = async () => {
        if (!match?.thesis_id || !company?.ticker) return;
        setAdding(true);
        try {
            await thesisAddCompany(match.thesis_id, company.ticker, company.name);
            setAdded(true);
            toast.success(`${company.ticker} añadida a "${match.thesis_title}"`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo añadir la empresa.");
        } finally {
            setAdding(false);
        }
    };

    return (
        <div className="border border-black bg-white p-5 flex flex-col" data-testid={`thesis-trend-${(t.name || "").slice(0, 12)}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="font-serif text-lg font-medium leading-tight flex items-center gap-2">
                    <TrendingUp size={18} className="text-[#052049] shrink-0" />
                    {t.name}
                </div>
                <HoverTip
                    text={"Relevancia (0–100): cuánto pesa esta tendencia en la tesis de inversión de la empresa — qué tan central es este tema para su caso alcista.\n\nNo mide la calidad de la empresa, sino el encaje/peso del tema. Es relativa entre las tendencias en las que encaja: ≥75 (verde) = motor central del negocio; <50 (rojo) = encaje marginal o secundario."}
                    maxWidth={320}
                >
                    <div className="cursor-help"><ScoreBadge value={t.relevance_score} label="Relevancia" /></div>
                </HoverTip>
            </div>
            {t.fit_description && <p className="text-sm mt-3 leading-relaxed">{t.fit_description}</p>}
            {t.value_chain_role && (
                <div className="mt-2 text-xs text-[#4A4A4A]">
                    <span className="font-semibold">Rol en la cadena:</span> {t.value_chain_role}
                </div>
            )}
            {t.rationale && (
                <div className="mt-3 border-l-2 pl-3" style={{ borderColor: c }}>
                    <p className="text-sm leading-relaxed text-[#1a1a1a]">{t.rationale}</p>
                </div>
            )}

            {/* Action footer: generate, or duplicate warning + add-to-existing */}
            <div className="mt-auto pt-4 border-t border-black/10">
                {match ? (
                    <div className="border border-[#B8860B]/50 bg-[#FBF3E0] p-2.5" data-testid={`trend-dup-warning-${slug}`}>
                        <div className="flex items-start gap-2 text-xs text-[#7a5a10]">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-[#B8860B]" />
                            <span>
                                Ya tienes una tesis desarrollada que encaja:{" "}
                                <Link to={`/thesis/${match.thesis_id}`} className="font-bold underline" data-testid={`trend-dup-link-${slug}`}>{match.thesis_title}</Link>.{" "}
                                Añade la empresa a esa tesis en lugar de duplicarla — duplicar inflaría el valor atribuido a {company?.ticker || "la empresa"}.
                            </span>
                        </div>
                        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                            <button
                                onClick={addToExisting}
                                disabled={adding || added}
                                className={`text-xs font-semibold px-2.5 py-1.5 flex items-center gap-1 transition-colors ${added ? "bg-[#1E7D45] text-white" : "bg-black text-[#FDF1E6] hover:bg-[#052049]"} disabled:opacity-70`}
                                data-testid={`trend-add-${slug}`}
                            >
                                {adding ? <Loader2 size={12} className="animate-spin" /> : added ? <Check size={12} /> : <Plus size={12} />}
                                {added ? "Añadida" : adding ? "Añadiendo…" : `Añadir ${company?.ticker || "empresa"} a esa tesis`}
                            </button>
                            <Link to={`/thesis?trend=${trendQuery}&auto=1`} className="text-xs text-[#4A4A4A] hover:text-black hover:underline" data-testid={`trend-generate-anyway-${slug}`}>
                                Generar de todas formas
                            </Link>
                        </div>
                    </div>
                ) : (
                    <Link
                        to={`/thesis?trend=${trendQuery}&auto=1`}
                        className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] font-semibold bg-black text-[#FDF1E6] px-3 py-1.5 hover:bg-[#052049] transition-colors"
                        data-testid={`trend-generate-${slug}`}
                    >
                        <Sparkles size={13} /> Generar tesis <ArrowRight size={12} />
                    </Link>
                )}
            </div>
        </div>
    );
}

export default function ThesisResult({ thesis, canGenerateContra = false, onGenerateContra, generatingContra = false }) {
    const [tamScores, setTamScores] = useState(null);
    const [tamLoading, setTamLoading] = useState(false);
    const [linkData, setLinkData] = useState(null);
    const [linkLoading, setLinkLoading] = useState(false);

    const isTrend = thesis?.type === "trend";

    useEffect(() => {
        if (!thesis || thesis.type !== "trend") { setTamScores(null); return; }
        const stages = thesis.value_chain || [];
        const tamByRole = {};
        stages.forEach((s) => { tamByRole[_norm(s.stage)] = s.tam_busd; });
        const items = (thesis.companies || [])
            .filter((c) => c.ticker)
            .map((c) => ({
                ticker: c.ticker,
                overall_score: c.overall_score,
                stage_tam_busd: tamByRole[_norm(c.value_chain_role)] ?? null,
            }));
        if (!items.length) { setTamScores(null); return; }
        let alive = true;
        setTamLoading(true);
        setTamScores(null);
        thesisTamScores(items)
            .then((res) => { if (alive) setTamScores(res?.scores || {}); })
            .catch(() => { if (alive) setTamScores({}); })
            .finally(() => { if (alive) setTamLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thesis?.id, thesis?.generated_at, thesis?.type]);

    // Company mode: check which of the company's trends already have a matching
    // saved trend-thesis, to warn against duplicating (and offer add-to-existing).
    useEffect(() => {
        if (!thesis || thesis.type !== "company" || !thesis.id) { setLinkData(null); return; }
        let alive = true;
        setLinkLoading(true);
        thesisLinkSuggestions(thesis.id)
            .then((d) => { if (alive) setLinkData(d); })
            .catch(() => { if (alive) setLinkData(null); })
            .finally(() => { if (alive) setLinkLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thesis?.id, thesis?.type]);

    const matchByTrend = {};
    (linkData?.to_add || []).forEach((a) => { if (a.trend_name) matchByTrend[_norm(a.trend_name)] = a; });

    if (!thesis) return null;

    return (
        <div data-testid="thesis-result">
            {/* Header */}
            <div className="border border-black bg-white p-6 mb-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                        <div className="overline text-[#B32A22] mb-1">
                            {isTrend ? "Tendencia → Cadena de valor" : "Empresa → Tendencias"}
                        </div>
                        <h1 className="font-serif text-3xl sm:text-4xl font-medium leading-tight">{thesis.title}</h1>
                        {!isTrend && thesis.company?.ticker && (
                            <Link to={`/company/${thesis.company.ticker}`}
                                  className="inline-flex items-center gap-1 mt-2 font-mono text-sm font-semibold bg-black text-[#FDF1E6] px-2 py-1 hover:bg-[#052049] transition-colors"
                                  data-testid={`company-link-${thesis.company.ticker}`}>
                                {thesis.company.ticker} <ArrowRight size={13} />
                            </Link>
                        )}
                    </div>
                    <div className="flex items-start gap-5 shrink-0">
                        {!isTrend && (
                            <HoverTip
                                text={"Relevancia temática global (0–100): cuán expuesta e impulsada está la empresa por el CONJUNTO de megatendencias en las que encaja.\n\nResume, en un solo número, el peso agregado de los temas estructurales en su tesis alcista."}
                                maxWidth={320}
                            >
                                <div className="cursor-help"><ScoreBadge value={thesis.overall_relevance} label="Relevancia temática global" /></div>
                            </HoverTip>
                        )}
                        {isTrend && thesis.tam?.global_busd != null && (
                            <TamBadge busd={thesis.tam.global_busd} label={`TAM ${thesis.tam?.year || 2027}e`} note={thesis.tam?.note} big />
                        )}
                        <ProbabilityCircle value={thesis.probability} rationale={thesis.probability_rationale} label="Prob. de la tesis" testid="thesis-probability" />
                    </div>
                </div>
                {thesis.summary && <p className="text-base mt-4 leading-relaxed text-[#1a1a1a]">{thesis.summary}</p>}
            </div>

            {/* Contra-thesis (between header and value chain) */}
            <ContraSection
                contra={thesis.contra}
                isTrend={isTrend}
                canGenerate={canGenerateContra}
                onGenerate={onGenerateContra}
                generating={generatingContra}
            />

            {/* Value chain (trend only) */}
            {/* Value chain + companies by stage (leaders / disruptors), trend only */}
            {isTrend ? (
                <>
                    <div className="flex items-baseline justify-between gap-2 mb-3">
                        <div className="overline text-[#4A4A4A]">Cadena de valor · líderes vs. disruptores</div>
                        <div className="overline text-[#9CA3AF] hidden sm:block">TAM 2027e por eslabón</div>
                    </div>
                    <CompaniesByStage valueChain={thesis.value_chain} companies={thesis.companies} tamScores={tamScores} tamLoading={tamLoading} />
                </>
            ) : (
                <>
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="overline text-[#4A4A4A]">Tendencias donde encaja</div>
                        {linkLoading && (
                            <span className="text-[11px] text-[#4A4A4A] flex items-center gap-1" data-testid="trends-dup-checking">
                                <Loader2 size={11} className="animate-spin" /> Comprobando duplicados…
                            </span>
                        )}
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                        {(thesis.trends || []).map((t, i) => (
                            <TrendCard key={i} t={t} match={matchByTrend[_norm(t.name)]} company={thesis.company} />
                        ))}
                    </div>
                </>
            )}

            <SourcesList sources={thesis.sources} />
        </div>
    );
}
