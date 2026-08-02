import React, { useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

/**
 * Touch/mouse pinch-zoom + pan pane. Zooms its children visually with a CSS
 * transform (crisp for SVG charts and absolutely-positioned treemaps) without
 * re-laying-out the content.
 *  - Two fingers → pinch to zoom.
 *  - One finger while zoomed → pan. (At scale 1, single taps pass through so
 *    treemap cells / chart bubbles stay tappable.)
 *  - Double-tap → reset.
 *  - Buttons (+ / − / reset) for desktop and accessibility.
 */
const MIN = 1;
const MAX = 6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export default function PinchZoomPane({ children, className = "" }) {
    const wrapRef = useRef(null);
    const [t, setT] = useState({ scale: 1, x: 0, y: 0 });
    const tRef = useRef(t);
    tRef.current = t;
    const pointers = useRef(new Map());
    const gesture = useRef(null);
    const lastTap = useRef(0);

    const apply = (next) => {
        const scale = clamp(next.scale, MIN, MAX);
        if (scale <= MIN + 0.001) { setT({ scale: 1, x: 0, y: 0 }); return; }
        setT({ scale, x: next.x, y: next.y });
    };

    const zoomAt = useCallback((factor, cx, cy) => {
        const cur = tRef.current;
        const rect = wrapRef.current?.getBoundingClientRect();
        const px = cx == null ? (rect ? rect.width / 2 : 0) : cx - (rect?.left || 0);
        const py = cy == null ? (rect ? rect.height / 2 : 0) : cy - (rect?.top || 0);
        const scale = clamp(cur.scale * factor, MIN, MAX);
        const k = scale / cur.scale;
        apply({ scale, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k });
    }, []);

    const reset = () => setT({ scale: 1, x: 0, y: 0 });

    const onPointerDown = (e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
            const pts = [...pointers.current.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const rect = wrapRef.current.getBoundingClientRect();
            gesture.current = {
                type: "pinch", startDist: dist, startScale: tRef.current.scale,
                startX: tRef.current.x, startY: tRef.current.y,
                midX: (pts[0].x + pts[1].x) / 2 - rect.left,
                midY: (pts[0].y + pts[1].y) / 2 - rect.top,
            };
            wrapRef.current.setPointerCapture?.(e.pointerId);
        } else if (pointers.current.size === 1) {
            const now = Date.now();
            if (now - lastTap.current < 300) { reset(); lastTap.current = 0; }
            else lastTap.current = now;
            if (tRef.current.scale > 1) {
                gesture.current = { type: "pan", startX: tRef.current.x, startY: tRef.current.y, ox: e.clientX, oy: e.clientY };
                wrapRef.current.setPointerCapture?.(e.pointerId);
            }
        }
    };

    const onPointerMove = (e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = gesture.current;
        if (!g) return;
        if (g.type === "pinch" && pointers.current.size >= 2) {
            const pts = [...pointers.current.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const scale = clamp(g.startScale * (dist / (g.startDist || 1)), MIN, MAX);
            const k = scale / g.startScale;
            apply({ scale, x: g.midX - (g.midX - g.startX) * k, y: g.midY - (g.midY - g.startY) * k });
        } else if (g.type === "pan") {
            apply({ scale: tRef.current.scale, x: g.startX + (e.clientX - g.ox), y: g.startY + (e.clientY - g.oy) });
        }
    };

    const endPointer = (e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2 && gesture.current?.type === "pinch") gesture.current = null;
        if (pointers.current.size === 0) gesture.current = null;
    };

    const zoomed = t.scale > 1.001;
    return (
        <div className={`relative overflow-hidden ${className}`}>
            <div
                ref={wrapRef}
                className="w-full h-full"
                style={{ touchAction: zoomed ? "none" : "pan-y", cursor: zoomed ? "grab" : "default" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endPointer}
                onPointerCancel={endPointer}
                onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); } }}
            >
                <div style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`, transformOrigin: "0 0", width: "100%", height: "100%" }}>
                    {children}
                </div>
            </div>
            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-10" data-testid="pinch-zoom-controls">
                <button onClick={() => zoomAt(1.3)} className="w-9 h-9 flex items-center justify-center bg-white border border-black hover:bg-black hover:text-white transition-colors shadow" title="Acercar" data-testid="pinch-zoom-in"><ZoomIn size={16} /></button>
                <button onClick={() => zoomAt(1 / 1.3)} className="w-9 h-9 flex items-center justify-center bg-white border border-black hover:bg-black hover:text-white transition-colors shadow" title="Alejar" data-testid="pinch-zoom-out"><ZoomOut size={16} /></button>
                <button onClick={reset} disabled={!zoomed} className="w-9 h-9 flex items-center justify-center bg-white border border-black hover:bg-black hover:text-white transition-colors shadow disabled:opacity-40" title="Restablecer" data-testid="pinch-zoom-reset"><RotateCcw size={16} /></button>
            </div>
        </div>
    );
}
