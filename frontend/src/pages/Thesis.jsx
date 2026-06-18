import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, FolderPlus, Loader2, TrendingUp, Building2, Folder, Radar, Undo2, Redo2, RefreshCw, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
    thesisGenerate, thesisPollJob, thesisExplore, thesisAutoTrend, thesisSaveTendencia,
    thesisGenerateContra, thesisCreateFolder, thesisDeleteFolder, thesisAssignFolder,
    thesisDelete, thesisRadarStatus, thesisRadarSubscribe, thesisRadarSendNow, thesisDashboard,
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
    const [radarSchedule, setRadarSchedule] = useState({ weekday: 0, hour_utc: 7, last_sent_at: null, next_send_at: null });
    const [refreshEnabled, setRefreshEnabled] = useState(false);
    const [pendingDup, setPendingDup] = useState(null);
    const [overwriteTendenciaId, setOverwriteTendenciaId] = useState(null);  // armed by Reescribir on a tendencia match → saveTendencia replaces in place
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [folderToDelete, setFolderToDelete] = useState(null);
    const [companyToDelete, setCompanyToDelete] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [genStatus, setGenStatus] = useState(null);   // "processing" | "queued" while generating
    const [queueAsk, setQueueAsk] = useState(null);      // { active, retry } when a generation is already running

    const folders = dash?.folders || [];
    const _norm = (s) => (s || "").trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");   // strip accents for fuzzy

    // Sørensen-Dice similarity over character bigrams. Returns 0..1.
    // Used by the dedup-warning to flag "you already have something very similar"
    // when the user re-types a saved title in the trend search box.
    const _bigrams = (s) => {
        const set = new Set();
        for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
        return set;
    };
    const similarity = (a, b) => {
        const na = _norm(a); const nb = _norm(b);
        if (!na || !nb) return 0;
        if (na === nb) return 1;
        if (na.length < 2 || nb.length < 2) return 0;
        const ba = _bigrams(na); const bb = _bigrams(nb);
        let inter = 0;
        for (const x of ba) if (bb.has(x)) inter++;
        return (2 * inter) / (ba.size + bb.size);
    };
    const SIM_THRESHOLD = 0.80;

    // Strict ticker validator. Accepts plain letters (NVDA), numeric Asian codes
    // (7203.T, 9988.HK), exchange suffixes (.TO, .HK, .L…) and class suffix (BRK.B).
    // Empty and free-text inputs return false so the company search box can refuse them.
    const isValidTicker = (s) => /^[A-Z0-9]{1,6}(\.[A-Z]{1,3})?(-[A-Z])?$/.test((s || "").trim().toUpperCase());

    const findDup = (type, s) => {
        if (!dash) return null;
        if (type === "trend") {
            // Best fuzzy match across:
            //   - dash.tendencias (informativas, saved from "Tendencias → Empresas")
            //   - dash.trends (tesis-tendencia developed from drivers)
            //   - dash.company_theses (cross-match with company plans)
            // We surface ONE: { kind: "tendencia" | "trend" | "company", existing, score }.
            // In the user's terminology: "tendencia" = informativa; "trend" = tesis.
            let best = null;
            for (const t of (dash.tendencias || [])) {
                const score = similarity(s, t.title);
                if (score >= SIM_THRESHOLD && (!best || score > best.score)) {
                    best = { kind: "tendencia", existing: t, score };
                }
            }
            for (const t of (dash.trends || [])) {
                const score = similarity(s, t.title);
                if (score >= SIM_THRESHOLD && (!best || score > best.score)) {
                    best = { kind: "trend", existing: t, score };
                }
            }
            for (const c of (dash.company_theses || [])) {
                const score = similarity(s, c.title);
                if (score >= SIM_THRESHOLD && (!best || score > best.score)) {
                    best = { kind: "company", existing: c, score };
                }
            }
            return best ? { ...best.existing, _dup_kind: best.kind } : null;
        }
        // Company search: exact-ticker match only (the box rejects free text upstream).
        const up = (s || "").trim().toUpperCase();
        return (dash.company_theses || []).find((c) => (c.ticker || "").toUpperCase() === up);
    };

    const reload = useCallback(async () => {
        if (!user) { setDash(null); return; }
        try {
            const [d, r, rf] = await Promise.all([thesisDashboard(), thesisRadarStatus(), thesisRefreshStatus()]);
            setDash(d);
            setRadarEnabled(!!r.enabled);
            setRadarSchedule({
                weekday: r.weekday ?? 0,
                hour_utc: r.hour_utc ?? 7,
                last_sent_at: r.last_sent_at || null,
                next_send_at: r.next_send_at || null,
            });
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
        const explore = searchParams.get("explore");
        if (co) { setMode("company"); setSubject(co); }
        else if (explore) {
            // Coming from the weekly Radar email: pre-fill the trend-explorer
            // search box WITHOUT auto-executing — user must click "Explorar tendencia".
            setMode("explore");
            setSubject(explore);
        }
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
            const r = await thesisRadarSubscribe({ enabled: next });
            setRadarSchedule({
                weekday: r.weekday ?? 0,
                hour_utc: r.hour_utc ?? 7,
                last_sent_at: r.last_sent_at || null,
                next_send_at: r.next_send_at || null,
            });
            toast.success(next ? "Radar semanal activado" : "Radar semanal desactivado");
        } catch {
            setRadarEnabled(!next);
            toast.error("No se pudo actualizar el radar");
        }
    };

    const updateRadarSchedule = async (weekday, hour_utc) => {
        try {
            const r = await thesisRadarSubscribe({ enabled: radarEnabled, weekday, hour_utc });
            setRadarSchedule({
                weekday: r.weekday ?? weekday,
                hour_utc: r.hour_utc ?? hour_utc,
                last_sent_at: r.last_sent_at || null,
                next_send_at: r.next_send_at || null,
            });
        } catch {
            toast.error("No se pudo actualizar el horario del radar");
        }
    };

    const sendRadarNow = async () => {
        try {
            await thesisRadarSendNow();
            toast.success("Envío manual en curso · llegará en 1-2 minutos");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo disparar el envío");
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
        if (!s) { toast.error(t === "company" ? "Escribe un ticker" : "Escribe una tendencia"); return; }
        // Hard gate: company mode accepts ONLY valid tickers — never free text.
        if (t === "company" && !opts.force && !isValidTicker(s)) {
            toast.error("Introduce un ticker válido (p.ej. HIMS, LLY, BRK.B). Para buscar por nombre o concepto usa el modo Tendencia.");
            return;
        }
        // Dedup guard: if a saved thesis already matches, warn before rewriting.
        if (!opts.force && !matchedThesisId) {
            const dup = findDup(t, s);
            if (dup) {
                if (pendingDup && pendingDup.type === t && pendingDup.subject === s) {
                    // Second confirm pass: only set overwriteId when the dup is the
                    // same KIND as what we're generating (trend→trend or company→company).
                    // A cross-match (trend search hitting a company thesis) must NEVER
                    // overwrite the company plan — we generate the new trend alongside it.
                    if (!dup._dup_kind || dup._dup_kind === t) {
                        opts = { ...opts, overwriteId: dup.id };
                    }
                } else {
                    setPendingDup({ type: t, subject: s, existing: dup, kind: dup._dup_kind || t });
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
        // Per requirement: take the user to "Empresa → Tesis" with the ticker prefilled
        // and READY to press "Generar tesis" — but do NOT auto-generate.
        setResult(null);
        setPendingDup(null);
        setMode("company");
        setSubject(ticker);
        window.scrollTo({ top: 0, behavior: "smooth" });
        toast.info(`${ticker} listo en «Empresa → Tesis». Pulsa «Generar tesis» cuando quieras.`);
    };

    // Informational (structural-only) trend exploration.
    const runExplore = async (opts = {}) => {
        const s = subject.trim();
        if (!s) { toast.error("Escribe una tendencia"); return; }
        // Dedup guard: warn BEFORE spending ~60s of LLM if the user already has a
        // similar tendencia, tesis-tendencia or tesis de empresa (≥80% Sørensen-Dice).
        if (!opts.force) {
            const dup = findDup("trend", s);
            if (dup) {
                setPendingDup({ type: "trend", subject: s, existing: dup, kind: dup._dup_kind || "trend", origin: "explore" });
                return;
            }
        }
        setPendingDup(null);
        // If Reescribir was clicked on a TENDENCIA match, arm the save call to delete
        // the old doc before inserting the new one. The id travels via state so it
        // survives the explore→show-result→user-clicks-save async gap.
        setOverwriteTendenciaId(opts.overwriteTendenciaId || null);
        setTrendLoading(true);
        setResult(null);
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
            const res = await thesisSaveTendencia(result, overwriteTendenciaId);
            setResult({ ...result, id: res.id, saved: true });
            toast.success(overwriteTendenciaId ? "Tendencia reescrita" : "Tendencia guardada");
            setOverwriteTendenciaId(null);  // consumed
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
            toast.success("Megatendencia creada");
            pushAction({ type: "create_folder", folder: { id: f.id, name: f.name, created_at: f.created_at } });
            reload();
        } catch { toast.error("No se pudo crear la megatesis"); }
    };

    const assignThesisFolder = async (id, folderId) => {
        const prev = (dash?.tendencias || []).find((t) => t.id === id)?.folder_id || null;
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
                                <button onClick={manualRefresh} disabled={refreshing} title="Refrescar: vuelve a leer los fundamentales de Yahoo (revenue, FCF…) y recalcula los TAM Scores con los números frescos. No toca los scores cualitativos." data-testid="refresh-data-btn"
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
                                            onChange={(v) => setSubject((v || "").toUpperCase())}
                                            onPick={(r) => setSubject((r.symbol || "").toUpperCase())}
                                            onEnter={() => !loading && generate()}
                                            placeholder="Ej.: NVDA, ASML, BRK.B…"
                                            testid="thesis-input"
                                            disabled={loading}
                                        />
                                        {subject.trim() && !isValidTicker(subject) && (
                                            <div className="mt-1 text-[11px] text-[#B32A22]" data-testid="thesis-input-hint">
                                                Solo tickers (p.ej. NVDA, BRK.B). Para buscar por nombre o concepto usa <strong>Tendencias → Empresas</strong>.
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => generate()} disabled={busy || !isValidTicker(subject)} className="btn-primary flex items-center justify-center gap-2 !px-5 disabled:opacity-50 disabled:cursor-not-allowed" data-testid="thesis-generate-btn">
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

                    {/* Dedup / overwrite warning. The "kind" tag uses the user's
                        terminology: TENDENCIA = informativa (from "Tendencias → Empresas"),
                        TESIS = tesis-tendencia (developed from a driver). The buttons
                        adapt to make machacar only available when same-kind. */}
                    {pendingDup && (() => {
                        const k = pendingDup.kind;
                        const origin = pendingDup.origin;
                        // "Same kind" = can be overwritten in place:
                        //   • company search (k=company) → ok.
                        //   • explore origin (creates a tendencia) matching another tendencia (k=tendencia) → ok.
                        //   • generate origin (creates a tesis-tendencia, type=trend) matching a tesis (k=trend) → ok.
                        const isSameKind = (
                            (pendingDup.type === "company" && k === "company") ||
                            (pendingDup.type === "trend" && origin === "explore" && k === "tendencia") ||
                            (pendingDup.type === "trend" && origin === "generate" && k === "trend")
                        );
                        const existingNoun = k === "tendencia" ? "tendencia" : (k === "company" ? "tesis de empresa" : "tesis");
                        return (
                        <div className="border border-[#B8860B] bg-[#FBF3E0] p-4 mb-6" data-testid="dedup-warning">
                            <div className="text-sm text-[#7a5a10] leading-relaxed">
                                {isSameKind && pendingDup.type === "company" ? (
                                    <>
                                        Ya tienes esta empresa guardada:{" "}
                                        <Link to={`/thesis/${pendingDup.existing.id}`} className="font-bold underline" data-testid="dedup-existing-link">{pendingDup.existing.title}</Link>.{" "}
                                        Si continúas, se <strong>reescribirá desde cero</strong> el contenido cualitativo y se <strong>borrarán las tesis de tendencia generadas previamente desde este plan</strong>. La parte cuantitativa (fundamentales, TAM Score) se refresca aparte con el botón <em>Refrescar</em>; <strong>regenerar es lo único que actualiza lo cualitativo</strong>.
                                    </>
                                ) : isSameKind ? (
                                    <>
                                        Ya tienes una <strong>{existingNoun} parecida</strong> guardada:{" "}
                                        <Link to={`/thesis/${pendingDup.existing.id}`} className="font-bold underline" data-testid="dedup-existing-link">{pendingDup.existing.title}</Link>.{" "}
                                        Si quieres <strong>actualizarla</strong> con datos frescos → reescríbela (la machaca). Si hay un <strong>matiz distinto</strong> que merece su propia {existingNoun} → genera una nueva y conviven las dos. Si fue un error, cancela.
                                    </>
                                ) : (
                                    <>
                                        Ya tienes una <strong>{existingNoun}</strong> con un nombre parecido:{" "}
                                        <Link to={`/thesis/${pendingDup.existing.id}`} className="font-bold underline" data-testid="dedup-existing-link">{pendingDup.existing.title}</Link>.{" "}
                                        Si lo que buscas es información ábrela. Si realmente quieres explorar esto como <strong>tendencia nueva</strong> (con un matiz distinto), puedes generarla; las dos coexistirán. La {existingNoun} <strong>NO se sobreescribe desde aquí</strong> (sólo desde su flujo propio).
                                    </>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                                {/* Reescribir (machacar) — only when same kind. Route to the right
                                    flow: explore→tendencia (set overwriteId for save) vs generate→tesis. */}
                                {isSameKind && (
                                    <button
                                        onClick={() => {
                                            if (pendingDup.type === "trend" && origin === "explore") {
                                                runExplore({ force: true, overwriteTendenciaId: pendingDup.existing.id });
                                            } else {
                                                generate(pendingDup.type, pendingDup.subject, null, { force: true, overwriteId: pendingDup.existing.id });
                                            }
                                        }}
                                        className="text-xs uppercase tracking-[0.1em] font-semibold bg-[#B8860B] text-white px-3 py-1.5 hover:bg-[#946c09] transition-colors"
                                        data-testid="dedup-rewrite-btn"
                                    >
                                        Reescribir (machacar)
                                    </button>
                                )}
                                {/* Generar como nueva — keeps origin flow (explore stays explore). */}
                                {pendingDup.type === "trend" && (
                                    <button
                                        onClick={() => {
                                            if (origin === "explore") runExplore({ force: true });
                                            else generate(pendingDup.type, pendingDup.subject, null, { force: true });
                                        }}
                                        className={`text-xs uppercase tracking-[0.1em] font-semibold px-3 py-1.5 transition-colors ${isSameKind ? "border border-[#B8860B] text-[#7a5a10] hover:bg-[#B8860B] hover:text-white" : "bg-[#B8860B] text-white hover:bg-[#946c09]"}`}
                                        data-testid="dedup-generate-new-btn"
                                    >
                                        {isSameKind ? "Generar como nueva" : "Generar como tendencia"}
                                    </button>
                                )}
                                <Link to={`/thesis/${pendingDup.existing.id}`} className="text-xs uppercase tracking-[0.1em] font-semibold border border-[#B8860B] text-[#7a5a10] px-3 py-1.5 hover:bg-[#B8860B] hover:text-white transition-colors" data-testid="dedup-open-btn">
                                    Abrir la existente
                                </Link>
                                <button onClick={() => setPendingDup(null)} className="text-xs text-[#7a5a10] hover:underline" data-testid="dedup-cancel-btn">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                        );
                    })()}

                    {/* Megatendencias management */}
                    {user && (
                        <div className="border border-black bg-white p-4 mb-6" data-testid="megatrends-bar">
                            <div className="overline text-black flex items-center gap-1 mb-1"><Folder size={12} /> Megatendencias</div>
                            <p className="text-[11px] text-[#4A4A4A] mb-3">Agrupa tus tendencias en megatendencias. Crea una abajo, asígnala desde el selector de cada tendencia (lista de la derecha) y elimínala desde su cuadro en la vista <strong>Megatendencias</strong>.</p>
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

                    {/* Save bar — theses (company / trend) just link to detail; tendencias save inline. */}
                    {result && !isTendencia && user && result.id && (
                        <div className="border border-black bg-[#F5E4D4] p-3 mb-6 flex items-center gap-3 flex-wrap" data-testid="thesis-save-bar">
                            <Link to={`/thesis/${result.id}`} className="btn-primary flex items-center gap-1.5 !px-4" data-testid="thesis-view-detail">
                                Ver en detalle <ArrowRight size={14} />
                            </Link>
                        </div>
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
                        <ThesisExplore dash={dash} onDeleteFolder={setFolderToDelete} onPrepareThesis={developCompanyFromTendencia} />
                    ))}
                </div>

                {/* Sidebar */}
                <div className="order-1 lg:order-2">
                    {!user ? (
                        <aside className="border border-black bg-white p-4" data-testid="thesis-sidebar">
                            <div className="overline text-black mb-2">Tendencias y empresas</div>
                            <div className="text-sm text-[#4A4A4A]">Inicia sesión con Google para guardar tus tendencias y empresas y consultarlas cuando quieras.</div>
                        </aside>
                    ) : (
                        <ThesisSidebar
                            tendencias={dash?.tendencias || []}
                            companyTheses={dash?.company_theses || []}
                            folders={folders}
                            onAssignFolder={assignThesisFolder}
                            onRemoveThesis={removeThesis}
                            radarEnabled={radarEnabled}
                            onToggleRadar={toggleRadar}
                            radarSchedule={radarSchedule}
                            onUpdateRadarSchedule={updateRadarSchedule}
                            onSendRadarNow={sendRadarNow}
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
                            Esta megatendencia agrupa <strong>{folderToDelete.tendencia_count || 0} tendencias</strong>. ¿Qué quieres hacer con ellas?
                        </p>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => deleteFolder(folderToDelete, "ungroup")} data-testid="delete-folder-ungroup"
                                    className="text-left text-sm border border-black px-3 py-2 hover:bg-[#F5E4D4] transition-colors">
                                <span className="font-semibold">Solo desagrupar</span> — mantener las tendencias en mi lista (sin megatendencia)
                            </button>
                            <button onClick={() => deleteFolder(folderToDelete, "cascade")} data-testid="delete-folder-cascade"
                                    className="text-left text-sm border border-[#B32A22] text-[#B32A22] px-3 py-2 hover:bg-[#B32A22] hover:text-white transition-colors">
                                <span className="font-semibold">Borrar también las tendencias</span> — eliminar la megatendencia y su contenido
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
