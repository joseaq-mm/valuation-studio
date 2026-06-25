import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, ArrowRight, TrendingUp, AlertTriangle, Loader2, ShieldAlert, Sparkles, Flame, RefreshCw, GitBranch, GitMerge, ChevronDown, Check } from "lucide-react";
import { ScoreBar, ScoreBadge, ValueBox, tamColor, scoreColor, fmtTamScore } from "./ScoreBar";
import ProbabilityCircle from "./ProbabilityCircle";
import CompanyQualCard from "./CompanyQualCard";
import HoverTip from "@/components/HoverTip";
import { thesisMerge, thesisUnmerge, thesisSetPlan } from "@/lib/api";

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
        "TAM Score = (Score global tesis / 100 × TAM del eslabón 2027e) / Ingresos proyectados 2027 de la empresa.\n\n" +
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

// Competitive role badge. 'disruptor' is reserved for genuine paradigm-shift / risky
// bets that threaten the leader / radically-superior approaches; every other non-leader
// is a 'competitor'.
function catBadge(category) {
    if (category === "disruptor") return { txt: "Disruptor", cls: "bg-[#B32A22] text-white" };
    if (category === "leader") return { txt: "Líder", cls: "bg-[#052049] text-[#FDF1E6]" };
    return { txt: "Competidor", cls: "bg-[#4A4A4A] text-white" };
}

