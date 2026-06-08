import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, ArrowRight, GitMerge } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisCompanyProfile, thesisMergeThesis, thesisUnmergeThesis } from "@/lib/api";
import { ValueBox, scoreColor, tamColor, fmtTamScore } from "./ScoreBar";

import HoverTip from "@/components/HoverTip";

/**
 * Bridges the qualitative Thesis Engine with the quantitative company dashboard.
 * Lists every saved TREND thesis where this ticker appears — one line each, with
 * the trend (bold, linked to the full thesis), its "Score global tendencia" and
 * its TAM Score. Footer: average of all overall scores (overall quality) and the
 * sum of all TAM Scores (total potential).
 *
 * Fase B (control manual): when rendered inside a company thesis (companyId +
 * onMerged provided), each row gets a "Fusionar" action that folds that developed
 * thesis into another the company belongs to, removing the company from it
 * (reversible via the "Tesis fusionadas" strip below).
 */
export default function CompanyQualCard({ ticker, hideEmpty = false, refreshKey = 0, companyId = null, thesisMerges = [], onMerged }) {
    const { user } = useAuth();
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mergeFor, setMergeFor] = useState(null);   // source thesis_id in merge mode
    const [mergeTarget, setMergeTarget] = useState("");
    const [mergeStep, setMergeStep] = useState("pick"); // pick | confirm
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        const run = async () => {
            if (!user || !ticker) { if (alive) { setProfile(null); setLoading(false); } return; }
            if (alive) setLoading(true);
            try {
                const d = await thesisCompanyProfile(ticker);
                if (alive) setProfile(d);
            } catch {
                if (alive) setProfile(null);
            } finally {
                if (alive) setLoading(false);
            }
        };
        run();
        return () => { alive = false; };
    }, [user, ticker, refreshKey]);

    const resetMerge = () => { setMergeFor(null); setMergeTarget(""); setMergeStep("pick"); };

    const doMerge = async (rows) => {
        if (!companyId || !mergeFor || !mergeTarget) return;
        setBusy(true);
        try {
            const updated = await thesisMergeThesis(companyId, mergeFor, mergeTarget);
            onMerged?.(updated);
            const src = rows.find((r) => r.thesis_id === mergeFor);
            toast.success(`«${src?.thesis_title || "Tesis"}» fusionada`, {
                action: { label: "Revertir", onClick: () => doUnmerge(mergeFor) },
            });
            resetMerge();
        } catch (e) { toast.error(e?.response?.data?.detail || "No se pudo fusionar."); }
        finally { setBusy(false); }
    };

    const doUnmerge = async (sourceId) => {
        if (!companyId) return;
        try {
            const updated = await thesisUnmergeThesis(companyId, sourceId);
            onMerged?.(updated);
            toast.success("Tesis restaurada.");
        } catch (e) { toast.error(e?.response?.data?.detail || "No se pudo revertir."); }
    };

    if (loading) return null;

    // Embedded inside the thesis result (hideEmpty): show nothing when logged out
    // or when there is no qualitative data — the surrounding page handles those.
    if (hideEmpty && (!user || (!(profile?.trend_rows || []).length && !profile?.reverse && !(thesisMerges || []).length))) return null;

    // Not logged in → subtle prompt
    if (!user) {
        return (
            <div className="border border-black bg-[#F5E4D4] p-4 mb-6 flex items-center justify-between gap-4 flex-wrap" data-testid="company-qual-login">
                <div className="flex items-center gap-2 text-sm">
                    <Sparkles size={16} className="text-[#052049]" />
                    <span>Genera un <strong>análisis cualitativo con IA</strong> de {ticker}: tendencias en las que encaja, rol en la cadena de valor y score.</span>
                </div>
                <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="btn-ghost flex items-center gap-1 shrink-0" data-testid="company-qual-cta">
                    Ir a Tesis <ArrowRight size={13} />
                </Link>
            </div>
        );
    }

    const rows = profile?.trend_rows || [];
    const reverse = profile?.reverse;
    // Phase B merge removed: fusionar/partir happen ONLY in the planning phase
    // (before generating), so the TAM partition stays conserved. Existing merges can
    // still be reverted via the list below.
    const canMerge = false;

    // Logged in but the company is not part of any saved thesis → CTA to generate.
    if (!rows.length && !reverse && !(thesisMerges || []).length) {
        return (
            <div className="border border-dashed border-black/40 bg-white p-4 mb-6 flex items-center justify-between gap-4 flex-wrap" data-testid="company-qual-empty">
                <div className="flex items-center gap-2 text-sm text-[#4A4A4A]">
                    <Sparkles size={16} className="text-[#052049]" />
                    <span>Aún no tienes una tesis cualitativa de <strong>{ticker}</strong>.</span>
                </div>
                <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="btn-primary flex items-center gap-1 shrink-0" data-testid="company-qual-generate">
                    <Sparkles size={13} /> Generar tesis
                </Link>
            </div>
        );
    }

    const COLS = "grid-cols-[1fr_5rem_4.5rem]";

    return (
        <div className="border border-black bg-white p-5 mb-6" data-testid="company-qual-card">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="overline text-[#B32A22]">Tesis cualitativa · tesis guardadas</div>
                <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="text-xs text-[#052049] hover:underline inline-flex items-center gap-1" data-testid="company-qual-add">
                    <Sparkles size={12} /> Buscar más tesis
                </Link>
            </div>

            {rows.length > 0 && (
                <>
                    {/* Column headers */}
                    <div className={`grid ${COLS} gap-x-4 items-end pb-1.5 border-b border-black`}>
                        <div className="overline text-[#4A4A4A]">Tesis</div>
                        <div className="overline text-[#4A4A4A] text-center leading-tight">Score global tesis</div>
                        <div className="overline text-[#4A4A4A] text-center leading-tight">TAM Score</div>
                    </div>

                    {/* One line per thesis */}
                    {rows.map((r) => (
                        <React.Fragment key={r.thesis_id}>
                            <div className={`grid ${COLS} gap-x-4 items-center py-2.5 border-b border-black/10`} data-testid={`qual-row-${r.thesis_id}`}>
                                <div className="min-w-0">
                                    <Link to={`/thesis/${r.thesis_id}`} className="font-bold text-sm leading-tight hover:underline inline-flex items-center gap-1" data-testid={`qual-row-link-${r.thesis_id}`}>
                                        <span className="truncate">{r.thesis_title}</span>
                                        <ArrowRight size={12} className="shrink-0" />
                                    </Link>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {r.value_chain_role && <div className="overline text-[#9CA3AF] truncate">{r.value_chain_role}</div>}
                                        {canMerge && mergeFor !== r.thesis_id && (
                                            <button onClick={() => { setMergeFor(r.thesis_id); setMergeTarget(""); setMergeStep("pick"); }} className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#7a5a10] inline-flex items-center gap-0.5 hover:underline shrink-0" data-testid={`qual-merge-open-${r.thesis_id}`}>
                                                <GitMerge size={11} /> Fusionar
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex justify-center">
                                    <ValueBox text={r.overall_score ?? "—"} color={scoreColor(r.overall_score)} testid={`qual-overall-${r.thesis_id}`} />
                                </div>
                                <div className="flex justify-center">
                                    <ValueBox text={fmtTamScore(r.tam_score) ?? "—"} color={tamColor(r.tam_score)} testid={`qual-tam-${r.thesis_id}`} />
                                </div>
                            </div>
                            {canMerge && mergeFor === r.thesis_id && (
                                <div className="border-b border-black/10 py-2.5 px-2 bg-[#FBF3E0]/70" data-testid={`qual-merge-panel-${r.thesis_id}`}>
                                    {mergeStep === "pick" ? (
                                        <div className="space-y-2">
                                            <div className="text-xs font-semibold text-[#7a5a10]">Fusionar «{r.thesis_title}» en otra tesis de {ticker}:</div>
                                            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} className="w-full border border-black/30 px-2 py-1.5 text-xs outline-none bg-white" data-testid={`qual-merge-target-${r.thesis_id}`}>
                                                <option value="">— Elige tesis destino —</option>
                                                {rows.filter((o) => o.thesis_id !== r.thesis_id).map((o) => <option key={o.thesis_id} value={o.thesis_id}>{o.thesis_title}</option>)}
                                            </select>
                                            <div className="flex items-center gap-2">
                                                <button disabled={!mergeTarget} onClick={() => setMergeStep("confirm")} className="text-[11px] uppercase tracking-[0.1em] font-semibold bg-black text-[#FDF1E6] px-2.5 py-1.5 disabled:opacity-40" data-testid={`qual-merge-continue-${r.thesis_id}`}>Continuar</button>
                                                <button onClick={resetMerge} className="text-[11px] text-[#4A4A4A] hover:underline">Cancelar</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2" data-testid={`qual-merge-confirm-${r.thesis_id}`}>
                                            <div className="text-xs text-[#7a5a10] leading-relaxed">
                                                «<strong>{r.thesis_title}</strong>» se fusionará en «<strong>{rows.find((o) => o.thesis_id === mergeTarget)?.thesis_title}</strong>». <strong>{ticker}</strong> se quitará de «{r.thesis_title}» (seguirá en la tesis destino). Es reversible.
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button disabled={busy} onClick={() => doMerge(rows)} className="text-[11px] uppercase tracking-[0.1em] font-semibold bg-[#B8860B] text-white px-2.5 py-1.5 hover:bg-[#946c09] disabled:opacity-60 transition-colors" data-testid={`qual-merge-confirm-btn-${r.thesis_id}`}>{busy ? "Fusionando…" : "Confirmar fusión"}</button>
                                                <button disabled={busy} onClick={() => setMergeStep("pick")} className="text-[11px] text-[#7a5a10] hover:underline">Atrás</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </React.Fragment>
                    ))}

                    {/* Aggregates */}
                    <div className={`grid ${COLS} gap-x-4 items-center pt-3`} data-testid="qual-aggregates">
                        <div className="text-xs text-[#4A4A4A] leading-snug">
                            <div><strong>Media</strong> · calidad general</div>
                            <div><strong>Suma</strong> · potencial total</div>
                        </div>
                        <div className="flex justify-center">
                            <HoverTip text="Media de todos los 'Score global tesis': una idea de la calidad general de la empresa a través de las tesis en las que encaja." maxWidth={300}>
                                <div className="cursor-help"><ValueBox text={profile.avg_overall_score ?? "—"} color={scoreColor(profile.avg_overall_score)} testid="qual-avg-overall" /></div>
                            </HoverTip>
                        </div>
                        <div className="flex justify-center">
                            <HoverTip text="Suma de todos los TAM Scores: una idea del potencial total acumulado de la empresa por su exposición a varias tendencias." maxWidth={300}>
                                <div className="cursor-help"><ValueBox text={fmtTamScore(profile.sum_tam_score) ?? "—"} color={tamColor(profile.sum_tam_score)} testid="qual-sum-tam" /></div>
                            </HoverTip>
                        </div>
                    </div>
                </>
            )}

            {(thesisMerges || []).length > 0 && (
                <div className="mt-4 pt-3 border-t border-black/10" data-testid="qual-merged-list">
                    <div className="overline text-[#4A4A4A] mb-2">Tesis fusionadas (la empresa se quitó de ellas)</div>
                    <div className="space-y-1.5">
                        {thesisMerges.map((m) => (
                            <div key={m.source_thesis_id} className="flex items-center justify-between gap-2 border border-[#B8860B]/40 bg-[#FBF3E0] px-3 py-2" data-testid={`qual-merged-row-${m.source_thesis_id}`}>
                                <div className="text-xs text-[#7a5a10] min-w-0">
                                    <GitMerge size={12} className="inline mr-1 -mt-0.5" />
                                    «<strong>{m.source_title}</strong>» → fusionada en «<strong>{m.target_title}</strong>»
                                </div>
                                <button onClick={() => doUnmerge(m.source_thesis_id)} className="text-[11px] uppercase tracking-[0.1em] font-semibold border border-[#B8860B] text-[#7a5a10] px-2.5 py-1 hover:bg-[#B8860B] hover:text-white transition-colors shrink-0" data-testid={`qual-unmerge-${m.source_thesis_id}`}>Revertir</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Reverse (company → trends) thesis link, if one exists */}
            {reverse && (
                <div className={`flex items-center justify-between gap-2 ${rows.length ? "mt-4 pt-3 border-t border-black/10" : ""}`}>
                    <span className="text-xs text-[#4A4A4A]">
                        Análisis temático de <strong>{ticker}</strong>{reverse.overall_relevance != null ? ` · relevancia ${reverse.overall_relevance}` : ""}
                    </span>
                    <Link to={`/thesis/${reverse.thesis_id}`} className="text-xs text-[#052049] hover:underline inline-flex items-center gap-1" data-testid="company-qual-reverse-link">
                        Ver tesis completa <ArrowRight size={12} />
                    </Link>
                </div>
            )}
        </div>
    );
}
