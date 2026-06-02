import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, FolderPlus, Trash2, Loader2, TrendingUp, Building2, Folder, Radar, Flame, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
    thesisGenerate, thesisDiscover, thesisGenerateContra, thesisCreateFolder,
    thesisDeleteFolder, thesisAssignFolder, thesisDelete, thesisRadarStatus,
    thesisRadarSubscribe, thesisDashboard,
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
    const [pendingDup, setPendingDup] = useState(null);

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
            const [d, r] = await Promise.all([thesisDashboard(), thesisRadarStatus()]);
            setDash(d);
            setRadarEnabled(!!r.enabled);
        } catch { /* ignore */ }
    }, [user]);

    useEffect(() => { reload(); }, [reload]);

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

    const generate = async (overrideType, overrideSubject, matchedThesisId = null, opts = {}) => {
        const t = overrideType || mode;
        const s = (overrideSubject ?? subject).trim();
        if (!s) { toast.error("Escribe una tendencia o empresa"); return; }
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
            if (!(data.candidates || []).length) toast.info("No se detectaron tendencias claras ahora mismo.");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudieron detectar tendencias emergentes.");
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

    const createFolder = async () => {
        const n = newFolder.trim();
        if (!n) return;
        try {
            await thesisCreateFolder(n);
            setNewFolder("");
            toast.success("Megatendencia creada");
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
        try {
            await thesisAssignFolder(id, folderId || null);
            toast.success(folderId ? "Movida a la megatendencia" : "Quitada de la megatendencia");
            reload();
        } catch { toast.error("No se pudo mover la tesis"); }
    };

    const removeFolder = async (id) => {
        try { await thesisDeleteFolder(id); reload(); }
        catch { toast.error("No se pudo eliminar"); }
    };

    const removeThesis = async (id) => {
        try { await thesisDelete(id); reload(); toast.success("Tesis eliminada"); }
        catch { toast.error("No se pudo eliminar"); }
    };

    const examples = mode === "trend" ? EXAMPLES_TREND : EXAMPLES_COMPANY;

    return (
        <div data-testid="thesis-page">
            <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
                {/* Main column */}
                <div className="order-2 lg:order-1 min-w-0">
                    {/* Hero */}
                    <div className="mb-5">
                        <div className="overline text-[#B32A22] mb-1">Thesis Engine · Análisis cualitativo con IA</div>
                        <h1 className="font-serif text-4xl sm:text-5xl font-medium leading-tight">Tesis de inversión</h1>
                        <p className="text-base text-[#4A4A4A] mt-2 max-w-2xl leading-relaxed">
                            Mapea megatendencias a su cadena de valor y a las empresas líderes con un score cualitativo —
                            o parte de una empresa y descubre en qué tendencias encaja.
                        </p>
                    </div>

                    {/* Megatendencias management */}
                    {user && (
                        <div className="border border-black bg-white p-4 mb-6" data-testid="megatrends-bar">
                            <div className="overline text-black flex items-center gap-1 mb-1"><Folder size={12} /> Megatendencias</div>
                            <p className="text-[11px] text-[#4A4A4A] mb-3">Agrupa tus tendencias en megatendencias. Asigna cada tesis desde su selector en la lista de la derecha.</p>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                                {folders.length === 0 && <span className="text-[11px] text-[#9CA3AF]">Aún no hay megatendencias.</span>}
                                {folders.map((f) => (
                                    <span key={f.id} className="text-xs px-2 py-1 border border-black/30 flex items-center gap-1.5" data-testid={`megatrend-chip-${f.id}`}>
                                        <Folder size={11} /> {f.name}
                                        <span className="text-[10px] text-[#4A4A4A]">({f.trend_count})</span>
                                        <button onClick={() => removeFolder(f.id)} className="opacity-60 hover:opacity-100" title="Eliminar megatendencia">
                                            <Trash2 size={11} />
                                        </button>
                                    </span>
                                ))}
                            </div>
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

                    {/* Generator */}
                    <div className="border border-black bg-white p-5 mb-6" data-testid="thesis-generator">
                        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                            <div className="flex gap-0 border border-black w-fit">
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
                                    ? "Escaneando fuentes en busca de tendencias emergentes… ~40s."
                                    : "Buscando en la web e investigando con IA… esto puede tardar ~1-2 minutos."}
                            </div>
                        )}
                    </div>

                    {/* Discovered candidate trends */}
                    {candidates && candidates.length > 0 && (
                        <div className="border border-black bg-[#F5E4D4] p-4 mb-6" data-testid="thesis-candidates">
                            <div className="flex items-center gap-2 mb-3">
                                <Radar size={16} className="text-[#052049]" />
                                <span className="overline text-black">Tendencias emergentes detectadas</span>
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

                    {/* Dedup warning */}
                    {pendingDup && (
                        <div className="border border-[#B8860B] bg-[#FBF3E0] p-4 mb-6" data-testid="dedup-warning">
                            <div className="text-sm text-[#7a5a10] leading-relaxed">
                                Ya tienes esta {pendingDup.type === "trend" ? "tendencia" : "empresa"} guardada:{" "}
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

                    {/* Result, or the explore dashboard when idle */}
                    {result ? (
                        <ThesisResult
                            thesis={result}
                            canGenerateContra={!!result.id}
                            onGenerateContra={generateContra}
                            generatingContra={generatingContra}
                        />
                    ) : (user && dash && !loading && (
                        <ThesisExplore dash={dash} />
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
                            companies={dash?.companies || []}
                            folders={folders}
                            onAssignFolder={assignThesisFolder}
                            onRemoveThesis={removeThesis}
                            radarEnabled={radarEnabled}
                            onToggleRadar={toggleRadar}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
