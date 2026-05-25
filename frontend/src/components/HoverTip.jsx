import React, { useState, useRef, useLayoutEffect } from "react";

/**
 * Lightweight controlled tooltip. Uses fixed positioning + viewport clamping
 * so it never gets cut off by overflow. Supports multi-line text (via
 * whiteSpace: pre-line) — newlines in the `text` prop are rendered.
 */
export default function HoverTip({ text, children, maxWidth = 320 }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const wrapRef = useRef(null);
    const tipRef = useRef(null);

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

    if (!text) return children;
    return (
        <>
            <span
                ref={wrapRef}
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
                tabIndex={0}
                className="inline-block"
            >
                {children}
            </span>
            {open && (
                <div
                    ref={tipRef}
                    role="tooltip"
                    style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 60, maxWidth, whiteSpace: "pre-line" }}
                    className="bg-[#111111] text-white text-xs font-mono px-3 py-2 border border-black shadow-md leading-relaxed pointer-events-none"
                >
                    {text}
                </div>
            )}
        </>
    );
}
