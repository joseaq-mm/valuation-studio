import React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, ArrowRight, TrendingUp, AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { ScoreBar, ScoreBadge } from "./ScoreBar";
import ProbabilityCircle from "./ProbabilityCircle";

const DIMS = ["competitive_position", "sector_momentum", "management_quality", "financial_resilience"];

function ContraSection({ contra, isTrend, canGenerate, onGenerate, generating }) {
    // Not generated yet → on-demand button (saves credits).
    if (!contra) {
        if (!canGenerate) return null;
        return (
            <div className="border border-[#B32A22]/40 bg-[#FBEAE8] px-4 py-3 mb-6 flex items-center justify-between gap-3 flex-wrap" data-testid="contra-cta-wrap">
                <div className="flex items-center gap-2 text-sm text-[#7a1d17]">
                    <ShieldAlert size={16} className="shrink-0" />
                    <span>¿Y si la tesis falla? Genera la <strong>contratesis</strong> (escenario bajista, empresas perjudicadas y su probabilidad).</span>
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
                    <div className="overline text-[#B32A22] flex items-center gap-1"><ShieldAlert size={12} /> Contratesis · escenario bajista</div>
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

function CompanyCard({ c }) {
    return (
        <div className="border border-black bg-white p-5" data-testid={`thesis-company-${c.ticker}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="font-serif text-xl font-medium leading-tight">{c.name}</div>
                    <div className="overline text-[#4A4A4A] mt-1">{c.value_chain_role}</div>
                </div>
                <ScoreBadge value={c.overall_score} label="Score global" testid={`overall-${c.ticker}`} />
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

function TrendCard({ t }) {
    const c = t.relevance_score == null ? "#9CA3AF" : t.relevance_score >= 75 ? "#1E7D45" : t.relevance_score >= 50 ? "#B8860B" : "#B32A22";
    return (
        <div className="border border-black bg-white p-5" data-testid={`thesis-trend-${(t.name || "").slice(0, 12)}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="font-serif text-lg font-medium leading-tight flex items-center gap-2">
                    <TrendingUp size={18} className="text-[#052049] shrink-0" />
                    {t.name}
                </div>
                <ScoreBadge value={t.relevance_score} label="Relevancia" />
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
        </div>
    );
}

export default function ThesisResult({ thesis, canGenerateContra = false, onGenerateContra, generatingContra = false }) {
    if (!thesis) return null;
    const isTrend = thesis.type === "trend";

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
                            <ScoreBadge value={thesis.overall_relevance} label="Relevancia temática global" />
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
            {isTrend && thesis.value_chain?.length > 0 && (
                <div className="mb-6" data-testid="thesis-value-chain">
                    <div className="overline text-[#4A4A4A] mb-2">Cadena de valor</div>
                    <div className="flex flex-wrap gap-2">
                        {thesis.value_chain.map((v, i) => (
                            <div key={i} className="border border-black bg-[#F5E4D4] px-3 py-2 max-w-xs">
                                <div className="font-semibold text-sm">{v.stage}</div>
                                <div className="text-xs text-[#4A4A4A] mt-0.5 leading-snug">{v.description}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Companies / Trends grid */}
            {isTrend ? (
                <>
                    <div className="overline text-[#4A4A4A] mb-2">Empresas líderes</div>
                    <div className="grid md:grid-cols-2 gap-4">
                        {(thesis.companies || []).map((c, i) => <CompanyCard key={i} c={c} />)}
                    </div>
                </>
            ) : (
                <>
                    <div className="overline text-[#4A4A4A] mb-2">Tendencias donde encaja</div>
                    <div className="grid md:grid-cols-2 gap-4">
                        {(thesis.trends || []).map((t, i) => <TrendCard key={i} t={t} />)}
                    </div>
                </>
            )}

            <SourcesList sources={thesis.sources} />
        </div>
    );
}