function CompanyCard({ c, stageTam }) {
    const badge = catBadge(c.category);
    const tamData = { tam_score: c.tam_score, projected_revenue_busd: c.projected_revenue_busd, stage_tam_busd: stageTam };
    return (
        <div className="border border-black bg-white p-5" data-testid={`thesis-company-${c.ticker}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <span
                        className={`inline-block text-[10px] uppercase tracking-[0.12em] font-bold px-1.5 py-0.5 mb-1 ${badge.cls}`}
                        data-testid={`category-${c.ticker}`}
                    >
                        {badge.txt}
                    </span>
                    <div className="font-serif text-xl font-medium leading-tight">{c.name}</div>
                    <div className="overline text-[#4A4A4A] mt-1">{c.value_chain_role}</div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                    <ScoreStatRight value={c.overall_score} label={<>Score global<br />tesis</>} testid={`overall-${c.ticker}`} tip={SCORE_GLOBAL_TIP} />
                    <TamScoreBadge data={tamData} loading={false} ticker={c.ticker} />
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

function StageRow({ group }) {
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
                            ? leaders.map((c, i) => <CompanyCard key={i} c={c} stageTam={stage.tam_busd} />)
                            : <div className="text-xs text-[#9CA3AF] border border-dashed border-black/20 p-3">Sin líder identificado en este eslabón.</div>}
                    </div>
                </div>
                <div>
                    <div className="overline text-[#B32A22] mb-2">Competidores / disruptores</div>
                    <div className="space-y-4">
                        {disruptors.length
                            ? disruptors.map((c, i) => <CompanyCard key={i} c={c} stageTam={stage.tam_busd} />)
                            : <div className="text-xs text-[#9CA3AF] border border-dashed border-black/20 p-3">Sin competidores identificados en este eslabón.</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function CompaniesByStage({ valueChain, companies }) {
    const stages = valueChain || [];
    const used = new Set();
    const groups = stages.map((s) => {
        const inStage = (companies || []).filter((c) => _norm(c.value_chain_role) === _norm(s.stage));
        inStage.forEach((c) => used.add(c.ticker));
        return {
            stage: s,
            leaders: inStage.filter((c) => c.category === "leader"),
            disruptors: inStage.filter((c) => c.category !== "leader"),
        };
    });
    const leftover = (companies || []).filter((c) => !used.has(c.ticker));
    if (leftover.length) {
        groups.push({
            stage: { stage: stages.length ? "Otros" : "Empresas", description: "", tam_busd: null },
            leaders: leftover.filter((c) => c.category === "leader"),
            disruptors: leftover.filter((c) => c.category !== "leader"),
        });
    }
    return <>{groups.map((g, i) => <StageRow key={i} group={g} />)}</>;
}

const RELEVANCE_TIP =
    "Relevancia (0–100): cuánto pesa esta tendencia en la tesis de inversión de la empresa — qué tan central es este tema para su caso alcista.\n\nNo mide la calidad de la empresa, sino el encaje/peso del tema. Es relativa entre las tendencias en las que encaja: ≥75 (verde) = motor central del negocio; <50 (rojo) = encaje marginal o secundario.";

const SCORE_GLOBAL_TIP =
    "Score global tesis (0–100): es la MEDIA de los cuatro sub-scores de la empresa en esta tesis —posición competitiva, momentum del sector, calidad del management y resiliencia financiera—.\n\nMayor = mejor.";

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

/** Develop action: executes in-place via onDevelop (no search box) when provided;
 *  otherwise falls back to a deep-link (e.g. from the saved-thesis detail page). */
function DevelopAction({ name, core, whole, companyId, onDevelop, linkTo, testid, className, children }) {
    if (onDevelop) {
        return (
            <button type="button" onClick={() => onDevelop({ name, core, whole, companyId })} className={className} data-testid={testid}>
                {children}
            </button>
        );
    }
    return <Link to={linkTo} className={className} data-testid={testid}>{children}</Link>;
}

/** Bloque 1.2 — a NEW thesis idea (growth driver). May offer an optional split into
 *  independent sub-parts (whose TAM sum to the core). Once a part (or the whole) is
 *  developed, the card becomes an informational note + the remaining parts as cards. */
function NewThesisCard({ t, idx = 0, companyId, dev, onDevelop, onSetPlan, planningLocked = false, mergeTargets = [], absorbed = [], onMerge, ticker, developed = false }) {
    const [showSplits, setShowSplits] = useState(false);
    const [mergeMode, setMergeMode] = useState("idle");
    const [mergeTarget, setMergeTarget] = useState("");
    const planBtn = (active) => `text-[11px] uppercase tracking-[0.1em] font-semibold px-3 py-1.5 border transition-colors ${active ? "bg-black text-[#FDF1E6] border-black" : "bg-white text-[#1a1a1a] border-black/30 hover:border-black"}`;
    const absorbedTam = (absorbed || []).reduce((a, s) => a + (s.tam_busd || 0), 0);
    const displayTam = (t.tam_busd || 0) + absorbedTam;
    const c = t.relevance_score == null ? "#9CA3AF" : t.relevance_score >= 75 ? "#1E7D45" : t.relevance_score >= 50 ? "#B8860B" : "#B32A22";
    const slug = `${_norm(t.name).slice(0, 16)}-${idx}`;
    const coreName = t.name || "";
    const ctx = companyId ? `&from_company=${companyId}&core=${encodeURIComponent(coreName)}` : "";
    const splitLink = (name) => `/thesis?trend=${encodeURIComponent(name || "")}&auto=1${ctx}`;
    const splits = Array.isArray(t.splits) && t.splits.length >= 2 ? t.splits : null;
    const splitSum = splits ? splits.reduce((a, s) => a + (s.tam_busd || 0), 0) : 0;

    const devSplits = dev?.developedSplits || [];
    const devSplitId = (name) => devSplits.find((d) => _norm(d.split) === _norm(name))?.developed_id;
    const wholeDeveloped = !!dev?.whole;
    const splitDeveloped = devSplits.length > 0;
    const isDeveloped = wholeDeveloped || splitDeveloped;

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
            {fmtTam(displayTam) && (
                <div className="mt-1.5 inline-flex items-center gap-1 text-xs" data-testid={`new-thesis-tam-${(t.name || "").slice(0, 12)}`}>
                    <span className="overline text-[#4A4A4A]">TAM estimado</span>
                    <span className="font-mono font-bold text-[#1E7D45]">{fmtTam(displayTam)}</span>
                </div>
            )}
            {absorbed.length > 0 && (
                <div className="mt-1 text-[11px] text-[#7a5a10] flex items-start gap-1" data-testid={`absorbed-${slug}`}>
                    <GitMerge size={11} className="shrink-0 mt-0.5" />
                    <span>Incluye (fusionadas): {absorbed.map((s) => s.name).join(" · ")}</span>
                </div>
            )}

            {/* Status banner (green) when developed — narrative is preserved below. */}
            {wholeDeveloped && (
                <div className="mt-3 inline-flex items-center gap-2 w-fit border border-[#1E7D45]/50 bg-[#F0F7F2] px-3 py-1.5 text-sm" data-testid={`core-whole-note-${(t.name || "").slice(0, 12)}`}>
                    <Check size={15} className="text-[#1E7D45]" />
                    <span className="font-semibold text-[#1E7D45]">Tesis generada</span>
                    <Link to={`/thesis/${dev.whole.developed_id}`} className="underline font-medium text-[#1a1a1a]" data-testid={`core-whole-link-${(t.name || "").slice(0, 12)}`}>Ver la tesis</Link>
                </div>
            )}
            {!wholeDeveloped && splitDeveloped && (
                <div className="mt-3 inline-flex items-center gap-2 w-fit border border-[#1E7D45]/50 bg-[#F0F7F2] px-3 py-1.5 text-sm" data-testid={`core-split-note-${(t.name || "").slice(0, 12)}`}>
                    <Check size={15} className="text-[#1E7D45]" />
                    <span className="font-semibold text-[#1E7D45]">Tesis generada por partes</span>
                    <span className="text-[11px] text-[#4A4A4A]">· detalle abajo</span>
                </div>
            )}

            {/* Narrative — ALWAYS shown (kept as reference even after the thesis is developed). */}
            {t.win_probability != null && <div className="mt-2.5"><WinningBadge value={t.win_probability} /></div>}
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

            {/* Splits */}
            {splits && (isDeveloped || planningLocked) ? (
                /* Developed / locked: split parts as info with per-part status (+ generate pending). */
                <div className="mt-3 border border-[#B8860B]/50 bg-[#FBF3E0] p-3" data-testid={`splits-status-${(t.name || "").slice(0, 12)}`}>
                    <div className="font-semibold text-[#7a5a10] flex items-center gap-1.5 mb-1.5 text-sm"><GitBranch size={14} /> Particiones del conjunto</div>
                    <ul className="space-y-1">
                        {splits.map((sp, i) => {
                            const did = devSplitId(sp.name);
                            return (
                                <li key={i} className="text-[13px] flex items-center justify-between gap-2">
                                    <span className="min-w-0"><span className="font-medium">{sp.name}</span>{fmtTam(sp.tam_busd) ? ` (${fmtTam(sp.tam_busd)})` : ""}</span>
                                    {did
                                        ? <Link to={`/thesis/${did}`} className="text-[#1E7D45] underline font-semibold inline-flex items-center gap-1 shrink-0"><Check size={12} />tesis generada</Link>
                                        : wholeDeveloped
                                            ? <span className="text-[#4A4A4A] text-[11px] shrink-0">incluida en el conjunto</span>
                                            : <DevelopAction
                                                name={sp.name} core={coreName} whole={false} companyId={companyId} onDevelop={onDevelop}
                                                linkTo={splitLink(sp.name)}
                                                className="shrink-0 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] font-semibold bg-black text-[#FDF1E6] px-2.5 py-1 hover:bg-[#052049] transition-colors"
                                                testid={`split-generate-${_norm(sp.name).slice(0, 12)}`}
                                            ><Sparkles size={11} /> Generar</DevelopAction>}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ) : splits ? (
                /* Planning, not developed: interactive split panel. */
                <div className="mt-3 border-2 border-[#B8860B] bg-[#FBF3E0] p-3">
                    <button
                        onClick={() => setShowSplits((v) => {
                            const next = !v;
                            // Sincronía bidireccional con el plan (solo en planificación):
                            //   - desplegar  → marca "split"   (interés en partir)
                            //   - colapsar   → marca "whole"   (vuelta al conjunto)
                            // El usuario puede forzar cualquiera con los botones manuales.
                            if (!planningLocked) {
                                if (next && t.plan !== "split") onSetPlan?.(coreName, "split");
                                else if (!next && t.plan === "split") onSetPlan?.(coreName, "whole");
                            }
                            return next;
                        })}
                        className="w-full flex items-center justify-between gap-2 text-left"
                        data-testid={`thesis-split-toggle-${(t.name || "").slice(0, 12)}`}
                    >
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#7a5a10] uppercase tracking-[0.06em]">
                            <GitBranch size={15} /> Se puede dividir en {splits.length} partes
                        </span>
                        <ChevronDown size={16} className={`text-[#7a5a10] transition-transform ${showSplits ? "rotate-180" : ""}`} />
                    </button>
                    <p className="text-[11px] text-[#7a5a10] mt-1 leading-snug">
                        Si la partes, cada parte es su propia tesis y sus TAM se <strong>reparten el TAM del conjunto</strong> ({fmtTam(t.tam_busd) || "del driver"}): al generarlas, sus trozos se ajustan para sumar exactamente ese total (coherencia garantizada).
                    </p>
                    {showSplits && (
                        <ul className="mt-2 space-y-1" data-testid={`thesis-splits-${(t.name || "").slice(0, 12)}`}>
                            {splits.map((sp, i) => (
                                <li key={i} className="flex items-center justify-between gap-2 border border-[#B8860B]/40 bg-white px-2.5 py-1.5 text-sm">
                                    <span className="font-medium leading-tight">{sp.name}</span>
                                    {fmtTam(sp.tam_busd) && <span className="font-mono text-xs text-[#1E7D45] font-bold shrink-0">{fmtTam(sp.tam_busd)}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}

            {/* Footer: planning controls — only while planning and not yet developed. */}
            {!isDeveloped && (
                <div className="mt-auto pt-4 border-t border-black/10">
                    {planningLocked ? (
                        <div className="text-[11px] text-[#4A4A4A] inline-flex items-center gap-1.5" data-testid={`pending-gen-${slug}`}>
                            <Loader2 size={12} className="animate-spin" /> Pendiente de generarse…
                        </div>
                    ) : (
                        <div data-testid={`plan-markers-${slug}`}>
                            <div className="overline text-[#4A4A4A] mb-1.5">¿Cómo generarla?</div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button onClick={() => onSetPlan?.(coreName, "whole")} className={planBtn(t.plan !== "split")} data-testid={`plan-whole-${slug}`}>
                                    Conjunto
                                </button>
                                {splits && (
                                    <button onClick={() => onSetPlan?.(coreName, "split")} className={planBtn(t.plan === "split")} data-testid={`plan-split-${slug}`}>
                                        <GitBranch size={12} className="inline -mt-0.5 mr-1" />Particiones ({splits.length})
                                    </button>
                                )}
                            </div>
                            <p className="text-[11px] text-[#4A4A4A] mt-1.5 leading-snug">
                                {t.plan === "split" && splits
                                    ? <>Se generarán <strong>{splits.length} tesis</strong>; sus TAM se reparten el conjunto ({fmtTam(t.tam_busd) || "del driver"}).</>
                                    : <>Se generará <strong>1 tesis</strong> con todo el TAM del driver{fmtTam(t.tam_busd) ? ` (${fmtTam(t.tam_busd)})` : ""}.</>}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Fusionar (control manual, solo en planificación): fold this driver into a sibling. */}
            {onMerge && mergeTargets.length > 0 && (
                <div className="mt-3 pt-3 border-t border-black/10" data-testid={`merge-wrap-${slug}`}>
                    {mergeMode === "idle" && (
                        <button onClick={() => setMergeMode("pick")} className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#7a5a10] inline-flex items-center gap-1 hover:underline" data-testid={`merge-open-${slug}`}>
                            <GitMerge size={12} /> Fusionar en otra tesis
                        </button>
                    )}
                    {mergeMode === "pick" && (
                        <div className="space-y-2" data-testid={`merge-pick-${slug}`}>
                            <div className="text-xs font-semibold">Fusionar «{t.name}» en:</div>
                            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} className="w-full border border-black/30 px-2 py-1.5 text-xs outline-none bg-white" data-testid={`merge-target-select-${slug}`}>
                                <option value="">— Elige driver destino —</option>
                                {mergeTargets.map((n) => <option key={`p-${n}`} value={n}>{n}</option>)}
                            </select>
                            <div className="flex items-center gap-2">
                                <button disabled={!mergeTarget} onClick={() => setMergeMode("confirm")} className="text-[11px] uppercase tracking-[0.1em] font-semibold bg-black text-[#FDF1E6] px-2.5 py-1.5 disabled:opacity-40" data-testid={`merge-continue-${slug}`}>Continuar</button>
                                <button onClick={() => { setMergeMode("idle"); setMergeTarget(""); }} className="text-[11px] text-[#4A4A4A] hover:underline">Cancelar</button>
                            </div>
                        </div>
                    )}
                    {mergeMode === "confirm" && (
                            <div className="border border-[#B8860B] bg-[#FBF3E0] p-3 space-y-2" data-testid={`merge-confirm-${slug}`}>
                                <div className="text-xs text-[#7a5a10] leading-relaxed">
                                    «<strong>{t.name}</strong>» se fusionará en «<strong>{mergeTarget}</strong>».{fmtTam(t.tam_busd) && <> Su TAM ({fmtTam(t.tam_busd)}) se <strong>sumará</strong> al de la tesis destino.</>}{" "}Es reversible mientras no generes tesis.</div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => { onMerge(t.name, mergeTarget); setMergeMode("idle"); setMergeTarget(""); }} className="text-[11px] uppercase tracking-[0.1em] font-semibold bg-[#B8860B] text-white px-2.5 py-1.5 hover:bg-[#946c09] transition-colors" data-testid={`merge-confirm-btn-${slug}`}>Confirmar fusión</button>
                                    <button onClick={() => setMergeMode("pick")} className="text-[11px] text-[#7a5a10] hover:underline">Atrás</button>
                                </div>
                            </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function ThesisResult({ thesis, canGenerateContra = false, onGenerateContra, generatingContra = false, onMutated, onDevelop, onGeneratePlan, generatingPlan = false, onThesisUpdate }) {
    const isTrend = thesis?.type === "trend";
    const planningLocked = !!thesis?.planning_locked;

    const ticker = thesis?.company?.ticker;

    // Per-core split-development state (which splits / the whole were already developed).
    const splitDev = useMemo(() => {
        const byCore = {};
        (thesis?.split_dev || []).forEach((e) => {
            const k = _norm(e.core);
            if (!byCore[k]) byCore[k] = { developedSplits: [], whole: null };
            if (e.whole) byCore[k].whole = { developed_id: e.developed_id };
            else byCore[k].developedSplits.push({ split: e.split, developed_id: e.developed_id });
        });
        return byCore;
    }, [thesis?.split_dev]);

    // Cores already developed by parts (or whole). Once a core has a split developed,
    // the matcher reclassifies it into `to_add` (it now matches the developed thesis),
    // so we must KEEP showing its card (as the split-note state) and NOT also list it
    // as a generic "matched thesis to add" row — otherwise the note + the remaining
    // pending split cards vanish.
    const splitDevCores = useMemo(() => new Set(Object.keys(splitDev)), [splitDev]);

    // Manual merge state (Fase A/B): proposals folded into another (reversible).
    const mergedTrends = useMemo(() => (thesis?.trends || []).filter((t) => t.merged_into), [thesis?.trends]);
    const mergedNames = useMemo(() => new Set(mergedTrends.map((t) => _norm(t.name))), [mergedTrends]);
    const absorbedByTarget = useMemo(() => {
        const m = {};
        mergedTrends.forEach((t) => { const k = _norm(t.merged_into); (m[k] || (m[k] = [])).push(t); });
        return m;
    }, [mergedTrends]);

    const doMerge = async (source, target) => {
        if (!thesis?.id) return;
        try {
            const updated = await thesisMerge(thesis.id, source, target);
            onThesisUpdate?.(updated);
            onMutated?.();
            toast.success(`«${source}» fusionada en «${target}»`, { action: { label: "Revertir", onClick: () => doUnmerge(source) } });
        } catch (e) { toast.error(e?.response?.data?.detail || "No se pudo fusionar."); }
    };
    const doUnmerge = async (source) => {
        if (!thesis?.id) return;
        try {
            const updated = await thesisUnmerge(thesis.id, source);
            onThesisUpdate?.(updated);
            onMutated?.();
            toast.success(`«${source}» restaurada.`);
        } catch (e) { toast.error(e?.response?.data?.detail || "No se pudo revertir."); }
    };

    // Planning phase: mark a driver as "whole" (one thesis) or "split" (all partitions).
    // Pure metadata, no LLM — nothing generates until the user presses "Generar plan".
    const doSetPlan = async (core, plan) => {
        if (!thesis?.id) return;
        try {
            const updated = await thesisSetPlan(thesis.id, core, plan);
            onThesisUpdate?.(updated);
        } catch (e) { toast.error(e?.response?.data?.detail || "No se pudo marcar el plan."); }
    };

    // 1.1b — existing-thesis match feature REMOVED (Jun 2026, per user request): no
    // more "Tesis ya generadas que encajan" panel. The plan-generation flow is now the
    // sole way to add TAM to a company, keeping the UX focused on one path.

    // 1.2 — All non-merged drivers are shown for planning. No more LLM-based
    // duplicate-detection split between to_add/to_create — every driver is plannable.
    const newTrends = useMemo(
        () => (thesis?.trends || []).filter((t) => !t.merged_into),
        [thesis?.trends]
    );

    // How many theses "Generar plan" will create: split → its partitions, else 1.
    const planCount = useMemo(() => {
        if (planningLocked) return 0;
        return (thesis?.trends || [])
            .filter((t) => !t.merged_into)
            .reduce((n, t) => {
                const sp = Array.isArray(t.splits) && t.splits.length >= 2 ? t.splits : null;
                return n + (t.plan === "split" && sp ? sp.length : 1);
            }, 0);
    }, [thesis?.trends, planningLocked]);

    // After locking, how many planned theses are still NOT developed (failed /
    // interrupted / queued). Drives the "Reanudar generación" recovery button.
    const pendingCount = useMemo(() => {
        if (!planningLocked) return 0;
        return (thesis?.trends || [])
            .filter((t) => !t.merged_into)
            .reduce((n, t) => {
                const d = splitDev[_norm(t.name)];
                const sp = Array.isArray(t.splits) && t.splits.length >= 2 ? t.splits : null;
                if (t.plan === "split" && sp) {
                    const done = new Set((d?.developedSplits || []).map((x) => _norm(x.split)));
                    return n + sp.filter((s) => !done.has(_norm(s.name))).length;
                }
                return n + (d?.whole ? 0 : 1);
            }, 0);
    }, [thesis?.trends, planningLocked, splitDev]);

    // After adding the company to an existing thesis: refresh this view (matches +
    // membership box) and tell the parent to reload the dashboard/sidebar.
    // (CompanyQualCard removed Jun 2026 — no longer used; kept signature in case
    // future internal flows need a simple parent-notify hook.)

    if (!thesis) return null;

    return (
        <div data-testid="thesis-result">
            {/* Header */}
            <div className="border border-black bg-white p-6 mb-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                        <div className="overline text-[#B32A22] mb-1">
                            {isTrend ? "Tesis → Cadena de valor" : "Empresa → Tesis"}
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
                                text={"Relevancia temática global (0–100): cuán expuesta e impulsada está la empresa por el CONJUNTO de tesis en las que encaja.\n\nResume, en un solo número, el peso agregado de los temas estructurales en su tesis alcista."}
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
                        <div className="overline text-[#4A4A4A]">Cadena de valor · líderes vs. competidores/disruptores</div>
                        <div className="overline text-[#9CA3AF] hidden sm:block">TAM 2027e por eslabón</div>
                    </div>
                    <CompaniesByStage valueChain={thesis.value_chain} companies={thesis.companies} />
                </>
            ) : (
                <>
                    {/* 1.1a — CompanyQualCard (restored Jun 2026, filtered by source_company_thesis_id):
                        shows ONLY trend theses that were BORN from THIS company's plan,
                        not auto-included memberships from other plans. Hidden when empty. */}
                    {thesis.company?.ticker && (
                        <CompanyQualCard
                            ticker={thesis.company.ticker}
                            hideEmpty
                            fromCompanyId={thesis.id}
                            refreshKey={thesis.updated_at || thesis.id}
                        />
                    )}

                    {/* 1.1b — existing-matches feature removed: only the plan flow remains */}

                    {/* 1.2 — new suggested theses (drivers de crecimiento) */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="overline text-[#4A4A4A]">Drivers de crecimiento · nuevas tesis</div>
                    </div>
                    {/* Planning notice: mark each driver, merge what you don't want, THEN execute. */}
                    {!planningLocked ? (
                        <div className="mb-3 border border-[#B8860B] bg-[#FBF3E0] px-3 py-2 text-[12px] text-[#7a5a10] leading-snug flex items-start gap-2" data-testid="planning-notice">
                            <GitBranch size={14} className="shrink-0 mt-0.5" />
                            <span><strong>Fase de planificación.</strong> Marca cada driver como <strong>Conjunto</strong> o <strong>Particiones</strong>, y <strong>fusiona</strong> los que no quieras por separado (su TAM se suma al destino, no se pierde). Cuando lo tengas, pulsa <strong>Generar plan</strong> abajo para crear todas las tesis a la vez. Nada se genera hasta entonces.</span>
                        </div>
                    ) : (
                        <div className="mb-3 border border-black/15 bg-[#F7F2EA] px-3 py-2 text-[12px] text-[#4A4A4A] leading-snug flex items-start gap-2" data-testid="planning-locked-notice">
                            <Sparkles size={14} className="shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <span><strong>Planificación cerrada:</strong> ya empezaste a generar tesis de esta empresa. Para reorganizar la partición (fusionar/partir), borra sus tesis generadas o reescribe la empresa desde cero.</span>
                                {pendingCount > 0 && (
                                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                                        <span className="text-[#B32A22] font-medium">Quedan {pendingCount} tesis del plan sin generar.</span>
                                        <button
                                            onClick={() => onGeneratePlan?.(thesis.id)}
                                            disabled={generatingPlan}
                                            className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] font-semibold bg-black text-[#FDF1E6] px-3 py-1.5 hover:bg-[#052049] transition-colors disabled:opacity-50"
                                            data-testid="resume-plan-btn"
                                        >
                                            {generatingPlan ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Reanudar generación
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {newTrends.length ? (
                        <div className="grid md:grid-cols-2 gap-4" data-testid="new-trends-list">
                            {newTrends.map((t, i) => {
                                const d = splitDev[_norm(t.name)];
                                return (
                                    <NewThesisCard
                                        key={i} idx={i} t={t} companyId={thesis.id}
                                        dev={d} onDevelop={onDevelop} onSetPlan={doSetPlan}
                                        planningLocked={planningLocked}
                                        mergeTargets={newTrends.filter((o) => _norm(o.name) !== _norm(t.name)).map((o) => o.name)}
                                        absorbed={absorbedByTarget[_norm(t.name)] || []}
                                        onMerge={planningLocked ? null : doMerge}
                                        ticker={thesis.company?.ticker}
                                        developed={!!(d && (d.whole || (d.developedSplits || []).length))}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-sm text-[#4A4A4A] border border-dashed border-black/20 p-4" data-testid="new-trends-empty">
                            Todos los segmentos de negocio de {ticker || "la empresa"} ya están cubiertos por tus tesis. No hay tesis nuevas que generar.
                        </div>
                    )}

                    {/* EXECUTE — generate the whole plan at once (serial queue). */}
                    {!planningLocked && planCount > 0 && (
                        <div className="mt-5 border-2 border-black bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="generate-plan-bar">
                            <div className="min-w-0">
                                <div className="font-serif text-lg font-medium leading-tight">¿Listo? Genera el plan completo</div>
                                <p className="text-xs text-[#4A4A4A] mt-0.5 leading-snug">
                                    Se crearán <strong>{planCount}</strong> tesis en serie (cola), conservando el 100 % del TAM. Los drivers sin marcar se generan como <strong>conjunto</strong>; los marcados como particiones, en sus partes.
                                </p>
                            </div>
                            <button
                                onClick={() => onGeneratePlan?.(thesis.id)}
                                disabled={generatingPlan}
                                className="shrink-0 inline-flex items-center justify-center gap-2 text-sm uppercase tracking-[0.12em] font-semibold bg-black text-[#FDF1E6] px-5 py-3 hover:bg-[#052049] transition-colors disabled:opacity-50"
                                data-testid="generate-plan-btn"
                            >
                                {generatingPlan ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                                Generar plan · {planCount} {planCount === 1 ? "tesis" : "tesis"}
                            </button>
                        </div>
                    )}

                    {!planningLocked && mergedTrends.length > 0 && (
                        <div className="mt-6" data-testid="merged-theses">
                            <div className="overline text-[#4A4A4A] mb-2">Tesis fusionadas</div>
                            <div className="space-y-1.5">
                                {mergedTrends.map((t, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2 border border-[#B8860B]/40 bg-[#FBF3E0] px-3 py-2" data-testid={`merged-row-${_norm(t.name).slice(0, 12)}`}>
                                        <div className="text-xs text-[#7a5a10] min-w-0">
                                            <GitMerge size={12} className="inline mr-1 -mt-0.5" />
                                            «<strong>{t.name}</strong>» → fusionada en «<strong>{t.merged_into}</strong>»
                                        </div>
                                        <button onClick={() => doUnmerge(t.name)} className="text-[11px] uppercase tracking-[0.1em] font-semibold border border-[#B8860B] text-[#7a5a10] px-2.5 py-1 hover:bg-[#B8860B] hover:text-white transition-colors shrink-0" data-testid={`unmerge-${_norm(t.name).slice(0, 12)}`}>
                                            Revertir
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            <SourcesList sources={thesis.sources} />
        </div>
    );
}
