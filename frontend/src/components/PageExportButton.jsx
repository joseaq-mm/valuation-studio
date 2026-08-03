import React, { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

// One-click snapshot of the current page's main content as a PDF.
export default function PageExportButton() {
    const [busy, setBusy] = useState(false);

    const exportPage = async () => {
        setBusy(true);
        try {
            const html2pdf = (await import("html2pdf.js")).default;
            const el = document.querySelector("main") || document.body;
            const path = (window.location.pathname || "/").replace(/^\/+|\/+$/g, "");
            const slug = (path || "inicio").replace(/[^\w]+/g, "-").slice(0, 50);
            await html2pdf().set({
                margin: [8, 8, 8, 8],
                filename: `valuation-studio-${slug}.pdf`,
                image: { type: "jpeg", quality: 0.95 },
                html2canvas: { scale: 2, useCORS: true, backgroundColor: "#FDF1E6", scrollX: 0, scrollY: -window.scrollY },
                jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
                pagebreak: { mode: ["avoid-all", "css", "legacy"] },
            }).from(el).save();
        } catch {
            toast.error("No se pudo generar el PDF de la página");
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            onClick={exportPage}
            disabled={busy}
            data-testid="page-export-pdf"
            className="text-xs uppercase tracking-[0.12em] font-semibold px-2.5 py-1 border border-black bg-white hover:bg-black hover:text-white transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            title="Descargar esta página en PDF (captura de pantalla)"
        >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} PDF
        </button>
    );
}
