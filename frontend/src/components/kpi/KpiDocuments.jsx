import React, { useState, useEffect, useRef, useCallback } from "react";
import { FileText, Image as ImageIcon, FileType, Upload, Trash2, Loader2, AlertCircle, ClipboardPaste, Pencil, Check, X, DownloadCloud, Download, RotateCw } from "lucide-react";
import { kpiFilesList, kpiFileUpload, kpiTranscriptAdd, kpiFileToggle, kpiFileUpdate, kpiFileDelete, kpiFileDownload, kpiFileRetry } from "@/lib/api";
import { toast } from "sonner";

const fileIcon = (f) => {
    if (f.kind === "transcript") return ClipboardPaste;
    if ((f.content_type || "").includes("pdf")) return FileType;
    if ((f.content_type || "").startsWith("image/")) return ImageIcon;
    return FileText;
};
const fmtSize = (b) => (b == null ? "" : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

// Per-company document sources for KPI analysis: upload PDF/images (pre-extracted
// by AI on upload), paste a transcript, select which to use, delete obsolete.
export default function KpiDocuments({ companyId }) {
    const [files, setFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [tOpen, setTOpen] = useState(false);
    const [tText, setTText] = useState("");
    const [tTitle, setTTitle] = useState("");
    const [editId, setEditId] = useState(null);
    const [editName, setEditName] = useState("");
    const [editDesc, setEditDesc] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef(null);
    const dragDepth = useRef(0);

    const load = useCallback(async () => {
        try { const d = await kpiFilesList(companyId); setFiles(d.files || []); }
        catch { setFiles([]); }
    }, [companyId]);

    useEffect(() => { load(); }, [load]);

    // Poll while any file is still being processed (pre-extraction).
    useEffect(() => {
        if (!files.some((f) => f.status === "processing")) return;
        const t = setInterval(load, 3000);
        return () => clearInterval(t);
    }, [files, load]);

    const ACCEPT = /(pdf|image\/(png|jpe?g|webp|gif))/i;
    const uploadOne = async (file) => {
        if (file.size > 100 * 1024 * 1024) { toast.error(`"${file.name}" supera 100 MB`); return false; }
        if (file.type && !ACCEPT.test(file.type)) { toast.error(`"${file.name}": formato no admitido (solo PDF o imagen)`); return false; }
        try {
            const d = await kpiFileUpload(companyId, file);
            setFiles((prev) => [d.file, ...prev]);
            return true;
        } catch (err) {
            toast.error(err?.response?.data?.detail || `Error al subir "${file.name}"`);
            return false;
        }
    };

    const uploadFiles = useCallback(async (fileList) => {
        const incoming = Array.from(fileList || []);
        if (!incoming.length) return;
        // Respect the 10-file cap using the freshest count.
        let slots = 10 - files.length;
        if (slots <= 0) { toast.error("Máximo 10 documentos por empresa"); return; }
        const toUpload = incoming.slice(0, slots);
        if (incoming.length > toUpload.length) toast.info(`Solo se subirán ${toUpload.length} (máx. 10 por empresa)`);
        setUploading(true);
        let ok = 0;
        for (const f of toUpload) { if (await uploadOne(f)) ok += 1; }
        setUploading(false);
        if (ok) toast.success(ok === 1 ? "Archivo subido · leyéndolo con IA…" : `${ok} archivos subidos · leyéndolos con IA…`);
    }, [companyId, files.length]);

    const onPick = (e) => {
        const list = e.target.files;
        e.target.value = "";
        uploadFiles(list);
    };

    const onDragEnter = (e) => { e.preventDefault(); dragDepth.current += 1; setDragOver(true); };
    const onDragOver = (e) => { e.preventDefault(); };
    const onDragLeave = (e) => { e.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragOver(false); } };
    const onDrop = (e) => {
        e.preventDefault();
        dragDepth.current = 0; setDragOver(false);
        if (uploading || files.length >= 10) { if (files.length >= 10) toast.error("Máximo 10 documentos por empresa"); return; }
        uploadFiles(e.dataTransfer?.files);
    };

    const addTranscript = async () => {
        if (tText.trim().length < 20) { toast.error("Pega un transcript más completo"); return; }
        try {
            const d = await kpiTranscriptAdd(companyId, tText.trim(), tTitle.trim() || "Transcript");
            setFiles((prev) => [d.file, ...prev]);
            setTText(""); setTTitle(""); setTOpen(false);
            toast.success("Transcript añadido");
        } catch (err) { toast.error(err?.response?.data?.detail || "Error"); }
    };

    const toggle = async (f) => {
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, selected: !x.selected } : x)));
        try { await kpiFileToggle(companyId, f.id, !f.selected); }
        catch { load(); }
    };

    const remove = async (f) => {
        setFiles((prev) => prev.filter((x) => x.id !== f.id));
        try { await kpiFileDelete(companyId, f.id); toast.success("Archivo borrado"); }
        catch { load(); }
    };

    const retry = async (f) => {
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, status: "processing", error: null } : x)));
        try { await kpiFileRetry(companyId, f.id); toast.info("Reintentando lectura del documento…"); }
        catch (err) { toast.error(err?.response?.data?.detail || "No se pudo reintentar la lectura"); load(); }
    };

    const startEdit = (f) => { setEditId(f.id); setEditName(f.display_name || f.original_filename || ""); setEditDesc(f.description || ""); };
    const cancelEdit = () => { setEditId(null); setEditName(""); setEditDesc(""); };
    const saveEdit = async (f) => {
        const name = editName.trim();
        try {
            const d = await kpiFileUpdate(companyId, f.id, { display_name: name || f.original_filename, description: editDesc.trim() });
            setFiles((prev) => prev.map((x) => (x.id === f.id ? d.file : x)));
            cancelEdit();
            toast.success("Guardado");
        } catch { toast.error("No se pudo guardar"); }
    };

    const download = async (f) => {
        try {
            const resp = await kpiFileDownload(companyId, f.id);
            const url = URL.createObjectURL(resp.data);
            const a = document.createElement("a");
            a.href = url;
            a.download = f.display_name || f.original_filename || "documento";
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch { toast.error("No se pudo descargar"); }
    };

    const keepBoth = async (f) => {
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, supersedes: null } : x)));
        try { await kpiFileUpdate(companyId, f.id, { dismiss_supersedes: true }); }
        catch { load(); }
    };

    const deleteOld = async (f) => {
        const oldId = f.supersedes?.id;
        if (!oldId) return;
        setFiles((prev) => prev.filter((x) => x.id !== oldId).map((x) => (x.id === f.id ? { ...x, supersedes: null } : x)));
        try {
            await kpiFileDelete(companyId, oldId);
            await kpiFileUpdate(companyId, f.id, { dismiss_supersedes: true });
            toast.success("Documento antiguo borrado");
        } catch { load(); }
    };

    return (
        <div
            className={`relative border bg-white p-3 mb-4 transition-colors ${dragOver ? "border-[#052049] border-dashed bg-[#F4F6FA]" : "border-black/20"}`}
            data-testid="kpi-documents"
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {dragOver && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#F4F6FA]/85 border-2 border-dashed border-[#052049] pointer-events-none" data-testid="kpi-drop-overlay">
                    <div className="text-[#052049] font-semibold inline-flex items-center gap-2"><Upload size={18} /> Suelta para subir (PDF/imagen)</div>
                </div>
            )}
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5"><FileText size={13} /> Documentos como fuente ({files.length}/10)</div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setTOpen((v) => !v)} className="btn-ghost !py-1 !px-2.5 inline-flex items-center gap-1.5 text-xs" data-testid="kpi-transcript-toggle">
                        <ClipboardPaste size={13} /> Pegar transcript
                    </button>
                    <button onClick={() => inputRef.current?.click()} disabled={uploading || files.length >= 10} className="btn-primary !py-1 !px-2.5 inline-flex items-center gap-1.5 text-xs disabled:opacity-40" data-testid="kpi-upload-btn">
                        {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir PDF/imagen
                    </button>
                    <input ref={inputRef} type="file" multiple accept=".pdf,image/png,image/jpeg,image/webp,image/gif" onChange={onPick} className="hidden" data-testid="kpi-file-input" />
                </div>
            </div>

            <p className="text-[11px] text-[#7A7A7A] mb-2">Sube presentaciones o gráficos (máx. 100 MB, 10 por empresa) <strong>o arrástralos aquí</strong>. Al analizar, la app también <strong>descarga sola</strong> el deck/comunicado oficial de resultados si lo encuentra (marcado <span className="text-[#052049] font-semibold">«Auto · web»</span>). La IA los lee y usa los <strong>seleccionados</strong> al analizar/buscar KPIs.</p>

            {tOpen && (
                <div className="border border-[#052049]/30 bg-[#F4F6FA] p-2.5 mb-2" data-testid="kpi-transcript-box">
                    <input value={tTitle} onChange={(e) => setTTitle(e.target.value)} placeholder="Título (p. ej. Earnings call Q4 2025)" className="w-full border border-black/30 bg-white px-2 py-1 text-sm mb-1.5 outline-none" data-testid="kpi-transcript-title" />
                    <textarea value={tText} onChange={(e) => setTText(e.target.value)} rows={4} placeholder="Pega aquí el transcript de la llamada de resultados…" className="w-full border border-black/30 bg-white px-2 py-1 text-sm outline-none resize-y" data-testid="kpi-transcript-text" />
                    <div className="flex justify-end gap-2 mt-1.5">
                        <button onClick={() => { setTOpen(false); setTText(""); }} className="btn-ghost !py-1 !px-2.5 text-xs">Cancelar</button>
                        <button onClick={addTranscript} className="btn-primary !py-1 !px-2.5 text-xs" data-testid="kpi-transcript-save">Añadir</button>
                    </div>
                </div>
            )}

            {files.length === 0 ? (
                <div className="text-xs text-[#9A9A9A] py-3 text-center border border-dashed border-black/20">Sin documentos. Arrastra aquí un PDF/imagen, súbelo con el botón o pega un transcript.</div>
            ) : (
                <ul className="space-y-1" data-testid="kpi-files-list">
                    {files.map((f) => {
                        const Icon = fileIcon(f);
                        const isEd = editId === f.id;
                        return (
                            <li key={f.id} className="flex items-start gap-2 border border-black/10 px-2 py-1.5 text-sm" data-testid={`kpi-file-${f.id}`}>
                                <input type="checkbox" checked={!!f.selected} onChange={() => toggle(f)} disabled={f.status !== "ready"} className="accent-[#052049] mt-0.5" data-testid={`kpi-file-toggle-${f.id}`} title="Usar como fuente" />
                                <Icon size={15} className="text-[#4A4A4A] shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                    {isEd ? (
                                        <div className="space-y-1">
                                            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nombre del documento" className="w-full border border-black/30 bg-white px-2 py-1 text-sm outline-none" data-testid={`kpi-file-edit-name-${f.id}`} />
                                            <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Descripción (p. ej. Deck resultados Q4 2025)" className="w-full border border-black/30 bg-white px-2 py-1 text-xs outline-none" data-testid={`kpi-file-edit-desc-${f.id}`} />
                                            <div className="flex gap-2 justify-end">
                                                <button onClick={cancelEdit} className="text-xs text-[#4A4A4A] inline-flex items-center gap-1"><X size={12} /> Cancelar</button>
                                                <button onClick={() => saveEdit(f)} className="text-xs text-[#1D7044] font-semibold inline-flex items-center gap-1" data-testid={`kpi-file-save-${f.id}`}><Check size={12} /> Guardar</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="truncate font-medium leading-tight flex items-center gap-1.5">
                                                {f.display_name || f.original_filename}
                                                {f.auto_fetched && (
                                                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#052049] bg-[#E7EDF6] border border-[#052049]/30 px-1 py-0.5" data-testid={`kpi-file-auto-${f.id}`} title="Descargado automáticamente por la app">
                                                        <DownloadCloud size={10} /> Auto · web
                                                    </span>
                                                )}
                                            </div>
                                            {f.description && <div className="text-[11px] text-[#4A4A4A] leading-snug">{f.description}</div>}
                                            <div className="text-[11px] text-[#9A9A9A]">
                                                {fmtSize(f.size)}
                                                {f.auto_fetched && f.source_url && (
                                                    <a href={f.source_url} target="_blank" rel="noreferrer" className="text-[#052049] ml-1 hover:underline inline-flex items-center gap-0.5">· fuente</a>
                                                )}
                                                {f.status === "processing" && <span className="text-[#B8860B] ml-1 inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> leyendo…</span>}
                                                {f.status === "ready" && f.has_text && <span className="text-[#1D7044] ml-1">· listo</span>}
                                                {f.status === "error" && <span className="text-[#B32A22] ml-1 inline-flex items-center gap-1"><AlertCircle size={10} /> {f.error || "error"}</span>}
                                            </div>
                                            {f.status === "error" && f.downloadable && (
                                                <button onClick={() => retry(f)} className="mt-1 text-[11px] text-[#052049] font-semibold inline-flex items-center gap-1 hover:underline" data-testid={`kpi-file-retry-${f.id}`}>
                                                    <RotateCw size={11} /> Reintentar lectura
                                                </button>
                                            )}
                                            {f.supersedes && (
                                                <div className="mt-1.5 text-[11px] bg-[#FFF8E6] border border-[#B8860B]/40 px-2 py-1.5" data-testid={`kpi-file-supersedes-${f.id}`}>
                                                    <div className="text-[#7a5c00] leading-snug">Parece una versión más reciente de «<strong>{f.supersedes.name}</strong>». ¿Mantener ambos o borrar el antiguo?</div>
                                                    <div className="flex gap-2 mt-1">
                                                        <button onClick={() => keepBoth(f)} className="text-[#4A4A4A] hover:underline" data-testid={`kpi-file-keepboth-${f.id}`}>Mantener ambos</button>
                                                        <button onClick={() => deleteOld(f)} className="text-[#B32A22] font-semibold hover:underline" data-testid={`kpi-file-deleteold-${f.id}`}>Borrar el antiguo</button>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                {!isEd && f.downloadable && (
                                    <button onClick={() => download(f)} className="text-[#4A4A4A] hover:bg-black/5 p-1 shrink-0" title="Descargar" data-testid={`kpi-file-download-${f.id}`}>
                                        <Download size={14} />
                                    </button>
                                )}
                                {!isEd && (
                                    <button onClick={() => startEdit(f)} className="text-[#4A4A4A] hover:bg-black/5 p-1 shrink-0" title="Renombrar / describir" data-testid={`kpi-file-edit-${f.id}`}>
                                        <Pencil size={13} />
                                    </button>
                                )}
                                <button onClick={() => remove(f)} className="text-[#B32A22] hover:bg-[#B32A22]/10 p-1 shrink-0" title="Borrar" data-testid={`kpi-file-delete-${f.id}`}>
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
