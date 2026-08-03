import React, { useState, useRef, useEffect, useCallback } from "react";
import { Share2, Link2, Copy, Check, Send, MessageCircle, Facebook, Twitter, Mail, Slack, MessagesSquare, Loader2, Smartphone } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { shareWebhook } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Reusable "Share" split from download. `createShare` must create the shareable
 *  document and resolve to { token }. The panel then offers: copy link + QR, native
 *  share, WhatsApp/Telegram/X/Facebook/Email, and Discord/Slack (user webhooks). */
export default function ShareMenu({ createShare, title = "documento", size = "sm", testidPrefix = "share" }) {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [url, setUrl] = useState("");
    const [copied, setCopied] = useState(false);
    const [alignLeft, setAlignLeft] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const ensureLink = useCallback(async () => {
        if (url) return url;
        const res = await createShare();
        const link = `${window.location.origin}/s/${res.token}`;
        setUrl(link);
        return link;
    }, [url, createShare]);

    const onOpen = async () => {
        if (!user) { toast.info("Inicia sesión para compartir"); return; }
        setBusy(true);
        try {
            await ensureLink();
            // Keep the 290px popover inside the viewport: if the trigger sits near the
            // left edge (right-anchored panel would overflow left), anchor it left.
            const rect = ref.current?.getBoundingClientRect();
            if (rect) setAlignLeft(rect.right < 298);
            setOpen(true);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo generar el enlace para compartir");
        } finally { setBusy(false); }
    };

    const copy = async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
        catch { toast.error("No se pudo copiar"); }
    };

    const nativeShare = async () => {
        try { await navigator.share({ title, text: title, url }); }
        catch { /* user cancelled */ }
    };

    const openIntent = (href) => window.open(href, "_blank", "noopener,noreferrer");
    const enc = encodeURIComponent;
    const targets = [
        { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle, color: "text-[#25D366]", href: () => `https://wa.me/?text=${enc(title + " " + url)}` },
        { key: "telegram", label: "Telegram", Icon: Send, color: "text-[#229ED9]", href: () => `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}` },
        { key: "x", label: "X", Icon: Twitter, color: "text-black", href: () => `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}` },
        { key: "facebook", label: "Facebook", Icon: Facebook, color: "text-[#1877F2]", href: () => `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
        { key: "email", label: "Email", Icon: Mail, color: "text-[#4A4A4A]", href: () => `mailto:?subject=${enc(title)}&body=${enc(title + "\n\n" + url)}` },
    ];

    const sendWebhook = async (target) => {
        try {
            await shareWebhook(target, title, url);
            toast.success(`Enviado a ${target === "discord" ? "Discord" : "Slack"}`);
        } catch (e) {
            const detail = e?.response?.data?.detail;
            if (detail === "no_webhook") toast.info(`Configura el webhook de ${target === "discord" ? "Discord" : "Slack"} en Ajustes`);
            else toast.error(detail || "No se pudo enviar");
        }
    };

    const iconSize = size === "md" ? 16 : 14;
    const btnCls = size === "md"
        ? "inline-flex items-center justify-center border border-black/50 hover:bg-black/5 text-[#052049] px-2 py-1 disabled:opacity-50 transition-colors"
        : "inline-flex items-center justify-center hover:bg-black/5 text-[#4A4A4A] p-1 disabled:opacity-50 transition-colors";

    return (
        <div className="relative shrink-0 flex items-center" ref={ref} data-testid={`${testidPrefix}-wrap`}>
            <button onClick={onOpen} disabled={busy} title="Compartir" data-testid={`${testidPrefix}-btn`} className={btnCls}>
                {busy ? <Loader2 size={iconSize} className="animate-spin" /> : <Share2 size={iconSize} />}
            </button>
            {open && (
                <div className={`absolute ${alignLeft ? "left-0" : "right-0"} top-full mt-1 z-40 bg-white border border-black/25 shadow-xl w-[290px] p-3`} data-testid={`${testidPrefix}-panel`} onMouseDown={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 mb-2">
                        <Link2 size={13} className="text-[#4A4A4A]" />
                        <input readOnly value={url} className="flex-1 min-w-0 border border-black/25 bg-[#FAF6EE] px-2 py-1 text-[11px] font-mono truncate" data-testid={`${testidPrefix}-link`} onFocus={(e) => e.target.select()} />
                        <button onClick={copy} title="Copiar enlace" data-testid={`${testidPrefix}-copy`} className="border border-black/40 p-1 hover:bg-black/5">
                            {copied ? <Check size={13} className="text-[#1D7044]" /> : <Copy size={13} />}
                        </button>
                    </div>
                    <div className="flex items-center gap-3 mb-3">
                        <div className="border border-black/15 p-1 bg-white"><QRCodeCanvas value={url || " "} size={64} data-testid={`${testidPrefix}-qr`} /></div>
                        <div className="text-[10px] text-[#7A7A7A] leading-snug">Escanea el QR o comparte el enlace. Caduca en 15 días; quien lo reciba ve el documento y puede descargarlo (sin acceso a tu app).</div>
                    </div>
                    {typeof navigator !== "undefined" && navigator.share && (
                        <button onClick={nativeShare} data-testid={`${testidPrefix}-native`} className="w-full mb-2 inline-flex items-center justify-center gap-2 border border-black bg-black text-white text-xs uppercase tracking-wide py-1.5 hover:bg-[#222]">
                            <Smartphone size={13} /> Compartir (móvil)
                        </button>
                    )}
                    <div className="grid grid-cols-5 gap-1 mb-2">
                        {targets.map((t) => (
                            <button key={t.key} onClick={() => openIntent(t.href())} title={t.label} data-testid={`${testidPrefix}-${t.key}`} className="flex flex-col items-center gap-0.5 py-1.5 hover:bg-[#F4F6FA] border border-black/10">
                                <t.Icon size={16} className={t.color} />
                                <span className="text-[9px] text-[#4A4A4A]">{t.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                        <button onClick={() => sendWebhook("discord")} data-testid={`${testidPrefix}-discord`} className="flex items-center justify-center gap-1.5 py-1.5 text-xs border border-black/15 hover:bg-[#F4F6FA] text-[#5865F2]">
                            <MessagesSquare size={14} /> Discord
                        </button>
                        <button onClick={() => sendWebhook("slack")} data-testid={`${testidPrefix}-slack`} className="flex items-center justify-center gap-1.5 py-1.5 text-xs border border-black/15 hover:bg-[#F4F6FA] text-[#611f69]">
                            <Slack size={14} /> Slack
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
