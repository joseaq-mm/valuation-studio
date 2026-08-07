import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, Send, Bug, Lightbulb, Wand2, Plus, X, ShieldCheck, BarChart3, Power, Flag, Check, Trash2, Bot } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
    feedbackAdminThreads, feedbackGetThread, feedbackReply, feedbackScreenshot,
    feedbackAdminUpdateStatus, feedbackSurveys, feedbackCreateSurvey, feedbackToggleSurvey, feedbackUnread,
    communityAdminModeration, communityResolveModeration,
} from "@/lib/api";

const TYPE_META = {
    bug: { label: "Error", icon: Bug, color: "#B32A22" },
    suggestion: { label: "Idea", icon: Lightbulb, color: "#C99700" },
    feature: { label: "Mejora", icon: Wand2, color: "#052049" },
};
const STATUSES = [["new", "Nuevo"], ["in_progress", "En curso"], ["resolved", "Resuelto"]];
const STATUS_LABEL = Object.fromEntries(STATUSES);

function fmtDate(iso) {
    try { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
}

export default function AdminFeedback() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [isAdmin, setIsAdmin] = useState(null);

    useEffect(() => {
        if (loading) return;
        if (!user) { setIsAdmin(false); return; }
        feedbackUnread().then((r) => setIsAdmin(!!r.is_admin)).catch(() => setIsAdmin(false));
    }, [user, loading]);

    if (loading || isAdmin === null) return <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto" /></div>;
    return <AdminInner isAdmin={isAdmin} navigate={navigate} />;
}

function AdminInner({ isAdmin, navigate }) {
    const [tab, setTab] = useState("feedback");
    if (!isAdmin) return (
        <div className="py-20 text-center" data-testid="admin-feedback-denied">
            <ShieldCheck className="mx-auto mb-3 opacity-30" size={40} />
            <div className="font-serif text-2xl mb-2">Acceso restringido</div>
            <p className="text-sm text-[#4A4A4A]">Esta página es solo para el administrador.</p>
            <button onClick={() => navigate("/")} className="btn-primary mt-4 !px-4 !py-2">Volver al inicio</button>
        </div>
    );

    return (
        <div data-testid="admin-feedback-page">
            <div className="flex items-center gap-3 mb-6">
                <ShieldCheck size={22} />
                <div>
                    <h1 className="font-serif text-3xl leading-none">Comunidad · Administración</h1>
                    <div className="overline text-[#4A4A4A] mt-1">Sugerencias, encuestas y moderación</div>
                </div>
            </div>
            <div className="flex border border-black mb-5 max-w-md">
                {[["feedback", "Sugerencias y encuestas"], ["moderation", "Moderación"]].map(([k, l]) => (
                    <button key={k} onClick={() => setTab(k)}
                        className={`flex-1 py-2.5 text-xs uppercase tracking-[0.12em] font-semibold ${tab === k ? "bg-black text-[#FDF1E6]" : "hover:bg-black/5"}`}
                        data-testid={`admin-tab-${k}`}>{l}</button>
                ))}
            </div>
            {tab === "feedback" ? (<><SurveysAdmin /><ThreadsAdmin /></>) : <ModerationQueue />}
        </div>
    );
}

