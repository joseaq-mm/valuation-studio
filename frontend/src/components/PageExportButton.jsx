import React, { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ShareMenu from "@/components/ShareMenu";
import { shareUpload } from "@/lib/api";

function pageSlug() {
    const path = (window.location.pathname || "/").replace(/^\/+|\/+$/g, "");
    return (path || "inicio").replace(/[^\w]+/g, "-").slice(0, 50);
}

async function buildPagePdfBlob() {
    const html2pdf = (await import("html2pdf.js")).default;
    const el = document.querySelector("main") || document.body;
    const opts = {
        margin: [8, 8, 8, 8],
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#FDF1E6", scrollX: 0, scrollY: -window.scrollY },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };
    return await html2pdf().set(opts).from(el).outputPdf("blob");
}

// One-click snapshot of the current page's main content as a PDF, plus Share.
export default function PageExportButton() {
    const [busy, setBusy] = useState(false);

    const exportPage = async () => {
        setBusy(true);
        try {
            const blob = await buildPagePdfBlob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `valuation-studio-${pageSlug()}.pdf`;
            document.body.appendChild(a); a.click(); a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            toast.error("No se pudo generar el PDF de la página");
        } finally { setBusy(false); }
    };

    return (
        <div className="inline-flex items-center gap-1">
            <ShareMenu
                size="md"
                title={`Valuation Studio · ${pageSlug()}`}
                testidPrefix="page-share"
                createShare={async () => shareUpload(await buildPagePdfBlob(), "pdf", `Valuation Studio ${pageSlug()}`)}
            />
            <button
                onClick={exportPage}
                disabled={busy}
                data-testid="page-export-pdf"
                className="text-xs uppercase tracking-[0.12em] font-semibold px-2.5 py-1 border border-black bg-white hover:bg-black hover:text-white transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                title="Descargar esta página en PDF (captura de pantalla)"
            >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} PDF
            </button>
        </div>
    );
}
