import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { MessageSquarePlus, Bell, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { feedbackUnread } from "@/lib/api";
import FeedbackPanel from "./FeedbackPanel";

export default function FeedbackControls({ mobile = false }) {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [unread, setUnread] = useState({ user_total: 0, is_admin: false, admin_threads: 0 });
    const timer = useRef(null);

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

    if (!user) return null;

    const badge = (n, testid) => n > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 bg-[#B32A22] text-white text-[10px] font-bold min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full" data-testid={testid}>{n > 9 ? "9+" : n}</span>
    ) : null;

    const btnBase = "relative border border-black bg-white flex items-center justify-center hover:bg-black hover:text-white transition-colors";

    return (
        <>
            <div className={mobile ? "flex items-center gap-2" : "flex items-center gap-2"}>
                <button onClick={() => { setOpen(true); }}
                    className={`${btnBase} gap-1.5 px-2.5 py-1.5 text-xs uppercase tracking-[0.12em] font-semibold`}
                    data-testid="feedback-open-btn" title="Enviar sugerencia">
                    <MessageSquarePlus size={16} />
                    <span className="hidden sm:inline">Sugerencias</span>
                    {badge(unread.user_total, "feedback-unread-badge")}
                </button>

                <button onClick={() => { setOpen(true); }} className={`${btnBase} p-2`} data-testid="feedback-bell-btn" title="Notificaciones">
                    <Bell size={16} />
                    {badge(unread.user_total, "feedback-bell-badge")}
                </button>

                {unread.is_admin && (
                    <Link to="/admin/feedback" className={`${btnBase} p-2`} data-testid="feedback-admin-link" title="Panel de administración">
                        <ShieldCheck size={16} />
                        {badge(unread.admin_threads, "feedback-admin-badge")}
                    </Link>
                )}
            </div>

            <FeedbackPanel open={open} onClose={() => { setOpen(false); refresh(); }} onChanged={refresh} />
        </>
    );
}
