import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, FolderPlus, Loader2, TrendingUp, Building2, Folder, Radar, Undo2, Redo2, RefreshCw, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
    thesisGenerate, thesisPollJob, thesisExplore, thesisAutoTrend, thesisSaveTendencia,
    thesisGenerateContra, thesisCreateFolder, thesisDeleteFolder, thesisAssignFolder,
    thesisDelete, thesisRadarStatus, thesisRadarSubscribe, thesisDashboard,
    thesisRefreshStatus, thesisRefreshSubscribe, thesisRefreshRun, thesisRestore, thesisGet, thesisGeneratePlan,
} from "@/lib/api";
import ThesisResult from "@/components/thesis/ThesisResult";
import TendenciaResult from "@/components/thesis/TendenciaResult";
import ThesisSidebar from "@/components/thesis/ThesisSidebar";
import ThesisExplore from "@/components/thesis/ThesisExplore";
import ModelPicker from "@/components/thesis/ModelPicker";
import RefreshButton from "@/components/RefreshButton";
import TickerAutocomplete from "@/components/TickerAutocomplete";

const EXAMPLES_COMPANY = ["NVDA", "ASML", "Novo Nordisk", "Inditex"];
const EXAMPLES_TREND = ["Inteligencia artificial y centros de datos", "Transición energética y baterías", "GLP-1 y obesidad", "Defensa europea"];

