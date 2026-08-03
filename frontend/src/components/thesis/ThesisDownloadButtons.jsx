import React, { useState } from "react";
import { FileText, FileType2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { thesisExport } from "@/lib/api";

function filenameFromDisposition(disposition, fallback) {
    if (!disposition) return fallback;
    const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (m) {
        try { return decodeURIComponent(m[1]); } catch { return fallback; }
    }
    const m2 = /filename="?([^";]+)"?/i.exec(disposition);
    return m2 ? m2[1] : fallback;
}

/** Two always-visible buttons that download a saved thesis (company / tendencia)
 *  as PDF or Word (.docx). Requires a persisted thesis id (auth Bearer via api.js). */
export default function ThesisDownloadButtons({ thesisId, title, className = "" }) {
    const [busy, setBusy] = useState(null); // "pdf" | "docx" | null
    if (!thesisId) return null;

    const download = async (fmt) => {
        setBusy(fmt);
        try {
            const res = await thesisExport(thesisId, fmt);
            const disp = res.headers?.["content-disposition"];
            const fname = filenameFromDisposition(disp, `${title || "tesis"}.${fmt}`);
            const url = window.URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url;
            a.download = fname;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            toast.error("No se pudo descargar el documento. Inténtalo de nuevo.");
        } finally {
            setBusy(null);
        }
    };

    const base = "inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] font-semibold border border-black px-3 py-2 hover:bg-[#F5E4D4] transition-colors disabled:opacity-60";

    return (
        <div className={`flex items-center gap-2 ${className}`} data-testid="thesis-download-buttons">
            <button
                onClick={() => download("pdf")}
                disabled={!!busy}
                className={base}
                data-testid="thesis-download-pdf"
                title="Descargar en PDF"
            >
                {busy === "pdf" ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Descargar PDF
            </button>
            <button
                onClick={() => download("docx")}
                disabled={!!busy}
                className={base}
                data-testid="thesis-download-docx"
                title="Descargar en Word (.docx, compatible con Google Docs)"
            >
                {busy === "docx" ? <Loader2 size={13} className="animate-spin" /> : <FileType2 size={13} />} Descargar Word
            </button>
        </div>
    );
}
