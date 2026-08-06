import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Users, MessageSquarePlus, ChevronDown, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { feedbackUnread } from "@/lib/api";
import HoverTip from "@/components/HoverTip";
import FeedbackPanel from "./FeedbackPanel";

export default function FeedbackControls({ mobile = false }) {
    const { user } = useAuth();
    const [panelOpen, setPanelOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [unread, setUnread] = useState({ user_total: 0, is_admin: false, admin_threads: 0 });
    const timer = useRef(null);
    const menuRef = useRef(null);

    const refresh = useCallback(() => {
        if (!user) return;
        feedbackUnread().then(setUnread).catch(() => {});
    }, [user]);

    useEffect(() => {
        if (!user) { setUnread({ user_total: 0, is_admin: false, admin_threads: 0 }); return; }
        refresh();
        timer.current = setInterval(refresh, 45000);
        return () => clearInterval(timer.current);
    }, [user, refresh]);

    useEffect(() => {
        const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    if (!user) return null;

    const badge = (n, testid) => n > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 bg-[#B32A22] text-white text-[10px] font-bold min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full" data-testid={testid}>{n > 9 ? "9+" : n}</span>
    ) : null;

    const openSuggestions = () => { setMenuOpen(false); setPanelOpen(true); };

    return (
        <>
            <div className="relative" ref={menuRef}>
                <HoverTip text="Comunidad: envía sugerencias, participa en encuestas y (próximamente) foros, grupos y mensajes privados." maxWidth={260}>
                    <button
                        onClick={() => setMenuOpen((o) => !o)}
                        className="relative border border-black bg-white flex items-center gap-1.5 px-2.5 py-1.5 text-xs uppercase tracking-[0.12em] font-semibold hover:bg-black hover:text-white transition-colors"
                        data-testid="community-menu-btn"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                    >
                        <Users size={16} />
                        <span className="hidden sm:inline">Comunidad</span>
                        <ChevronDown size={13} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
                        {badge(unread.user_total, "feedback-unread-badge")}
                    </button>
                </HoverTip>

                {menuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-black shadow-lg z-[65]" role="menu" data-testid="community-menu">
                        <div className="px-3 py-1.5 overline text-[#4A4A4A] border-b border-black/10">Comunidad</div>
                        <button
                            onClick={openSuggestions}
                            className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-[#F5E4D4] transition-colors"
                            data-testid="feedback-open-btn"
                            role="menuitem"
                        >
                            <MessageSquarePlus size={16} className="text-[#052049] shrink-0" />
                            <span className="text-sm flex-1">Sugerencias</span>
                            {unread.user_total > 0 && (
                                <span className="bg-[#B32A22] text-white text-[10px] font-bold min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full" data-testid="feedback-menu-unread">{unread.user_total > 9 ? "9+" : unread.user_total}</span>
                            )}
                        </button>
                        {unread.is_admin && (
                            <Link
                                to="/admin/feedback"
                                onClick={() => setMenuOpen(false)}
                                className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-[#F5E4D4] transition-colors border-t border-black/10"
                                data-testid="feedback-admin-link"
                                role="menuitem"
                            >
                                <ShieldCheck size={16} className="shrink-0" />
                                <span className="text-sm flex-1">Administración</span>
                                {unread.admin_threads > 0 && (
                                    <span className="bg-[#B32A22] text-white text-[10px] font-bold min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full" data-testid="feedback-admin-badge">{unread.admin_threads > 9 ? "9+" : unread.admin_threads}</span>
                                )}
                            </Link>
                        )}
                    </div>
                )}
            </div>

            <FeedbackPanel open={panelOpen} onClose={() => { setPanelOpen(false); refresh(); }} onChanged={refresh} />
        </>
    );
}
