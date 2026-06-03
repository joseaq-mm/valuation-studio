import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, ArrowRight, TrendingUp, AlertTriangle, Loader2, ShieldAlert, Sparkles, Plus, Check, Flame, RefreshCw, GitBranch } from "lucide-react";
import { ScoreBar, ScoreBadge, ValueBox, tamColor, scoreColor, fmtTamScore } from "./ScoreBar";
import ProbabilityCircle from "./ProbabilityCircle";
import CompanyQualCard from "./CompanyQualCard";
import HoverTip from "@/components/HoverTip";
import { thesisTamScores, thesisLinkSuggestions, thesisAddCompany, thesisEvaluateCompany } from "@/lib/api";

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
        ">1 = el mercado direccionable (ponderado por calidad) supera el tamaño proyectado de la empresa → amplio recorrido. " +
        "<1 = la empresa ya es grande respecto al TAM del eslabón.";
    const row = (
        <div className="flex items-center justify-end gap-2" data-testid={isLoading ? `tam-score-loading-${ticker}` : `tam-score-${ticker}`}>
            <span className="overline text-[#4A4A4A] leading-tight text-right">TAM Score</span>
            {isLoading
                ? <div className="w-11 h-10 border-2 flex items-center justify-center shrink-0" style={{ borderColor: "#6B7280" }}><Loader2 size={14} className="animate-spin text-[#6B7280]" /></div>
                : <ValueBox text={txt} color={color} />}
        </div>
    );
    return isLoading ? row : <HoverTip text={note} maxWidth={320}><div className="cursor-help">{row}</div></HoverTip>;
}

/** Score with a two-line label on the LEFT and the boxed number on the RIGHT,
 *  so the boxes align flush to the card's right edge. */