function ModerationQueue() {
    const [items, setItems] = useState(null);
    const [status, setStatus] = useState("open");

    const load = useCallback(async () => {
        try { const r = await communityAdminModeration(status); setItems(r.items || []); }
        catch { setItems([]); }
    }, [status]);
    useEffect(() => { load(); }, [load]);

    const act = async (id, action) => {
        try { await communityResolveModeration(id, action); toast.success(action === "delete" ? "Contenido borrado" : "Aprobado (visible)"); load(); }
        catch (e) { toast.error(e?.response?.data?.detail || "Error"); }
    };

    return (
        <div className="border border-black bg-white" data-testid="admin-moderation">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-black">
                <div className="flex items-center gap-2"><Flag size={18} /><span className="font-semibold text-sm uppercase tracking-wide">Cola de moderación</span></div>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-black px-2 py-1 text-sm bg-white" data-testid="mod-status-filter">
                    <option value="open">Abiertos</option>
                    <option value="resolved">Resueltos</option>
                    <option value="all">Todos</option>
                </select>
            </div>
            {items === null ? <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>
                : !items.length ? <div className="p-8 text-center text-sm text-[#4A4A4A]" data-testid="mod-empty">Nada pendiente de moderar. 🎉</div>
                : <div className="divide-y divide-black/10">
                    {items.map((m) => (
                        <div key={m.id} className="p-3" data-testid={`mod-item-${m.id}`}>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {m.source === "ai"
                                    ? <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 border border-[#052049] text-[#052049]"><Bot size={12} /> IA</span>
                                    : <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 border border-[#B32A22] text-[#B32A22]"><Flag size={12} /> {m.reporters} reporte{m.reporters !== 1 ? "s" : ""}</span>}
                                <span className="overline text-[#4A4A4A]">{m.target_type === "topic" ? "Tema/Idea" : "Respuesta"}{m.ticker ? ` · ${m.ticker}` : ""}</span>
                                {m.hidden && <span className="overline text-[#B32A22]">oculto</span>}
                                {m.removed && <span className="overline text-[#4A4A4A]">borrado</span>}
                            </div>
                            <div className="text-sm font-medium">{m.preview}</div>
                            {m.content_body && m.content_body !== m.preview && <div className="text-xs text-[#4A4A4A] mt-0.5 line-clamp-2">{m.content_body}</div>}
                            <div className="text-xs text-[#B32A22] mt-1">Motivo: {m.reason}</div>
                            <div className="text-[11px] text-[#4A4A4A] mt-0.5">{m.author_name} · {fmtDate(m.created_at)}</div>
                            {m.status === "open" && (
                                <div className="flex gap-2 mt-2">
                                    <button onClick={() => act(m.id, "approve")} className="flex items-center gap-1 text-xs border border-[#1D7044] text-[#1D7044] px-2 py-1 hover:bg-[#1D7044] hover:text-white transition-colors" data-testid={`mod-approve-${m.id}`}><Check size={13} /> Aprobar</button>
                                    <button onClick={() => act(m.id, "delete")} className="flex items-center gap-1 text-xs border border-[#B32A22] text-[#B32A22] px-2 py-1 hover:bg-[#B32A22] hover:text-white transition-colors" data-testid={`mod-delete-${m.id}`}><Trash2 size={13} /> Borrar</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>}
        </div>
    );
}

function ThreadsAdmin() {
    const [threads, setThreads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState(null);
    const [type, setType] = useState(null);
    const [selected, setSelected] = useState(null);
    const timer = useRef(null);

    const load = useCallback(async () => {
        setLoading(true);
        try { const r = await feedbackAdminThreads({ q: q || null, status, type }); setThreads(r.threads || []); }
        catch { setThreads([]); }
        finally { setLoading(false); }
    }, [q, status, type]);

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(load, 250);
        return () => clearTimeout(timer.current);
    }, [load]);

    return (
        <div className="border border-black bg-white" data-testid="admin-threads">
            <div className="p-3 border-b border-black flex flex-wrap items-center gap-2">
                <div className="flex items-center border border-black flex-1 min-w-[200px]">
                    <Search size={16} className="ml-2 text-[#4A4A4A]" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por asunto, email o nombre…"
                        className="flex-1 px-2 py-1.5 outline-none text-sm font-mono" data-testid="admin-search-input" />
                </div>
                <select value={type || ""} onChange={(e) => setType(e.target.value || null)} className="border border-black px-2 py-1.5 text-sm bg-white" data-testid="admin-filter-type">
                    <option value="">Todos los tipos</option>
                    <option value="bug">Errores</option>
                    <option value="suggestion">Ideas</option>
                    <option value="feature">Mejoras</option>
                </select>
                <select value={status || ""} onChange={(e) => setStatus(e.target.value || null)} className="border border-black px-2 py-1.5 text-sm bg-white" data-testid="admin-filter-status">
                    <option value="">Todos los estados</option>
                    {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
            </div>

            <div className="grid md:grid-cols-2 min-h-[400px]">
                <div className="border-r border-black/10 max-h-[600px] overflow-y-auto">
                    {loading ? <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>
                        : !threads.length ? <div className="p-8 text-center text-sm text-[#4A4A4A]" data-testid="admin-threads-empty">Sin resultados.</div>
                        : threads.map((t) => {
                            const m = TYPE_META[t.type] || TYPE_META.bug;
                            return (
                                <button key={t.id} onClick={() => setSelected(t.id)}
                                    className={`w-full text-left px-3 py-2.5 border-b border-black/10 flex items-start gap-2 transition-colors ${selected === t.id ? "bg-[#F5E4D4]" : "hover:bg-black/5"}`}
                                    data-testid={`admin-thread-${t.id}`}>
                                    {React.createElement(m.icon, { size: 15, style: { color: m.color, marginTop: 2 } })}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">{t.subject}</div>
                                        <div className="overline text-[#4A4A4A] mt-0.5 truncate">{t.user_email} · {STATUS_LABEL[t.status]} · {fmtDate(t.last_message_at)}</div>
                                    </div>
                                    {t.unread_for_admin > 0 && <span className="bg-[#B32A22] text-white text-[10px] font-bold px-1.5 rounded-full shrink-0">{t.unread_for_admin}</span>}
                                </button>
                            );
                        })}
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                    {selected
                        ? <AdminThreadView id={selected} onChanged={load} />
                        : <div className="p-8 text-center text-sm text-[#4A4A4A] h-full flex items-center justify-center">Selecciona un mensaje para verlo.</div>}
                </div>
            </div>
        </div>
    );
}

function AdminThreadView({ id, onChanged }) {
    const [data, setData] = useState(null);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [shotUrl, setShotUrl] = useState(null);

    const load = useCallback(async () => {
        const r = await feedbackGetThread(id);
        setData(r); onChanged && onChanged();
        if (r.thread.has_screenshot) {
            try { const b = await feedbackScreenshot(id); setShotUrl(URL.createObjectURL(b)); } catch { /* ignore */ }
        } else setShotUrl(null);
    }, [id]); // eslint-disable-line

    useEffect(() => { setData(null); setShotUrl(null); load(); }, [load]);

    const send = async () => {
        if (!reply.trim()) return;
        setSending(true);
        try { await feedbackReply(id, reply.trim()); setReply(""); await load(); }
        catch (e) { toast.error(e?.response?.data?.detail || "Error"); }
        finally { setSending(false); }
    };

    const setStatus = async (s) => {
        try { await feedbackAdminUpdateStatus(id, s); await load(); toast.success("Estado actualizado"); }
        catch { toast.error("No se pudo actualizar"); }
    };

    if (!data) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>;
    const { thread, messages } = data;
    const meta = thread.metadata || {};

    return (
        <div className="flex flex-col h-full" data-testid="admin-thread-view">
            <div className="px-3 py-2 border-b border-black/10 bg-white/60">
                <div className="flex items-center gap-2 mb-2">
                    {STATUSES.map(([k, l]) => (
                        <button key={k} onClick={() => setStatus(k)}
                            className={`text-xs px-2 py-1 border transition-colors ${thread.status === k ? "bg-black text-white border-black" : "border-black/30 hover:border-black"}`}
                            data-testid={`admin-status-${k}`}>{l}</button>
                    ))}
                </div>
                <div className="text-[11px] text-[#4A4A4A] font-mono leading-relaxed" data-testid="admin-thread-meta">
                    <span className="text-black">{thread.user_name || thread.user_email}</span> · {meta.browser} {meta.os} · {meta.viewport} · {meta.language}<br />
                    Página: {meta.path} · Enviado: {fmtDate(thread.created_at)}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender === "admin" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] px-3 py-2 text-sm border border-black ${msg.sender === "admin" ? "bg-[#052049] text-white" : "bg-white"}`}>
                            <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                            <div className={`text-[10px] mt-1 ${msg.sender === "admin" ? "text-white/60" : "text-[#4A4A4A]"}`}>{fmtDate(msg.created_at)}</div>
                        </div>
                    </div>
                ))}
                {shotUrl && (
                    <a href={shotUrl} target="_blank" rel="noreferrer" className="block border border-black" data-testid="admin-thread-screenshot">
                        <img src={shotUrl} alt="captura" className="w-full" />
                    </a>
                )}
            </div>
            <div className="p-2 border-t border-black flex gap-2 bg-white">
                <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder="Responder al usuario…" className="flex-1 border border-black px-3 py-2 text-sm outline-none" data-testid="admin-reply-input" />
                <button onClick={send} disabled={sending} className="btn-primary !px-3 disabled:opacity-50" data-testid="admin-reply-send">
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
            </div>
        </div>
    );
}

function SurveysAdmin() {
    const [surveys, setSurveys] = useState([]);
    const [creating, setCreating] = useState(false);
    const [question, setQuestion] = useState("");
    const [options, setOptions] = useState(["", ""]);

    const load = useCallback(() => feedbackSurveys().then((r) => setSurveys(r.surveys || [])).catch(() => {}), []);
    useEffect(() => { load(); }, [load]);

    const create = async () => {
        const opts = options.map((o) => o.trim()).filter(Boolean);
        if (!question.trim() || opts.length < 2) { toast.error("Escribe la pregunta y al menos 2 opciones"); return; }
        try {
            await feedbackCreateSurvey(question.trim(), opts);
            toast.success("Encuesta publicada para todos los usuarios");
            setQuestion(""); setOptions(["", ""]); setCreating(false); load();
        } catch (e) { toast.error(e?.response?.data?.detail || "Error"); }
    };

    const toggle = async (s) => {
        try { await feedbackToggleSurvey(s.id, !s.active); load(); }
        catch { toast.error("No se pudo cambiar"); }
    };

    return (
        <div className="border border-black bg-white mb-6" data-testid="admin-surveys">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-black">
                <div className="flex items-center gap-2"><BarChart3 size={18} /><span className="font-semibold text-sm uppercase tracking-wide">Encuestas globales</span></div>
                <button onClick={() => setCreating((c) => !c)} className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-xs" data-testid="admin-survey-new-btn">
                    {creating ? <X size={14} /> : <Plus size={14} />}{creating ? "Cancelar" : "Nueva encuesta"}
                </button>
            </div>

            {creating && (
                <div className="p-3 border-b border-black/10 space-y-2 bg-[#FDF1E6]/50" data-testid="admin-survey-form">
                    <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pregunta de la encuesta…"
                        className="w-full border border-black px-3 py-2 text-sm outline-none" data-testid="admin-survey-question" />
                    {options.map((o, i) => (
                        <div key={i} className="flex gap-2">
                            <input value={o} onChange={(e) => setOptions((a) => a.map((x, j) => j === i ? e.target.value : x))}
                                placeholder={`Opción ${i + 1}`} className="flex-1 border border-black px-3 py-1.5 text-sm outline-none" data-testid={`admin-survey-option-${i}`} />
                            {options.length > 2 && <button onClick={() => setOptions((a) => a.filter((_, j) => j !== i))} className="px-2 border border-black/30 hover:border-black"><X size={14} /></button>}
                        </div>
                    ))}
                    <div className="flex justify-between">
                        <button onClick={() => setOptions((a) => [...a, ""])} className="text-xs border border-black/30 px-2 py-1 hover:border-black" data-testid="admin-survey-add-option">+ Añadir opción</button>
                        <button onClick={create} className="btn-primary !px-4 !py-1.5 text-xs" data-testid="admin-survey-publish">Publicar</button>
                    </div>
                </div>
            )}

            <div className="divide-y divide-black/10">
                {!surveys.length ? <div className="p-4 text-center text-sm text-[#4A4A4A]">No hay encuestas.</div>
                    : surveys.map((s) => {
                        const total = s.total_votes || 0;
                        return (
                            <div key={s.id} className="p-3" data-testid={`admin-survey-${s.id}`}>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="font-medium text-sm">{s.question}</div>
                                    <button onClick={() => toggle(s)} className={`text-xs px-2 py-1 border flex items-center gap-1 shrink-0 ${s.active ? "border-[#2E7D32] text-[#2E7D32]" : "border-black/30 text-[#4A4A4A]"}`} data-testid={`admin-survey-toggle-${s.id}`}>
                                        <Power size={12} />{s.active ? "Activa" : "Cerrada"}
                                    </button>
                                </div>
                                <div className="space-y-1">
                                    {s.options.map((opt, i) => {
                                        const count = s.results ? s.results[i] : 0;
                                        const pct = total ? Math.round((count / total) * 100) : 0;
                                        return (
                                            <div key={i} className="relative border border-black/20 overflow-hidden">
                                                <div className="absolute inset-y-0 left-0 bg-[#052049]/10" style={{ width: `${pct}%` }} />
                                                <div className="relative flex justify-between px-2 py-1 text-xs">
                                                    <span>{opt}</span><span className="font-mono text-[#4A4A4A]">{count} · {pct}%</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="overline text-[#4A4A4A] mt-1">{total} voto{total !== 1 ? "s" : ""}</div>
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}
