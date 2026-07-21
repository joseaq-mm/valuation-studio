import React, { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, ChevronDown, Send, Save, Loader2, Sparkles } from "lucide-react";
import { kpiChat, kpiChatSave } from "@/lib/api";
import { toast } from "sonner";

const newSession = (companyId) => `kpichat-${companyId}-${Date.now().toString(36)}`;

const SUGGESTIONS = [
    "¿Qué KPIs confirmarían o desmentirían mi tesis de crecimiento?",
    "Compárala con sus competidoras en calidad operativa.",
    "¿Qué riesgos operativos deberían preocuparme más?",
];

// Fase 1: conversational KPI analyst. Grounded on the company context + web.
// The conversation can be saved as a document that feeds the KPI coefficient.
export default function KpiChat({ companyId, onSaved }) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);   // {role, text, sources?}
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedOnce, setSavedOnce] = useState(false);
    const sessionRef = useRef(newSession(companyId));
    const scrollRef = useRef(null);

    // Reset the conversation when switching companies.
    useEffect(() => {
        sessionRef.current = newSession(companyId);
        setMessages([]); setInput(""); setSavedOnce(false);
    }, [companyId]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, sending]);

    const send = useCallback(async (text) => {
        const msg = (text ?? input).trim();
        if (!msg || sending) return;
        setInput("");
        setMessages((prev) => [...prev, { role: "user", text: msg }]);
        setSending(true);
        try {
            const d = await kpiChat(companyId, sessionRef.current, msg);
            setMessages((prev) => [...prev, { role: "assistant", text: d.reply, sources: d.sources || [] }]);
        } catch (err) {
            const detail = err?.response?.data?.detail || "No se pudo responder. Inténtalo de nuevo.";
            setMessages((prev) => [...prev, { role: "assistant", text: detail, error: true }]);
        } finally {
            setSending(false);
        }
    }, [input, sending, companyId]);

    const save = async () => {
        if (saving || !messages.some((m) => m.role === "assistant" && !m.error)) return;
        setSaving(true);
        try {
            const d = await kpiChatSave(companyId, sessionRef.current);
            toast.success(`Guardado como documento «${d.file.display_name}». Reanaliza para que cuente en el coeficiente.`);
            setSavedOnce(true);
            onSaved?.();
        } catch (err) {
            toast.error(err?.response?.data?.detail || "No se pudo guardar la conversación");
        } finally {
            setSaving(false);
        }
    };

    const canSave = messages.some((m) => m.role === "assistant" && !m.error);

    return (
        <div className="border border-black/20 bg-white mb-4" data-testid="kpi-chat">
            <button
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[#F4F6FA] transition-colors"
                data-testid="kpi-chat-toggle"
            >
                <span className="overline text-[#052049] flex items-center gap-1.5">
                    <MessageSquare size={14} /> Chat con el analista de KPIs
                    <span className="normal-case tracking-normal text-[10px] text-[#7A7A7A] font-normal">· pregunta y guarda la conversación como fuente</span>
                </span>
                <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="border-t border-black/10 p-3" data-testid="kpi-chat-panel">
                    <div ref={scrollRef} className="max-h-[360px] overflow-y-auto space-y-3 mb-3" data-testid="kpi-chat-messages">
                        {messages.length === 0 && (
                            <div className="text-xs text-[#7A7A7A]">
                                <p className="mb-2 flex items-center gap-1.5"><Sparkles size={13} className="text-[#B8860B]" /> Puede consultar los datos de esta empresa, de tus otras empresas y de la web. Prueba con:</p>
                                <div className="flex flex-col gap-1.5">
                                    {SUGGESTIONS.map((s, i) => (
                                        <button key={i} onClick={() => send(s)} className="text-left border border-black/15 px-2 py-1.5 hover:bg-[#F4F6FA] text-[#052049]" data-testid={`kpi-chat-suggestion-${i}`}>{s}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`kpi-chat-msg-${m.role}-${i}`}>
                                <div className={`max-w-[85%] px-3 py-2 text-sm leading-snug whitespace-pre-wrap ${m.role === "user" ? "bg-[#052049] text-white" : m.error ? "bg-[#FBEAEA] text-[#B32A22] border border-[#B32A22]/30" : "bg-[#F4F6FA] text-black border border-black/10"}`}>
                                    {m.text}
                                    {m.sources?.length > 0 && (
                                        <div className="mt-1.5 pt-1.5 border-t border-black/10 text-[10px] text-[#4A4A4A]">
                                            {m.sources.slice(0, 4).map((s, j) => (
                                                <a key={j} href={s.url} target="_blank" rel="noreferrer" className="block truncate hover:underline text-[#052049]">· {s.title || s.url}</a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {sending && (
                            <div className="flex justify-start" data-testid="kpi-chat-typing">
                                <div className="bg-[#F4F6FA] border border-black/10 px-3 py-2 text-sm text-[#4A4A4A] inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Pensando y consultando fuentes…</div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-end gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                            rows={2}
                            placeholder="Escribe tu pregunta o tu tesis sobre esta empresa…"
                            className="flex-1 border border-black/30 bg-white px-2.5 py-1.5 text-sm outline-none resize-y focus:border-[#052049]"
                            data-testid="kpi-chat-input"
                        />
                        <button onClick={() => send()} disabled={sending || !input.trim()} className="btn-primary !py-2 !px-3 disabled:opacity-40" title="Enviar" data-testid="kpi-chat-send">
                            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                        </button>
                    </div>

                    <div className="flex items-center justify-between mt-2 gap-2">
                        <p className="text-[10px] text-[#7A7A7A]">Al guardar, la conversación entra como documento seleccionado y se tendrá en cuenta al reanalizar los KPIs.</p>
                        <button onClick={save} disabled={saving || !canSave} className="btn-ghost !py-1 !px-2.5 inline-flex items-center gap-1.5 text-xs disabled:opacity-40 shrink-0" data-testid="kpi-chat-save">
                            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {savedOnce ? "Guardar de nuevo" : "Guardar como documento"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
