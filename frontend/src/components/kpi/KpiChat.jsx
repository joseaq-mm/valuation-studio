import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, ChevronDown, Send, Save, Loader2, Sparkles, Lightbulb, ArrowRight, X, Check, History, RefreshCw, FileText, Pencil, Trash2 } from "lucide-react";
import { kpiChat, kpiChatSave, kpiChatProposeThesis, kpiChatAddThesis, kpiChatLast, kpiChatReplace } from "@/lib/api";
import HoverTip from "@/components/HoverTip";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toast } from "sonner";

const TOKEN = "[[TESIS_SUGERIDA]]";
const newSession = (companyId) => `kpichat-${companyId}-${Date.now().toString(36)}`;

const SUGGESTIONS = [
    "¿Qué KPIs confirmarían o desmentirían mi tesis de crecimiento?",
    "Compárala con sus competidoras en calidad operativa.",
    "¿Hay algún driver de crecimiento nuevo que debería considerar como tesis?",
];

const stripToken = (t) => (t || "").replace(TOKEN, "").trim();
const persistable = (msgs) => msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));

// Fase 1: conversational KPI analyst grounded on company + comparables + web.
// Fase 2: the AI (or the user) can propose a NEW thesis; the user confirms and it
// is added to the company plan (same machinery as the plan page) and generated.
export default function KpiChat({ companyId, onSaved, onChanged }) {
    const navigate = useNavigate();
    const [open, setOpen] = useState(true);
    const [messages, setMessages] = useState([]);   // {role, text, sources?, aiSuggested?, error?}
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedOnce, setSavedOnce] = useState(false);
    const [aiSuggest, setAiSuggest] = useState(false);
    const [proposing, setProposing] = useState(false);
    const [proposal, setProposal] = useState(null);   // { name, type, tam_busd, fit_description, rationale, ... , origin }
    const [adding, setAdding] = useState(false);
    const [added, setAdded] = useState(null);         // { driver }
    const [dupNotice, setDupNotice] = useState(null); // { name, pending }
    // New: recover / edit / save-chat / refresh
    const [loadingLast, setLoadingLast] = useState(false);
    const [savingChat, setSavingChat] = useState(false);
    const [editIdx, setEditIdx] = useState(-1);
    const [editText, setEditText] = useState("");
    const [refreshAsk, setRefreshAsk] = useState(false);
    const [refresh, setRefresh] = useState(null);     // { done, total } while refreshing
    const sessionRef = useRef(newSession(companyId));
    const scrollRef = useRef(null);

    useEffect(() => {
        sessionRef.current = newSession(companyId);
        setMessages([]); setInput(""); setSavedOnce(false);
        setAiSuggest(false); setProposal(null); setAdded(null); setDupNotice(null);
        setEditIdx(-1); setRefresh(null); setRefreshAsk(false);
    }, [companyId]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, sending, proposal, added, refresh]);

    const busy = sending || saving || savingChat || loadingLast || !!refresh;

    const send = useCallback(async (text) => {
        const msg = (text ?? input).trim();
        if (!msg || sending) return;
        setInput("");
        setMessages((prev) => [...prev, { role: "user", text: msg }]);
        setSending(true);
        try {
            const d = await kpiChat(companyId, sessionRef.current, msg);
            const suggested = (d.reply || "").includes(TOKEN);
            setMessages((prev) => [...prev, { role: "assistant", text: stripToken(d.reply), sources: d.sources || [], aiSuggested: suggested }]);
            if (suggested) setAiSuggest(true);
        } catch (err) {
            const detail = err?.response?.data?.detail || "No se pudo responder. Inténtalo de nuevo.";
            setMessages((prev) => [...prev, { role: "assistant", text: detail, error: true }]);
        } finally {
            setSending(false);
        }
    }, [input, sending, companyId]);

    // ── Mostrar último chat ──────────────────────────────────────────────
    const showLast = async () => {
        if (busy) return;
        setLoadingLast(true);
        try {
            const d = await kpiChatLast(companyId);
            if (!d.conversation || !(d.conversation.messages || []).length) {
                toast.info("Todavía no existe un chat que mostrar para esta empresa.");
                return;
            }
            sessionRef.current = d.conversation.session_id;
            setMessages(d.conversation.messages.map((m) => ({ role: m.role, text: m.text })));
            setAiSuggest(false); setProposal(null); setAdded(null); setDupNotice(null);
            setEditIdx(-1); setSavedOnce(false);
            toast.success("Última conversación recuperada. Puedes editarla, refrescarla o guardarla.");
        } catch (err) {
            toast.error(err?.response?.data?.detail || "No se pudo recuperar la conversación");
        } finally {
            setLoadingLast(false);
        }
    };

    // ── Guardar chat (sobrescribe la conversación) ───────────────────────
    const saveChat = async () => {
        if (busy || messages.length === 0) return;
        setSavingChat(true);
        try {
            await kpiChatReplace(companyId, sessionRef.current, persistable(messages));
            toast.success("Chat guardado. 'Mostrar último chat' te devolverá esta versión.");
        } catch (err) {
            toast.error(err?.response?.data?.detail || "No se pudo guardar el chat");
        } finally {
            setSavingChat(false);
        }
    };

    // ── Refrescar chat (relanza tus preguntas con datos actuales) ─────────
    const doRefresh = async () => {
        setRefreshAsk(false);
        const questions = messages.filter((m) => m.role === "user" && !m.error).map((m) => m.text);
        if (!questions.length) { toast.info("No hay preguntas que refrescar."); return; }
        const session = newSession(companyId);
        const next = [];
        setRefresh({ done: 0, total: questions.length });
        setAiSuggest(false); setProposal(null); setAdded(null); setDupNotice(null); setEditIdx(-1);
        let sawSuggest = false;
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            next.push({ role: "user", text: q });
            try {
                const d = await kpiChat(companyId, session, q);
                const suggested = (d.reply || "").includes(TOKEN);
                if (suggested) sawSuggest = true;
                next.push({ role: "assistant", text: stripToken(d.reply), sources: d.sources || [], aiSuggested: suggested });
            } catch (err) {
                next.push({ role: "assistant", text: err?.response?.data?.detail || "No se pudo actualizar esta respuesta.", error: true });
            }
            setRefresh({ done: i + 1, total: questions.length });
            setMessages([...next]);
        }
        sessionRef.current = session;
        setSavedOnce(false);
        setRefresh(null);
        if (sawSuggest) setAiSuggest(true);
        toast.success("Chat actualizado con los datos actuales.");
    };

    // ── Editar / borrar bloques ──────────────────────────────────────────
    const deleteBlock = (i) => { setMessages((prev) => prev.filter((_, idx) => idx !== i)); if (editIdx === i) setEditIdx(-1); };
    const startEdit = (i) => { setEditIdx(i); setEditText(messages[i].text); };
    const commitEdit = () => {
        const t = editText.trim();
        if (!t) { setEditIdx(-1); return; }
        setMessages((prev) => prev.map((m, idx) => (idx === editIdx ? { ...m, text: t } : m)));
        setEditIdx(-1);
    };

    const save = async () => {
        if (saving || !messages.some((m) => m.role === "assistant" && !m.error)) return;
        setSaving(true);
        try {
            // Persist the current (possibly edited) conversation first so the document
            // reflects exactly what's on screen.
            await kpiChatReplace(companyId, sessionRef.current, persistable(messages));
            const d = await kpiChatSave(companyId, sessionRef.current);
            toast.success(`Guardado como documento «${d.file.display_name}». Reanaliza para que cuente en el coeficiente.`);
            setSavedOnce(true);
            onSaved?.();
            onChanged?.();
        } catch (err) {
            toast.error(err?.response?.data?.detail || "No se pudo guardar la conversación");
        } finally {
            setSaving(false);
        }
    };

    const propose = async (origin) => {
        if (proposing) return;
        setProposing(true); setAdded(null); setDupNotice(null);
        try {
            await kpiChatReplace(companyId, sessionRef.current, persistable(messages));
            const d = await kpiChatProposeThesis(companyId, sessionRef.current, origin);
            if (d.duplicate) {
                setDupNotice({ name: d.existing?.name, pending: !!d.existing?.pending });
            } else {
                setProposal({ ...d.proposal, origin: d.origin || origin });
            }
            setAiSuggest(false);
        } catch (err) {
            toast.error(err?.response?.data?.detail || "No se pudo generar la propuesta de tesis");
        } finally {
            setProposing(false);
        }
    };

    const confirmAdd = async () => {
        if (adding || !proposal?.name?.trim()) return;
        setAdding(true);
        try {
            const d = await kpiChatAddThesis(companyId, {
                name: proposal.name.trim(),
                type: proposal.type,
                demand_driver: proposal.demand_driver || "",
                fit_description: proposal.fit_description || "",
                rationale: proposal.rationale || "",
                tam_busd: Number(proposal.tam_busd) || 0,
                relevance_score: proposal.relevance_score,
                win_probability: proposal.win_probability,
                origin: proposal.origin || "usuario",
                session_id: sessionRef.current,
            });
            setAdded({ driver: d.driver });
            setProposal(null);
            toast.success("Tesis añadida al plan de la empresa. Generándose…");
            onChanged?.();
        } catch (err) {
            toast.error(err?.response?.data?.detail || "No se pudo añadir la tesis");
        } finally {
            setAdding(false);
        }
    };

    const upd = (k, v) => setProposal((p) => ({ ...p, [k]: v }));
    const canSave = messages.some((m) => m.role === "assistant" && !m.error);
    const canPropose = messages.some((m) => m.role === "assistant" && !m.error);
    const canRefresh = messages.some((m) => m.role === "user" && !m.error);
    const hasMsgs = messages.length > 0;

    const ToolBtn = ({ tip, onClick, disabled, icon, label, testid, active }) => (
        <HoverTip text={tip} dense>
            <button onClick={onClick} disabled={disabled} data-testid={testid}
                className={`inline-flex items-center gap-1.5 text-[11px] font-mono border px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active ? "bg-[#052049] text-white border-[#052049]" : "border-black/40 bg-white text-[#052049] hover:bg-[#052049] hover:text-white"}`}>
                {icon}<span className="hidden sm:inline">{label}</span>
            </button>
        </HoverTip>
    );

    return (
        <div className="border border-black/20 bg-white mb-4" data-testid="kpi-chat">
            <button
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[#F4F6FA] transition-colors"
                data-testid="kpi-chat-toggle"
            >
                <span className="overline text-[#052049] flex items-center gap-1.5">
                    <MessageSquare size={14} /> Chat con el analista de KPIs
                    <span className="normal-case tracking-normal text-[10px] text-[#7A7A7A] font-normal">· pregunta, guarda como fuente o crea una tesis nueva</span>
                </span>
                <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="border-t border-black/10 p-3" data-testid="kpi-chat-panel">
                    {/* Toolbar */}
                    <div className="flex items-center gap-2 flex-wrap mb-3" data-testid="kpi-chat-toolbar">
                        <ToolBtn tip="Recupera tu última conversación guardada con esta empresa para releerla o reutilizarla." onClick={showLast} disabled={busy}
                            icon={loadingLast ? <Loader2 size={13} className="animate-spin" /> : <History size={13} />} label="Mostrar último chat" testid="kpi-chat-show-last" />
                        <ToolBtn tip="Sobrescribe la conversación guardada con lo que ves ahora (para recuperarla luego con 'Mostrar último chat')." onClick={saveChat} disabled={busy || !hasMsgs}
                            icon={savingChat ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} label="Guardar chat" testid="kpi-chat-save-chat" />
                        <ToolBtn tip="Relanza tus mismas preguntas con los datos actuales y actualiza las respuestas. Puede tardar y consumir saldo de IA." onClick={() => setRefreshAsk(true)} disabled={busy || !canRefresh}
                            icon={refresh ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} label="Refrescar chat" testid="kpi-chat-refresh" />
                        <ToolBtn tip="Guarda esta conversación como documento fuente; contará al reanalizar los KPIs." onClick={save} disabled={busy || !canSave}
                            icon={saving ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} label={savedOnce ? "Guardar doc. de nuevo" : "Guardar como documento"} testid="kpi-chat-save" />
                    </div>

                    {refresh && (
                        <div className="mb-3" data-testid="kpi-chat-refresh-progress">
                            <div className="flex items-center justify-between text-[11px] text-[#052049] mb-1">
                                <span className="inline-flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" /> Actualizando respuestas con datos actuales…</span>
                                <span className="font-mono">{refresh.done}/{refresh.total}</span>
                            </div>
                            <div className="h-1.5 bg-[#E7EDF6] overflow-hidden">
                                <div className="h-full bg-[#052049] transition-all" style={{ width: `${(refresh.done / refresh.total) * 100}%` }} />
                            </div>
                        </div>
                    )}

                    <div ref={scrollRef} className="max-h-[380px] overflow-y-auto space-y-3 mb-3" data-testid="kpi-chat-messages">
                        {messages.length === 0 && !refresh && (
                            <div className="text-xs text-[#7A7A7A]">
                                <p className="mb-2 flex items-center gap-1.5"><Sparkles size={13} className="text-[#B8860B]" /> Puede consultar los datos de esta empresa, de tus otras empresas y de la web. Prueba con:</p>
                                <div className="flex flex-col gap-1.5">
                                    {SUGGESTIONS.map((s, i) => (
                                        <button key={i} onClick={() => send(s)} className="text-left border border-black/15 px-2 py-1.5 hover:bg-[#F4F6FA] text-[#052049]" data-testid={`kpi-chat-suggestion-${i}`}>{s}</button>
                                    ))}
                                </div>
                                <p className="mt-2 text-[10px] text-[#9A9A9A]">¿Ya chateaste antes? Pulsa <strong>Mostrar último chat</strong> para recuperarlo.</p>
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={i} className={`group flex items-start gap-1.5 ${m.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`kpi-chat-msg-${m.role}-${i}`}>
                                {editIdx === i ? (
                                    <div className="w-full max-w-[85%] ml-auto">
                                        <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                                            className="w-full border border-[#052049] bg-white px-2 py-1.5 text-sm outline-none resize-y" data-testid={`kpi-chat-edit-input-${i}`} />
                                        <div className="flex justify-end gap-2 mt-1">
                                            <button onClick={() => setEditIdx(-1)} className="btn-ghost !py-0.5 !px-2 text-[11px]">Cancelar</button>
                                            <button onClick={commitEdit} className="btn-primary !py-0.5 !px-2 text-[11px] inline-flex items-center gap-1" data-testid={`kpi-chat-edit-save-${i}`}><Check size={12} /> Aplicar</button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* controls */}
                                        {!busy && (
                                            <div className={`flex flex-col gap-1 pt-1 opacity-30 group-hover:opacity-100 transition-opacity ${m.role === "user" ? "order-1" : "order-2"}`}>
                                                {m.role === "user" && !m.error && (
                                                    <button onClick={() => startEdit(i)} title="Editar pregunta" className="text-[#7A7A7A] hover:text-[#052049]" data-testid={`kpi-chat-edit-${i}`}><Pencil size={13} /></button>
                                                )}
                                                <button onClick={() => deleteBlock(i)} title="Borrar" className="text-[#7A7A7A] hover:text-[#B32A22]" data-testid={`kpi-chat-delete-${i}`}><Trash2 size={13} /></button>
                                            </div>
                                        )}
                                        <div className={`${m.role === "user" ? "order-2" : "order-1"} max-w-[80%] px-3 py-2 text-sm leading-snug whitespace-pre-wrap ${m.role === "user" ? "bg-[#052049] text-white" : m.error ? "bg-[#FBEAEA] text-[#B32A22] border border-[#B32A22]/30" : "bg-[#F4F6FA] text-black border border-black/10"}`}>
                                            {m.text}
                                            {m.sources?.length > 0 && (
                                                <div className="mt-1.5 pt-1.5 border-t border-black/10 text-[10px] text-[#4A4A4A]">
                                                    {m.sources.slice(0, 4).map((s, j) => (
                                                        <a key={j} href={s.url} target="_blank" rel="noreferrer" className="block truncate hover:underline text-[#052049]">· {s.title || s.url}</a>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                        {sending && (
                            <div className="flex justify-start" data-testid="kpi-chat-typing">
                                <div className="bg-[#F4F6FA] border border-black/10 px-3 py-2 text-sm text-[#4A4A4A] inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Pensando y consultando fuentes…</div>
                            </div>
                        )}

                        {/* AI-originated suggestion → ask the user */}
                        {aiSuggest && !proposal && !proposing && !added && (
                            <div className="border-2 border-[#B8860B] bg-[#FFF8E6] px-3 py-2.5" data-testid="kpi-chat-ai-suggest">
                                <div className="text-sm text-[#7a5c00] flex items-start gap-2">
                                    <Lightbulb size={16} className="shrink-0 mt-0.5 text-[#B8860B]" />
                                    <span>La IA cree que aquí ha surgido una <strong>tesis de inversión nueva</strong> para esta empresa. ¿Quieres revisarla y añadirla al plan?</span>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <button onClick={() => propose("ia")} className="btn-primary !py-1 !px-2.5 text-xs inline-flex items-center gap-1.5" data-testid="kpi-chat-review-ai-thesis"><Lightbulb size={12} /> Revisar tesis sugerida</button>
                                    <button onClick={() => setAiSuggest(false)} className="btn-ghost !py-1 !px-2.5 text-xs" data-testid="kpi-chat-dismiss-ai-thesis">Ahora no</button>
                                </div>
                            </div>
                        )}

                        {proposing && (
                            <div className="flex justify-start"><div className="bg-[#FFF8E6] border border-[#B8860B]/40 px-3 py-2 text-sm text-[#7a5c00] inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Preparando la propuesta de tesis…</div></div>
                        )}

                        {/* Duplicate: the thesis is already in the plan */}
                        {dupNotice && (
                            <div className="border-2 border-[#052049] bg-[#EEF2F8] px-3 py-2.5" data-testid="kpi-chat-duplicate">
                                <div className="text-sm text-[#052049] flex items-start gap-2">
                                    <Check size={16} className="shrink-0 mt-0.5" />
                                    <span>Esa tesis <strong>ya está en el plan</strong> de esta empresa (<em>{dupNotice.name}</em>){dupNotice.pending ? ", y está pendiente de ejecutarse" : ""}. No hace falta volver a crearla.</span>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <button onClick={() => navigate(`/thesis/${companyId}`)} className="btn-primary !py-1 !px-2.5 text-xs inline-flex items-center gap-1.5" data-testid="kpi-chat-dup-goto">Ver en la ficha de tesis <ArrowRight size={13} /></button>
                                    <button onClick={() => setDupNotice(null)} className="btn-ghost !py-1 !px-2.5 text-xs">Entendido</button>
                                </div>
                            </div>
                        )}

                        {/* Editable proposal card + step-by-step permission */}
                        {proposal && (
                            <div className="border-2 border-[#052049] bg-white px-3 py-3" data-testid="kpi-chat-proposal">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="overline text-[#052049] flex items-center gap-1.5"><Lightbulb size={13} /> Nueva tesis propuesta</div>
                                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 border ${proposal.origin === "ia" ? "text-[#7a5c00] bg-[#FFF8E6] border-[#B8860B]/40" : "text-[#052049] bg-[#E7EDF6] border-[#052049]/30"}`} data-testid="kpi-chat-proposal-origin">
                                        {proposal.origin === "ia" ? "Idea de la IA" : "Idea tuya"}
                                    </span>
                                </div>
                                <label className="block text-[10px] text-[#7A7A7A] uppercase tracking-wide mb-0.5">Título</label>
                                <input value={proposal.name} onChange={(e) => upd("name", e.target.value)} className="w-full border border-black/30 bg-white px-2 py-1 text-sm mb-2 outline-none focus:border-[#052049]" data-testid="kpi-chat-proposal-name" />
                                <div className="flex gap-2 mb-2">
                                    <div className="flex-1">
                                        <label className="block text-[10px] text-[#7A7A7A] uppercase tracking-wide mb-0.5">Tipo</label>
                                        <select value={proposal.type} onChange={(e) => upd("type", e.target.value)} className="w-full border border-black/30 bg-white px-2 py-1 text-sm outline-none" data-testid="kpi-chat-proposal-type">
                                            <option value="actual">Crecimiento actual</option>
                                            <option value="futuro">Apuesta futura</option>
                                        </select>
                                    </div>
                                    <div className="w-28">
                                        <label className="block text-[10px] text-[#7A7A7A] uppercase tracking-wide mb-0.5">TAM (B$)</label>
                                        <input type="number" value={proposal.tam_busd} onChange={(e) => upd("tam_busd", e.target.value)} className="w-full border border-black/30 bg-white px-2 py-1 text-sm outline-none" data-testid="kpi-chat-proposal-tam" />
                                    </div>
                                </div>
                                <label className="block text-[10px] text-[#7A7A7A] uppercase tracking-wide mb-0.5">Por qué encaja</label>
                                <textarea value={proposal.fit_description} onChange={(e) => upd("fit_description", e.target.value)} rows={2} className="w-full border border-black/30 bg-white px-2 py-1 text-sm mb-2 outline-none resize-y" data-testid="kpi-chat-proposal-fit" />
                                <p className="text-[11px] text-[#7A7A7A] mb-2 leading-snug">Paso 1: revisa y ajusta. Paso 2: al añadirla, entra en la ficha de tesis de la empresa junto al resto y se genera automáticamente (podrás verla en detalle allí).</p>
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => setProposal(null)} className="btn-ghost !py-1 !px-2.5 text-xs inline-flex items-center gap-1"><X size={12} /> Cancelar</button>
                                    <button onClick={confirmAdd} disabled={adding || !proposal.name?.trim()} className="btn-primary !py-1 !px-2.5 text-xs inline-flex items-center gap-1.5 disabled:opacity-40" data-testid="kpi-chat-proposal-confirm">
                                        {adding ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Añadir al plan y generar
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Success → guided path to the company's thesis page */}
                        {added && (
                            <div className="border-2 border-[#1D7044] bg-[#EAF6EF] px-3 py-3" data-testid="kpi-chat-added">
                                <div className="text-sm text-[#0f5132] mb-2 flex items-start gap-2">
                                    <Check size={16} className="shrink-0 mt-0.5" />
                                    <span>Añadida <strong>«{added.driver?.name}»</strong> al plan de esta empresa. Se está generando su análisis junto al resto de tesis.</span>
                                </div>
                                <button onClick={() => navigate(`/thesis/${companyId}`)} className="btn-primary !py-1 !px-2.5 text-xs inline-flex items-center gap-1.5" data-testid="kpi-chat-goto-thesis">
                                    Ver en la ficha de tesis <ArrowRight size={13} />
                                </button>
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
                            disabled={!!refresh}
                        />
                        <button onClick={() => send()} disabled={sending || !input.trim() || !!refresh} className="btn-primary !py-2 !px-3 disabled:opacity-40" title="Enviar" data-testid="kpi-chat-send">
                            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                        </button>
                    </div>

                    <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                        <button onClick={() => propose("usuario")} disabled={!canPropose || proposing || busy} className="text-xs text-[#052049] inline-flex items-center gap-1 hover:underline disabled:opacity-40 disabled:no-underline" data-testid="kpi-chat-propose-thesis">
                            <Lightbulb size={13} /> Convertir en nueva tesis
                        </button>
                        <p className="text-[10px] text-[#7A7A7A]">Al guardar como documento, la conversación cuenta al reanalizar los KPIs.</p>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={refreshAsk}
                title="¿Refrescar el chat con datos actuales?"
                message={`Se relanzarán tus ${messages.filter((m) => m.role === "user" && !m.error).length} pregunta(s) con el contexto y los datos de ahora, y se actualizarán las respuestas. Puede tardar y consumir saldo de IA.`}
                confirmLabel="Refrescar"
                cancelLabel="Cancelar"
                onConfirm={doRefresh}
                onCancel={() => setRefreshAsk(false)}
                testid="kpi-chat-refresh-confirm"
            />
        </div>
    );
}
