import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, Bug, Lightbulb, Wand2, Camera, Send, ChevronLeft, Loader2, BarChart3, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
    feedbackCreateThread, feedbackMyThreads, feedbackGetThread, feedbackReply,
    feedbackScreenshot, feedbackSurveys, feedbackVote,
} from "@/lib/api";
import { gatherMeta, captureScreenshot } from "@/lib/feedbackMeta";

const TYPES = [
    { key: "bug", label: "Error", icon: Bug, color: "#B32A22" },
    { key: "suggestion", label: "Idea", icon: Lightbulb, color: "#C99700" },
    { key: "feature", label: "Mejora", icon: Wand2, color: "#052049" },
];
const TYPE_LABEL = { bug: "Error", suggestion: "Idea", feature: "Mejora" };
const STATUS_LABEL = { new: "Nuevo", in_progress: "En curso", resolved: "Resuelto" };

function fmtDate(iso) {
    try { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
}

export default function FeedbackPanel({ open, onClose, onChanged }) {
    const [tab, setTab] = useState("new");
    const [openThread, setOpenThread] = useState(null);

    useEffect(() => { if (open) { setTab("new"); setOpenThread(null); } }, [open]);

    if (!open) return null;

    return (
        <div data-fb-ignore data-testid="feedback-panel" className="fixed inset-0 z-[70] flex justify-end">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} data-testid="feedback-backdrop" />
            <div className="relative w-full sm:w-[440px] max-w-full h-full bg-[#FDF1E6] border-l border-black flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
                <div className="flex items-center justify-between px-4 py-3 border-b border-black shrink-0 bg-white">
                    <div className="min-w-0">
                        <div className="font-serif text-xl leading-none">Sugerencias</div>
                        <div className="overline text-[#4A4A4A]">Cuéntanos qué mejorar</div>
                    </div>
                    <button onClick={onClose} className="border border-black bg-white p-2 hover:bg-black hover:text-white transition-colors shrink-0" aria-label="Cerrar" data-testid="feedback-close">
                        <X size={18} />
                    </button>
                </div>

                {!openThread && (
                    <div className="flex border-b border-black shrink-0">
                        {[["new", "Enviar"], ["threads", "Mis mensajes"], ["surveys", "Encuestas"]].map(([k, l]) => (
                            <button key={k} onClick={() => setTab(k)}
                                className={`flex-1 py-2.5 text-xs uppercase tracking-[0.12em] font-semibold transition-colors ${tab === k ? "bg-black text-[#FDF1E6]" : "text-black hover:bg-black/5"}`}
                                data-testid={`feedback-tab-${k}`}>{l}</button>
                        ))}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto">
                    {openThread
                        ? <ThreadView id={openThread} onBack={() => setOpenThread(null)} onChanged={onChanged} />
                        : tab === "new" ? <NewReport onSent={() => { setTab("threads"); onChanged && onChanged(); }} />
                        : tab === "threads" ? <ThreadList onOpen={(id) => setOpenThread(id)} />
                        : <Surveys onChanged={onChanged} />}
                </div>
            </div>
        </div>
    );
}

function NewReport({ onSent }) {
    const [type, setType] = useState("bug");
    const [message, setMessage] = useState("");
    const [shot, setShot] = useState(null);
    const [capturing, setCapturing] = useState(false);
    const [sending, setSending] = useState(false);
    const meta = useRef(gatherMeta());

    const doCapture = async () => {
        setCapturing(true);
        try {
            const blob = await captureScreenshot();
            if (blob) { setShot(blob); toast.success("Captura adjuntada"); }
            else toast.error("No se pudo capturar");
        } catch { toast.error("No se pudo capturar la pantalla"); }
        finally { setCapturing(false); }
    };

    const submit = async () => {
        if (!message.trim()) { toast.error("Escribe un mensaje"); return; }
        setSending(true);
        try {
            await feedbackCreateThread(type, message.trim(), meta.current, shot);
            toast.success("¡Enviado! Gracias por tu ayuda.");
            setMessage(""); setShot(null);
            onSent && onSent();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo enviar");
        } finally { setSending(false); }
    };

    const m = meta.current;
    return (
        <div className="p-4 space-y-4" data-testid="feedback-new-form">
            <div className="grid grid-cols-3 gap-2">
                {TYPES.map(({ key, label, icon: Icon, color }) => (
                    <button key={key} onClick={() => setType(key)}
                        className={`flex flex-col items-center gap-1.5 py-3 border transition-colors ${type === key ? "border-black bg-white" : "border-black/20 bg-transparent hover:border-black/50"}`}
                        data-testid={`feedback-type-${key}`}>
                        <Icon size={20} style={{ color }} />
                        <span className="text-xs uppercase tracking-wide font-semibold">{label}</span>
                    </button>
                ))}
            </div>

            <textarea
                value={message} onChange={(e) => setMessage(e.target.value)}
                rows={5} placeholder="Describe el error o tu idea con el mayor detalle posible…"
                className="w-full border border-black bg-white px-3 py-2 text-sm outline-none resize-none"
                data-testid="feedback-message-input" />

            <div>
                {shot ? (
                    <div className="border border-black bg-white p-2 flex items-center gap-3" data-testid="feedback-shot-preview">
                        <img src={URL.createObjectURL(shot)} alt="captura" className="w-16 h-12 object-cover border border-black/20" />
                        <span className="text-xs flex-1">Captura adjuntada ({Math.round(shot.size / 1024)} KB)</span>
                        <button onClick={() => setShot(null)} className="text-[#B32A22] hover:underline text-xs" data-testid="feedback-shot-remove">Quitar</button>
                    </div>
                ) : (
                    <button onClick={doCapture} disabled={capturing}
                        className="w-full border border-black bg-white py-2.5 flex items-center justify-center gap-2 text-sm hover:bg-black hover:text-white transition-colors disabled:opacity-50"
                        data-testid="feedback-capture-btn">
                        {capturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                        {capturing ? "Capturando…" : "Adjuntar captura de pantalla"}
                    </button>
                )}
            </div>

            <div className="border border-black/20 bg-white/50 px-3 py-2 text-[11px] text-[#4A4A4A] font-mono leading-relaxed" data-testid="feedback-meta">
                <div className="uppercase tracking-wide text-[10px] mb-1 text-black">Datos técnicos (se envían automáticamente)</div>
                {m.browser} · {m.os} · {m.viewport} · {m.language}<br />Página: {m.path}
            </div>

            <button onClick={submit} disabled={sending}
                className="w-full btn-primary !py-3 flex items-center justify-center gap-2 disabled:opacity-50"
                data-testid="feedback-submit-btn">
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {sending ? "Enviando…" : "Enviar sugerencia"}
            </button>
        </div>
    );
}

function ThreadList({ onOpen }) {
    const [threads, setThreads] = useState(null);
    useEffect(() => { feedbackMyThreads().then((r) => setThreads(r.threads || [])).catch(() => setThreads([])); }, []);

    if (threads === null) return <div className="p-8 text-center text-sm text-[#4A4A4A]"><Loader2 className="animate-spin mx-auto" /></div>;
    if (!threads.length) return <div className="p-8 text-center text-sm text-[#4A4A4A]" data-testid="feedback-threads-empty">Aún no has enviado sugerencias.</div>;

    return (
        <div className="divide-y divide-black/10" data-testid="feedback-thread-list">
            {threads.map((t) => (
                <button key={t.id} onClick={() => onOpen(t.id)}
                    className="w-full text-left px-4 py-3 hover:bg-white transition-colors flex items-start gap-3"
                    data-testid={`feedback-thread-${t.id}`}>
                    <span className="mt-0.5">{React.createElement((TYPES.find((x) => x.key === t.type) || TYPES[0]).icon, { size: 16, style: { color: (TYPES.find((x) => x.key === t.type) || TYPES[0]).color } })}</span>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{t.subject}</div>
                        <div className="overline text-[#4A4A4A] mt-0.5">{TYPE_LABEL[t.type]} · {STATUS_LABEL[t.status]} · {fmtDate(t.last_message_at)}</div>
                    </div>
                    {t.unread_for_user > 0 && <span className="bg-[#B32A22] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" data-testid={`feedback-thread-unread-${t.id}`}>{t.unread_for_user}</span>}
                </button>
            ))}
        </div>
    );
}

function ThreadView({ id, onBack, onChanged }) {
    const [data, setData] = useState(null);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [shotUrl, setShotUrl] = useState(null);

    const load = useCallback(async () => {
        const r = await feedbackGetThread(id);
        setData(r);
        onChanged && onChanged();
        if (r.thread.has_screenshot && !shotUrl) {
            try { const b = await feedbackScreenshot(id); setShotUrl(URL.createObjectURL(b)); } catch { /* ignore */ }
        }
    }, [id]); // eslint-disable-line

    useEffect(() => { load(); }, [load]);

    const send = async () => {
        if (!reply.trim()) return;
        setSending(true);
        try { await feedbackReply(id, reply.trim()); setReply(""); await load(); }
        catch (e) { toast.error(e?.response?.data?.detail || "No se pudo enviar"); }
        finally { setSending(false); }
    };

    if (!data) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>;
    const { thread, messages } = data;

    return (
        <div className="flex flex-col h-full" data-testid="feedback-thread-view">
            <div className="px-4 py-2 border-b border-black/10 flex items-center gap-2 bg-white shrink-0">
                <button onClick={onBack} className="p-1 hover:bg-black/5" data-testid="feedback-thread-back"><ChevronLeft size={18} /></button>
                <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{thread.subject}</div>
                    <div className="overline text-[#4A4A4A]">{TYPE_LABEL[thread.type]} · {STATUS_LABEL[thread.status]}</div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] px-3 py-2 text-sm border border-black ${msg.sender === "admin" ? "bg-[#052049] text-white" : "bg-white"}`}>
                            {msg.sender === "admin" && <div className="overline mb-1 opacity-70">Equipo</div>}
                            <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                            <div className={`text-[10px] mt-1 ${msg.sender === "admin" ? "text-white/60" : "text-[#4A4A4A]"}`}>{fmtDate(msg.created_at)}</div>
                        </div>
                    </div>
                ))}
                {shotUrl && (
                    <a href={shotUrl} target="_blank" rel="noreferrer" className="block border border-black" data-testid="feedback-thread-screenshot">
                        <img src={shotUrl} alt="captura" className="w-full" />
                    </a>
                )}
            </div>
            <div className="p-3 border-t border-black shrink-0 flex gap-2 bg-white">
                <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder="Escribe una respuesta…" className="flex-1 border border-black px-3 py-2 text-sm outline-none" data-testid="feedback-reply-input" />
                <button onClick={send} disabled={sending} className="btn-primary !px-3 disabled:opacity-50" data-testid="feedback-reply-send">
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
            </div>
        </div>
    );
}

function Surveys({ onChanged }) {
    const [surveys, setSurveys] = useState(null);
    const load = useCallback(() => feedbackSurveys().then((r) => setSurveys(r.surveys || [])).catch(() => setSurveys([])), []);
    useEffect(() => { load(); }, [load]);

    const vote = async (sid, idx) => {
        try { await feedbackVote(sid, idx); toast.success("¡Voto registrado!"); await load(); onChanged && onChanged(); }
        catch (e) { toast.error(e?.response?.data?.detail || "No se pudo votar"); }
    };

    if (surveys === null) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>;
    if (!surveys.length) return <div className="p-8 text-center text-sm text-[#4A4A4A]" data-testid="feedback-surveys-empty"><BarChart3 className="mx-auto mb-2 opacity-40" /> No hay encuestas activas ahora mismo.</div>;

    return (
        <div className="p-4 space-y-5" data-testid="feedback-surveys-list">
            {surveys.map((s) => {
                const voted = s.my_vote != null;
                const total = s.total_votes || 0;
                return (
                    <div key={s.id} className="border border-black bg-white p-3" data-testid={`feedback-survey-${s.id}`}>
                        <div className="font-medium text-sm mb-3">{s.question}</div>
                        <div className="space-y-2">
                            {s.options.map((opt, i) => {
                                const count = s.results ? s.results[i] : 0;
                                const pct = total ? Math.round((count / total) * 100) : 0;
                                const mine = s.my_vote === i;
                                return (
                                    <button key={i} disabled={voted} onClick={() => vote(s.id, i)}
                                        className={`w-full text-left border relative overflow-hidden ${mine ? "border-[#052049]" : "border-black/30"} ${voted ? "cursor-default" : "hover:border-black"}`}
                                        data-testid={`feedback-survey-opt-${s.id}-${i}`}>
                                        {voted && <div className="absolute inset-y-0 left-0 bg-[#052049]/10" style={{ width: `${pct}%` }} />}
                                        <div className="relative flex justify-between items-center px-3 py-2 text-sm">
                                            <span className={mine ? "font-semibold" : ""}>{opt}{mine ? " ✓" : ""}</span>
                                            {voted && <span className="font-mono text-xs text-[#4A4A4A]">{pct}%</span>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        {voted && <div className="overline text-[#4A4A4A] mt-2">{total} voto{total !== 1 ? "s" : ""}</div>}
                    </div>
                );
            })}
        </div>
    );
}
