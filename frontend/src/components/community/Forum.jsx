import React, { useState, useEffect, useCallback } from "react";
import { Loader2, ThumbsUp, MessageCircle, Trash2, ChevronLeft, Send, Plus } from "lucide-react";
import { toast } from "sonner";
import {
    communityTopics, communityCreateTopic, communityGetTopic, communityReply,
    communityLikeTopic, communityLikeReply, communityDeleteTopic, communityDeleteReply,
} from "@/lib/api";
import ReportButton from "./ReportButton";

function fmtDate(iso) {
    try { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
}

function apiErr(e, fallback) {
    const d = e?.response?.data?.detail;
    return d || fallback;
}

// Reusable forum feed for the general channel (scope='general') or a group (scope='group', groupId set).
export default function Forum({ scope = "general", groupId = null, onChanged }) {
    const [openId, setOpenId] = useState(null);
    return openId
        ? <TopicView id={openId} onBack={() => { setOpenId(null); onChanged && onChanged(); }} onChanged={onChanged} />
        : <TopicFeed scope={scope} groupId={groupId} onOpen={setOpenId} onChanged={onChanged} />;
}

function TopicFeed({ scope, groupId, onOpen, onChanged }) {
    const [topics, setTopics] = useState(null);
    const [sort, setSort] = useState("recent");
    const [composing, setComposing] = useState(false);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);

    const load = useCallback(async () => {
        try { const r = await communityTopics(scope, groupId, sort); setTopics(r.topics || []); }
        catch (e) { setTopics([]); toast.error(apiErr(e, "No se pudo cargar")); }
    }, [scope, groupId, sort]);

    useEffect(() => { setTopics(null); load(); }, [load]);

    const create = async () => {
        if (!title.trim()) { toast.error("Escribe un título"); return; }
        setPosting(true);
        try {
            await communityCreateTopic({ scope, group_id: groupId, title: title.trim(), body: body.trim() });
            toast.success("Tema publicado");
            setTitle(""); setBody(""); setComposing(false); load(); onChanged && onChanged();
        } catch (e) { toast.error(apiErr(e, "No se pudo publicar")); }
        finally { setPosting(false); }
    };

    const like = async (t) => {
        try { const r = await communityLikeTopic(t.id); setTopics((ts) => ts.map((x) => x.id === t.id ? { ...x, liked_by_me: r.liked, like_count: r.like_count } : x)); }
        catch (e) { toast.error(apiErr(e, "Error")); }
    };

    return (
        <div data-testid="community-forum">
            <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex border border-black">
                    {[["recent", "Recientes"], ["popular", "Populares"]].map(([k, l]) => (
                        <button key={k} onClick={() => setSort(k)}
                            className={`px-3 py-1.5 text-xs uppercase tracking-wide font-semibold ${sort === k ? "bg-black text-white" : "hover:bg-black/5"}`}
                            data-testid={`forum-sort-${k}`}>{l}</button>
                    ))}
                </div>
                <button onClick={() => setComposing((c) => !c)} className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-xs" data-testid="forum-new-topic-btn">
                    <Plus size={14} /> Nuevo tema
                </button>
            </div>

            {composing && (
                <div className="border border-black bg-white p-3 mb-4 space-y-2" data-testid="forum-composer">
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título del tema…"
                        className="w-full border border-black px-3 py-2 text-sm outline-none" data-testid="forum-topic-title" />
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Desarrolla tu idea…"
                        className="w-full border border-black px-3 py-2 text-sm outline-none resize-none" data-testid="forum-topic-body" />
                    <div className="flex justify-end">
                        <button onClick={create} disabled={posting} className="btn-primary !px-4 !py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-50" data-testid="forum-topic-publish">
                            {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Publicar
                        </button>
                    </div>
                </div>
            )}

            {topics === null ? <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto" /></div>
                : !topics.length ? <div className="py-10 text-center text-sm text-[#4A4A4A]" data-testid="forum-empty">Aún no hay temas. ¡Abre el primero!</div>
                : <div className="space-y-2" data-testid="forum-topic-list">
                    {topics.map((t) => (
                        <div key={t.id} className="border border-black bg-white p-3 hover:bg-[#FDF1E6]/40 transition-colors" data-testid={`forum-topic-${t.id}`}>
                            <button onClick={() => onOpen(t.id)} className="text-left w-full">
                                <div className="font-serif text-lg leading-snug">{t.title}</div>
                                {t.body && <div className="text-sm text-[#4A4A4A] mt-1 line-clamp-2">{t.body}</div>}
                            </button>
                            <div className="flex items-center gap-4 mt-2 text-xs text-[#4A4A4A]">
                                <span>{t.author_name} · {fmtDate(t.created_at)}</span>
                                <button onClick={() => like(t)} className={`flex items-center gap-1 ${t.liked_by_me ? "text-[#052049] font-semibold" : "hover:text-black"}`} data-testid={`forum-topic-like-${t.id}`}>
                                    <ThumbsUp size={13} /> {t.like_count}
                                </button>
                                <span className="flex items-center gap-1"><MessageCircle size={13} /> {t.reply_count}</span>
                                <ReportButton targetType="topic" targetId={t.id} />
                            </div>
                        </div>
                    ))}
                </div>}
        </div>
    );
}

export function TopicView({ id, onBack, onChanged, header = null }) {
    const [data, setData] = useState(null);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);

    const load = useCallback(async () => {
        try { setData(await communityGetTopic(id)); }
        catch (e) { toast.error(apiErr(e, "No se pudo abrir")); onBack(); }
    }, [id]); // eslint-disable-line

    useEffect(() => { load(); }, [load]);

    const send = async () => {
        if (!reply.trim()) return;
        setSending(true);
        try { await communityReply(id, reply.trim()); setReply(""); await load(); onChanged && onChanged(); }
        catch (e) { toast.error(apiErr(e, "No se pudo responder")); }
        finally { setSending(false); }
    };

    const likeReply = async (r) => {
        try { const res = await communityLikeReply(r.id); setData((d) => ({ ...d, replies: d.replies.map((x) => x.id === r.id ? { ...x, liked_by_me: res.liked, like_count: res.like_count } : x) })); }
        catch (e) { toast.error(apiErr(e, "Error")); }
    };

    const delTopic = async () => {
        if (!window.confirm("¿Borrar este tema?")) return;
        try { await communityDeleteTopic(id); toast.success("Tema borrado"); onBack(); }
        catch (e) { toast.error(apiErr(e, "Error")); }
    };
    const delReply = async (r) => {
        try { await communityDeleteReply(r.id); await load(); }
        catch (e) { toast.error(apiErr(e, "Error")); }
    };

    if (!data) return <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto" /></div>;
    const { topic, replies } = data;

    return (
        <div data-testid="community-topic-view">
            <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3 hover:underline" data-testid="topic-back"><ChevronLeft size={16} /> Volver</button>
            {header}
            <div className="border border-black bg-white p-4">
                <div className="flex justify-between items-start gap-2">
                    <h2 className="font-serif text-2xl leading-tight">{topic.title}</h2>
                    {topic.can_delete && <button onClick={delTopic} className="text-[#B32A22] p-1 shrink-0" data-testid="topic-delete"><Trash2 size={16} /></button>}
                </div>
                {topic.body && <p className="text-sm mt-2 whitespace-pre-wrap">{topic.body}</p>}
                <div className="text-xs text-[#4A4A4A] mt-3">{topic.author_name} · {fmtDate(topic.created_at)}</div>
            </div>

            <div className="mt-4 space-y-2">
                <div className="overline text-[#4A4A4A]">{replies.length} respuesta{replies.length !== 1 ? "s" : ""}</div>
                {replies.map((r) => (
                    <div key={r.id} className="border border-black/20 bg-white p-3" data-testid={`reply-${r.id}`}>
                        <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-[#4A4A4A]">
                            <span>{r.author_name} · {fmtDate(r.created_at)}</span>
                            <button onClick={() => likeReply(r)} className={`flex items-center gap-1 ${r.liked_by_me ? "text-[#052049] font-semibold" : "hover:text-black"}`} data-testid={`reply-like-${r.id}`}>
                                <ThumbsUp size={12} /> {r.like_count}
                            </button>
                            {r.can_delete && <button onClick={() => delReply(r)} className="text-[#B32A22]" data-testid={`reply-delete-${r.id}`}><Trash2 size={12} /></button>}
                            <ReportButton targetType="reply" targetId={r.id} size={12} />
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-3 flex gap-2">
                <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder="Escribe una respuesta…" className="flex-1 border border-black px-3 py-2 text-sm outline-none bg-white" data-testid="reply-input" />
                <button onClick={send} disabled={sending} className="btn-primary !px-3 disabled:opacity-50" data-testid="reply-send">
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
            </div>
        </div>
    );
}
