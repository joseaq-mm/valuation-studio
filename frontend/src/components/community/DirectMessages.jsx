import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Send, ChevronLeft, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
    communityDms, communityStartDm, communityGetDm, communitySendDm, communitySearchUsers,
} from "@/lib/api";

function fmtDate(iso) {
    try { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
}
function apiErr(e, f) { return e?.response?.data?.detail || f; }

export default function DirectMessages({ onChanged }) {
    const [dms, setDms] = useState(null);
    const [active, setActive] = useState(null);
    const [newOpen, setNewOpen] = useState(false);

    const load = useCallback(async () => {
        try { const r = await communityDms(); setDms(r.dms || []); }
        catch { setDms([]); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const openDm = (id, name) => { setActive({ id, name }); setNewOpen(false); };

    if (active) return <Conversation id={active.id} name={active.name} onBack={() => { setActive(null); load(); onChanged && onChanged(); }} onChanged={onChanged} />;

    return (
        <div data-testid="community-dms">
            <div className="flex justify-end mb-3">
                <button onClick={() => setNewOpen((o) => !o)} className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-xs" data-testid="dm-new-btn">
                    {newOpen ? <X size={14} /> : <Plus size={14} />} {newOpen ? "Cerrar" : "Nuevo mensaje"}
                </button>
            </div>

            {newOpen && <NewDm onStarted={(id, name) => openDm(id, name)} />}

            {dms === null ? <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto" /></div>
                : !dms.length ? <div className="py-10 text-center text-sm text-[#4A4A4A]" data-testid="dms-empty">No tienes conversaciones todavía.</div>
                : <div className="space-y-2" data-testid="dm-list">
                    {dms.map((d) => (
                        <button key={d.id} onClick={() => openDm(d.id, d.other_name)}
                            className="w-full text-left border border-black bg-white p-3 hover:bg-[#FDF1E6]/40 flex items-center gap-3" data-testid={`dm-${d.id}`}>
                            <div className="w-9 h-9 border border-black flex items-center justify-center bg-[#052049] text-white font-serif shrink-0">{(d.other_name || "?")[0]}</div>
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">{d.other_name}</div>
                                <div className="text-xs text-[#4A4A4A] truncate">{d.last_text || "—"}</div>
                            </div>
                            {d.unread > 0 && <span className="bg-[#B32A22] text-white text-[10px] font-bold px-1.5 rounded-full" data-testid={`dm-unread-${d.id}`}>{d.unread}</span>}
                        </button>
                    ))}
                </div>}
        </div>
    );
}

function NewDm({ onStarted }) {
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    const timer = useRef(null);

    useEffect(() => {
        if (!q.trim()) { setResults([]); return; }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
            try { const r = await communitySearchUsers(q.trim()); setResults(r.users || []); } catch { setResults([]); }
        }, 250);
    }, [q]);

    const start = async (u) => {
        try { const r = await communityStartDm(u.user_id); onStarted(r.id, u.name || u.email); }
        catch (e) { toast.error(apiErr(e, "No se pudo iniciar")); }
    };

    return (
        <div className="border border-black bg-white p-3 mb-3" data-testid="dm-new-panel">
            <div className="flex items-center border border-black">
                <Search size={16} className="ml-2 text-[#4A4A4A]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar usuario por nombre o email…"
                    className="flex-1 px-2 py-1.5 outline-none text-sm" data-testid="dm-user-search" autoFocus />
            </div>
            {results.length > 0 && (
                <div className="mt-2 border border-black/20 divide-y divide-black/10" data-testid="dm-user-results">
                    {results.map((u) => (
                        <button key={u.user_id} onClick={() => start(u)} className="w-full text-left px-3 py-2 hover:bg-[#F5E4D4] text-sm flex items-center gap-2" data-testid={`dm-user-${u.user_id}`}>
                            <span className="font-medium">{u.name || "Usuario"}</span>
                            <span className="text-[#4A4A4A] text-xs">{u.email}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function Conversation({ id, name, onBack, onChanged }) {
    const [data, setData] = useState(null);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const endRef = useRef(null);

    const load = useCallback(async () => {
        try { setData(await communityGetDm(id)); onChanged && onChanged(); }
        catch (e) { toast.error(apiErr(e, "Error")); onBack(); }
    }, [id]); // eslint-disable-line

    useEffect(() => { load(); }, [load]);
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [data]);

    const send = async () => {
        if (!text.trim()) return;
        setSending(true);
        try { await communitySendDm(id, text.trim()); setText(""); await load(); }
        catch (e) { toast.error(apiErr(e, "No se pudo enviar")); }
        finally { setSending(false); }
    };

    if (!data) return <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto" /></div>;

    return (
        <div data-testid="dm-conversation">
            <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3 hover:underline" data-testid="dm-back"><ChevronLeft size={16} /> Mensajes</button>
            <div className="font-serif text-xl mb-3">{data.other_name || name}</div>
            <div className="border border-black bg-white p-3 h-[420px] overflow-y-auto space-y-2">
                {data.messages.length === 0 && <div className="text-center text-sm text-[#4A4A4A] py-8">Escribe el primer mensaje.</div>}
                {data.messages.map((m) => (
                    <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] px-3 py-2 text-sm border border-black ${m.mine ? "bg-[#052049] text-white" : "bg-[#FDF1E6]"}`}>
                            <div className="whitespace-pre-wrap break-words">{m.text}</div>
                            <div className={`text-[10px] mt-1 ${m.mine ? "text-white/60" : "text-[#4A4A4A]"}`}>{fmtDate(m.created_at)}</div>
                        </div>
                    </div>
                ))}
                <div ref={endRef} />
            </div>
            <div className="mt-3 flex gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder="Escribe un mensaje…" className="flex-1 border border-black px-3 py-2 text-sm outline-none bg-white" data-testid="dm-input" />
                <button onClick={send} disabled={sending} className="btn-primary !px-3 disabled:opacity-50" data-testid="dm-send">
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
            </div>
        </div>
    );
}