export default function Thesis() {
    const { user } = useAuth();
    const [searchParams] = useSearchParams();
    const [mode, setMode] = useState("company");          // "company" (default) | "explore"
    const [subject, setSubject] = useState("");
    const [loading, setLoading] = useState(false);        // company / trend generation
    const [trendLoading, setTrendLoading] = useState(false); // explore / auto-trend
    const [result, setResult] = useState(null);
    const [generatingContra, setGeneratingContra] = useState(false);
    const [generatingPlan, setGeneratingPlan] = useState(false);
    const [tendenciaSaving, setTendenciaSaving] = useState(false);
    const [autoSeen, setAutoSeen] = useState([]);         // trend names already shown (avoid repeats)
    const [genCount, setGenCount] = useState(0);          // bump to refresh model usage counters

    const [dash, setDash] = useState(null);
    const [newFolder, setNewFolder] = useState("");
    const [radarEnabled, setRadarEnabled] = useState(false);
    const [refreshEnabled, setRefreshEnabled] = useState(false);
    const [pendingDup, setPendingDup] = useState(null);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [folderToDelete, setFolderToDelete] = useState(null);
    const [companyToDelete, setCompanyToDelete] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [genStatus, setGenStatus] = useState(null);   // "processing" | "queued" while generating
    const [queueAsk, setQueueAsk] = useState(null);      // { active, retry } when a generation is already running

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
            await thesisRefreshRun();          // refresh ALL the user's data (fundamentals + TAM)
            await reload();
            toast.success("Datos actualizados");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo refrescar.");
        } finally {
            setRefreshing(false);
        }
    };

    // Prefill (?company) / auto-develop a proposed thesis (?trend&auto=1) from a deep
    // link. For develop links we DO NOT populate the search box — we run directly.
    const lastAutoRef = useRef(null);
    useEffect(() => {
        const co = searchParams.get("company");
        const tr = searchParams.get("trend");
        const auto = searchParams.get("auto");
        if (co) { setMode("company"); setSubject(co); }
        else if (tr && auto === "1") {
            const matched = searchParams.get("matched");
            const fromCompany = searchParams.get("from_company");
            const core = searchParams.get("core");
            const whole = searchParams.get("whole");
            const autoKey = `${tr}|${matched || ""}|${fromCompany || ""}|${core || ""}|${whole || ""}`;
            if (lastAutoRef.current !== autoKey) {
                lastAutoRef.current = autoKey;
                const recordSplit = fromCompany
                    ? { companyId: fromCompany, core, split: whole ? null : tr, whole: !!whole }
                    : null;
                generate("trend", tr, matched || null, { force: true, recordSplit });
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

    // Generate a COMPANY thesis (primary flow) or develop a TREND ("tesis") in place.
    const generate = async (overrideType, overrideSubject, matchedThesisId = null, opts = {}) => {
        const t = overrideType || "company";
        const s = (overrideSubject ?? subject).trim();
        if (!s) { toast.error("Escribe una empresa"); return; }
        // Dedup guard: if a saved thesis already matches, warn before rewriting.
        if (!opts.force && !matchedThesisId) {
            const dup = findDup(t, s);
            if (dup) {
                if (pendingDup && pendingDup.type === t && pendingDup.subject === s) {
                    opts = { ...opts, overwriteId: dup.id };
                } else {
                    setPendingDup({ type: t, subject: s, existing: dup });
                    return;
                }
            }
        }
        setPendingDup(null);
        setLoading(true);
        setResult(null);
        setGenStatus("processing");
        const extra = opts.recordSplit
            ? { from_company: opts.recordSplit.companyId, core: opts.recordSplit.core, develop_whole: opts.recordSplit.whole }
            : {};
        const overwriteId = opts.overwriteId || null;
        try {
            const data = await thesisGenerate(t, s, matchedThesisId, overwriteId, { ...extra, queue: opts.queue || false }, setGenStatus);
            setResult(data);
            setGenCount((n) => n + 1);
            if (data?.no_changes) toast.info("Sin novedades relevantes: conservamos tu tesis actual.");
            else if (data?.changes?.length) toast.success(`Tesis actualizada · ${data.changes.length} cambio${data.changes.length > 1 ? "s" : ""}`);
            reload();
        } catch (e) {
            // A generation is already running → offer to queue this one (FIFO).
            if (e?.busy) {
                setQueueAsk({ active: e.busy, retry: { t, s, matchedThesisId, overwriteId, extra } });
            } else {
                toast.error(e?.response?.data?.detail || "No se pudo generar la tesis. Inténtalo de nuevo.");
            }
        } finally {
            setLoading(false);
            setGenStatus(null);
        }
    };

    // User accepted to queue the generation behind the one already running.
    const confirmQueue = async () => {
        const q = queueAsk;
        setQueueAsk(null);
        if (!q) return;
        setLoading(true);
        setResult(null);
        setGenStatus("queued");
        try {
            const data = await thesisGenerate(q.retry.t, q.retry.s, q.retry.matchedThesisId, q.retry.overwriteId, { ...q.retry.extra, queue: true }, setGenStatus);
            setResult(data);
            setGenCount((n) => n + 1);
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo generar la tesis. Inténtalo de nuevo.");
        } finally {
            setLoading(false);
            setGenStatus(null);
        }
    };

    // Develop a proposed thesis (growth driver / split) directly — no search box.
    const developThesis = ({ name, core, whole, companyId }) => {
        const recordSplit = (companyId && core) ? { companyId, core, split: whole ? null : name, whole: !!whole } : null;
        setMode("company");
        generate("trend", name, null, { force: true, recordSplit });
    };

    // "Generar plan": execute the whole plan — enqueue a generation for every
    // non-merged driver (whole → 1 thesis; split → its partitions), all serial.
    // Planning locks; we reload the company thesis to show the pending/generating
    // states, and poll the first job to update once it lands.
    const generatePlan = async (companyId) => {
        if (!companyId) return;
        setGeneratingPlan(true);
        try {
            const res = await thesisGeneratePlan(companyId);
            toast.success(`Plan en marcha: ${res.count} tesis (1ª generándose, el resto en cola).`);
            const fresh = await thesisGet(companyId);   // planning_locked + pending states
            setResult(fresh);
            reload();
            if (res.first_job_id) {
                thesisPollJob(res.first_job_id)
                    .then(async () => { const f2 = await thesisGet(companyId); setResult(f2); reload(); })
                    .catch(() => {});
            }
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo generar el plan.");
        } finally {
            setGeneratingPlan(false);
        }
    };

    // From an informational trend: generate the Empresa→Tesis of a mentioned company.
    const developCompanyFromTendencia = (ticker) => {
        if (!ticker) return;
        setMode("company");
        setSubject(ticker);
        generate("company", ticker);
    };

    // Informational (structural-only) trend exploration.
    const runExplore = async () => {
        const s = subject.trim();
        if (!s) { toast.error("Escribe una tendencia"); return; }
        setTrendLoading(true);
        setResult(null);
        setPendingDup(null);
        try {
            const data = await thesisExplore(s);
            setResult(data);
            setGenCount((n) => n + 1);
            if (data?.title) setAutoSeen((prev) => Array.from(new Set([...prev, data.title])));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo explorar la tendencia.");
        } finally {
            setTrendLoading(false);
        }
    };

    // One automatic emerging trend per click, avoiding repeats (shown + saved).
    const runAutoTrend = async () => {
        setTrendLoading(true);
        setResult(null);
        setPendingDup(null);
        try {
            const exclude = Array.from(new Set([
                ...autoSeen,
                ...(dash?.tendencias || []).map((t) => t.title),
            ].filter(Boolean)));
            const data = await thesisAutoTrend(exclude);
            setResult(data);
            setGenCount((n) => n + 1);
            if (data?.title) setAutoSeen((prev) => Array.from(new Set([...prev, data.title])));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo generar la tendencia automática.");
        } finally {
            setTrendLoading(false);
        }
    };

    const saveTendencia = async () => {
        if (!user) { toast.error("Inicia sesión para guardar la tendencia"); return; }
        if (!result || result.type !== "tendencia") return;
        setTendenciaSaving(true);
        try {
            const res = await thesisSaveTendencia(result);
            setResult({ ...result, id: res.id, saved: true });
            toast.success("Tendencia guardada");
            reload();
        } catch {
            toast.error("No se pudo guardar la tendencia");
        } finally {
            setTendenciaSaving(false);
        }
    };

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
            toast.success("Megatesis creada");
            pushAction({ type: "create_folder", folder: { id: f.id, name: f.name, created_at: f.created_at } });
            reload();
        } catch { toast.error("No se pudo crear la megatesis"); }
    };

    const assign = async (folderId) => {
        if (!result?.id) return;
        try {
            await thesisAssignFolder(result.id, folderId || null);
            setResult({ ...result, saved: true, folder_id: folderId || null });
            toast.success(folderId ? "Guardada en megatesis" : "Guardada");
            reload();
        } catch { toast.error("No se pudo guardar"); }
    };

    const assignThesisFolder = async (id, folderId) => {
        const prev = (dash?.trends || []).find((t) => t.id === id)?.folder_id || null;
        try {
            await thesisAssignFolder(id, folderId || null);
            toast.success(folderId ? "Movida a la megatesis" : "Quitada de la megatesis");
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
                toast.success("Megatesis y sus tesis eliminadas");
            } else {
                pushAction({ type: "delete_folder_ungroup", folder: res.folder, detached_ids: res.detached_ids || [] });
                toast.success("Megatesis eliminada · tesis desagrupadas");
            }
            reload();
        } catch { toast.error("No se pudo eliminar la megatesis"); }
    };

    const removeThesis = async (id) => {
        try {
            const doc = await thesisGet(id);
            // Deleting a COMPANY = start from 0 → confirm first (cascades its developed
            // theses; not undoable). Trends/tendencias keep the undoable quick-delete.
            if (doc?.type === "company") { setCompanyToDelete(doc); return; }
            await thesisDelete(id);
            toast.success(doc?.type === "tendencia" ? "Tendencia eliminada" : "Tesis eliminada");
            pushAction({ type: "delete_thesis", doc });
            reload();
        } catch { toast.error("No se pudo eliminar"); }
    };

    const confirmDeleteCompany = async () => {
        const doc = companyToDelete;
        setCompanyToDelete(null);
        if (!doc) return;
        try {
            await thesisDelete(doc.id);   // backend cascades the developed trend theses
            toast.success("Empresa y sus tesis generadas eliminadas");
            if (result?.id === doc.id) setResult(null);
            reload();
        } catch { toast.error("No se pudo eliminar"); }
    };

    const examples = mode === "company" ? EXAMPLES_COMPANY : EXAMPLES_TREND;
    const busy = loading || trendLoading;
    const isTendencia = result?.type === "tendencia";

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
                                Parte de una empresa y descubre las tesis (drivers de crecimiento) en las que encaja —
                                o explora una tendencia y su cadena de valor de forma informativa.
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
                                <button onClick={manualRefresh} disabled={refreshing} title="Refrescar: actualiza precios, fundamentales y TAM de todas tus empresas y tesis al instante (los datos viajan entre empresa y tesis)." data-testid="refresh-data-btn"
                                        className="border border-black p-2 hover:bg-[#F5E4D4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                    <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* DEV-only model cost/quality switch (hidden in production) */}
                    <ModelPicker canSwitch={!!user} reloadSignal={genCount} />

                    {/* Generator */}
                    <div className="border border-black bg-white p-5 mb-6" data-testid="thesis-generator">
                        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                            {/* Primary (left, black by default) */}
                            <button
                                onClick={() => { setMode("company"); setSubject(""); setResult(null); setPendingDup(null); }}
                                className={`px-4 py-2 text-xs uppercase tracking-[0.12em] font-semibold flex items-center gap-2 border border-black transition-colors ${mode === "company" ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                                data-testid="mode-company"
                            >
                                <Building2 size={14} /> Empresa → Tesis
                            </button>

                            {/* Secondary trend tools (right) */}
                            <div className="flex gap-2 flex-wrap">
                                <button
                                    onClick={() => { setMode("explore"); setSubject(""); setResult(null); setPendingDup(null); }}
                                    className={`px-3 py-2 text-xs uppercase tracking-[0.12em] font-semibold flex items-center gap-2 border border-black/40 transition-colors ${mode === "explore" ? "bg-[#052049] text-[#FDF1E6] border-[#052049]" : "bg-white text-[#4A4A4A] hover:bg-[#F5E4D4]"}`}
                                    data-testid="mode-explore"
                                >
                                    <TrendingUp size={14} /> Tendencias → Empresas
                                </button>
                                <button
                                    onClick={runAutoTrend}
                                    disabled={busy}
                                    className="px-3 py-2 text-xs uppercase tracking-[0.12em] font-semibold border border-black/40 text-[#4A4A4A] hover:bg-[#F5E4D4] transition-colors flex items-center gap-2 disabled:opacity-60"
                                    data-testid="auto-trend-btn"
                                >
                                    {trendLoading ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
                                    Tendencia automática
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                            {mode === "company" ? (
                                <>
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
                                    <button onClick={() => generate()} disabled={busy} className="btn-primary flex items-center justify-center gap-2 !px-5" data-testid="thesis-generate-btn">
                                        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                        {loading ? (genStatus === "queued" ? "En cola…" : "Generando…") : "Generar tesis"}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <input
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && !trendLoading && runExplore()}
                                        placeholder="Ej.: Inteligencia artificial y centros de datos"
                                        className="flex-1 px-3 py-2.5 border border-black outline-none font-mono text-sm bg-white"
                                        data-testid="thesis-input"
                                        disabled={trendLoading}
                                        autoComplete="off"
                                    />
                                    <button onClick={runExplore} disabled={busy} className="btn-primary flex items-center justify-center gap-2 !px-5" data-testid="thesis-explore-btn">
                                        {trendLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                        {trendLoading ? "Explorando…" : "Explorar tendencia"}
                                    </button>
                                </>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2 mt-3 items-center">
                            <span className="overline text-[#4A4A4A]">Prueba:</span>
                            {examples.map((ex) => (
                                <button key={ex} onClick={() => setSubject(ex)} disabled={busy}
                                        className="text-xs border border-black/30 px-2 py-1 hover:bg-[#F5E4D4] transition-colors font-mono">
                                    {ex}
                                </button>
                            ))}
                        </div>

                        {busy && (
                            <div className="mt-4 text-xs text-[#4A4A4A] flex items-center gap-2" data-testid="thesis-loading">
                                <Loader2 size={13} className="animate-spin" />
                                {genStatus === "queued"
                                    ? "En cola: esperando a que termine la generación en curso. Empezará automáticamente al finalizar la anterior."
                                    : trendLoading
                                        ? "Explorando la tendencia en la web… esto puede tardar ~40-60s."
                                        : "Buscando en la web e investigando con IA… esto puede tardar ~1-2 minutos."}
                            </div>
                        )}
                    </div>

                    {/* Dedup / overwrite warning (company): right below the search box. */}
                    {pendingDup && (
                        <div className="border border-[#B8860B] bg-[#FBF3E0] p-4 mb-6" data-testid="dedup-warning">
                            <div className="text-sm text-[#7a5a10] leading-relaxed">
                                Ya tienes esta {pendingDup.type === "trend" ? "tesis" : "empresa"} guardada:{" "}
                                <Link to={`/thesis/${pendingDup.existing.id}`} className="font-bold underline" data-testid="dedup-existing-link">{pendingDup.existing.title}</Link>.{" "}
                                El <strong>Thesis Engine la refresca automáticamente cada semana</strong>, así que normalmente no necesitas regenerarla. Si continúas, se <strong>reescribirá desde cero</strong> el resultado actual {pendingDup.type === "trend" ? "" : <>y se <strong>borrarán las tesis generadas previamente a partir de esta empresa</strong></>}.
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

                    {/* Megatesis management */}
                    {user && (
                        <div className="border border-black bg-white p-4 mb-6" data-testid="megatrends-bar">
                            <div className="overline text-black flex items-center gap-1 mb-1"><Folder size={12} /> Megatesis</div>
                            <p className="text-[11px] text-[#4A4A4A] mb-3">Agrupa tus tesis desarrolladas en megatesis. Crea una abajo, asígnala desde el selector de cada tesis (lista de la derecha) y elimínala desde su cuadro en la vista <strong>Megatesis</strong>.</p>
                            <div className="flex gap-1 max-w-sm">
                                <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
                                       onKeyDown={(e) => e.key === "Enter" && createFolder()}
                                       placeholder="Nueva megatesis" className="flex-1 border border-black/30 px-2 py-1 text-xs outline-none" data-testid="new-folder-input" />
                                <button onClick={createFolder} className="border border-black px-2 hover:bg-[#F5E4D4]" data-testid="create-folder-btn" title="Crear megatesis">
                                    <FolderPlus size={14} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Save bar — only for theses (company / trend); tendencias save inline. */}
                    {result && !isTendencia && user && (
                        result.type === "company" ? (
                            result.id && (
                                <div className="border border-black bg-[#F5E4D4] p-3 mb-6 flex items-center gap-3 flex-wrap" data-testid="thesis-save-bar">
                                    <Link to={`/thesis/${result.id}`} className="btn-primary flex items-center gap-1.5 !px-4" data-testid="thesis-view-detail">
                                        Ver en detalle <ArrowRight size={14} />
                                    </Link>
                                </div>
                            )
                        ) : (
                            <div className="border border-black bg-[#F5E4D4] p-3 mb-6 flex items-center gap-3 flex-wrap" data-testid="thesis-save-bar">
                                <span className="overline text-[#4A4A4A]">Guardar en megatesis</span>
                                <select
                                    value={result.folder_id || ""}
                                    onChange={(e) => assign(e.target.value)}
                                    className="border border-black bg-white px-2 py-1.5 text-sm outline-none"
                                    data-testid="thesis-folder-select"
                                >
                                    <option value="">— Sin megatesis —</option>
                                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                                {result.id && <Link to={`/thesis/${result.id}`} className="text-xs text-[#052049] hover:underline">Ver en detalle →</Link>}
                            </div>
                        )
                    )}
                    {result && !isTendencia && !user && (
                        <div className="border border-[#B32A22]/40 bg-white p-3 mb-6 text-sm" data-testid="thesis-login-hint">
                            Inicia sesión con Google (botón <span className="font-semibold">Entrar</span> arriba) para guardar esta tesis.
                        </div>
                    )}

                    {/* Result, or the explore dashboard when idle */}
                    {result ? (
                        isTendencia ? (
                            <TendenciaResult
                                tendencia={result}
                                onDevelopCompany={developCompanyFromTendencia}
                                onSave={saveTendencia}
                                onDiscard={() => setResult(null)}
                                saved={!!result.saved}
                                saving={tendenciaSaving}
                                canSave={!!user}
                            />
                        ) : (
                            <ThesisResult
                                thesis={result}
                                canGenerateContra={!!result.id}
                                onGenerateContra={generateContra}
                                generatingContra={generatingContra}
                                onMutated={reload}
                                onDevelop={developThesis}
                                onGeneratePlan={generatePlan}
                                generatingPlan={generatingPlan}
                                onThesisUpdate={(d) => setResult(d)}
                            />
                        )
                    ) : (user && dash && !busy && (
                        <ThesisExplore dash={dash} onDeleteFolder={setFolderToDelete} />
                    ))}
                </div>

                {/* Sidebar */}
                <div className="order-1 lg:order-2">
                    {!user ? (
                        <aside className="border border-black bg-white p-4" data-testid="thesis-sidebar">
                            <div className="overline text-black mb-2">Tendencias, tesis y empresas</div>
                            <div className="text-sm text-[#4A4A4A]">Inicia sesión con Google para guardar tus tendencias, tesis y empresas y consultarlas cuando quieras.</div>
                        </aside>
                    ) : (
                        <ThesisSidebar
                            tendencias={dash?.tendencias || []}
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

            {/* Delete megatesis confirm modal */}
            {folderToDelete && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" data-testid="delete-folder-modal" onClick={() => setFolderToDelete(null)}>
                    <div className="bg-white border border-black max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="font-serif text-xl font-medium mb-1">Eliminar «{folderToDelete.name}»</div>
                        <p className="text-sm text-[#4A4A4A] mb-4">
                            Esta megatesis agrupa <strong>{folderToDelete.trend_count || 0} tesis</strong>. ¿Qué quieres hacer con ellas?
                        </p>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => deleteFolder(folderToDelete, "ungroup")} data-testid="delete-folder-ungroup"
                                    className="text-left text-sm border border-black px-3 py-2 hover:bg-[#F5E4D4] transition-colors">
                                <span className="font-semibold">Solo desagrupar</span> — mantener las tesis en mi lista (sin megatesis)
                            </button>
                            <button onClick={() => deleteFolder(folderToDelete, "cascade")} data-testid="delete-folder-cascade"
                                    className="text-left text-sm border border-[#B32A22] text-[#B32A22] px-3 py-2 hover:bg-[#B32A22] hover:text-white transition-colors">
                                <span className="font-semibold">Borrar también las tesis</span> — eliminar la megatesis y su contenido
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
            {/* Generation already running → ask to queue (no parallel generations) */}
            {queueAsk && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" data-testid="queue-modal" onClick={() => setQueueAsk(null)}>
                    <div className="bg-white border border-black max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="font-serif text-xl font-medium mb-1">Ya hay una generación en curso</div>
                        <p className="text-sm text-[#4A4A4A] mb-4">
                            Se está generando «<strong>{queueAsk.active?.subject}</strong>». No se pueden generar dos tesis a la vez. ¿Quieres <strong>dejar esta en cola</strong> y que empiece automáticamente al terminar la anterior?
                        </p>
                        <div className="flex items-center gap-2">
                            <button onClick={confirmQueue} data-testid="queue-confirm"
                                    className="text-sm uppercase tracking-[0.1em] font-semibold bg-black text-[#FDF1E6] px-3 py-2 hover:bg-[#222] transition-colors">
                                Dejar en cola
                            </button>
                            <button onClick={() => setQueueAsk(null)} data-testid="queue-cancel"
                                    className="text-xs text-[#4A4A4A] hover:underline">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete company (start from 0) confirm modal */}
            {companyToDelete && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" data-testid="delete-company-modal" onClick={() => setCompanyToDelete(null)}>
                    <div className="bg-white border border-black max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="font-serif text-xl font-medium mb-1">Eliminar «{companyToDelete.title || companyToDelete.company?.ticker}»</div>
                        <p className="text-sm text-[#4A4A4A] mb-2">
                            Esto borra la empresa <strong>y todas las tesis de tendencia que generaste a partir de ella</strong> (se parte de cero).
                        </p>
                        <p className="text-sm text-[#4A4A4A] mb-4">
                            En las empresas que compartían esas tesis, su <strong>TAM Score</strong> de esas líneas desaparecerá y el tema volverá a aparecer como <strong>pendiente de generar</strong>. Para volver a tener esta empresa tendrás que <strong>buscarla y generar las tesis de nuevo</strong>. No se puede deshacer.
                        </p>
                        <div className="flex items-center gap-2">
                            <button onClick={confirmDeleteCompany} data-testid="delete-company-confirm"
                                    className="text-sm uppercase tracking-[0.1em] font-semibold bg-[#B32A22] text-white px-3 py-2 hover:bg-[#8f211b] transition-colors">
                                Eliminar y partir de 0
                            </button>
                            <button onClick={() => setCompanyToDelete(null)} data-testid="delete-company-cancel"
                                    className="text-xs text-[#4A4A4A] hover:underline">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
