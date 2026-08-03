import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { shareMeta, shareFileUrl } from "@/lib/api";
import { Download, FileText, AlertTriangle, Loader2 } from "lucide-react";

// Public, login-free viewer for a shared document. Previews PDF and JPG inline;
// Word (.docx) is download-only. Shows nothing of the user's private app.
export default function ShareView() {
    const { token } = useParams();
    const [meta, setMeta] = useState(null);
    const [state, setState] = useState("loading"); // loading | ok | expired | error

    useEffect(() => {
        let alive = true;
        shareMeta(token)
            .then((m) => { if (!alive) return; setMeta(m); setState(m.expired ? "expired" : "ok"); })
            .catch(() => { if (alive) setState("error"); });
        return () => { alive = false; };
    }, [token]);

    const fileUrl = shareFileUrl(token);
    const dlUrl = shareFileUrl(token, true);
    const fmt = meta?.format;

    return (
        <div className="min-h-screen bg-[#FDF1E6] text-[#111] flex flex-col" data-testid="share-view">
            <header className="border-b border-black/15 px-4 py-3 flex items-center justify-between bg-white/60 backdrop-blur">
                <div>
                    <div className="font-serif text-xl leading-none">Valuation Studio</div>
                    <div className="overline text-[#7A7A7A] text-[10px]">Documento compartido</div>
                </div>
                {state === "ok" && (
                    <a href={dlUrl} className="text-xs uppercase tracking-[0.12em] font-semibold px-3 py-2 border border-black bg-white hover:bg-black hover:text-white transition-colors inline-flex items-center gap-1.5" data-testid="share-view-download">
                        <Download size={14} /> Descargar
                    </a>
                )}
            </header>

            <main className="flex-1 flex flex-col">
                {state === "loading" && (
                    <div className="flex-1 flex items-center justify-center text-[#7A7A7A]"><Loader2 className="animate-spin mr-2" size={18} /> Cargando documento…</div>
                )}
                {state === "expired" && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6" data-testid="share-view-expired">
                        <AlertTriangle size={28} className="text-[#B8860B] mb-2" />
                        <div className="font-serif text-2xl mb-1">Enlace caducado</div>
                        <p className="text-sm text-[#4A4A4A] max-w-sm">Este enlace para compartir ha expirado (los enlaces caducan a los 15 días). Pide a quien te lo envió que genere uno nuevo.</p>
                    </div>
                )}
                {state === "error" && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6" data-testid="share-view-error">
                        <AlertTriangle size={28} className="text-[#B32A22] mb-2" />
                        <div className="font-serif text-2xl mb-1">Documento no encontrado</div>
                        <p className="text-sm text-[#4A4A4A] max-w-sm">El enlace no es válido o el documento ha sido eliminado.</p>
                    </div>
                )}
                {state === "ok" && (
                    <div className="flex-1 flex flex-col">
                        <div className="px-4 py-2 text-sm font-semibold border-b border-black/10 bg-white/40">{meta.title}</div>
                        {fmt === "pdf" && (
                            <iframe title={meta.title} src={fileUrl} className="flex-1 w-full border-0" data-testid="share-view-pdf" />
                        )}
                        {fmt === "jpg" && (
                            <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-[#e9dccb]">
                                <img src={fileUrl} alt={meta.title} className="max-w-full h-auto shadow-lg bg-white" data-testid="share-view-image" />
                            </div>
                        )}
                        {fmt === "docx" && (
                            <div className="flex-1 flex flex-col items-center justify-center text-center px-6" data-testid="share-view-docx">
                                <FileText size={40} className="text-[#2B579A] mb-3" />
                                <div className="font-serif text-2xl mb-1">Documento de Word</div>
                                <p className="text-sm text-[#4A4A4A] max-w-sm mb-4">Los archivos de Word (.docx) no se pueden previsualizar en el navegador. Se abre perfectamente en Word o Google Docs.</p>
                                <a href={dlUrl} className="btn-primary inline-flex items-center gap-2" data-testid="share-view-docx-download"><Download size={16} /> Descargar Word</a>
                            </div>
                        )}
                    </div>
                )}
            </main>
            <footer className="border-t border-black/10 px-4 py-2 text-[10px] text-[#9A9A9A] text-center">
                Compartido con Valuation Studio · Este enlace da acceso solo a este documento.
            </footer>
        </div>
    );
}
