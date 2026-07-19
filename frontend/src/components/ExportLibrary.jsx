import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Download, Share2, Trash2, UploadCloud, Play, Check, Pencil, Loader2, Film } from "lucide-react";
import { toast } from "sonner";
import { listMediaItems, updateMediaItem, deleteMediaItems, clearMediaItems } from "@/lib/mediaLibrary";
import { exportUpload, exportPublicUrl } from "@/lib/api";

const fmtSize = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

const ItemPreview = ({ item }) => {
    const url = useMemo(() => (item.blob ? URL.createObjectURL(item.blob) : item.cloudUrl), [item]);
    useEffect(() => () => { if (item.blob && url) URL.revokeObjectURL(url); }, [url, item.blob]);
    if (!url) return <div className="text-sm text-[#4A4A4A]">Sin vista previa</div>;
    if ((item.mime || "").startsWith("video/")) return <video src={url} controls autoPlay className="w-full max-h-[60vh] bg-black" data-testid="export-preview-video" />;
    if ((item.mime || "").startsWith("image/")) return <img src={url} alt={item.name} className="w-full max-h-[60vh] object-contain" />;
    if (item.mime === "application/pdf") return <iframe title={item.name} src={url} className="w-full h-[60vh] border border-black/20" />;
    return <a href={url} download={item.name} className="underline">Descargar {item.name}</a>;
};

