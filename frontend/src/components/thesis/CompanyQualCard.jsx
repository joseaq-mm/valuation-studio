import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, ArrowRight, GitMerge, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisCompanyProfile, thesisMergeThesis, thesisUnmergeThesis } from "@/lib/api";
import { ValueBox, scoreColor, tamColor, fmtTamScore } from "./ScoreBar";

import HoverTip from "@/components/HoverTip";

/**
 * Thesis title that never overlaps the score columns: it truncates when there's
 * not enough room. UX:
 *  - Tap the arrow  → go to the thesis (single tap).
 *  - Double-tap the title → go to the thesis.
 *  - Single tap the title → if truncated, show a tooltip with the FULL title
 *    (so it can be read at a glance without opening it). Desktop hover shows it too.
 */
function ThesisTitleLink({ to, title, bold = false, arrowSize = 12, colorClass = "", linkTestid, titleTestid }) {
    const navigate = useNavigate();
    const wrapRef = useRef(null);
    const spanRef = useRef(null);
    const tipRef = useRef(null);
    const clickTimer = useRef(null);
    const [truncated, setTruncated] = useState(false);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    const measure = () => {
        const el = spanRef.current;
        if (el) setTruncated(el.scrollWidth > el.clientWidth + 1);
    };
    useEffect(() => {
        measure();
        window.addEventListener("resize", measure);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(() => {});
        const t = setTimeout(measure, 400);
        return () => { window.removeEventListener("resize", measure); clearTimeout(t); };
    }, [title]);

    const show = () => {
        if (!truncated || !spanRef.current) return;
        const r = spanRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 6, left: r.left });
        setOpen(true);
    };
    const hide = () => setOpen(false);

    useLayoutEffect(() => {
        if (!open || !spanRef.current || !tipRef.current) return;
        const wrap = spanRef.current.getBoundingClientRect();
        const tip = tipRef.current.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight, margin = 8;
        let left = wrap.left;
        if (left + tip.width + margin > vw) left = Math.max(margin, vw - tip.width - margin);
        if (left < margin) left = margin;
        const above = wrap.bottom + tip.height + margin > vh && wrap.top - tip.height - margin > 0;
        setPos({ top: above ? wrap.top - tip.height - 6 : wrap.bottom + 6, left });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => { if (spanRef.current && !spanRef.current.contains(e.target)) hide(); };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("touchstart", onDoc);
        return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("touchstart", onDoc); };
    }, [open]);

    const onTitleClick = () => {
        if (clickTimer.current) return;
        clickTimer.current = setTimeout(() => {
            clickTimer.current = null;
            if (truncated) setOpen(true);   // truncated → single tap reveals full title
            else navigate(to);              // fully readable → single tap opens it
        }, 240);
    };
    const onTitleDouble = () => {
        if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
        hide();
        navigate(to);
    };

    return (
        <div ref={wrapRef} className="flex items-center gap-1 min-w-0">
            <span
                ref={spanRef}
                onClick={onTitleClick}
                onDoubleClick={onTitleDouble}
                onMouseEnter={show}
                onMouseLeave={hide}
                className={`truncate min-w-0 cursor-pointer hover:underline text-sm leading-tight ${bold ? "font-bold" : ""} ${colorClass}`}
                data-testid={titleTestid}
            >{title}</span>
            <Link to={to} onClick={hide} aria-label="Ir a la tesis" className="shrink-0 inline-flex text-inherit" data-testid={linkTestid}>
                <ArrowRight size={arrowSize} className="shrink-0" />
            </Link>
            {open && truncated && (
                <div
                    ref={tipRef}
                    role="tooltip"
                    style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 60, maxWidth: 340 }}
                    className="bg-[#111111] text-white font-mono border border-black shadow-md text-xs leading-relaxed px-3 py-2"
                >
                    {title}
                </div>
            )}
        </div>
    );
}

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
export default function CompanyQualCard({ ticker, hideEmpty = false, refreshKey = 0, companyId = null, thesisMerges = [], onMerged, fromCompanyId = null }) {
    const { user } = useAuth();
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mergeFor, setMergeFor] = useState(null);   // source thesis_id in merge mode
    const [mergeTarget, setMergeTarget] = useState("");
    const [mergeStep, setMergeStep] = useState("pick"); // pick | confirm
    const [busy, setBusy] = useState(false);
    const [othersOpen, setOthersOpen] = useState(false);

    useEffect(() => {
        let alive = true;
        const run = async () => {
            if (!user || !ticker) { if (alive) { setProfile(null); setLoading(false); } return; }
            if (alive) setLoading(true);
            try {
                const d = await thesisCompanyProfile(ticker, fromCompanyId);
                if (alive) setProfile(d);
            } catch {
                if (alive) setProfile(null);
            } finally {
                if (alive) setLoading(false);
            }
        };
        run();
        return () => { alive = false; };
    }, [user, ticker, refreshKey, fromCompanyId]);

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
    if (hideEmpty && (!user || (!(profile?.trend_rows || []).length && !(profile?.other_rows || []).length && !profile?.reverse && !(thesisMerges || []).length))) return null;

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
    const others = profile?.other_rows || [];
    const reverse = profile?.reverse;
    // Phase B merge removed: fusionar/partir happen ONLY in the planning phase
    // (before generating), so the TAM partition stays conserved. Existing merges can
    // still be reverted via the list below.
    const canMerge = false;

    // Logged in but the company is not part of any saved thesis → CTA to generate.
    if (!rows.length && !others.length && !reverse && !(thesisMerges || []).length) {
        return (
            <div className="border border-dashed border-black/40 bg-white p-4 mb-6 flex items-center justify-between gap-4 flex-wrap" data-testid="company-qual-empty">
                <div className="flex items-center gap-2 text-sm text-[#4A4A4A]">
                    <Sparkles size={16} className="text-[#052049] shrink-0" />
                    <span>Esta empresa todavía no tiene <strong>tesis propias desarrolladas</strong>.</span>
                </div>
                <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="btn-primary flex items-center gap-1 shrink-0" data-testid="company-qual-generate">
                    <Sparkles size={13} /> Generar plan
                </Link>
            </div>
        );
    }

    const COLS = "grid-cols-[1fr_5rem_4.5rem]";

    return (
        <div className="border border-black bg-white p-5 mb-6" data-testid="company-qual-card">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="overline text-[#B32A22]">{fromCompanyId ? "Tesis generadas desde este plan" : "Tesis cualitativa · tesis guardadas"}</div>
                {!fromCompanyId && !profile?.plan_complete && (
                    rows.length === 0 ? (
                        <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="text-xs text-[#052049] hover:underline inline-flex items-center gap-1.5 max-w-full text-right" data-testid="company-qual-add">
                            <Sparkles size={12} className="shrink-0" />
                            <span>Esta empresa todavía no tiene tesis propias desarrolladas · <strong>Generar plan</strong></span>
                        </Link>
                    ) : (
                        <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="text-xs text-[#052049] hover:underline inline-flex items-center gap-1" data-testid="company-qual-add">
                            <Sparkles size={12} /> Buscar más tesis
                        </Link>
                    )
                )}
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
                                    <ThesisTitleLink
                                        to={`/thesis/${r.thesis_id}`}
                                        title={r.thesis_title}
                                        bold
                                        arrowSize={12}
                                        linkTestid={`qual-row-link-${r.thesis_id}`}
                                        titleTestid={`qual-row-title-${r.thesis_id}`}
                                    />
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

            {others.length > 0 && !fromCompanyId && (
                <div className="mt-4 pt-3 border-t border-black/10" data-testid="qual-other-list">
                    <button onClick={() => setOthersOpen((o) => !o)} className="flex items-center gap-1.5 group w-full text-left" data-testid="qual-other-toggle" aria-expanded={othersOpen}>
                        {othersOpen ? <ChevronDown size={14} className="text-[#4A4A4A]" /> : <ChevronRight size={14} className="text-[#4A4A4A]" />}
                        <span className="overline text-[#4A4A4A] group-hover:text-black">También aparece en</span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 bg-black/5 text-[#4A4A4A]">{others.length}</span>
                        <span className="overline text-[#9CA3AF]">· informativo · no suma</span>
                    </button>
                    {othersOpen && (
                        <>
                            <p className="text-[11px] text-[#9CA3AF] leading-snug mb-2 mt-2">
                                Tesis donde {ticker} fue añadida desde las tesis desarrolladas desde los planes de otras empresas. No cuentan en los totales de arriba para mantener la coherencia con el plan de esta empresa.
                            </p>
                            <div className="space-y-0">
                                {others.map((r) => (
                                    <div key={r.thesis_id} className={`grid ${COLS} gap-x-4 items-center py-2 border-b border-black/10 opacity-70`} data-testid={`qual-other-row-${r.thesis_id}`}>
                                        <div className="min-w-0">
                                            <ThesisTitleLink
                                                to={`/thesis/${r.thesis_id}`}
                                                title={r.thesis_title}
                                                arrowSize={11}
                                                colorClass="text-[#4A4A4A]"
                                                linkTestid={`qual-other-link-${r.thesis_id}`}
                                                titleTestid={`qual-other-title-${r.thesis_id}`}
                                            />
                                            {r.value_chain_role && <div className="overline text-[#9CA3AF] truncate">{r.value_chain_role}</div>}
                                        </div>
                                        <div className="flex justify-center">
                                            <ValueBox text={r.overall_score ?? "—"} color={scoreColor(r.overall_score)} testid={`qual-other-overall-${r.thesis_id}`} />
                                        </div>
                                        <div className="flex justify-center">
                                            <ValueBox text={fmtTamScore(r.tam_score) ?? "—"} color={tamColor(r.tam_score)} testid={`qual-other-tam-${r.thesis_id}`} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
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
