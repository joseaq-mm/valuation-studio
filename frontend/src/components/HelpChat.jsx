import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X, Send, Loader2 } from "lucide-react";
import { helpChat } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// Header "Ayuda" button + internal chat dialog. Asks questions about the app to
// a Gemini Flash assistant that knows the whole product. Conversation memory is
// kept per session (session_id) on the backend.
export default function HelpChat() {
    const { lang } = useI18n();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const sessionRef = useRef(null);
    const scrollRef = useRef(null);

    const greeting = lang === "en"
        ? "Hi 👋 I'm the Valuation Studio assistant. Ask me anything about the app: POC/POV, the scores, the Thesis Engine, Level 2, alerts…"
        : "¡Hola! 👋 Soy el asistente de Valuation Studio. Pregúntame lo que quieras sobre la app: POC/POV, los scores, el Thesis Engine, el Nivel 2, las alertas…";

    const [messages, setMessages] = useState([{ role: "assistant", text: greeting }]);

    if (!sessionRef.current) {
        sessionRef.current = (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID()
            : `help_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, open, sending]);

    const send = async () => {
        const text = input.trim();
        if (!text || sending) return;
        setInput("");
        setMessages((m) => [...m, { role: "user", text }]);
        setSending(true);
        try {
            const r = await helpChat(sessionRef.current, text);
            setMessages((m) => [...m, { role: "assistant", text: r.reply || "…" }]);
        } catch {
            setMessages((m) => [...m, {
                role: "assistant",
                text: lang === "en" ? "Sorry, I couldn't reach the assistant. Try again." : "Lo siento, no he podido conectar con el asistente. Inténtalo de nuevo.",
            }]);
        } finally {
            setSending(false);
        }
    };

    const onKey = (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    };

    const suggestions = lang === "en"
        ? ["What is POC and POV?", "What does the TAM Score mean?", "How do I create a thesis?"]
        : ["¿Qué son POC y POV?", "¿Qué significa el TAM Score?", "¿Cómo creo una tesis?"];

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="text-xs uppercase tracking-[0.15em] font-semibold px-3 py-1 text-black hover:bg-black hover:text-[#FDF1E6] transition-colors flex items-center gap-1.5"
                data-testid="help-chat-open"
            >
                <HelpCircle size={14} /> {lang === "en" ? "Help" : "Ayuda"}
            </button>

            {open && createPortal(
                <div className="fixed inset-0 z-[9998] flex items-end sm:items-stretch sm:justify-end" data-testid="help-chat-dialog">
                    <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
                    <div className="relative bg-[#FDF1E6] border border-black w-full sm:w-[420px] sm:m-4 h-[80vh] sm:h-auto sm:max-h-[calc(100vh-2rem)] flex flex-col shadow-2xl">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-black bg-white">
                            <div className="flex items-center gap-2">
                                <HelpCircle size={18} className="text-[#B32A22]" />
                                <div className="font-serif text-lg leading-none">{lang === "en" ? "Help assistant" : "Asistente de ayuda"}</div>
                            </div>
                            <button onClick={() => setOpen(false)} className="text-black/50 hover:text-black" data-testid="help-chat-close" aria-label="cerrar">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Messages */}
                        <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3 space-y-3" data-testid="help-chat-messages">
                            {messages.map((m, i) => (
                                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                    <div
                                        className={`max-w-[85%] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap border ${
                                            m.role === "user"
                                                ? "bg-[#052049] text-white border-[#052049]"
                                                : "bg-white text-[#1A1A1A] border-black/20"
                                        }`}
                                        data-testid={`help-msg-${m.role}`}
                                    >
                                        {m.text}
                                    </div>
                                </div>
                            ))}
                            {sending && (
                                <div className="flex justify-start">
                                    <div className="bg-white border border-black/20 px-3 py-2 text-sm text-[#4A4A4A] flex items-center gap-2">
                                        <Loader2 size={14} className="animate-spin" /> {lang === "en" ? "Thinking…" : "Pensando…"}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Suggestions (only before first user message) */}
                        {messages.filter((m) => m.role === "user").length === 0 && (
                            <div className="px-4 pb-2 flex flex-wrap gap-2">
                                {suggestions.map((s, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setInput(s)}
                                        className="text-[11px] border border-black/30 bg-white px-2 py-1 hover:bg-[#F5E4D4] transition-colors"
                                        data-testid={`help-suggestion-${i}`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Input */}
                        <div className="border-t border-black p-3 flex items-end gap-2 bg-white">
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={onKey}
                                rows={1}
                                placeholder={lang === "en" ? "Ask about the app…" : "Pregunta sobre la app…"}
                                className="flex-1 resize-none outline-none text-sm bg-transparent max-h-24 py-1"
                                data-testid="help-chat-input"
                            />
                            <button
                                onClick={send}
                                disabled={sending || !input.trim()}
                                className="btn-primary !py-2 !px-3 disabled:opacity-40"
                                data-testid="help-chat-send"
                            >
                                <Send size={15} />
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
