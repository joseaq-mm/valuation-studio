import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Plus, Send, TrendingUp, TrendingDown, Minus, ThumbsUp, MessageCircle, BarChart3, Search, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
    communityTopics, communityCreateTopic, communityLikeTopic, communityIdeasSignal, thesisTickerMetrics,
    communitySignalAI, communityGenerateSignal,
} from "@/lib/api";
import { TopicView } from "./Forum";
import ReportButton from "./ReportButton";

const STANCES = {
    bull: { label: "Alcista", icon: TrendingUp, color: "#1D7044" },
    bear: { label: "Bajista", icon: TrendingDown, color: "#B32A22" },
    neutral: { label: "Neutral", icon: Minus, color: "#B8860B" },
};
const VERDICTS = {
    bull: { label: "Alcista", color: "#1D7044", bg: "#1D704415" },
    bear: { label: "Bajista", color: "#B32A22", bg: "#B32A2215" },
    mixed: { label: "Mixto", color: "#B8860B", bg: "#B8860B15" },
};

function fmtDate(iso) {
    try { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
}
function apiErr(e, f) { return e?.response?.data?.detail || f; }
const pct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const num = (v, d = 2) => (v == null ? "—" : v.toFixed(d));

// Shared metrics panel (author's valuation snapshot for the idea's ticker).
export function IdeaMetrics({ m, currency }) {
    if (!m) return null;
    const cur = currency || m.currency || "";
    const q = [
        ["Precio", m.current_price != null ? `${num(m.current_price)} ${cur}` : "—"],
        ["POC", m.poc != null ? `${num(m.poc)} ${cur}` : "—"],
        ["POV", m.pov != null ? `${num(m.pov)} ${cur}` : "—"],
        ["Ratio Compra", pct(m.ratio_compra_pct)],
        ["Ratio Venta", pct(m.ratio_venta_pct)],
    ];
    return (
        <div className="border border-black/20 bg-[#FDF1E6]/60 p-2.5 text-xs" data-testid="idea-metrics">
            <div className="grid grid-cols-5 gap-1 text-center">
                {q.map(([k, v]) => (
                    <div key={k}><div className="text-[#4A4A4A] text-[10px] uppercase tracking-wide">{k}</div><div className="font-mono font-semibold mt-0.5">{v}</div></div>
                ))}
            </div>
            <div className="mt-2 pt-2 border-t border-black/10">
                {m.has_qual ? (
                    <div className="grid grid-cols-5 gap-1 text-center">
                        {[["Score", num(m.score, 1)], ["TAM Score", num(m.tam_score, 2)], ["Coef KPI", num(m.kpi_coef, 2)],
                        ["Comb. cual.", m.combined_qual != null ? `${m.combined_qual}%` : "—"], ["Comb. total", m.combined != null ? `${m.combined}%` : "—"]].map(([k, v]) => (
                            <div key={k}><div className="text-[#4A4A4A] text-[10px] uppercase tracking-wide">{k}</div><div className="font-mono font-semibold mt-0.5">{v}</div></div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-[11px] text-[#4A4A4A] italic py-1" data-testid="idea-no-thesis">
                        Tesis no desarrollada — sin datos cualitativos (Score, TAM, KPI). Solo valoración por precio.
                    </div>
                )}
            </div>
        </div>
    );
}

export default function Ideas({ onChanged }) {
    const [openId, setOpenId] = useState(null);
    const [openMetrics, setOpenMetrics] = useState(null);

    if (openId) {
        return (
            <TopicView
                id={openId}
                header={openMetrics ? <IdeaMetrics m={openMetrics} /> : null}
                onBack={() => { setOpenId(null); setOpenMetrics(null); onChanged && onChanged(); }}
                onChanged={onChanged}
            />
        );
    }
    return <IdeasFeed onOpen={(id, m) => { setOpenId(id); setOpenMetrics(m); }} onChanged={onChanged} />;
}

function IdeasFeed({ onOpen, onChanged }) {
    const [ideas, setIdeas] = useState(null);
    const [signal, setSignal] = useState([]);
    const [ai, setAi] = useState(null);
    const [genLoading, setGenLoading] = useState(false);
    const [composing, setComposing] = useState(false);

    const load = useCallback(async () => {
        try {
            const [r, s, a] = await Promise.all([communityTopics("idea"), communityIdeasSignal(), communitySignalAI()]);
            setIdeas(r.topics || []); setSignal(s.signal || []); setAi(a.ai || null);
        } catch { setIdeas([]); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const generateAI = async () => {
        setGenLoading(true);
        try {
            const r = await communityGenerateSignal();
            setAi(r.ai || null);
            toast.success("Análisis de la comunidad actualizado");
        } catch (e) { toast.error(apiErr(e, "No se pudo generar el análisis")); }
        finally { setGenLoading(false); }
    };

    const like = async (t) => {
        try { const r = await communityLikeTopic(t.id); setIdeas((xs) => xs.map((x) => x.id === t.id ? { ...x, liked_by_me: r.liked, like_count: r.like_count } : x)); }
        catch (e) { toast.error(apiErr(e, "Error")); }
    };

    return (
        <div data-testid="community-ideas">
            {signal.length > 0 && (
                <div className="border border-black bg-white p-3 mb-4" data-testid="ideas-signal">
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <span className="overline flex items-center gap-2"><BarChart3 size={16} /> Señal de la comunidad · más comentadas</span>
                        <button onClick={generateAI} disabled={genLoading}
                            className="btn-primary !px-3 !py-1 flex items-center gap-1.5 text-xs disabled:opacity-50" data-testid="signal-generate-btn">
                            {genLoading ? <Loader2 size={13} className="animate-spin" /> : (ai ? <RefreshCw size={13} /> : <Sparkles size={13} />)}
                            {ai ? "Actualizar análisis IA" : "Generar análisis IA"}
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {signal.map((s) => (
                            <div key={s.ticker} className="border border-black/20 px-2 py-1 flex items-center gap-2 text-xs" data-testid={`signal-${s.ticker}`}>
                                <span className="font-mono font-bold">{s.ticker}</span>
                                <span className="text-[#4A4A4A]">{s.ideas} idea{s.ideas !== 1 ? "s" : ""}</span>
                                <span className="flex items-center gap-1">
                                    {s.bull > 0 && <span style={{ color: STANCES.bull.color }}>▲{s.bull}</span>}
                                    {s.bear > 0 && <span style={{ color: STANCES.bear.color }}>▼{s.bear}</span>}
                                    {s.neutral > 0 && <span style={{ color: STANCES.neutral.color }}>■{s.neutral}</span>}
                                </span>
                            </div>
                        ))}
                    </div>
                    {ai && Array.isArray(ai.items) && ai.items.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-black/10" data-testid="signal-ai">
                            <div className="flex items-center justify-between mb-2">
                                <span className="overline flex items-center gap-1.5 text-[#052049]"><Sparkles size={13} /> Análisis IA · comunidad vs. tu valoración</span>
                                <span className="text-[10px] text-[#4A4A4A]" data-testid="signal-ai-updated">Actualizado {fmtDate(ai.generated_at)}</span>
                            </div>
                            <div className="space-y-2">
                                {ai.items.map((it) => {
                                    const v = VERDICTS[it.verdict] || VERDICTS.mixed;
                                    return (
                                        <div key={it.ticker} className="border border-black/15 p-2.5" style={{ background: v.bg }} data-testid={`signal-ai-${it.ticker}`}>
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="font-mono font-bold text-sm">{it.ticker}</span>
                                                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 border" style={{ color: v.color, borderColor: v.color }} data-testid={`verdict-${it.ticker}`}>{v.label}</span>
                                                {it.confidence && <span className="text-[10px] text-[#4A4A4A] uppercase">confianza {it.confidence}</span>}
                                                <span className="text-[10px] text-[#4A4A4A]">▲{it.bull}/▼{it.bear}/■{it.neutral}</span>
                                            </div>
                                            <p className="text-xs text-[#2A2A2A] leading-snug">{it.summary}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="flex justify-end mb-3">
                <button onClick={() => setComposing((c) => !c)} className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-xs" data-testid="idea-new-btn">
                    <Plus size={14} /> {composing ? "Cancelar" : "Nueva idea"}
                </button>
            </div>

            {composing && <IdeaComposer onDone={() => { setComposing(false); load(); onChanged && onChanged(); }} />}

            {ideas === null ? <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto" /></div>
                : !ideas.length ? <div className="py-10 text-center text-sm text-[#4A4A4A]" data-testid="ideas-empty">Aún no hay ideas de inversión. ¡Comparte la primera!</div>
                : <div className="space-y-3" data-testid="ideas-list">
                    {ideas.map((t) => {
                        const st = STANCES[t.stance] || STANCES.neutral;
                        return (
                            <div key={t.id} className="border border-black bg-white p-3" data-testid={`idea-${t.id}`}>
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="font-mono font-bold border border-black px-1.5 py-0.5 text-sm">{t.ticker}</span>
                                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 border" style={{ color: st.color, borderColor: st.color }} data-testid={`idea-stance-${t.id}`}>
                                        {React.createElement(st.icon, { size: 12 })} {st.label}
                                    </span>
                                    {t.target_price != null && <span className="text-xs text-[#4A4A4A]">Objetivo: {num(t.target_price)}</span>}
                                </div>
                                <button onClick={() => onOpen(t.id, t.metrics)} className="text-left w-full">
                                    <div className="font-serif text-lg leading-snug">{t.title}</div>
                                    {t.body && <div className="text-sm text-[#4A4A4A] mt-1 line-clamp-2">{t.body}</div>}
                                </button>
                                <div className="mt-2"><IdeaMetrics m={t.metrics} /></div>
                                <div className="flex items-center gap-4 mt-2 text-xs text-[#4A4A4A]">
                                    <span>{t.author_name} · {fmtDate(t.created_at)}</span>
                                    <button onClick={() => like(t)} className={`flex items-center gap-1 ${t.liked_by_me ? "text-[#052049] font-semibold" : "hover:text-black"}`} data-testid={`idea-like-${t.id}`}>
                                        <ThumbsUp size={13} /> {t.like_count}
                                    </button>
                                    <span className="flex items-center gap-1"><MessageCircle size={13} /> {t.reply_count}</span>
                                    <ReportButton targetType="topic" targetId={t.id} />
                                </div>
                            </div>
                        );
                    })}
                </div>}
        </div>
    );
}

function IdeaComposer({ onDone }) {
    const [ticker, setTicker] = useState("");
    const [metrics, setMetrics] = useState(null);
    const [loadingM, setLoadingM] = useState(false);
    const [stance, setStance] = useState("bull");
    const [target, setTarget] = useState("");
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);

    const loadMetrics = async () => {
        const tk = ticker.trim().toUpperCase();
        if (!tk) { toast.error("Escribe un ticker"); return; }
        setLoadingM(true); setMetrics(null);
        try { const m = await thesisTickerMetrics(tk); setMetrics(m); }
        catch (e) { toast.error(apiErr(e, "No se encontraron datos para ese ticker")); }
        finally { setLoadingM(false); }
    };

    const submit = async () => {
        if (!metrics) { toast.error("Carga primero los datos del ticker"); return; }
        if (!title.trim()) { toast.error("Escribe un título"); return; }
        setPosting(true);
        try {
            await communityCreateTopic({
                scope: "idea", title: title.trim(), body: body.trim(),
                ticker: metrics.ticker, stance,
                target_price: target ? parseFloat(target) : null,
                metrics,
            });
            toast.success("Idea publicada");
            onDone();
        } catch (e) { toast.error(apiErr(e, "No se pudo publicar")); }
        finally { setPosting(false); }
    };

    return (
        <div className="border border-black bg-white p-3 mb-4 space-y-3" data-testid="idea-composer">
            <div className="flex gap-2">
                <div className="flex items-center border border-black flex-1">
                    <Search size={15} className="ml-2 text-[#4A4A4A]" />
                    <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && loadMetrics()}
                        placeholder="Ticker (ej. NVDA, AAPL, ASML.AS)" className="flex-1 px-2 py-2 text-sm outline-none font-mono" data-testid="idea-ticker-input" />
                </div>
                <button onClick={loadMetrics} disabled={loadingM} className="border border-black px-3 text-sm hover:bg-black hover:text-white transition-colors disabled:opacity-50" data-testid="idea-load-metrics">
                    {loadingM ? <Loader2 size={15} className="animate-spin" /> : "Cargar datos"}
                </button>
            </div>

            {metrics && (
                <>
                    <div className="text-sm font-medium">{metrics.name || metrics.ticker}</div>
                    <IdeaMetrics m={metrics} />
                    <div className="flex flex-wrap items-center gap-2">
                        {Object.entries(STANCES).map(([k, v]) => (
                            <button key={k} onClick={() => setStance(k)}
                                className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 border transition-colors ${stance === k ? "text-white" : ""}`}
                                style={stance === k ? { background: v.color, borderColor: v.color } : { borderColor: v.color, color: v.color }}
                                data-testid={`idea-stance-btn-${k}`}>
                                {React.createElement(v.icon, { size: 13 })} {v.label}
                            </button>
                        ))}
                        <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" placeholder="Precio objetivo (opc.)"
                            className="border border-black px-2 py-1.5 text-sm outline-none w-40" data-testid="idea-target-input" />
                    </div>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titular de tu idea…"
                        className="w-full border border-black px-3 py-2 text-sm outline-none" data-testid="idea-title-input" />
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Desarrolla tu tesis de inversión…"
                        className="w-full border border-black px-3 py-2 text-sm outline-none resize-none" data-testid="idea-body-input" />
                    <div className="flex justify-end">
                        <button onClick={submit} disabled={posting} className="btn-primary !px-4 !py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-50" data-testid="idea-publish">
                            {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Publicar idea
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
