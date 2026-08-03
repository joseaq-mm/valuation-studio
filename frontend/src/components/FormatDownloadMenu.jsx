import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

// Colour-coded text symbols so the current format is instantly recognisable.
const FMT = {
    pdf: { sym: "PDF", label: "PDF", color: "text-[#B32A22]" },
    docx: { sym: "W", label: "Word", color: "text-[#2B579A]" },
    jpg: { sym: "JPG", label: "JPG", color: "text-[#1D7044]" },
};

const SIZES = {
    sm: { sym: "text-[11px] min-w-[30px] px-1 py-0.5", caret: 14, gap: "" },
    md: { sym: "text-xs min-w-[38px] px-2 py-1", caret: 16, gap: "" },
};

function filenameFromDisposition(disp, fallback) {
    if (!disp) return fallback;
    const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
    if (m) { try { return decodeURIComponent(m[1]); } catch { return fallback; } }
    const m2 = /filename="?([^";]+)"?/i.exec(disp);
    return m2 ? m2[1] : fallback;
}

/** Split button: the symbol button downloads in the currently-selected format;
 *  the caret opens a menu to CHANGE the format (changing it does NOT download —
 *  the user presses the symbol again to download). */
export default function FormatDownloadMenu({
    formats, defaultFmt, fetcher, fallbackName = "documento",
    size = "sm", testids = {},
}) {
    const [fmt, setFmt] = useState(defaultFmt || formats[0]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const ref = useRef(null);
    const S = SIZES[size] || SIZES.sm;

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const doDownload = async () => {
        setBusy(true);
        try {
            const res = await fetcher(fmt);
            const fname = filenameFromDisposition(res.headers?.["content-disposition"], `${fallbackName}.${fmt}`);
            const url = URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url; a.download = fname;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo descargar en ese formato");
        } finally { setBusy(false); }
    };

    const meta = FMT[fmt] || FMT.pdf;

    return (
        <div className="relative shrink-0 flex items-center" ref={ref} data-testid={testids.menu}>
            <button
                onClick={doDownload}
                disabled={busy}
                title={`Descargar en ${meta.label}`}
                data-testid={testids.btn}
                className={`inline-flex items-center justify-center font-bold border border-black/50 hover:bg-black/5 transition-colors disabled:opacity-50 ${meta.color} ${S.sym}`}
            >
                {busy ? <Loader2 size={S.caret} className="animate-spin text-[#4A4A4A]" /> : meta.sym}
            </button>
            <button
                onClick={() => setOpen((v) => !v)}
                disabled={busy}
                title="Elegir formato"
                data-testid={testids.caret}
                className="text-[#7A7A7A] hover:bg-black/5 hover:text-black border border-l-0 border-black/50 p-0.5 disabled:opacity-50"
            >
                <ChevronDown size={S.caret} />
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-black/25 shadow-lg min-w-[130px]" data-testid={testids.optMenu}>
                    {formats.map((w) => {
                        const M = FMT[w] || FMT.pdf;
                        return (
                            <button
                                key={w}
                                onClick={() => { setFmt(w); setOpen(false); }}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[#F4F6FA] ${w === fmt ? "font-semibold text-black" : "text-[#4A4A4A]"}`}
                                data-testid={testids.opt ? testids.opt(w) : undefined}
                            >
                                <span className={`font-bold w-8 ${M.color}`}>{M.sym}</span> {M.label}
                                {w === fmt && <Check size={13} className="ml-auto" />}
                            </button>
                        );
                    })}
                    <div className="px-3 py-1 text-[10px] text-[#9A9A9A] border-t border-black/10 leading-snug">Elige y pulsa el símbolo para descargar</div>
                </div>
            )}
        </div>
    );
}