// Generic export/media library modal. Reusable for timeline clips now and for
// thesis/trend documents (PDF/Word/Google Doc) later — just pass a different `kind`.
export const ExportLibrary = ({ open, onClose, kind = "timeline-clip", title = "Exportaciones" }) => {
    const [items, setItems] = useState([]);
    const [sel, setSel] = useState(new Set());
    const [preview, setPreview] = useState(null);
    const [editing, setEditing] = useState(null);
    const [editName, setEditName] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try { setItems(await listMediaItems(kind)); }
        finally { setLoading(false); }
    }, [kind]);

    useEffect(() => { if (open) { refresh(); setSel(new Set()); } }, [open, refresh]);

    if (!open) return null;

    const allSelected = items.length > 0 && sel.size === items.length;
    const toggleAll = () => setSel(allSelected ? new Set() : new Set(items.map((i) => i.id)));
    const toggleOne = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const selectedItems = items.filter((i) => sel.has(i.id));

    const downloadItem = (item) => {
        const url = URL.createObjectURL(item.blob);
        const a = document.createElement("a");
        const ext = (item.mime || "").split("/")[1] || "bin";
        a.href = url; a.download = `${item.name}.${ext}`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    };
    const downloadSelected = () => {
        if (!selectedItems.length) return toast.error("Selecciona al menos un elemento");
        selectedItems.forEach(downloadItem);
        toast.success(`Descargando ${selectedItems.length} archivo(s)`);
    };

    const ensureCloud = async (item) => {
        if (item.cloudUrl) return item.cloudUrl;
        const res = await exportUpload(item.blob, item.name, kind);
        const url = exportPublicUrl(res.token);
        await updateMediaItem(item.id, { cloudUrl: url });
        return url;
    };

    const uploadSelected = async () => {
        if (!selectedItems.length) return toast.error("Selecciona al menos un elemento");
        setBusy(true);
        try {
            for (const it of selectedItems) await ensureCloud(it);
            await refresh();
            toast.success("Subido a la nube · enlace disponible para compartir");
        } catch (e) { toast.error(e?.response?.data?.detail || "Error al subir a la nube"); }
        finally { setBusy(false); }
    };

    const shareItem = async (item) => {
        setBusy(true);
        try {
            const ext = (item.mime || "").split("/")[1] || "bin";
            const file = new File([item.blob], `${item.name}.${ext}`, { type: item.mime });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: item.name, text: item.name });
            } else {
                const url = await ensureCloud(item);
                await refresh();
                if (navigator.share) await navigator.share({ title: item.name, text: item.name, url });
                else { await navigator.clipboard.writeText(url); toast.success("Enlace copiado al portapapeles"); }
            }
        } catch (e) { if (e?.name !== "AbortError") toast.error("No se pudo compartir"); }
        finally { setBusy(false); }
    };

    const saveName = async (item) => {
        const name = (editName || "").trim() || item.name;
        await updateMediaItem(item.id, { name });
        setEditing(null);
        await refresh();
    };

    const deleteSelected = async () => {
        if (!selectedItems.length) return toast.error("Selecciona al menos un elemento");
        await deleteMediaItems(selectedItems.map((i) => i.id));
        setSel(new Set());
        await refresh();
        toast.success("Eliminado(s)");
    };
    const deleteAll = async () => {
        const n = await clearMediaItems(kind);
        setSel(new Set());
        await refresh();
        toast.success(`${n} elemento(s) borrados`);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" data-testid="export-library">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white border-2 border-black w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Film size={16} />
                        <h2 className="font-serif text-xl">{title}</h2>
                        <span className="font-mono text-xs text-[#4A4A4A]">· {items.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {items.length > 0 && (
                            <button onClick={deleteAll} className="text-xs font-mono px-2 py-1 border border-[#B32A22] text-[#B32A22] hover:bg-[#B32A22] hover:text-white transition flex items-center gap-1" data-testid="export-delete-all">
                                <Trash2 size={12} /> Borrar todo
                            </button>
                        )}
                        <button onClick={onClose} className="p-1 hover:bg-black/5" data-testid="export-close"><X size={18} /></button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-[#4A4A4A]"><Loader2 className="animate-spin mr-2" size={18} /> Cargando…</div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-16 text-[#4A4A4A] font-sans text-sm">Aún no hay elementos guardados.</div>
                    ) : (
                        <>
                            <label className="flex items-center gap-2 mb-3 text-xs font-mono cursor-pointer">
                                <input type="checkbox" checked={allSelected} onChange={toggleAll} data-testid="export-select-all" />
                                Seleccionar todo ({sel.size}/{items.length})
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {items.map((item) => (
                                    <div key={item.id} className={`border ${sel.has(item.id) ? "border-[#052049] ring-1 ring-[#052049]" : "border-black/20"} bg-[#FAF6EE] flex flex-col`} data-testid={`export-item-${item.id}`}>
                                        <div className="relative group cursor-pointer bg-black/5 aspect-video flex items-center justify-center overflow-hidden" onClick={() => setPreview(item)}>
                                            {item.thumbnail ? <img src={item.thumbnail} alt={item.name} className="w-full h-full object-cover" /> : <Film size={28} className="text-black/30" />}
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition">
                                                <Play size={26} className="text-white opacity-0 group-hover:opacity-100 transition" fill="#fff" />
                                            </div>
                                            <label className="absolute top-1.5 left-1.5" onClick={(e) => e.stopPropagation()}>
                                                <input type="checkbox" checked={sel.has(item.id)} onChange={() => toggleOne(item.id)} data-testid={`export-select-${item.id}`} />
                                            </label>
                                            {item.cloudUrl && <span className="absolute top-1.5 right-1.5 bg-[#1D7044] text-white text-[9px] px-1 py-0.5 rounded-sm">NUBE</span>}
                                        </div>
                                        <div className="p-2">
                                            {editing === item.id ? (
                                                <div className="flex items-center gap-1">
                                                    <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveName(item)} autoFocus className="border border-black/40 text-xs px-1 py-0.5 w-full font-mono" data-testid={`export-name-input-${item.id}`} />
                                                    <button onClick={() => saveName(item)} className="text-[#1D7044]" data-testid={`export-name-save-${item.id}`}><Check size={14} /></button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 group/name">
                                                    <span className="text-xs font-mono truncate flex-1" title={item.name}>{item.name}</span>
                                                    <button onClick={() => { setEditing(item.id); setEditName(item.name); }} className="text-[#4A4A4A] hover:text-black" data-testid={`export-rename-${item.id}`}><Pencil size={12} /></button>
                                                </div>
                                            )}
                                            <div className="text-[10px] text-[#7A7A7A] font-mono mt-0.5">{fmtSize(item.size)} · {fmtDate(item.createdAt)}</div>
                                            <div className="flex items-center gap-1 mt-2">
                                                <button onClick={() => downloadItem(item)} title="Descargar" className="flex-1 border border-black/30 hover:bg-black hover:text-white transition py-1 flex items-center justify-center" data-testid={`export-download-${item.id}`}><Download size={13} /></button>
                                                <button onClick={() => shareItem(item)} disabled={busy} title="Compartir" className="flex-1 border border-black/30 hover:bg-black hover:text-white transition py-1 flex items-center justify-center disabled:opacity-40" data-testid={`export-share-${item.id}`}><Share2 size={13} /></button>
                                                <button onClick={async () => { await deleteMediaItems([item.id]); await refresh(); }} title="Borrar" className="flex-1 border border-[#B32A22]/40 text-[#B32A22] hover:bg-[#B32A22] hover:text-white transition py-1 flex items-center justify-center" data-testid={`export-delete-${item.id}`}><Trash2 size={13} /></button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer bulk actions */}
                {items.length > 0 && (
                    <div className="border-t-2 border-black px-4 py-3 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-[#4A4A4A] mr-auto">{sel.size} seleccionado(s)</span>
                        <button onClick={downloadSelected} className="text-xs font-mono px-3 py-1.5 border border-black hover:bg-black hover:text-white transition flex items-center gap-1.5" data-testid="export-download-selected"><Download size={13} /> Descargar</button>
                        <button onClick={uploadSelected} disabled={busy} className="text-xs font-mono px-3 py-1.5 border border-black hover:bg-black hover:text-white transition flex items-center gap-1.5 disabled:opacity-40" data-testid="export-upload-selected">{busy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} Subir a la nube</button>
                        <button onClick={deleteSelected} className="text-xs font-mono px-3 py-1.5 border border-[#B32A22] text-[#B32A22] hover:bg-[#B32A22] hover:text-white transition flex items-center gap-1.5" data-testid="export-delete-selected"><Trash2 size={13} /> Borrar</button>
                    </div>
                )}
            </div>

            {/* Preview overlay */}
            {preview && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" data-testid="export-preview">
                    <div className="absolute inset-0 bg-black/70" onClick={() => setPreview(null)} />
                    <div className="relative bg-white border-2 border-black w-full max-w-3xl">
                        <div className="flex items-center justify-between border-b border-black px-3 py-2">
                            <span className="font-mono text-sm truncate">{preview.name}</span>
                            <button onClick={() => setPreview(null)} className="p-1 hover:bg-black/5"><X size={16} /></button>
                        </div>
                        <div className="p-3"><ItemPreview item={preview} /></div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExportLibrary;