function ScoreStatRight({ value, label, testid, tip }) {
    const row = (
        <div className="flex items-center justify-end gap-2" data-testid={testid}>
            <span className="overline text-[#4A4A4A] leading-tight text-right">{label}</span>
            <ValueBox text={value == null ? "—" : value} color={scoreColor(value)} />
        </div>
    );
    return tip ? <HoverTip text={tip} maxWidth={320}><div className="cursor-help">{row}</div></HoverTip> : row;
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
                <div className="flex flex-col items-end gap-2 shrink-0">
                    <ScoreStatRight value={c.overall_score} label={<>Score global<br />tendencia</>} testid={`overall-${c.ticker}`} tip={SCORE_GLOBAL_TIP} />
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

const RELEVANCE_TIP =
    "Relevancia (0–100): cuánto pesa esta tendencia en la tesis de inversión de la empresa — qué tan central es este tema para su caso alcista.\n\nNo mide la calidad de la empresa, sino el encaje/peso del tema. Es relativa entre las tendencias en las que encaja: ≥75 (verde) = motor central del negocio; <50 (rojo) = encaje marginal o secundario.";

const SCORE_GLOBAL_TIP =
    "Score global tendencia (0–100): la calidad y el atractivo de la empresa DENTRO de esta tendencia, ponderado por su exposición al tema (a menor exposición, menor score).\n\nResume sus cuatro sub-scores: posición competitiva, momentum del sector, calidad del management y resiliencia financiera. Mayor = mejor.";

const WINNING_TIP =
    "Tendencia ganadora (0–10): probabilidad de que esta tendencia sea estructuralmente GANADORA / con momentum (no cuánto pesa para la empresa, sino la fuerza del tema en sí).\n\n≥7 alto momentum · 4–6 medio · <4 bajo. Útil para priorizar qué apuestas desarrollar primero.";

/** Compact "winning thesis" badge (0–10) for the new-thesis suggestions. */
function WinningBadge({ value }) {
    if (value == null) return null;
    const color = value >= 7 ? "#1E7D45" : value >= 4 ? "#B8860B" : "#B32A22";
    return (
        <HoverTip text={WINNING_TIP} maxWidth={300}>
            <div className="inline-flex items-center gap-1 px-2 py-1 border cursor-help" style={{ borderColor: color, color }} data-testid="winning-badge">
                <Flame size={12} />
                <span className="font-mono font-bold text-sm leading-none">{value}<span className="text-[10px] opacity-70">/10</span></span>
                <span className="text-[9px] uppercase tracking-[0.12em] font-semibold">Ganadora</span>
            </div>
        </HoverTip>
    );
}

/** Bloque 1.2 — a NEW thesis idea (not yet generated, not similar to an existing one):
 *  an informational card with a single "Generar tesis" action. */
function NewThesisCard({ t, idx = 0 }) {
    const c = t.relevance_score == null ? "#9CA3AF" : t.relevance_score >= 75 ? "#1E7D45" : t.relevance_score >= 50 ? "#B8860B" : "#B32A22";
    const slug = `${_norm(t.name).slice(0, 16)}-${idx}`;
    const trendQuery = encodeURIComponent(t.name || "");

    return (
        <div className="border border-black bg-white p-5 flex flex-col" data-testid={`thesis-trend-${(t.name || "").slice(0, 12)}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="font-serif text-lg font-medium leading-tight flex items-center gap-2">
                    <TrendingUp size={18} className="text-[#052049] shrink-0" />
                    {t.name}
                </div>
                <HoverTip text={RELEVANCE_TIP} maxWidth={320}>
                    <div className="cursor-help"><ScoreBadge value={t.relevance_score} label="Relevancia" /></div>
                </HoverTip>
            </div>
            {(t.type === "actual" || t.type === "futura") && (
                <span
                    className="inline-block w-fit mt-2 text-[10px] uppercase tracking-[0.12em] font-bold px-2 py-0.5"
                    style={t.type === "actual"
                        ? { background: "#052049", color: "#FDF1E6" }
                        : { background: "#FBF3E0", color: "#7a5a10", border: "1px solid #B8860B" }}
                    data-testid={`thesis-type-${(t.name || "").slice(0, 12)}`}
                    title={t.type === "actual" ? "Driver de crecimiento actual (negocio en expansión)" : "Apuesta de crecimiento futuro / adyacencia"}
                >
                    {t.type === "actual" ? "Crecimiento actual" : "Apuesta futura"}
                </span>
            )}
            {fmtTam(t.tam_busd) && (
                <div className="mt-1.5 inline-flex items-center gap-1 text-xs" data-testid={`new-thesis-tam-${(t.name || "").slice(0, 12)}`}>
                    <span className="overline text-[#4A4A4A]">TAM estimado</span>
                    <span className="font-mono font-bold text-[#1E7D45]">{fmtTam(t.tam_busd)}</span>
                </div>
            )}
            {t.win_probability != null && (
                <div className="mt-2.5"><WinningBadge value={t.win_probability} /></div>
            )}
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
            <div className="mt-auto pt-4 border-t border-black/10">
                <Link
                    to={`/thesis?trend=${trendQuery}&auto=1`}
                    className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] font-semibold bg-black text-[#FDF1E6] px-3 py-1.5 hover:bg-[#052049] transition-colors"
                    data-testid={`trend-generate-${slug}`}
                >
                    <Sparkles size={13} /> Generar tesis <ArrowRight size={12} />
                </Link>
            </div>
        </div>
    );
}

/** Bloque 1.1b — an EXISTING trend thesis the company fits but isn't a member of yet.
 *  Two-step add: "Calcular score" runs a no-persist evaluation and previews BOTH the
 *  Score global tendencia and the TAM Score; "Confirmar" then adds the company reusing
 *  that evaluation (no second LLM call). Anti-duplication: the company joins the
 *  existing thesis instead of spawning a near-duplicate. */
function MatchedThesisRow({ match, company, fit, onAdded }) {
    const [phase, setPhase] = useState("idle"); // idle | evaluating | preview | adding | adding-direct | added
    const [preview, setPreview] = useState(null);
    const companyLabel = company?.name || company?.ticker || "La empresa";
    const showPreview = phase === "preview" || phase === "adding";

    const directAdd = async () => {
        if (!match?.thesis_id || !company?.ticker) return;
        setPhase("adding-direct");
        try {
            await thesisAddCompany(match.thesis_id, company.ticker, company.name);
            setPhase("added");
            toast.success(`${company.ticker} añadida a "${match.thesis_title}"`);
            onAdded?.();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo añadir la empresa.");
            setPhase("idle");
        }
    };

    const evaluate = async () => {
        if (!match?.thesis_id || !company?.ticker) return;
        setPhase("evaluating");
        try {
            const res = await thesisEvaluateCompany(match.thesis_id, company.ticker, company.name);
            setPreview(res);
            setPhase("preview");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo calcular el score.");
            setPhase("idle");
        }
    };

    const confirm = async () => {
        setPhase("adding");
        try {
            await thesisAddCompany(match.thesis_id, company.ticker, company.name, preview?.entry || null);
            setPhase("added");
            toast.success(`${company.ticker} añadida a "${match.thesis_title}"`);
            onAdded?.();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo añadir la empresa.");
            setPhase("preview");
        }
    };

    return (
        <div className="border border-black/30 bg-white px-3 py-2.5" data-testid={`matched-thesis-${match.thesis_id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 text-sm">
                    <Link to={`/thesis/${match.thesis_id}`} className="font-bold hover:underline inline-flex items-center gap-1" data-testid={`matched-thesis-link-${match.thesis_id}`}>
                        <span className="truncate">{match.thesis_title}</span><ArrowRight size={12} className="shrink-0" />
                    </Link>
                    {fit
                        ? <div className="text-xs text-[#1a1a1a] mt-1 leading-snug" data-testid={`matched-thesis-fit-${match.thesis_id}`}>{fit}</div>
                        : <div className="text-xs text-[#4A4A4A] mt-0.5">{companyLabel} encaja aquí pero aún no está incluida.</div>}
                </div>
                {phase === "idle" && (
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={directAdd}
                            className="text-xs font-semibold px-2.5 py-1.5 flex items-center gap-1 transition-colors bg-black text-[#FDF1E6] hover:bg-[#052049]"
                            data-testid={`matched-thesis-add-direct-${match.thesis_id}`}
                        >
                            <Plus size={12} /> Añadir a tesis
                        </button>
                        <button
                            onClick={evaluate}
                            className="text-xs font-semibold px-2.5 py-1.5 flex items-center gap-1 transition-colors border border-black hover:bg-black hover:text-[#FDF1E6]"
                            data-testid={`matched-thesis-eval-${match.thesis_id}`}
                        >
                            <Sparkles size={12} /> Calcular score
                        </button>
                    </div>
                )}
                {phase === "evaluating" && (
                    <span className="text-xs text-[#4A4A4A] flex items-center gap-1.5 shrink-0" data-testid={`matched-thesis-evaluating-${match.thesis_id}`}>
                        <Loader2 size={12} className="animate-spin" /> Calculando score…
                    </span>
                )}
                {phase === "adding-direct" && (
                    <span className="text-xs text-[#4A4A4A] flex items-center gap-1.5 shrink-0" data-testid={`matched-thesis-adding-${match.thesis_id}`}>
                        <Loader2 size={12} className="animate-spin" /> Añadiendo…
                    </span>
                )}
                {phase === "added" && (
                    <span className="text-xs font-semibold text-[#1E7D45] flex items-center gap-1 shrink-0" data-testid={`matched-thesis-added-${match.thesis_id}`}>
                        <Check size={12} /> Añadida
                    </span>
                )}
            </div>

            {showPreview && preview && (
                <div className="mt-2.5 pt-2.5 border-t border-black/10 flex items-center justify-between gap-3 flex-wrap" data-testid={`matched-thesis-preview-${match.thesis_id}`}>
                    <div className="flex items-center gap-5">
                        <HoverTip text={SCORE_GLOBAL_TIP} maxWidth={320}>
                            <div className="flex items-center gap-2 cursor-help">
                                <span className="overline text-[#4A4A4A] leading-tight text-right">Score global<br />tendencia</span>
                                <ValueBox text={preview.overall_score ?? "—"} color={scoreColor(preview.overall_score)} testid={`preview-overall-${match.thesis_id}`} />
                            </div>
                        </HoverTip>
                        <HoverTip text="TAM Score que tendría la empresa en esta tesis: (Score global tendencia / 100 × TAM del eslabón) / Ingresos proyectados 2027 (USD). >1 = amplio recorrido." maxWidth={300}>
                            <div className="flex items-center gap-2 cursor-help">
                                <span className="overline text-[#4A4A4A] leading-tight text-right">TAM<br />Score</span>
                                <ValueBox text={fmtTamScore(preview.tam_score) ?? "—"} color={tamColor(preview.tam_score)} testid={`preview-tam-${match.thesis_id}`} />
                            </div>
                        </HoverTip>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={confirm}
                            disabled={phase === "adding"}
                            className="text-xs font-semibold px-2.5 py-1.5 flex items-center gap-1 transition-colors bg-black text-[#FDF1E6] hover:bg-[#052049] disabled:opacity-70"
                            data-testid={`matched-thesis-add-${match.thesis_id}`}
                        >
                            {phase === "adding" ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            {phase === "adding" ? "Añadiendo…" : `Confirmar · Añadir ${company?.ticker || "empresa"}`}
                        </button>
                        {phase !== "adding" && (
                            <button onClick={() => { setPhase("idle"); setPreview(null); }} className="text-xs text-[#4A4A4A] hover:underline" data-testid={`matched-thesis-cancel-${match.thesis_id}`}>
                                Cancelar
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function ThesisResult({ thesis, canGenerateContra = false, onGenerateContra, generatingContra = false, onMutated, onNest }) {
    const [tamScores, setTamScores] = useState(null);
    const [tamLoading, setTamLoading] = useState(false);
    const [linkData, setLinkData] = useState(null);
    const [linkLoading, setLinkLoading] = useState(false);
    const [mutateTick, setMutateTick] = useState(0);
    const [parentDismissed, setParentDismissed] = useState(false);

    const isTrend = thesis?.type === "trend";

    // Reset the "nest under mother" banner dismissal when a new thesis loads.
    useEffect(() => { setParentDismissed(false); }, [thesis?.id]);

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

    // Company mode: classify the company's themes against the user's saved trend
    // theses → matches (existing) vs. to_create (genuinely new). Re-run on add.
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
    }, [thesis?.id, thesis?.type, mutateTick]);

    const ticker = thesis?.company?.ticker;

    // 1.1b — existing theses the company fits but isn't a member of yet.
    // Dedupe by thesis_id (several company trends can map to the same thesis).
    const existingMatches = useMemo(() => {
        const seen = new Set();
        return (linkData?.to_add || []).filter((a) => {
            if (a.already_in || !a.thesis_id || seen.has(a.thesis_id)) return false;
            seen.add(a.thesis_id);
            return true;
        });
    }, [linkData]);

    // 1.2 — NEW themes only (those the matcher put in to_create), mapped back to the
    // rich trend objects. Fallback to all themes while link data is unavailable.
    const newTrends = useMemo(() => {
        const all = thesis?.trends || [];
        if (!linkData) return all;
        const create = new Set((linkData.to_create || []).map((c) => _norm(c.trend_name)));
        return all.filter((t) => create.has(_norm(t.name)));
    }, [thesis?.trends, linkData]);

    // Map a matched thesis to a short "why it fits" (the company-trend fit description
    // / rationale, falling back to the matcher's reason) for the existing-matches rows.
    const trendByName = useMemo(() => {
        const m = {};
        (thesis?.trends || []).forEach((t) => { m[_norm(t.name)] = t; });
        return m;
    }, [thesis?.trends]);
    const fitFor = (match) => {
        const t = trendByName[_norm(match.trend_name)];
        return t?.fit_description || t?.rationale || match.reason || null;
    };

    // After adding the company to an existing thesis: refresh this view (matches +
    // membership box) and tell the parent to reload the dashboard/sidebar.
    const handleAdded = () => { setMutateTick((t) => t + 1); onMutated?.(); };

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

            {!isTrend && thesis.no_changes && (
                <div className="border border-[#052049]/40 bg-[#EAF0F7] px-4 py-2.5 mb-6 flex items-start gap-2 text-xs text-[#052049]" data-testid="no-changes-note">
                    <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                    <span>Sin novedades relevantes: hemos vuelto a analizar la empresa y no hay cambios significativos respecto a tu tesis guardada, así que la <strong>conservamos</strong> tal cual.</span>
                </div>
            )}

            {!isTrend && thesis.changes?.length > 0 && (
                <div className="border border-[#1E7D45]/40 bg-[#E8F3EC] px-4 py-3 mb-6 text-xs text-[#13532f]" data-testid="changes-note">
                    <div className="font-semibold flex items-center gap-2 mb-1.5">
                        <RefreshCw size={13} /> Tesis actualizada · {thesis.changes.length} cambio{thesis.changes.length > 1 ? "s" : ""} detectado{thesis.changes.length > 1 ? "s" : ""}
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5">
                        {thesis.changes.map((c, i) => (<li key={i}>{c}</li>))}
                    </ul>
                </div>
            )}

            {!isTrend && thesis.flags?.relevance_unavailable && (
                <div className="border border-[#B8860B]/50 bg-[#FBF3E0] px-4 py-2.5 mb-6 flex items-start gap-2 text-xs text-[#7a5a10]" data-testid="relevance-unavailable-note">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5 text-[#B8860B]" />
                    <span>La IA no pudo calcular los scores de <strong>relevancia</strong> en esta generación (fallo puntual del modelo). El resto del análisis es válido; vuelve a <strong>generar la tesis</strong> para reintentar el cálculo de relevancia.</span>
                </div>
            )}

            {isTrend && thesis.omitted_companies?.length > 0 && (
                <div className="border border-[#B8860B]/50 bg-[#FBF3E0] px-4 py-2.5 mb-6 flex items-start gap-2 text-xs text-[#7a5a10]" data-testid="omitted-companies-note">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5 text-[#B8860B]" />
                    <span>
                        <strong>{thesis.omitted_companies.map((o) => o.name || o.ticker).join(", ")}</strong>{" "}
                        {thesis.omitted_companies.length > 1 ? "no aparecen" : "no aparece"} en esta tesis porque ya {thesis.omitted_companies.length > 1 ? "están" : "está"} en{" "}
                        {thesis.omitted_for_thesis?.id
                            ? <Link to={`/thesis/${thesis.omitted_for_thesis.id}`} className="font-bold underline" data-testid="omitted-thesis-link">{thesis.omitted_for_thesis.title}</Link>
                            : "otra tesis que encaja"}.{" "}
                        Se {thesis.omitted_companies.length > 1 ? "han" : "ha"} omitido para no duplicar su valor.
                    </span>
                </div>
            )}

            {/* TAM hierarchy: this new thesis looks like a sub-segment of a broader one.
                Offer to nest it (manual confirm) so its TAM isn't double-counted. */}
            {isTrend && thesis.parent_suggestion && !parentDismissed && (
                <div className="border border-[#B8860B] bg-[#FBF3E0] px-4 py-3 mb-6" data-testid="parent-suggestion">
                    <div className="flex items-start gap-2 text-sm text-[#7a5a10] leading-relaxed">
                        <GitBranch size={16} className="shrink-0 mt-0.5" />
                        <span>
                            Esta tesis parece un <strong>sub-segmento</strong> de{" "}
                            {thesis.parent_suggestion.thesis_id
                                ? <Link to={`/thesis/${thesis.parent_suggestion.thesis_id}`} className="font-bold underline" data-testid="parent-suggestion-link">{thesis.parent_suggestion.title}</Link>
                                : <strong>{thesis.parent_suggestion.title}</strong>}.{" "}
                            {thesis.parent_suggestion.reason}{" "}
                            Para evitar el <strong>doble conteo del TAM</strong>, puedes anidarla como sub-tesis: su TAM dejará de sumarse al de su megatendencia (contará solo el de la madre).
                        </span>
                    </div>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <button
                            onClick={() => onNest?.(thesis.parent_suggestion.thesis_id)}
                            className="text-xs uppercase tracking-[0.1em] font-semibold bg-[#B8860B] text-white px-3 py-1.5 hover:bg-[#946c09] transition-colors flex items-center gap-1.5"
                            data-testid="parent-nest-btn"
                        >
                            <GitBranch size={13} /> Anidar como sub-tesis
                        </button>
                        <button onClick={() => setParentDismissed(true)} className="text-xs text-[#7a5a10] hover:underline" data-testid="parent-dismiss-btn">
                            Mantener separada
                        </button>
                    </div>
                </div>
            )}

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
                    {/* 1.1a — existing theses where the company already appears (reused box) */}
                    {ticker && <CompanyQualCard ticker={ticker} hideEmpty refreshKey={mutateTick} />}

                    {/* 1.1b — existing theses it fits but isn't included in yet → add */}
                    {existingMatches.length > 0 && (
                        <div className="mb-6" data-testid="existing-matches">
                            <div className="overline text-[#4A4A4A] mb-2">Tesis ya generadas que encajan</div>
                            <div className="space-y-2">
                                {existingMatches.map((m) => (
                                    <MatchedThesisRow key={m.thesis_id} match={m} company={thesis.company} fit={fitFor(m)} onAdded={handleAdded} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 1.2 — new suggested theses (not similar to the ones above) */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="overline text-[#4A4A4A]">Drivers de crecimiento · nuevas tesis</div>
                        {linkLoading && (
                            <span className="text-[11px] text-[#4A4A4A] flex items-center gap-1" data-testid="trends-dup-checking">
                                <Loader2 size={11} className="animate-spin" /> Comprobando duplicados…
                            </span>
                        )}
                    </div>
                    {thesis.id && linkLoading && !linkData ? (
                        <div className="text-xs text-[#4A4A4A] flex items-center gap-2 border border-dashed border-black/20 p-4" data-testid="new-trends-loading">
                            <Loader2 size={13} className="animate-spin" /> Analizando drivers de crecimiento…
                        </div>
                    ) : newTrends.length ? (
                        <div className="grid md:grid-cols-2 gap-4" data-testid="new-trends-list">
                            {newTrends.map((t, i) => <NewThesisCard key={i} idx={i} t={t} />)}
                        </div>
                    ) : (
                        <div className="text-sm text-[#4A4A4A] border border-dashed border-black/20 p-4" data-testid="new-trends-empty">
                            Todos los segmentos de negocio de {ticker || "la empresa"} ya están cubiertos por tus tesis. No hay tesis nuevas que generar.
                        </div>
                    )}
                </>
            )}

            <SourcesList sources={thesis.sources} />
        </div>
    );
}
