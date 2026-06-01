import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, FolderPlus, Trash2, Loader2, TrendingUp, Building2, Folder } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
    thesisGenerate, thesisList, thesisFolders, thesisCreateFolder,
    thesisDeleteFolder, thesisAssignFolder, thesisDelete,
} from "@/lib/api";
import ThesisResult from "@/components/thesis/ThesisResult";

const EXAMPLES_TREND = ["Inteligencia artificial y centros de datos", "Transición energética y baterías", "GLP-1 y obesidad", "Defensa europea"];
const EXAMPLES_COMPANY = ["NVDA", "ASML", "Novo Nordisk", "Inditex"];

export default function Thesis() {
    const { user } = useAuth();
    const [mode, setMode] = useState("trend");
    const [subject, setSubject] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    const [folders, setFolders] = useState([]);
    const [saved, setSaved] = useState([]);
    const [newFolder, setNewFolder] = useState("");
    const [activeFolder, setActiveFolder] = useState("all");

    const reload = useCallback(async () => {
        if (!user) { setFolders([]); setSaved([]); return; }
        try {
            const [f, l] = await Promise.all([thesisFolders(), thesisList()]);
            setFolders(f.folders || []);
            setSaved(l.items || []);
        } catch { /* ignore */ }
    }, [user]);

    useEffect(() => { reload(); }, [reload]);

    const generate = async () => {
        const s = subject.trim();
        if (!s) { toast.error("Escribe una tendencia o empresa"); return; }
        setLoading(true);
        setResult(null);
        try {
            const data = await thesisGenerate(mode, s);
            setResult(data);
            reload();
        } catch (e) {
            const msg = e?.response?.data?.detail || "No se pudo generar la tesis. Inténtalo de nuevo.";
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    const createFolder = async () => {
        const n = newFolder.trim();
        if (!n) return;
        try {
            await thesisCreateFolder(n);
            setNewFolder("");
            toast.success("Carpeta creada");
            reload();
        } catch { toast.error("No se pudo crear la carpeta"); }
    };

    const assign = async (folderId) => {
        if (!result?.id) return;
        try {
            await thesisAssignFolder(result.id, folderId || null);
            setResult({ ...result, saved: true, folder_id: folderId || null });
            toast.success(folderId ? "Guardada en carpeta" : "Guardada");
            reload();
        } catch { toast.error("No se pudo guardar"); }
    };

    const removeFolder = async (id) => {
        try { await thesisDeleteFolder(id); reload(); if (activeFolder === id) setActiveFolder("all"); }
        catch { toast.error("No se pudo eliminar"); }
    };

    const removeThesis = async (id) => {
        try { await thesisDelete(id); reload(); toast.success("Tesis eliminada"); }
        catch { toast.error("No se pudo eliminar"); }
    };

    const examples = mode === "trend" ? EXAMPLES_TREND : EXAMPLES_COMPANY;
    const visibleSaved = saved.filter((t) => activeFolder === "all" ? true : t.folder_id === activeFolder);

    return (
        <div data-testid="thesis-page">
            <div className="mb-6">
                <div className="overline text-[#B32A22] mb-1">Thesis Engine · Análisis cualitativo con IA</div>
                <h1 className="font-serif text-4xl sm:text-5xl font-medium leading-tight">Tesis de inversión</h1>
                <p className="text-base text-[#4A4A4A] mt-2 max-w-2xl leading-relaxed">
                    Mapea megatendencias a su cadena de valor y a las empresas líderes con un score cualitativo —
                    o parte de una empresa y descubre en qué tendencias encaja. Búsqueda web en vivo +
                    GPT-5.2 (investigador) + Claude (sintetizador).
                </p>
            </div>

            <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
                {/* Main column */}
                <div className="order-2 lg:order-1">
                    {/* Generator */}
                    <div className="border border-black bg-white p-5 mb-6" data-testid="thesis-generator">
                        <div className="flex gap-0 mb-4 border border-black w-fit">
                            <button
                                onClick={() => { setMode("trend"); setResult(null); }}
                                className={`px-4 py-2 text-xs uppercase tracking-[0.12em] font-semibold flex items-center gap-2 transition-colors ${mode === "trend" ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                                data-testid="mode-trend"
                            >
                                <TrendingUp size={14} /> Tendencia → Empresas
                            </button>
                            <button
                                onClick={() => { setMode("company"); setResult(null); }}
                                className={`px-4 py-2 text-xs uppercase tracking-[0.12em] font-semibold flex items-center gap-2 transition-colors border-l border-black ${mode === "company" ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                                data-testid="mode-company"
                            >
                                <Building2 size={14} /> Empresa → Tendencias
                            </button>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && !loading && generate()}
                                placeholder={mode === "trend" ? "Ej.: Inteligencia artificial y centros de datos" : "Ej.: NVDA, ASML, Inditex…"}
                                className="flex-1 px-3 py-2.5 border border-black outline-none font-mono text-sm bg-white"
                                data-testid="thesis-input"
                                disabled={loading}
                            />
                            <button onClick={generate} disabled={loading} className="btn-primary flex items-center justify-center gap-2 !px-5" data-testid="thesis-generate-btn">
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                {loading ? "Generando…" : "Generar tesis"}
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-3 items-center">
                            <span className="overline text-[#4A4A4A]">Prueba:</span>
                            {examples.map((ex) => (
                                <button key={ex} onClick={() => setSubject(ex)} disabled={loading}
                                        className="text-xs border border-black/30 px-2 py-1 hover:bg-[#F5E4D4] transition-colors font-mono">
                                    {ex}
                                </button>
                            ))}
                        </div>

                        {loading && (
                            <div className="mt-4 text-xs text-[#4A4A4A] flex items-center gap-2" data-testid="thesis-loading">
                                <Loader2 size={13} className="animate-spin" />
                                Buscando en la web e investigando con IA… esto puede tardar ~1 minuto.
                            </div>
                        )}
                    </div>

                    {/* Save bar */}
                    {result && user && (
                        <div className="border border-black bg-[#F5E4D4] p-3 mb-6 flex items-center gap-3 flex-wrap" data-testid="thesis-save-bar">
                            <span className="overline text-[#4A4A4A]">Guardar en carpeta</span>
                            <select
                                value={result.folder_id || ""}
                                onChange={(e) => assign(e.target.value)}
                                className="border border-black bg-white px-2 py-1.5 text-sm outline-none"
                                data-testid="thesis-folder-select"
                            >
                                <option value="">— Sin carpeta —</option>
                                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                            {result.id && <Link to={`/thesis/${result.id}`} className="text-xs text-[#052049] hover:underline">Ver en detalle →</Link>}
                        </div>
                    )}
                    {result && !user && (
                        <div className="border border-[#B32A22]/40 bg-white p-3 mb-6 text-sm" data-testid="thesis-login-hint">
                            Inicia sesión con Google (botón <span className="font-semibold">Entrar</span> arriba) para guardar esta tesis en carpetas.
                        </div>
                    )}

                    {/* Result */}
                    {result ? <ThesisResult thesis={result} /> : !loading && (
                        <div className="border border-dashed border-black/30 p-10 text-center text-[#4A4A4A]" data-testid="thesis-empty">
                            <Sparkles size={28} className="mx-auto mb-3 opacity-50" />
                            <p className="text-sm">Genera tu primera tesis cualitativa.</p>
                        </div>
                    )}
                </div>

                {/* Sidebar: folders + saved */}
                <aside className="order-1 lg:order-2 border border-black bg-white p-4" data-testid="thesis-sidebar">
                    {!user ? (
                        <div className="text-sm text-[#4A4A4A]">
                            <div className="overline text-black mb-2">Mis tesis</div>
                            Inicia sesión con Google para guardar tus tesis en carpetas y consultarlas cuando quieras.
                        </div>
                    ) : (
                        <>
                            <div className="overline text-black mb-2">Carpetas</div>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                                <button onClick={() => setActiveFolder("all")}
                                        className={`text-xs px-2 py-1 border ${activeFolder === "all" ? "bg-black text-[#FDF1E6] border-black" : "border-black/30 hover:bg-[#F5E4D4]"}`}>
                                    Todas
                                </button>
                                {folders.map((f) => (
                                    <span key={f.id} className={`text-xs px-2 py-1 border flex items-center gap-1 ${activeFolder === f.id ? "bg-black text-[#FDF1E6] border-black" : "border-black/30"}`}>
                                        <button onClick={() => setActiveFolder(f.id)} className="flex items-center gap-1">
                                            <Folder size={11} /> {f.name}
                                        </button>
                                        <button onClick={() => removeFolder(f.id)} className="opacity-60 hover:opacity-100" title="Eliminar carpeta">
                                            <Trash2 size={11} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <div className="flex gap-1 mb-4">
                                <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
                                       onKeyDown={(e) => e.key === "Enter" && createFolder()}
                                       placeholder="Nueva carpeta" className="flex-1 border border-black/30 px-2 py-1 text-xs outline-none" data-testid="new-folder-input" />
                                <button onClick={createFolder} className="border border-black px-2 hover:bg-[#F5E4D4]" data-testid="create-folder-btn" title="Crear carpeta">
                                    <FolderPlus size={14} />
                                </button>
                            </div>

                            <div className="overline text-black mb-2">Mis tesis ({visibleSaved.length})</div>
                            <div className="space-y-1.5 max-h-[480px] overflow-auto">
                                {visibleSaved.length === 0 && <div className="text-xs text-[#4A4A4A]">Aún no hay tesis guardadas.</div>}
                                {visibleSaved.map((t) => (
                                    <div key={t.id} className="border border-black/20 p-2 hover:bg-[#F5E4D4] group" data-testid={`saved-thesis-${t.id}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <Link to={`/thesis/${t.id}`} className="min-w-0 flex-1">
                                                <div className="text-[10px] uppercase tracking-wider text-[#B32A22]">{t.type === "trend" ? "Tendencia" : "Empresa"}</div>
                                                <div className="text-sm font-medium leading-tight truncate">{t.title}</div>
                                            </Link>
                                            <button onClick={() => removeThesis(t.id)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" title="Eliminar">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </aside>
            </div>
        </div>
    );
}
