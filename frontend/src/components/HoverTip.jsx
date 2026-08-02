import React, { useState, useRef, useLayoutEffect, useEffect } from "react";

/**
 * Lightweight controlled tooltip. Uses fixed positioning + viewport clamping
 * so it never gets cut off by overflow. Supports multi-line text (via
 * whiteSpace: pre-line) — newlines in the `text` prop are rendered.
 *
 * Desktop: shows on mouse hover. Touch: tap to open, tap again (or tap
 * elsewhere, or scroll) to close — a fixed tooltip must never stay "stuck".
 */
export default function HoverTip({ text, children, maxWidth = 320, dense = false }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const wrapRef = useRef(null);
    const tipRef = useRef(null);
    const ptrType = useRef("mouse");

    const show = () => {
        if (!wrapRef.current) return;
        const r = wrapRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 8, left: r.left });
        setOpen(true);
    };
    const hide = () => setOpen(false);

    useLayoutEffect(() => {
        if (!open || !wrapRef.current || !tipRef.current) return;
        const wrap = wrapRef.current.getBoundingClientRect();
        const tip = tipRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;
        let left = wrap.left;
        if (left + tip.width + margin > vw) left = Math.max(margin, vw - tip.width - margin);
        if (left < margin) left = margin;
        const placeAbove = wrap.bottom + tip.height + margin > vh && wrap.top - tip.height - margin > 0;
        const top = placeAbove ? wrap.top - tip.height - 8 : wrap.bottom + 8;
        setPos({ top, left });
    }, [open]);

    // Once open, dismiss on scroll/resize or a tap outside so the fixed
    // tooltip never lingers detached from its trigger.
    useEffect(() => {
        if (!open) return;
        const onScrollResize = () => hide();
        const onDocDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) hide(); };
        window.addEventListener("scroll", onScrollResize, true);
        window.addEventListener("resize", onScrollResize);
        document.addEventListener("pointerdown", onDocDown, true);
        return () => {
            window.removeEventListener("scroll", onScrollResize, true);
            window.removeEventListener("resize", onScrollResize);
            document.removeEventListener("pointerdown", onDocDown, true);
        };
    }, [open]);

    if (!text) return children;
    return (
        <>
            <span
                ref={wrapRef}
                onPointerDown={(e) => { ptrType.current = e.pointerType || "mouse"; }}
                onPointerEnter={(e) => { if ((e.pointerType || "mouse") === "mouse") show(); }}
                onPointerLeave={(e) => { if ((e.pointerType || "mouse") === "mouse") hide(); }}
                onClick={() => { if (ptrType.current !== "mouse") setOpen((o) => !o); }}
                className="inline-block"
            >
                {children}
            </span>
            {open && (
                <div
                    ref={tipRef}
                    role="tooltip"
                    style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 60, maxWidth, whiteSpace: "pre-line" }}
                    className={`bg-[#111111] text-white font-mono border border-black shadow-md pointer-events-none ${dense ? "text-[10.5px] leading-snug px-2.5 py-1.5" : "text-xs leading-relaxed px-3 py-2"}`}
                >
                    {text}
                </div>
            )}
        </>
    );
}
