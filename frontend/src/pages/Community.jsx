import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MessagesSquare, Users, Mail, Bell, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { feedbackUnread, communityNotifications, communityMarkNotifsRead } from "@/lib/api";
import Forum from "@/components/community/Forum";
import Groups from "@/components/community/Groups";
import DirectMessages from "@/components/community/DirectMessages";

function fmtDate(iso) {
    try { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
}

export default function Community() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [tab, setTab] = useState("general");
    const [isAdmin, setIsAdmin] = useState(false);
    const [notifs, setNotifs] = useState(null);
    const [showNotifs, setShowNotifs] = useState(false);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (loading || !user) return;
        feedbackUnread().then((r) => setIsAdmin(!!r.is_admin)).catch(() => {});
    }, [user, loading]);

    const loadNotifs = useCallback(() => {
        if (!user) return;
        communityNotifications().then((r) => setNotifs(r.notifications || [])).catch(() => setNotifs([]));
    }, [user]);
    useEffect(() => { loadNotifs(); }, [loadNotifs, tick]);

    const openNotifs = async () => {
        setShowNotifs((s) => !s);
        if (!showNotifs) { try { await communityMarkNotifsRead(); } catch { /* ignore */ } }
    };

    if (loading) return <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto" /></div>;
    if (!user) return (
        <div className="py-20 text-center" data-testid="community-login-needed">
            <MessagesSquare className="mx-auto mb-3 opacity-30" size={40} />
            <div className="font-serif text-2xl mb-2">Comunidad</div>
            <p className="text-sm text-[#4A4A4A]">Inicia sesión para participar en el foro, los grupos y los mensajes.</p>
            <button onClick={() => navigate("/")} className="btn-primary mt-4 !px-4 !py-2">Volver al inicio</button>
        </div>
    );

    const unreadNotifs = (notifs || []).filter((n) => !n.read).length;
    const tabs = [
        { key: "general", label: "General", icon: MessagesSquare },
        { key: "groups", label: "Grupos", icon: Users },
        { key: "dms", label: "Mensajes", icon: Mail },
    ];

    return (
        <div data-testid="community-page">
            <div className="flex items-center justify-between gap-3 mb-5">
                <div>
                    <h1 className="font-serif text-3xl leading-none">Comunidad</h1>
                    <div className="overline text-[#4A4A4A] mt-1">Debate, grupos e ideas de inversión</div>
                </div>
                <div className="relative">
                    <button onClick={openNotifs} className="relative border border-black bg-white p-2 hover:bg-black hover:text-white transition-colors" data-testid="community-notifs-btn">
                        <Bell size={16} />
                        {unreadNotifs > 0 && <span className="absolute -top-1.5 -right-1.5 bg-[#B32A22] text-white text-[10px] font-bold min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full">{unreadNotifs}</span>}
                    </button>
                    {showNotifs && (
                        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-black shadow-lg z-30 max-h-80 overflow-y-auto" data-testid="community-notifs-panel">
                            <div className="px-3 py-1.5 overline text-[#4A4A4A] border-b border-black/10">Notificaciones</div>
                            {(notifs || []).length === 0 ? <div className="p-4 text-center text-sm text-[#4A4A4A]">Sin notificaciones.</div>
                                : (notifs || []).map((n) => (
                                    <div key={n.id} className="px-3 py-2 border-b border-black/10 text-sm">
                                        {n.text}<div className="text-[10px] text-[#4A4A4A] mt-0.5">{fmtDate(n.created_at)}</div>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex border border-black mb-5">
                {tabs.map(({ key, label, icon: Icon }) => (
                    <button key={key} onClick={() => setTab(key)}
                        className={`flex-1 py-2.5 text-xs uppercase tracking-[0.12em] font-semibold flex items-center justify-center gap-2 transition-colors ${tab === key ? "bg-black text-[#FDF1E6]" : "hover:bg-black/5"}`}
                        data-testid={`community-tab-${key}`}>
                        <Icon size={15} /> {label}
                    </button>
                ))}
            </div>

            {tab === "general" && <Forum scope="general" onChanged={() => setTick((t) => t + 1)} />}
            {tab === "groups" && <Groups isAdmin={isAdmin} onChanged={() => setTick((t) => t + 1)} />}
            {tab === "dms" && <DirectMessages onChanged={() => setTick((t) => t + 1)} />}
        </div>
    );
}
