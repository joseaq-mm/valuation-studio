import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, FolderPlus, Loader2, TrendingUp, Building2, Folder, Radar, Flame, ArrowRight, Undo2, Redo2, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
    thesisGenerate, thesisDiscover, thesisGenerateContra, thesisCreateFolder,
    thesisDeleteFolder, thesisAssignFolder, thesisDelete, thesisRadarStatus,
    thesisRadarSubscribe, thesisDashboard, thesisRefreshStatus, thesisRefreshSubscribe,
    thesisRestore, thesisGet, searchTickers,
} from "@/lib/api";
import ThesisResult from "@/components/thesis/ThesisResult";
import ThesisSidebar from "@/components/thesis/ThesisSidebar";
import ThesisExplore from "@/components/thesis/ThesisExplore";
import TickerAutocomplete from "@/components/TickerAutocomplete";

const EXAMPLES_TREND = ["Inteligencia artificial y centros de datos", "Transición energética y baterías", "GLP-1 y obesidad", "Defensa europea"];
const EXAMPLES_COMPANY = ["NVDA", "ASML", "Novo Nordisk", "Inditex"];

export default function Thesis() {
    const { user } = useAuth();
    const [searchParams] = useSearchParams();
    const [mode, setMode] = useState("trend");
    const [subject, setSubject] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [generatingContra, setGeneratingContra] = useState(false);
    const [discovering, setDiscovering] = useState(false);
    const [candidates, setCandidates] = useState(null);

    const [dash, setDash] = useState(null);
    const [newFolder, setNewFolder] = useState("");
    const [radarEnabled, setRadarEnabled] = useState(false);
    const [refreshEnabled, setRefreshEnabled] = useState(false);
    const [pendingDup, setPendingDup] = useState(null);
    const [pendingWrongType, setPendingWrongType] = useState(null);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [folderToDelete, setFolderToDelete] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const folders = dash?.folders || [];

    const _norm = (s) => (s || "").trim().toLowerCase();
    const findDup = (type, s) => {
        if (!dash) return null;
        const n = _norm(s);
        if (type === "trend") {
            return (dash.trends || []).find((t) => {
                const tt = _norm(t.title);
                if (!tt) return false;
                if (tt === n) return true;
                return n.length >= 6 && (tt.includes(n) || n.includes(tt));
            });
        }
        const up = (s || "").trim().toUpperCase();
        return (dash.company_theses || []).find((c) => (c.ticker || "").toUpperCase() === up || _norm(c.title) === n);
    };

    // Detect whether the TREND search box actually holds an individual COMPANY (so we
    // can block & redirect to "Empresa → Tesis"). Real trend phrases return no equity
    // quotes from /api/search; a company name/ticker returns an EQUITY whose name/symbol
    // matches the input. Returns the matched quote or null.
    const matchCompany = (input, results) => {
        const clean = (x) => (x || "").trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
        const q = clean(input);
        if (!q) return null;
        for (const r of results || []) {
            if ((r.type || "").toUpperCase() !== "EQUITY") continue;
            const sym = clean(r.symbol);
            const name = clean(r.name);
            if (sym === q) return r;
            if (name && (name.startsWith(q) || (q.length >= 4 && name.includes(q)))) return r;
        }
        return null;
    };

    const reload = useCallback(async () => {
        if (!user) { setDash(null); return; }
        try {
            const [d, r, rf] = await Promise.all([thesisDashboard(), thesisRadarStatus(), thesisRefreshStatus()]);
            setDash(d);
            setRadarEnabled(!!r.enabled);
            setRefreshEnabled(!!rf.enabled);
        } catch { /* ignore */ }
    }, [user]);

    useEffect(() => { reload(); }, [reload]);

    const manualRefresh = async () => {
        setRefreshing(true);
        try {
            await reload();
            toast.success("Datos actualizados");
        } finally {
            setRefreshing(false);
        }
    };

    // Prefill / auto-generate from a ?company / ?trend deep link.
    const lastAutoRef = useRef(null);
    useEffect(() => {
        const co = searchParams.get("company");
        const tr = searchParams.get("trend");
        const auto = searchParams.get("auto");
        if (co) { setMode("company"); setSubject(co); }
        else if (tr) {
            setMode("trend"); setSubject(tr);
            const matched = searchParams.get("matched");
            const autoKey = `${tr}|${matched || ""}`;
            if (auto === "1" && lastAutoRef.current !== autoKey) {
                lastAutoRef.current = autoKey;
                generate("trend", tr, matched || null);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const toggleRadar = async () => {
        const next = !radarEnabled;
        setRadarEnabled(next);
        try {
            await thesisRadarSubscribe(next);
            toast.success(next ? "Radar semanal activado" : "Radar semanal desactivado");
        } catch {
            setRadarEnabled(!next);
            toast.error("No se pudo actualizar el radar");
        }
    };

    const toggleRefresh = async () => {
        const next = !refreshEnabled;
        setRefreshEnabled(next);
        try {
            await thesisRefreshSubscribe(next);
            toast.success(next ? "Refresco semanal activado" : "Refresco semanal desactivado");
        } catch {
            setRefreshEnabled(!next);
            toast.error("No se pudo actualizar el refresco");
        }
    };

    const generate = async (overrideType, overrideSubject, matchedThesisId = null, opts = {}) => {
        const t = overrideType || mode;
        const s = (overrideSubject ?? subject).trim();
        if (!s) { toast.error("Escribe una tesis o empresa"); return; }
        // Wrong-type guard: an individual COMPANY typed in the TREND search
        // ("Tesis → Empresas") is a mistake. Detect it (by ticker OR company name via
        // /api/search → EQUITY match) and BLOCK generation; the user must switch modes.
        if (!opts.force && !matchedThesisId && t === "trend") {
            try {
                const res = await searchTickers(s);
                const co = matchCompany(s, res?.results || []);
                if (co) { setPendingDup(null); setPendingWrongType({ subject: s, symbol: co.symbol, name: co.name }); return; }
            } catch { /* ignore search failures and continue */ }
        }
        setPendingWrongType(null);
        // Dedup guard: if a saved thesis already matches, warn before rewriting.
        if (!opts.force && !matchedThesisId) {
            const dup = findDup(t, s);
            if (dup) { setPendingDup({ type: t, subject: s, existing: dup }); return; }
        }
        setPendingDup(null);
        setLoading(true);
        setResult(null);
        try {
            const data = await thesisGenerate(t, s, matchedThesisId, opts.overwriteId || null);
            setResult(data);
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo generar la tesis. Inténtalo de nuevo.");
        } finally {
            setLoading(false);
        }
    };

    const discover = async () => {
        setDiscovering(true);
        setCandidates(null);
        try {
            const data = await thesisDiscover();
            setCandidates(data.candidates || []);
            if (!(data.candidates || []).length) toast.info("No se detectaron tesis claras ahora mismo.");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudieron detectar tesis emergentes.");
        } finally {
            setDiscovering(false);
        }
    };

    const developCandidate = (name) => { setMode("trend"); setSubject(name); generate("trend", name, null, { force: true }); };

    const generateContra = async () => {
        if (!result?.id) { toast.error("Inicia sesión para añadir la contratesis"); return; }
        setGeneratingContra(true);
        try {
            const contra = await thesisGenerateContra(result.id);
            setResult((prev) => ({ ...prev, contra }));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo generar la contratesis");
        } finally {
            setGeneratingContra(false);
        }
    };

    // ---- Undo / redo (page-wide history of mutating actions) ----
    const pushAction = (action) => {
        setUndoStack((s) => [...s, action]);
        setRedoStack([]);
    };

    const runAction = async (action, direction) => {
        const t = action.type;
        if (t === "create_folder") {
            if (direction === "undo") await thesisDeleteFolder(action.folder.id, "ungroup");
            else await thesisRestore({ folders: [action.folder] });
        } else if (t === "delete_folder_cascade") {
            if (direction === "undo") await thesisRestore({ folders: [action.folder], theses: action.theses });
            else await thesisDeleteFolder(action.folder.id, "cascade");
        } else if (t === "delete_folder_ungroup") {
            if (direction === "undo") await thesisRestore({ folders: [action.folder], reassign: action.detached_ids.map((id) => ({ id, folder_id: action.folder.id })) });
            else await thesisDeleteFolder(action.folder.id, "ungroup");
        } else if (t === "delete_thesis") {
            if (direction === "undo") await thesisRestore({ theses: [action.doc] });
            else await thesisDelete(action.doc.id);
        } else if (t === "assign_folder") {
            await thesisAssignFolder(action.id, (direction === "undo" ? action.prev : action.next) || null);
        }
    };

    const undo = async () => {
        if (!undoStack.length) return;
        const action = undoStack[undoStack.length - 1];
        try {
            await runAction(action, "undo");
            setUndoStack((s) => s.slice(0, -1));
            setRedoStack((s) => [...s, action]);
            toast.success("Acción deshecha");
            reload();
        } catch { toast.error("No se pudo deshacer"); }
    };

    const redo = async () => {
        if (!redoStack.length) return;
        const action = redoStack[redoStack.length - 1];
        try {
            await runAction(action, "redo");
            setRedoStack((s) => s.slice(0, -1));
            setUndoStack((s) => [...s, action]);
            toast.success("Acción rehecha");
            reload();
        } catch { toast.error("No se pudo rehacer"); }
    };

    const createFolder = async () => {
        const n = newFolder.trim();
        if (!n) return;
        try {
            const f = await thesisCreateFolder(n);
            setNewFolder("");
            toast.success("Megatendencia creada");
            pushAction({ type: "create_folder", folder: { id: f.id, name: f.name, created_at: f.created_at } });
            reload();
        } catch { toast.error("No se pudo crear la megatendencia"); }
    };

    const assign = async (folderId) => {
        if (!result?.id) return;
        try {
            await thesisAssignFolder(result.id, folderId || null);
            setResult({ ...result, saved: true, folder_id: folderId || null });
            toast.success(folderId ? "Guardada en megatendencia" : "Guardada");
            reload();
        } catch { toast.error("No se pudo guardar"); }
    };

    const assignThesisFolder = async (id, folderId) => {
        const prev = (dash?.trends || []).find((t) => t.id === id)?.folder_id || null;
        try {
            await thesisAssignFolder(id, folderId || null);
            toast.success(folderId ? "Movida a la megatendencia" : "Quitada de la megatendencia");
            pushAction({ type: "assign_folder", id, prev, next: folderId || null });
            reload();
        } catch { toast.error("No se pudo mover la tesis"); }
    };

    const deleteFolder = async (folder, fmode) => {
        setFolderToDelete(null);
        try {
            const res = await thesisDeleteFolder(folder.id, fmode);
            if (fmode === "cascade") {
                pushAction({ type: "delete_folder_cascade", folder: res.folder, theses: res.deleted_theses || [] });
                toast.success("Megatendencia y sus tesis eliminadas");
            } else {
                pushAction({ type: "delete_folder_ungroup", folder: res.folder, detached_ids: res.detached_ids || [] });
                toast.success("Megatendencia eliminada · tesis desagrupadas");
            }
            reload();
        } catch { toast.error("No se pudo eliminar la megatendencia"); }
    };

    const removeThesis = async (id) => {
        try {
            const doc = await thesisGet(id);
            await thesisDelete(id);
            toast.success(doc?.type === "company" ? "Empresa eliminada" : "Tesis eliminada");
            pushAction({ type: "delete_thesis", doc });
            reload();
        } catch { toast.error("No se pudo eliminar"); }
    };

    const examples = mode === "trend" ? EXAMPLES_TREND : EXAMPLES_COMPANY;

    return (
        <div data-testid="thesis-page">
            <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
                {/* Main column */}
                <div className="order-2 lg:order-1 min-w-0">
                    {/* Hero */}
                    <div className="mb-5 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="overline text-[#B32A22] mb-1">Thesis Engine · Análisis cualitativo con IA</div>
                            <h1 className="font-serif text-4xl sm:text-5xl font-medium leading-tight">Tesis de inversión</h1>
                            <p className="text-base text-[#4A4A4A] mt-2 max-w-2xl leading-relaxed">
                                Mapea megatendencias a su cadena de valor y a las empresas líderes con un score cualitativo —
                                o parte de una empresa y descubre en qué tesis encaja.
                            </p>
                        </div>
                        {user && (
                            <div className="flex items-center gap-1 shrink-0 mt-1" data-testid="undo-redo-bar">
                                <button onClick={undo} disabled={!undoStack.length} title="Deshacer" data-testid="undo-btn"
                                        className="border border-black p-2 hover:bg-[#F5E4D4] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                    <Undo2 size={16} />
                                </button>
                                <button onClick={redo} disabled={!redoStack.length} title="Rehacer" data-testid="redo-btn"
                                        className="border border-black p-2 hover:bg-[#F5E4D4] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                    <Redo2 size={16} />
                                </button>
                                <button onClick={manualRefresh} disabled={refreshing} title="Actualizar datos" data-testid="refresh-data-btn"
                                        className="border border-black p-2 hover:bg-[#F5E4D4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                    <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Generator */}
                    <div className="border border-black bg-white p-5 mb-6" data-testid="thesis-generator">
                        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                            <div className="flex gap-0 border border-black w-fit">
                                <button
                                    onClick={() => { setMode("trend"); setSubject(""); setResult(null); setPendingDup(null); setPendingWrongType(null); }}
                                    className={`px-4 py-2 text-xs uppercase tracking-[0.12em] font-semibold flex items-center gap-2 transition-colors ${mode === "trend" ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                                    data-testid="mode-trend"
                                >
                                    <TrendingUp size={14} /> Tesis → Empresas
                                </button>
                                <button
                                    onClick={() => { setMode("company"); setSubject(""); setResult(null); setPendingDup(null); setPendingWrongType(null); }}
                                    className={`px-4 py-2 text-xs uppercase tracking-[0.12em] font-semibold flex items-center gap-2 transition-colors border-l border-black ${mode === "company" ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                                    data-testid="mode-company"
                                >
                                    <Building2 size={14} /> Empresa → Tesis
                                </button>
                            </div>
                            <button
                                onClick={discover}
                                disabled={discovering || loading}
                                className="text-xs uppercase tracking-[0.12em] font-semibold border border-[#052049] text-[#052049] px-3 py-2 hover:bg-[#052049] hover:text-[#FDF1E6] transition-colors flex items-center gap-2 disabled:opacity-60"
                                data-testid="thesis-discover-btn"
                            >
                                {discovering ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
                                {discovering ? "Escaneando…" : "Tesis automática"}
                            </button>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                            {mode === "company" ? (
                                <div className="flex-1">
                                    <TickerAutocomplete
                                        value={subject}
                                        onChange={setSubject}
                                        onPick={(r) => setSubject(r.symbol)}
                                        onEnter={() => !loading && generate()}
                                        placeholder="Ej.: NVDA, ASML, Inditex…"
                                        testid="thesis-input"
                                        disabled={loading}
                                    />
                                </div>
                            ) : (
                                <input
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && !loading && generate()}
                                    placeholder="Ej.: Inteligencia artificial y centros de datos"
                                    className="flex-1 px-3 py-2.5 border border-black outline-none font-mono text-sm bg-white"
                                    data-testid="thesis-input"
                                    disabled={loading}
                                />
                            )}
                            <button onClick={() => generate()} disabled={loading} className="btn-primary flex items-center justify-center gap-2 !px-5" data-testid="thesis-generate-btn">
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

                        {(loading || discovering) && (
                            <div className="mt-4 text-xs text-[#4A4A4A] flex items-center gap-2" data-testid="thesis-loading">
                                <Loader2 size={13} className="animate-spin" />
                                {discovering
                                    ? "Escaneando fuentes en busca de tesis emergentes… ~40s."
                                    : "Buscando en la web e investigando con IA… esto puede tardar ~1-2 minutos."}
                            </div>
                        )}
                    </div>

                    {/* Wrong-type warning: a company typed in the TREND search.
                        Placed right below the search box, above megatrends. */}
                    {pendingWrongType && (
                        <div className="border border-[#052049] bg-[#EAF0F7] p-4 mb-6" data-testid="wrong-type-warning">
                            <div className="text-sm text-[#052049] leading-relaxed">
                                <strong>«{pendingWrongType.subject}»</strong> es una empresa
                                {pendingWrongType.name ? ` (${pendingWrongType.name})` : ""}, y <strong>«Tesis → Empresas»</strong> solo
                                analiza <strong>tendencias</strong>. No se ha generado nada. Para analizar esta empresa, usa <strong>«Empresa → Tesis»</strong>.
                            </div>
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                                <button
                                    onClick={() => { setMode("company"); setSubject(pendingWrongType.symbol); setPendingWrongType(null); }}
                                    className="text-xs uppercase tracking-[0.1em] font-semibold bg-[#052049] text-white px-3 py-1.5 hover:bg-[#03132e] transition-colors flex items-center gap-1.5"
                                    data-testid="wrong-type-switch-btn"
                                >
                                    <Building2 size={13} /> Analizar en Empresa → Tesis
                                </button>
                                <button onClick={() => setPendingWrongType(null)} className="text-xs text-[#052049] hover:underline" data-testid="wrong-type-cancel-btn">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Dedup / overwrite warning: right below the search box, above megatrends. */}
                    {pendingDup && (
                        <div className="border border-[#B8860B] bg-[#FBF3E0] p-4 mb-6" data-testid="dedup-warning">
                            <div className="text-sm text-[#7a5a10] leading-relaxed">
                                Ya tienes esta {pendingDup.type === "trend" ? "tesis" : "empresa"} guardada:{" "}
                                <Link to={`/thesis/${pendingDup.existing.id}`} className="font-bold underline" data-testid="dedup-existing-link">{pendingDup.existing.title}</Link>.{" "}
                                El <strong>Thesis Engine la refresca automáticamente cada semana</strong>, así que normalmente no necesitas regenerarla. Si continúas, se <strong>reescribirá</strong> el resultado actual.
                            </div>
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                                <button
                                    onClick={() => generate(pendingDup.type, pendingDup.subject, null, { force: true, overwriteId: pendingDup.existing.id })}
                                    className="text-xs uppercase tracking-[0.1em] font-semibold bg-[#B8860B] text-white px-3 py-1.5 hover:bg-[#946c09] transition-colors"
                                    data-testid="dedup-rewrite-btn"
                                >
                                    Reescribir igualmente
                                </button>
                                <Link to={`/thesis/${pendingDup.existing.id}`} className="text-xs uppercase tracking-[0.1em] font-semibold border border-[#B8860B] text-[#7a5a10] px-3 py-1.5 hover:bg-[#B8860B] hover:text-white transition-colors" data-testid="dedup-open-btn">
                                    Abrir la existente
                                </Link>
                                <button onClick={() => setPendingDup(null)} className="text-xs text-[#7a5a10] hover:underline" data-testid="dedup-cancel-btn">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Megatendencias management */}
                    {user && (
                        <div className="border border-black bg-white p-4 mb-6" data-testid="megatrends-bar">
                            <div className="overline text-black flex items-center gap-1 mb-1"><Folder size={12} /> Megatendencias</div>
                            <p className="text-[11px] text-[#4A4A4A] mb-3">Agrupa tus tesis en megatendencias. Crea una abajo, asígnala desde el selector de cada tesis (lista de la derecha) y elimínala desde su cuadro en la vista <strong>Megatendencias</strong>.</p>
                            <div className="flex gap-1 max-w-sm">
                                <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
                                       onKeyDown={(e) => e.key === "Enter" && createFolder()}
                                       placeholder="Nueva megatendencia" className="flex-1 border border-black/30 px-2 py-1 text-xs outline-none" data-testid="new-folder-input" />
                                <button onClick={createFolder} className="border border-black px-2 hover:bg-[#F5E4D4]" data-testid="create-folder-btn" title="Crear megatendencia">
                                    <FolderPlus size={14} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Discovered candidate trends */}
                    {candidates && candidates.length > 0 && (
                        <div className="border border-black bg-[#F5E4D4] p-4 mb-6" data-testid="thesis-candidates">
                            <div className="flex items-center gap-2 mb-3">
                                <Radar size={16} className="text-[#052049]" />
                                <span className="overline text-black">Tesis emergentes detectadas</span>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {candidates.map((c, i) => (
                                    <div key={i} className="border border-black bg-white p-3 flex flex-col" data-testid={`candidate-${i}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="font-serif text-base font-medium leading-tight">{c.name}</div>
                                                {c.sector && <div className="overline text-[#4A4A4A] mt-0.5">{c.sector}</div>}
                                            </div>
                                            <span className="flex items-center gap-1 text-xs font-mono font-bold shrink-0" style={{ color: (c.heat ?? 0) >= 7 ? "#B32A22" : "#B8860B" }} title="Momentum / atención actual">
                                                <Flame size={13} /> {c.heat ?? "—"}
                                            </span>
                                        </div>
                                        {c.why_now && <p className="text-xs text-[#4A4A4A] mt-2 leading-snug flex-1">{c.why_now}</p>}
                                        <button
                                            onClick={() => developCandidate(c.name)}
                                            disabled={loading}
                                            className="mt-3 text-xs uppercase tracking-[0.1em] font-semibold bg-black text-[#FDF1E6] px-2 py-1.5 hover:bg-[#052049] transition-colors flex items-center justify-center gap-1 disabled:opacity-60"
                                            data-testid={`candidate-develop-${i}`}
                                        >
                                            <Sparkles size={12} /> Desarrollar tesis <ArrowRight size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Save bar */}
                    {result && user && (
                        <div className="border border-black bg-[#F5E4D4] p-3 mb-6 flex items-center gap-3 flex-wrap" data-testid="thesis-save-bar">
                            <span className="overline text-[#4A4A4A]">Guardar en megatendencia</span>
                            <select
                                value={result.folder_id || ""}
                                onChange={(e) => assign(e.target.value)}
                                className="border border-black bg-white px-2 py-1.5 text-sm outline-none"
                                data-testid="thesis-folder-select"
                            >
                                <option value="">— Sin megatendencia —</option>
                                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                            {result.id && <Link to={`/thesis/${result.id}`} className="text-xs text-[#052049] hover:underline">Ver en detalle →</Link>}
                        </div>
                    )}
                    {result && !user && (
                        <div className="border border-[#B32A22]/40 bg-white p-3 mb-6 text-sm" data-testid="thesis-login-hint">
                            Inicia sesión con Google (botón <span className="font-semibold">Entrar</span> arriba) para guardar esta tesis en megatendencias.
                        </div>
                    )}

                    {/* Result, or the explore dashboard when idle */}
                    {result ? (
                        <ThesisResult
                            thesis={result}
                            canGenerateContra={!!result.id}
                            onGenerateContra={generateContra}
                            generatingContra={generatingContra}
                            onMutated={reload}
                        />
                    ) : (user && dash && !loading && (
                        <ThesisExplore dash={dash} onDeleteFolder={setFolderToDelete} />
                    ))}
                </div>

                {/* Sidebar */}
                <div className="order-1 lg:order-2">
                    {!user ? (
                        <aside className="border border-black bg-white p-4" data-testid="thesis-sidebar">
                            <div className="overline text-black mb-2">Mis tesis y empresas</div>
                            <div className="text-sm text-[#4A4A4A]">Inicia sesión con Google para guardar tus tesis en megatendencias y consultarlas cuando quieras.</div>
                        </aside>
                    ) : (
                        <ThesisSidebar
                            trends={dash?.trends || []}
                            companyTheses={dash?.company_theses || []}
                            folders={folders}
                            onAssignFolder={assignThesisFolder}
                            onRemoveThesis={removeThesis}
                            radarEnabled={radarEnabled}
                            onToggleRadar={toggleRadar}
                            refreshEnabled={refreshEnabled}
                            onToggleRefresh={toggleRefresh}
                        />
                    )}
                </div>
            </div>

            {/* Delete megatendencia confirm modal */}
            {folderToDelete && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" data-testid="delete-folder-modal" onClick={() => setFolderToDelete(null)}>
                    <div className="bg-white border border-black max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="font-serif text-xl font-medium mb-1">Eliminar «{folderToDelete.name}»</div>
                        <p className="text-sm text-[#4A4A4A] mb-4">
                            Esta megatendencia agrupa <strong>{folderToDelete.trend_count || 0} tesis</strong>. ¿Qué quieres hacer con ellas?
                        </p>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => deleteFolder(folderToDelete, "ungroup")} data-testid="delete-folder-ungroup"
                                    className="text-left text-sm border border-black px-3 py-2 hover:bg-[#F5E4D4] transition-colors">
                                <span className="font-semibold">Solo desagrupar</span> — mantener las tesis en mi lista (sin megatendencia)
                            </button>
                            <button onClick={() => deleteFolder(folderToDelete, "cascade")} data-testid="delete-folder-cascade"
                                    className="text-left text-sm border border-[#B32A22] text-[#B32A22] px-3 py-2 hover:bg-[#B32A22] hover:text-white transition-colors">
                                <span className="font-semibold">Borrar también las tesis</span> — eliminar la megatendencia y su contenido
                            </button>
                            <button onClick={() => setFolderToDelete(null)} data-testid="delete-folder-cancel"
                                    className="text-xs text-[#4A4A4A] hover:underline mt-1 self-start">
                                Cancelar
                            </button>
                        </div>
                        <p className="text-[11px] text-[#4A4A4A] mt-3">Podrás revertirlo con el botón <strong>Deshacer</strong> de arriba.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
