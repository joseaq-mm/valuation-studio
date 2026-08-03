import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ZAxis, Customized } from "recharts";
import { Loader2, RotateCcw, ArrowUp, ArrowDown, Bell, BellRing, Play, Pause, Clock, Circle, Square, FolderOpen, Trash2, Maximize2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisVisualData, thesisVisualTimeline, alertsGet, alertSave, alertDelete } from "@/lib/api";
import { addMediaItem, countMediaItems, clearMediaItems } from "@/lib/mediaLibrary";
import { ExportLibrary } from "@/components/ExportLibrary";
import { getPortfolio } from "@/lib/portfolio";
import { getWatchlistTickers } from "@/lib/storage";
import HoverTip from "@/components/HoverTip";
import PinchZoomPane from "@/components/PinchZoomPane";
import { FreshnessBadge } from "@/components/FreshnessBadge";
import { signalFor } from "@/lib/thresholds";
import { toast } from "sonner";

// ---------- Helpers ----------
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Next-earnings date badge. Red/bold when the report is due in ≤7 days; muted when the
// estimated date has already passed; "≈" prefix marks a tentative (estimated) date.
function EarningsBadge({ date, estimated, testid }) {
    if (!date) return <span className="text-[#9A9A9A]" data-testid={testid}>—</span>;
    const d = new Date(date);
    if (isNaN(d.getTime())) return <span className="text-[#9A9A9A]" data-testid={testid}>—</span>;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    const sameYear = d.getUTCFullYear() === new Date().getFullYear();
    const label = `${estimated ? "≈" : ""}${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}${sameYear ? "" : " '" + String(d.getUTCFullYear()).slice(2)}`;
    const imminent = days >= 0 && days <= 7;
    // "Próximos resultados" is by definition a future date → only normal or bold (≤7d).
    const weight = imminent ? 700 : 400;
    const tip = days < 0
        ? `Fecha de resultados pendiente de actualizar por Yahoo (${label}).`
        : imminent
            ? `¡Resultados ${days === 0 ? "hoy" : "en " + days + " día" + (days === 1 ? "" : "s")}! (${label})${estimated ? " · fecha estimada" : ""}`
            : `Próximos resultados${estimated ? " (estimado)" : ""}: faltan ${days} días (${label}).`;
    return (
        <HoverTip text={tip}>
            <span className="font-mono tabular-nums cursor-help whitespace-nowrap" style={{ color: "#111111", fontWeight: weight }} data-testid={testid}>
                {label}
            </span>
        </HoverTip>
    );
}

// Last published earnings date. Plain/muted (a past reference date, never colour-coded).
function LastEarningsBadge({ date, testid }) {
    if (!date) return <span className="text-[#9A9A9A]" data-testid={testid}>—</span>;
    const d = new Date(date);
    if (isNaN(d.getTime())) return <span className="text-[#9A9A9A]" data-testid={testid}>—</span>;
    const sameYear = d.getUTCFullYear() === new Date().getFullYear();
    const label = `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}${sameYear ? "" : " '" + String(d.getUTCFullYear()).slice(2)}`;
    return (
        <HoverTip text={`Últimos resultados publicados: ${label}.`}>
            <span className="font-mono tabular-nums cursor-help whitespace-nowrap text-[#4A4A4A]" data-testid={testid}>
                {label}
            </span>
        </HoverTip>
    );
}

const clamp01 = (v) => (v == null ? 0 : Math.max(0, Math.min(1, v)));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const KPI_BETA = 0.5; // intensidad de la modulación del coeficiente KPI

/** Parte cualitativa base — media normalizada de Score y TAM Score (sin precio, sin KPI). */
const qualBase = (r) => {
    const s = clamp01((r.avg_overall_score || 0) / 100);
    const t = clamp01((r.sum_tam_score || 0) / 30);
    return (s + t) / 2;
};

/** Parte de precio — media normalizada de Ratio Compra y Venta. */
const priceBase = (r) => {
    const rc = clamp01(((r.ratio_compra_pct ?? -50) + 50) / 150);
    const rv = clamp01(((r.ratio_venta_pct ?? -50) + 50) / 150);
    return (rc + rv) / 2;
};

/** Factor KPI relativo: punto neutro = promedio de 1 (absoluto) y la media del universo.
 *  C por encima del neutro mejora el combinado; por debajo lo empeora. Sin KPI → 1 (neutro). */
const kpiFactor = (C, neutro) => {
    if (C == null || typeof C !== "number") return 1;
    return clamp(1 + KPI_BETA * (C - neutro), 0.6, 1.4);
};

/** Aguja KPI: dirección por matriz 2×2 (absoluto C↔1 = izq/dcha; relativo C↔media = arriba/abajo),
 *  inclinación 0°→45° y fuerza ∝ |C − media| normalizada (REF = mayor desviación relativa del universo). */
const kpiArrow = (C, media, REF) => {
    if (C == null || typeof C !== "number") return null;
    const rdev = C - media;   // relativo  → arriba (≥0) / abajo (<0)
    const adev = C - 1;       // absoluto  → derecha (≥0) / izquierda (<0)
    const side = adev >= 0 ? 1 : -1;
    const vert = rdev >= 0 ? 1 : -1;
    const strength = REF > 0 ? clamp(Math.abs(rdev) / REF, 0, 1) : 0;
    let color;
    if (adev >= 0 && rdev >= 0) color = "#1D7044";      // verde · arriba-dcha
    else if (adev >= 0 && rdev < 0) color = "#B8860B";  // ámbar · abajo-dcha
    else if (adev < 0 && rdev >= 0) color = "#B8860B";  // ámbar · arriba-izq
    else color = "#B32A22";                              // rojo  · abajo-izq
    return { side, vert, strength, color };
};

// Header tooltips (Score → Combinado total)
const TIP = {
    score: "Score global cualitativo (0–100): media de la calidad de la empresa en las tesis donde aparece. Combina posición competitiva, momentum del sector, calidad del management y resiliencia financiera.",
    tam: "TAM Score (suma): potencial de mercado atribuido a la empresa. Mezcla su calidad con el trozo de TAM que le toca frente a sus ingresos proyectados, sumado en todas sus tesis. >1 = oportunidad grande respecto a su tamaño actual.",
    kpi: "Coeficiente KPI (0,5–1,5): validación operativa de la tesis con datos reales (ARR, NRR, backlog…). C = 1 + 0,5·S, donde S es la señal cuantitativa. >1 = los KPIs confirman la tesis; <1 = la refutan. Modula los combinados respecto a la media del universo. «—» = aún sin analizar en /kpis.",
    combined_qual: "Combinado cualitativo (0–100%): une el Score y el TAM Score, modulado por el coeficiente KPI (relativo a la media de todas las empresas con KPI). Mide la fuerza CUALITATIVA total — calidad + potencial + validación operativa — sin precio.",
    compra: "Ratio de Compra (%): distancia del precio actual al Precio Objetivo de Compra (POC). Positivo y alto = potencialmente barata.",
    venta: "Ratio de Venta (%): distancia del precio actual al Precio Objetivo de Venta (POV). Avisa de cuándo se agota el recorrido al alza.",
    combined: "Combinado total (0–100%): índice global que une calidad + potencial + validación KPI (vía el Combinado cualitativo) y la valoración (Compra/Venta). El coeficiente KPI cuenta una sola vez (no se dobla su peso).",
};

const fmtPct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtN = (v, d = 1) => (v == null ? "—" : v.toFixed(d));
const coefColor = (c) => (c == null ? "#9ca3af" : c > 1.05 ? "#1D7044" : c < 0.95 ? "#B32A22" : "#B8860B");

// ---------- Quadrant background labels (with subtitle) ----------
const QuadrantLabels = () => (
    <>
        {/* TL: low score + alto ratio compra (barata relativa) → trampa */}
        <text x="12%" y="10%" textAnchor="start" fill="#B8860B" fillOpacity={0.55} fontSize={14} fontWeight={700}>⚠️ TRAMPA DE VALOR</text>
        <text x="12%" y="10%" dy={14} textAnchor="start" fill="#B8860B" fillOpacity={0.55} fontSize={10} fontStyle="italic">Calidad baja + barata → auditar bien antes</text>

        {/* TR: high score + alto ratio compra → joya */}
        <text x="88%" y="10%" textAnchor="end" fill="#1D7044" fillOpacity={0.65} fontSize={14} fontWeight={700}>🏆 JOYAS ESCONDIDAS</text>
        <text x="88%" y="10%" dy={14} textAnchor="end" fill="#1D7044" fillOpacity={0.65} fontSize={10} fontStyle="italic">Calidad alta + descuento → comprar</text>

        {/* BL: low score + bajo ratio compra (cara) → sobrevalorada */}
        <text x="12%" y="80%" textAnchor="start" fill="#B32A22" fillOpacity={0.55} fontSize={14} fontWeight={700}>🚫 SOBREVALORADA</text>
        <text x="12%" y="80%" dy={14} textAnchor="start" fill="#B32A22" fillOpacity={0.55} fontSize={10} fontStyle="italic">Calidad baja + cara → ignorar</text>

        {/* BR: high score + bajo ratio compra → premium, esperar */}
        <text x="88%" y="80%" textAnchor="end" fill="#4A4A4A" fillOpacity={0.65} fontSize={14} fontWeight={700}>💎 PREMIUM</text>
        <text x="88%" y="80%" dy={14} textAnchor="end" fill="#4A4A4A" fillOpacity={0.65} fontSize={10} fontStyle="italic">Calidad alta + cara → esperar entrada</text>
    </>
);

// ---------- Custom dot ----------
// Colour is driven by the user's Ratio Venta thresholds (Umbrales cara/justa/barata)
// so that the visual quadrant matches the rest of the app (portfolio, company page).
// The chart subscribes to `vs:thresholds-changed` so when the user opens the dialog
// and edits cheap/fair, the dots re-paint immediately without a full reload.
const colorForRv = (rv) => signalFor(rv, "venta").color;

const DEG = Math.PI / 180;
// KPI needle: radial arrow emerging from the dot's edge. Angle measured from the
// center; tilt (0–45°) + length scale with relative strength. Direction & colour
// follow the 2×2 matrix (absolute C↔1 = left/right, relative C↔mean = up/down).
const KpiNeedle = ({ cx, cy, r, arrow }) => {
    const tilt = 45 * arrow.strength * DEG;
    const dirX = arrow.side * Math.cos(tilt);
    const dirY = -arrow.vert * Math.sin(tilt); // screen y is inverted (up = negative)
    const len = 11 + 30 * arrow.strength;
    const x0 = cx + r * dirX, y0 = cy + r * dirY;
    const x1 = cx + (r + len) * dirX, y1 = cy + (r + len) * dirY;
    const ang = Math.atan2(dirY, dirX);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const px = -uy, py = ux;
    const h = 7, w = 4;
    const bx = x1 - h * ux, by = y1 - h * uy;
    return (
        <g pointerEvents="none">
            <line x1={x0} y1={y0} x2={bx} y2={by} stroke={arrow.color} strokeWidth={2.6} strokeLinecap="round" />
            <polygon points={`${x1},${y1} ${bx + w * px},${by + w * py} ${bx - w * px},${by - w * py}`} fill={arrow.color} stroke="#000" strokeWidth={0.5} />
        </g>
    );
};

const Dot = (props) => {
    const { cx, cy, payload } = props;
    const r = Math.max(5, Math.min(22, 4 + Math.sqrt(Math.max(0, payload.sum_tam_score || 0)) * 2.2));
    return (
        <g>
            <circle cx={cx} cy={cy} r={r} fill={colorForRv(payload.ratio_venta_pct)} fillOpacity={0.75} stroke="#000" strokeWidth={1} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" pointerEvents="none">{payload.ticker}</text>
            {payload.kpi_arrow && <KpiNeedle cx={cx} cy={cy} r={r} arrow={payload.kpi_arrow} />}
        </g>
    );
};

// ---------- Timeline helpers ----------
const monthLabel = (m) => {
    if (!m) return "";
    const [y, mo] = m.split("-").map(Number);
    return `${MONTHS_ES[mo - 1]} '${String(y).slice(2)}`;
};

// Trail layer: draws each visible company's path through the quadrant up to the
// current step. Rendered via recharts <Customized> so we can use the live axis
// scales (xAxisMap/yAxisMap) to map data coords → pixels.
const TrailLayer = (props) => {
    const { xAxisMap, yAxisMap, trails } = props;
    if (!trails || !xAxisMap || !yAxisMap) return null;
    const xa = Object.values(xAxisMap)[0];
    const ya = Object.values(yAxisMap)[0];
    if (!xa?.scale || !ya?.scale) return null;
    const sx = xa.scale, sy = ya.scale;
    return (
        <g pointerEvents="none">
            {trails.map((tr) => {
                if (!tr.path || tr.path.length < 2) return null;
                const pts = tr.path.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");
                const last = tr.path[tr.path.length - 1];
                const first = tr.path[0];
                return (
                    <g key={tr.ticker}>
                        <polyline points={pts} fill="none" stroke={tr.color} strokeOpacity={0.6} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                        {tr.path.map((p, i) => (
                            <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.2} fill={tr.color} fillOpacity={0.55} />
                        ))}
                        {/* hollow marker at the start of the path (oldest point) */}
                        <circle cx={sx(first.x)} cy={sy(first.y)} r={3.5} fill="#fff" stroke={tr.color} strokeWidth={1.5} fillOpacity={0.9} />
                    </g>
                );
            })}
        </g>
    );
};


const ScatterTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    return (
        <div className="bg-white border border-black p-3 text-xs font-mono shadow-lg" style={{ minWidth: 220 }}>
            <div className="font-semibold text-black text-sm mb-1">{p.ticker}</div>
            <div className="text-[#4A4A4A] text-[11px] mb-2 font-sans">{p.name}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div className="text-[#4A4A4A]">Score</div><div className="text-right">{fmtN(p.avg_overall_score)}</div>
                <div className="text-[#4A4A4A]">TAM Score</div><div className="text-right">{fmtN(p.sum_tam_score, 2)}</div>
                <div className="text-[#4A4A4A]">Ratio Compra</div><div className="text-right">{fmtPct(p.ratio_compra_pct)}</div>
                <div className="text-[#4A4A4A]">Ratio Venta</div><div className="text-right">{fmtPct(p.ratio_venta_pct)}</div>
                {typeof p.kpi_coef === "number" && (<>
                    <div className="text-[#4A4A4A]">Coef KPI</div><div className="text-right" style={{ color: coefColor(p.kpi_coef) }}>{p.kpi_coef.toFixed(2)}</div>
                </>)}
                <div className="text-[#4A4A4A] border-t border-black/10 pt-1 mt-1">Combinado</div><div className="text-right border-t border-black/10 pt-1 mt-1 font-semibold">{(p.combined * 100).toFixed(1)}%</div>
            </div>
        </div>
    );
};

// ---------- Page ----------
export default function Visual() {
    const { user } = useAuth();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(new Set()); // all unchecked by default
    const [sortKey, setSortKey] = useState("combined");
    const [sortDir, setSortDir] = useState("desc");
    const [kpiMean, setKpiMean] = useState(null);
    const [noKpiCount, setNoKpiCount] = useState(0);
    const [alerts, setAlerts] = useState({});  // ticker -> alert config

    // --- Timeline (time dial) ---
    const [tlMode, setTlMode] = useState(false);
    const [tl, setTl] = useState(null);          // { months, current_month, series }
    const [tlLoading, setTlLoading] = useState(false);
    const [tlErr, setTlErr] = useState(null);
    const [tlIdx, setTlIdx] = useState(0);
    const [tlPlaying, setTlPlaying] = useState(false);
    const [tlTrail, setTlTrail] = useState(true);
    const [tlSpeed, setTlSpeed] = useState(600); // ms per step

    // --- Recording / export library ---
    const chartRef = useRef(null);
    const recCancelRef = useRef(false);
    const [recArmed, setRecArmed] = useState(false);
    const [recording, setRecording] = useState(false);
    const [clipCount, setClipCount] = useState(0);
    const [libOpen, setLibOpen] = useState(false);
    const [chartFull, setChartFull] = useState(false);   // fullscreen chart overlay (manual "Ampliar")
    useEffect(() => { countMediaItems("timeline-clip").then(setClipCount).catch(() => {}); }, []);

    // Lock body scroll + allow ESC to close while the fullscreen chart is open.
    useEffect(() => {
        if (!chartFull) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKey = (e) => { if (e.key === "Escape") setChartFull(false); };
        window.addEventListener("keydown", onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
    }, [chartFull]);

    const enableTimeline = useCallback(async () => {
        if (tl) { setTlMode(true); return; }
        setTlLoading(true); setTlErr(null);
        try {
            const d = await thesisVisualTimeline();
            setTl(d);
            setTlIdx(Math.max(0, (d.months || []).length - 1));
            setTlMode(true);
        } catch (e) {
            setTlErr(e?.response?.data?.detail || e.message || "No se pudo cargar la línea de tiempo");
        } finally { setTlLoading(false); }
    }, [tl]);

    // Playback loop
    useEffect(() => {
        if (!tlPlaying || !tl) return;
        const last = (tl.months || []).length - 1;
        if (tlIdx >= last) { setTlPlaying(false); return; }
        const id = setTimeout(() => setTlIdx((i) => Math.min(last, i + 1)), tlSpeed);
        return () => clearTimeout(id);
    }, [tlPlaying, tlIdx, tl, tlSpeed]);

    // Rasterize the live chart SVG onto a canvas (one frame).
    const drawFrame = useCallback((canvas, ctx) => new Promise((resolve, reject) => {
        const svg = chartRef.current && chartRef.current.querySelector("svg");
        if (!svg) return reject(new Error("no-svg"));
        const rect = svg.getBoundingClientRect();
        const clone = svg.cloneNode(true);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", rect.width);
        clone.setAttribute("height", rect.height);
        const xml = new XMLSerializer().serializeToString(clone);
        const img = new Image();
        img.onload = () => {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve();
        };
        img.onerror = reject;
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    }), []);

    // Record a full playthrough of the time dial into a WebM clip (canvas capture).
    const recordPlaythrough = useCallback(async () => {
        if (!tl || !chartRef.current) return;
        const svg = chartRef.current.querySelector("svg");
        if (!svg || !window.MediaRecorder) { toast.error("La grabación no está disponible en este navegador"); return; }
        const rect = svg.getBoundingClientRect();
        const scale = 1.75;  // supersample for sharper output
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(rect.width * scale); canvas.height = Math.round(rect.height * scale);
        const ctx = canvas.getContext("2d");
        // Prefer MP4 (H.264) — universal & higher quality — then fall back to WebM.
        const candidates = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
        const mime = candidates.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "video/webm";
        const baseMime = mime.startsWith("video/mp4") ? "video/mp4" : "video/webm";
        const stream = canvas.captureStream(0);
        const vtrack = stream.getVideoTracks()[0];
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const stopped = new Promise((res) => { rec.onstop = res; });
        setTlPlaying(false);
        setRecording(true);
        recCancelRef.current = false;
        const fps = tlSpeed <= 250 ? 12 : (tlSpeed <= 600 ? 8 : 5);
        const frameMs = 1000 / fps;
        const wait2raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        rec.start();
        try {
            const N = tl.months.length;
            for (let i = 0; i < N; i++) {
                if (recCancelRef.current) break;
                setTlIdx(i);
                await wait2raf();
                await drawFrame(canvas, ctx);
                if (vtrack.requestFrame) vtrack.requestFrame();
                await sleep(frameMs);
            }
            await drawFrame(canvas, ctx);
            if (vtrack.requestFrame) vtrack.requestFrame();
            await sleep(600);
        } catch (e) {
            toast.error("Error durante la grabación");
        } finally {
            rec.stop();
            await stopped;
            setRecording(false);
        }
        if (recCancelRef.current || !chunks.length) { toast("Grabación cancelada"); return; }
        try {
            const blob = new Blob(chunks, { type: baseMime });
            const thumb = canvas.toDataURL("image/png");
            const now = new Date();
            const name = `Recorrido ${now.toLocaleDateString("es-ES")} ${now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
            await addMediaItem({ kind: "timeline-clip", name, mime: baseMime, blob, thumbnail: thumb, meta: { months: tl.months.length } });
            setClipCount(await countMediaItems("timeline-clip"));
            toast.success("Recorrido grabado ✓");
        } catch (e) { toast.error("No se pudo guardar el clip"); }
    }, [tl, tlSpeed, drawFrame]);

    const onTimelinePlay = useCallback(() => {
        if (recording) { recCancelRef.current = true; return; }   // acts as Stop
        if (recArmed) { setTlIdx(0); recordPlaythrough(); return; }
        if (!tl) return;
        if (tlIdx >= tl.months.length - 1) setTlIdx(0);
        setTlPlaying((p) => !p);
    }, [recording, recArmed, tl, tlIdx, recordPlaythrough]);

    const clearClips = useCallback(async () => {
        const n = await clearMediaItems("timeline-clip");
        setClipCount(0);
        toast.success(`${n} clip(s) borrados`);
    }, []);


    useEffect(() => {
        if (!user) { setAlerts({}); return; }
        alertsGet().then((d) => setAlerts(d.alerts || {})).catch(() => { });
    }, [user]);

    const onAlertSaved = useCallback((ticker, alert) => {
        setAlerts((prev) => {
            const next = { ...prev };
            if (alert) next[ticker] = alert; else delete next[ticker];
            return next;
        });
    }, []);

    // Filters (only affect map visibility, not the table)
    const [filters, setFilters] = useState({
        score: 0,
        tam: 0,
        kpi: -10000,
        rc: -10000,
        rv: -10000,
        cqual: 0,
        ctotal: 0,
        level: "both",  // "both" | "n1" (Cartera) | "n2" (Seguimiento)
    });

    // Ticker membership of Nivel 1 (Cartera) and Nivel 2 (Seguimiento), read from
    // local storage (kept in sync with the cloud by WatchlistCloudSync).
    const [n1Set, setN1Set] = useState(() => new Set());
    const [n2Set, setN2Set] = useState(() => new Set());
    useEffect(() => {
        const load = () => {
            setN1Set(new Set(getPortfolio().map((p) => (p.ticker || "").toUpperCase())));
            setN2Set(new Set(getWatchlistTickers().map((t) => (t || "").toUpperCase())));
        };
        load();
        window.addEventListener("vs:portfolio-changed", load);
        window.addEventListener("vs:watchlist-changed", load);
        return () => {
            window.removeEventListener("vs:portfolio-changed", load);
            window.removeEventListener("vs:watchlist-changed", load);
        };
    }, []);

    // Load on mount (and whenever user changes). All rows start SELECTED so the
    // map shows everything immediately — user uncheck to narrow it down.
    const reload = useCallback(async () => {
        if (!user) { setRows([]); setSelected(new Set()); return; }
        setLoading(true); setError(null);
        try {
            const d = await thesisVisualData();
            const raw = d.rows || [];
            // Media de coef KPI sobre TODAS las empresas que tienen KPI (las demás no cuentan).
            const coefs = raw.map((r) => r.kpi_coef).filter((v) => typeof v === "number");
            const mediaC = coefs.length ? coefs.reduce((a, b) => a + b, 0) / coefs.length : 1;
            const neutro = (1 + mediaC) / 2;
            const REF = coefs.length ? Math.max(...coefs.map((c) => Math.abs(c - mediaC))) : 0;
            const enriched = raw.map((r) => {
                const f = kpiFactor(r.kpi_coef, neutro);
                const cq = clamp01(qualBase(r) * f);
                return { ...r, kpi_factor: f, kpi_arrow: kpiArrow(r.kpi_coef, mediaC, REF), combined_qual: cq, combined: (cq + priceBase(r)) / 2 };
            });
            setRows(enriched);
            setKpiMean(coefs.length ? mediaC : null);
            setNoKpiCount(raw.length - coefs.length);
            setSelected(new Set(enriched.map((r) => r.ticker)));
        } catch (e) {
            setError(e?.response?.data?.detail || e.message);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { reload(); }, [reload]);

    // Live-update dot colours when the user edits the cheap/fair thresholds.
    // ThresholdsDialog dispatches `vs:thresholds-changed`; we bump a tick to force
    // recharts to re-render the Scatter dots (signalFor reads localStorage on demand).
    const [, setThresholdsTick] = useState(0);
    useEffect(() => {
        const onChange = () => setThresholdsTick((n) => n + 1);
        window.addEventListener("vs:thresholds-changed", onChange);
        return () => window.removeEventListener("vs:thresholds-changed", onChange);
    }, []);

    // A row passes the numeric filters (drives both map visibility and table marking).
    const passesFilters = useCallback((r, f) => {
        const lvl = f.level || "both";
        const tk = (r.ticker || "").toUpperCase();
        if (lvl === "n1" && !n1Set.has(tk)) return false;
        if (lvl === "n2" && !n2Set.has(tk)) return false;
        return (
            (r.avg_overall_score || 0) >= f.score &&
            (r.sum_tam_score || 0) >= f.tam &&
            (typeof r.kpi_coef === "number" ? r.kpi_coef : -10000) >= f.kpi &&
            (r.ratio_compra_pct ?? -10000) >= f.rc &&
            (r.ratio_venta_pct ?? -10000) >= f.rv &&
            ((r.combined_qual ?? 0) * 100) >= f.cqual &&
            ((r.combined ?? 0) * 100) >= f.ctotal
        );
    }, [n1Set, n2Set]);

    // Keep the table checkboxes in sync with the filters: selecting/adjusting a filter
    // automatically marks (passes) or unmarks (fails) each row.
    useEffect(() => {
        if (!rows.length) return;
        setSelected(new Set(rows.filter((r) => passesFilters(r, filters)).map((r) => r.ticker)));
    }, [filters, rows, passesFilters]);

    // Sorting (table) — always over ALL rows. String columns (ticker/name) sort
    // alphabetically; the rest numerically.
    const STRING_KEYS = useMemo(() => new Set(["ticker", "name"]), []);
    const DATE_KEYS = useMemo(() => new Set(["thesis_updated_at", "next_earnings_date", "last_earnings_date"]), []);
    const sortedRows = useMemo(() => {
        const arr = [...rows];
        const isStr = STRING_KEYS.has(sortKey);
        const isDate = DATE_KEYS.has(sortKey);
        arr.sort((a, b) => {
            const av = a[sortKey]; const bv = b[sortKey];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (isStr) {
                const c = String(av).localeCompare(String(bv), "es", { sensitivity: "base" });
                return sortDir === "asc" ? c : -c;
            }
            if (isDate) {
                const at = Date.parse(av); const bt = Date.parse(bv);
                return sortDir === "asc" ? at - bt : bt - at;
            }
            return sortDir === "asc" ? av - bv : bv - av;
        });
        return arr;
    }, [rows, sortKey, sortDir, STRING_KEYS, DATE_KEYS]);

    const onSort = (k) => {
        if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else { setSortKey(k); setSortDir(STRING_KEYS.has(k) ? "asc" : "desc"); }
    };

    const allSelected = rows.length > 0 && selected.size === rows.length;
    const toggleAll = () => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(rows.map((r) => r.ticker)));
    };
    const toggleOne = (tk) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(tk)) next.delete(tk); else next.add(tk);
            return next;
        });
    };

    // Map data: selected rows that also pass the filters (need both axes to plot).
    const mapRows = useMemo(() => rows.filter((r) => {
        if (!selected.has(r.ticker)) return false;
        if (r.avg_overall_score == null || r.ratio_compra_pct == null) return false; // need both axes
        return passesFilters(r, filters);
    }), [rows, selected, filters, passesFilters]);

    const resetFilters = () => setFilters({ score: 0, tam: 0, kpi: -10000, rc: -10000, rv: -10000, cqual: 0, ctotal: 0, level: "both" });

    // Dynamic quadrant divider: use median of MAP rows so dots end up balanced
    // across the 4 quadrants regardless of dataset spread. Falls back to median
    // of all rows when nothing is selected, then to (50, 0) when no data at all.
    const { medianX, medianY } = useMemo(() => {
        const base = mapRows.length ? mapRows : rows.filter((r) => r.avg_overall_score != null && r.ratio_compra_pct != null);
        if (!base.length) return { medianX: 50, medianY: 0 };
        const median = (arr) => {
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        return {
            medianX: median(base.map((r) => r.avg_overall_score)),
            medianY: median(base.map((r) => r.ratio_compra_pct)),
        };
    }, [mapRows, rows]);

    // Dynamic X-axis domain: start at 60 by default (most quality companies score >60,
    // and 60 is also the threshold above which we consider a thesis "investable"). If
    // any visible company has score <60, extend the axis downward to include it.
    const xDomain = useMemo(() => {
        const base = mapRows.length ? mapRows : rows;
        const scores = base.map((r) => r.avg_overall_score).filter((v) => v != null);
        if (!scores.length) return [60, 100];
        const minScore = Math.min(...scores);
        if (minScore >= 60) return [60, 100];
        return [Math.max(0, Math.floor(minScore / 5) * 5), 100];
    }, [mapRows, rows]);

    // --- Timeline derived data ---
    const tlLevelOk = useCallback((tk) => {
        const lvl = filters.level || "both";
        const T = (tk || "").toUpperCase();
        if (lvl === "n1") return n1Set.has(T);
        if (lvl === "n2") return n2Set.has(T);
        return true;
    }, [filters.level, n1Set, n2Set]);

    const tlSeriesVisible = useMemo(() => {
        if (!tl) return [];
        return (tl.series || []).filter((s) => selected.has(s.ticker) && tlLevelOk(s.ticker));
    }, [tl, selected, tlLevelOk]);

    const tlDomains = useMemo(() => {
        if (!tlSeriesVisible.length) return { x: [60, 100], y: [-50, 50] };
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const s of tlSeriesVisible) {
            for (const m in s.pts) {
                const a = s.pts[m];
                if (a[0] != null) { minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]); }
                if (a[2] != null) { minY = Math.min(minY, a[2]); maxY = Math.max(maxY, a[2]); }
            }
        }
        const padY = (maxY - minY) * 0.08 || 10;
        return { x: [Math.min(60, Math.floor(minX / 5) * 5), 100], y: [Math.floor(minY - padY), Math.ceil(maxY + padY)] };
    }, [tlSeriesVisible]);

    const tlStepRows = useMemo(() => {
        if (!tl || !tl.months.length) return [];
        const month = tl.months[Math.min(tlIdx, tl.months.length - 1)];
        const raw = [];
        for (const s of tlSeriesVisible) {
            const a = s.pts[month];
            if (!a || a[0] == null || a[2] == null) continue;
            raw.push({
                ticker: s.ticker, name: s.name,
                avg_overall_score: a[0], sum_tam_score: a[1],
                ratio_compra_pct: a[2], ratio_venta_pct: a[3],
                kpi_coef: (typeof a[4] === "number" ? a[4] : null),
            });
        }
        const coefs = raw.map((r) => r.kpi_coef).filter((v) => typeof v === "number");
        const media = coefs.length ? coefs.reduce((x, y) => x + y, 0) / coefs.length : 1;
        const REF = coefs.length ? Math.max(...coefs.map((c) => Math.abs(c - media))) : 0;
        const neutro = (1 + media) / 2;
        return raw.map((r) => {
            const f = kpiFactor(r.kpi_coef, neutro);
            const cq = clamp01(qualBase(r) * f);
            return { ...r, kpi_arrow: kpiArrow(r.kpi_coef, media, REF), combined_qual: cq, combined: (cq + priceBase(r)) / 2 };
        });
    }, [tl, tlIdx, tlSeriesVisible]);

    // Quadrant dividers fixed at PRESENT medians so dots visibly move across them.
    const tlMedians = useMemo(() => {
        if (!tl || !tlSeriesVisible.length) return { mx: 50, my: 0 };
        const cur = tl.current_month;
        const med = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
        const xs = [], ys = [];
        for (const s of tlSeriesVisible) { const a = s.pts[cur]; if (a) { if (a[0] != null) xs.push(a[0]); if (a[2] != null) ys.push(a[2]); } }
        return { mx: xs.length ? med(xs) : 50, my: ys.length ? med(ys) : 0 };
    }, [tl, tlSeriesVisible]);

    const tlTrails = useMemo(() => {
        if (!tl || !tlTrail) return [];
        const upto = tl.months.slice(0, tlIdx + 1);
        return tlSeriesVisible.map((s) => {
            const path = [];
            for (const m of upto) { const a = s.pts[m]; if (a && a[0] != null && a[2] != null) path.push({ x: a[0], y: a[2] }); }
            const cur = s.pts[tl.months[Math.min(tlIdx, tl.months.length - 1)]];
            return { ticker: s.ticker, path, color: colorForRv(cur ? cur[3] : 0) };
        }).filter((t) => t.path.length >= 2);
    }, [tl, tlIdx, tlSeriesVisible, tlTrail]);


    if (!user) {
        return (
            <div className="max-w-4xl mx-auto px-6 py-12 text-center">
                <div className="text-xl font-serif text-[#4A4A4A]">Inicia sesión para ver tu Visual.</div>
            </div>
        );
    }

    const chartNode = (
        <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 50 }}>
            <CartesianGrid stroke="#00000010" />
            <XAxis type="number" dataKey="avg_overall_score" name="Score" domain={tlMode ? tlDomains.x : xDomain} allowDataOverflow tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }} label={{ value: "Score cualitativo →", position: "insideBottom", offset: -10, fontSize: 11, fontFamily: "IBM Plex Mono" }} />
            <YAxis type="number" dataKey="ratio_compra_pct" name="Ratio Compra %" domain={tlMode ? tlDomains.y : ["auto", "auto"]} allowDataOverflow tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }} label={{ value: "Ratio Compra % →", angle: -90, position: "insideLeft", fontSize: 11, fontFamily: "IBM Plex Mono" }} />
            <ZAxis dataKey="sum_tam_score" range={[60, 600]} />
            <Tooltip content={<ScatterTooltip />} />
            <ReferenceLine x={tlMode ? tlMedians.mx : medianX} stroke="#000" strokeDasharray="3 3" label={{ value: `Score ≈${(tlMode ? tlMedians.mx : medianX).toFixed(0)}`, position: "top", fill: "#4A4A4A", fontSize: 10, fontFamily: "IBM Plex Mono" }} />
            <ReferenceLine y={tlMode ? tlMedians.my : medianY} stroke="#000" strokeDasharray="3 3" label={{ value: `${(tlMode ? tlMedians.my : medianY) >= 0 ? "+" : ""}${(tlMode ? tlMedians.my : medianY).toFixed(0)}%`, position: "right", fill: "#4A4A4A", fontSize: 10, fontFamily: "IBM Plex Mono" }} />
            <QuadrantLabels />
            {tlMode && tlTrail && <Customized component={(p) => <TrailLayer {...p} trails={tlTrails} />} />}
            <Scatter data={tlMode ? tlStepRows : mapRows} shape={<Dot />} isAnimationActive={!tlMode} />
        </ScatterChart>
    );

    return (
        <div className="max-w-7xl mx-auto px-0 sm:px-6 py-6 sm:py-8" data-testid="visual-page">
            {/* Header */}
            <div className="flex items-end justify-between mb-6 border-b border-black/20 pb-3">
                <div>
                    <h1 className="font-serif text-4xl text-black tracking-tight">
                        <HoverTip text="Vista visual: un mapa interactivo donde cada empresa de tus niveles se sitúa según su valoración (Ratio Compra/Venta) y calidad cualitativa. Te da una foto global de dónde están las oportunidades de un vistazo.">
                            <span className="cursor-help" data-testid="visual-title-tip">Visual</span>
                        </HoverTip>
                    </h1>
                    <div className="text-xs text-[#4A4A4A] mt-1 font-mono">
                        {selected.size} / {rows.length} empresas seleccionadas · {mapRows.length} visibles en el mapa
                    </div>
                </div>
                <button onClick={reload} className="overline text-xs px-3 py-1.5 border border-black hover:bg-black hover:text-white transition" data-testid="visual-refresh">
                    {loading ? <Loader2 size={12} className="inline mr-1 animate-spin" /> : null}Actualizar
                </button>
            </div>

            {error && (
                <div className="border border-[#B32A22] bg-[#FEF2F2] p-3 text-sm text-[#B32A22] mb-4" data-testid="visual-error">
                    Error: {error}
                </div>
            )}

            {/* Quadrant Map */}
            <div className="border border-black/20 p-4 mb-6 bg-white" data-testid="visual-map">
                <div className="flex items-center justify-between mb-2">
                    <div className="overline text-[#4A4A4A]">Cuadrante calidad ↔ valoración{tlMode && tl ? ` · ${monthLabel(tl.months[tlIdx])}` : ""}</div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setChartFull(true)}
                        className="overline text-xs px-3 py-1.5 border border-black hover:bg-black hover:text-white transition flex items-center gap-1.5"
                        data-testid="visual-expand-chart"
                        title="Ampliar el gráfico a pantalla completa (ideal en móvil / horizontal)"
                    >
                        <Maximize2 size={12} /> Ampliar
                    </button>
                    <button
                        onClick={() => (tlMode ? setTlMode(false) : enableTimeline())}
                        disabled={tlLoading}
                        className={`overline text-xs px-3 py-1.5 border flex items-center gap-1.5 transition ${tlMode ? "bg-[#052049] text-white border-[#052049]" : "border-black hover:bg-black hover:text-white"}`}
                        data-testid="visual-timeline-toggle"
                    >
                        {tlLoading ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
                        {tlMode ? "Salir de línea de tiempo" : "Línea de tiempo"}
                    </button>
                </div>
                </div>
                {tlErr && <div className="text-xs text-[#B32A22] mb-2 font-mono" data-testid="visual-timeline-error">{tlErr}</div>}
                <div ref={chartRef} className="w-full h-[60vh] min-h-[300px] max-h-[460px] landscape:max-md:h-[85vh] landscape:max-md:max-h-none">
                <ResponsiveContainer width="100%" height="100%">
                    {chartNode}
                </ResponsiveContainer>
                </div>
                {tlMode && tl && (
                    <div className="mt-3 border-t border-black/10 pt-3" data-testid="visual-timeline-controls">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={onTimelinePlay}
                                className="w-9 h-9 flex items-center justify-center border border-black hover:bg-black hover:text-white transition shrink-0"
                                data-testid="visual-timeline-play"
                                title={recording ? "Detener grabación" : (tlPlaying ? "Pausar" : "Reproducir")}
                            >
                                {recording ? <Square size={14} /> : (tlPlaying ? <Pause size={15} /> : <Play size={15} />)}
                            </button>
                            <input
                                type="range" min={0} max={Math.max(0, tl.months.length - 1)} value={tlIdx}
                                disabled={recording}
                                onChange={(e) => { setTlPlaying(false); setTlIdx(parseInt(e.target.value, 10)); }}
                                className="flex-1 accent-[#052049] cursor-pointer disabled:opacity-50"
                                data-testid="visual-timeline-slider"
                            />
                            <span className="font-mono text-xs text-black w-16 text-right tabular-nums">{monthLabel(tl.months[tlIdx])}</span>
                        </div>
                        <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
                            <div className="flex items-center gap-3 text-[11px] font-mono text-[#4A4A4A]">
                                <label className="flex items-center gap-1.5 cursor-pointer" title="Muestra el rastro del recorrido de cada empresa">
                                    <input type="checkbox" checked={tlTrail} onChange={(e) => setTlTrail(e.target.checked)} data-testid="visual-timeline-trail" />
                                    Estela
                                </label>
                                <label className="flex items-center gap-1.5">
                                    Velocidad
                                    <select value={tlSpeed} onChange={(e) => setTlSpeed(parseInt(e.target.value, 10))} disabled={recording} className="border border-black/30 px-1 py-0.5" data-testid="visual-timeline-speed">
                                        <option value={1000}>Lenta</option>
                                        <option value={600}>Normal</option>
                                        <option value={250}>Rápida</option>
                                    </select>
                                </label>
                            </div>
                            {/* Record / Export / Delete */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setRecArmed((a) => !a)}
                                    disabled={recording}
                                    className={`text-xs font-mono px-2.5 py-1.5 border flex items-center gap-1.5 transition disabled:opacity-50 ${recArmed ? "bg-[#B32A22] text-white border-[#B32A22]" : "border-black hover:bg-black hover:text-white"}`}
                                    data-testid="visual-timeline-record"
                                    title={recArmed ? "Grabación activada: pulsa ▶ para grabar el recorrido. Clic para desactivar." : "Activar grabación del próximo recorrido"}
                                >
                                    <Circle size={11} fill={recArmed ? "#fff" : "none"} className={recording ? "animate-pulse" : ""} />
                                    {recording ? "Grabando…" : (recArmed ? "Grabar ●" : "Grabar")}
                                </button>
                                <button
                                    onClick={() => setLibOpen(true)}
                                    disabled={clipCount === 0}
                                    className="text-xs font-mono px-2.5 py-1.5 border border-black hover:bg-black hover:text-white transition flex items-center gap-1.5 disabled:opacity-40"
                                    data-testid="visual-timeline-export"
                                    title="Ver, reproducir, renombrar, descargar y compartir tus recorridos grabados"
                                >
                                    <FolderOpen size={12} /> Exportar
                                    {clipCount > 0 && <span className="bg-[#052049] text-white rounded-full px-1.5 py-0.5 text-[9px] leading-none" data-testid="visual-timeline-clipcount">{clipCount}</span>}
                                </button>
                                {clipCount > 0 && (
                                    <button
                                        onClick={clearClips}
                                        className="text-xs font-mono px-2.5 py-1.5 border border-[#B32A22] text-[#B32A22] hover:bg-[#B32A22] hover:text-white transition flex items-center gap-1.5"
                                        data-testid="visual-timeline-clear"
                                        title="Borrar todos los recorridos guardados (empezar de cero)"
                                    >
                                        <Trash2 size={12} /> Borrar
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="mt-2 text-[10px] italic text-[#7A7A7A]">Izquierda = pasado · derecha = hoy. La valoración histórica se reconstruye proyectando el valor razonable actual; Score/TAM/KPI se congelan hasta que haya snapshots diarios.</div>
                    </div>
                )}
                <div className="text-xs text-[#4A4A4A] mt-3 font-sans flex items-center gap-5 flex-wrap leading-relaxed">
                    {(() => {
                        // Read live thresholds via signalFor probe values so the legend
                        // reflects whatever the user has configured in Umbrales.
                        const t = (typeof window !== "undefined" && JSON.parse(window.localStorage.getItem("vs.thresholds.v1") || "null"))?.venta;
                        const cheap = t?.cheap ?? 20;
                        const fair = t?.fair ?? 0;
                        return (
                            <span>📍 Tamaño = TAM Score · Color = Ratio Venta (
                                <span className="text-[#1D7044] font-semibold">verde ≥{cheap}%</span>,{" "}
                                <span className="text-[#B8860B] font-semibold">ámbar {fair}% a {cheap}%</span>,{" "}
                                <span className="text-[#B32A22] font-semibold">rojo &lt;{fair}%</span>
                                ) · configurable en <em>Umbrales</em>
                            </span>
                        );
                    })()}
                    <span>Líneas discontinuas: <span className="font-mono">mediana</span> de las empresas visibles — el cruce divide los 4 cuadrantes dinámicamente.</span>
                    <span className="basis-full">➤ <strong>Aguja KPI</strong>: dirección = validación operativa (dcha si C&gt;1, izq si C&lt;1; arriba si C&gt;media, abajo si C&lt;media). Longitud/inclinación ∝ fuerza relativa. <span className="text-[#1D7044] font-semibold">verde</span> = valida (arriba-dcha), <span className="text-[#B8860B] font-semibold">ámbar</span> = mixto, <span className="text-[#B32A22] font-semibold">rojo</span> = refuta (abajo-izq). Sin aguja = sin KPI.</span>
                </div>
            </div>

            {/* Filters */}
            <div className="border border-black/20 p-4 mb-4 bg-[#FAF6EE]" data-testid="visual-filters">
                <div className="flex items-center justify-between mb-3">
                    <div className="overline text-[#4A4A4A]">Filtros · marcan/desmarcan empresas en la tabla y las muestran u ocultan en el mapa</div>
                    <button onClick={resetFilters} className="text-xs font-mono text-[#4A4A4A] hover:text-black flex items-center gap-1" data-testid="visual-reset-filters">
                        <RotateCcw size={12} /> Reset
                    </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="flex flex-col gap-1" data-testid="filter-level">
                        <label className="overline text-[#4A4A4A]">Nivel</label>
                        <div className="flex border border-black/30 divide-x divide-black/20 w-full">
                            {[
                                { k: "both", label: "Ambas" },
                                { k: "n1", label: "Nivel 1" },
                                { k: "n2", label: "Nivel 2" },
                            ].map((o) => (
                                <button
                                    key={o.k}
                                    type="button"
                                    onClick={() => setFilters({ ...filters, level: o.k })}
                                    className={`min-w-0 basis-0 flex-1 text-center text-[11px] font-mono px-1 py-1.5 whitespace-nowrap transition-colors ${filters.level === o.k ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F1E9D9]"}`}
                                    data-testid={`filter-level-${o.k}`}
                                >
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <FilterField label="Score min" value={filters.score} step={1} onChange={(v) => setFilters({ ...filters, score: v })} testid="filter-score" />
                    <FilterField label="TAM Score min" value={filters.tam} step={0.5} onChange={(v) => setFilters({ ...filters, tam: v })} testid="filter-tam" />
                    <FilterField label="Coef KPI ≥" value={filters.kpi} step={0.1} onChange={(v) => setFilters({ ...filters, kpi: v })} testid="filter-kpi" />
                    <FilterField label="Ratio Compra ≥ %" value={filters.rc} step={5} onChange={(v) => setFilters({ ...filters, rc: v })} testid="filter-rc" suffix="%" />
                    <FilterField label="Ratio Venta ≥ %" value={filters.rv} step={5} onChange={(v) => setFilters({ ...filters, rv: v })} testid="filter-rv" suffix="%" />
                    <FilterField label="Combinado cual. ≥ %" value={filters.cqual} step={5} onChange={(v) => setFilters({ ...filters, cqual: v })} testid="filter-cqual" suffix="%" />
                    <FilterField label="Combinado total ≥ %" value={filters.ctotal} step={5} onChange={(v) => setFilters({ ...filters, ctotal: v })} testid="filter-ctotal" suffix="%" />
                </div>
            </div>

            {/* Table */}
            <div className="border border-black/20 bg-white overflow-x-auto" data-testid="visual-table">
                <table className="w-full text-sm font-mono">
                    <thead className="bg-black text-white">
                        <tr>
                            <th className="p-2 text-left w-8">
                                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer" data-testid="visual-toggle-all" />
                            </th>
                            <SortableTh label="Ticker" k="ticker" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" />
                            <SortableTh label="Nombre" k="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" className="font-sans" />
                            <SortableTh label="Tesis" k="thesis_updated_at" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip="Días desde la última actualización de la tesis. En rojo si la empresa ha publicado resultados posteriores a esa fecha (conviene reanalizar)." />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Ant.</span><span>result.</span></span>} k="last_earnings_date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip="Fecha de los últimos resultados publicados (Yahoo Finance)." />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Próx.</span><span>result.</span></span>} k="next_earnings_date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip="Fecha estimada de los próximos resultados (Yahoo Finance). En rojo si faltan 7 días o menos. El símbolo ≈ indica que la fecha es tentativa." />
                            <SortableTh label="Score" k="avg_overall_score" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.score} />
                            <SortableTh label="TAM Score" k="sum_tam_score" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.tam} />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Coef</span><span>KPI</span></span>} k="kpi_coef" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.kpi} />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Combinado</span><span>cualitativo</span></span>} k="combined_qual" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.combined_qual} />
                            <SortableTh label="Compra %" k="ratio_compra_pct" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.compra} />
                            <SortableTh label="Venta %" k="ratio_venta_pct" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.venta} />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Combinado</span><span>total</span></span>} k="combined" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.combined} />
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.length === 0 && !loading && (
                            <tr><td colSpan={13} className="p-6 text-center text-[#4A4A4A] font-sans">No hay empresas miembros de tesis trend. Genera tesis primero.</td></tr>
                        )}
                        {sortedRows.map((r) => {
                            const checked = selected.has(r.ticker);
                            const incomplete = r.ratio_compra_pct == null || r.avg_overall_score == null;
                            return (
                                <tr key={r.ticker} className={`border-t border-black/10 ${incomplete ? "text-[#9ca3af]" : "hover:bg-[#FAF6EE]"}`} data-testid={`visual-row-${r.ticker}`}>
                                    <td className="p-2"><input type="checkbox" checked={checked} onChange={() => toggleOne(r.ticker)} className="cursor-pointer" data-testid={`visual-toggle-${r.ticker}`} /></td>
                                    <td className="p-2 font-semibold"><Link to={`/company/${r.ticker}`} className="hover:underline">{r.ticker}</Link></td>
                                    <td className="p-2 font-sans text-xs"><span className="inline-flex items-center gap-1.5"><span>{r.name}</span><AlertBell ticker={r.ticker} alert={alerts[r.ticker]} onSaved={onAlertSaved} /></span></td>
                                    <td className="p-2 text-right"><FreshnessBadge updatedAt={r.thesis_updated_at} lastEarningsDate={r.last_earnings_date} nextEarningsDate={r.next_earnings_date} noun="la última actualización de la tesis" testid={`visual-fresh-${r.ticker}`} /></td>
                                    <td className="p-2 text-right"><LastEarningsBadge date={r.last_earnings_date} testid={`visual-last-earnings-${r.ticker}`} /></td>
                                    <td className="p-2 text-right"><EarningsBadge date={r.next_earnings_date} estimated={r.next_earnings_estimated} testid={`visual-earnings-${r.ticker}`} /></td>
                                    <td className="p-2 text-right">{fmtN(r.avg_overall_score)}</td>
                                    <td className="p-2 text-right">{fmtN(r.sum_tam_score, 2)}</td>
                                    <td className="p-2 text-right" data-testid={`visual-kpi-${r.ticker}`}>
                                        {typeof r.kpi_coef === "number"
                                            ? <span style={{ color: coefColor(r.kpi_coef) }} className="font-semibold">{r.kpi_coef.toFixed(2)}</span>
                                            : <span className="text-[#9ca3af]">—</span>}
                                    </td>
                                    <td className="p-2 text-right">{(r.combined_qual * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-right" style={{ color: signalFor(r.ratio_compra_pct, "compra").color }}>{fmtPct(r.ratio_compra_pct)}</td>
                                    <td className="p-2 text-right" style={{ color: signalFor(r.ratio_venta_pct, "venta").color }}>{fmtPct(r.ratio_venta_pct)}</td>
                                    <td className="p-2 text-right font-semibold">{(r.combined * 100).toFixed(1)}%</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* KPI notice */}
            <div className="text-xs text-[#4A4A4A] mt-3 font-sans leading-relaxed" data-testid="visual-kpi-note">
                {kpiMean != null && (
                    <span>El <strong>coef KPI</strong> modula los combinados respecto a la media del universo (<span className="font-mono">{kpiMean.toFixed(2)}</span>): por encima del punto neutro mejora el porcentaje, por debajo lo empeora (cuenta una sola vez). </span>
                )}
                {noKpiCount > 0 && (
                    <span data-testid="visual-no-kpi-note">
                        {noKpiCount === 1 ? "1 empresa aún no tiene" : `${noKpiCount} empresas aún no tienen`} coeficiente KPI («—»): no se incluye este factor en {noKpiCount === 1 ? "su combinado" : "sus combinados"}. Analíza{noKpiCount === 1 ? "la" : "las"} en <Link to="/kpis" className="underline hover:text-black">/kpis</Link>.
                    </span>
                )}
            </div>

            <ExportLibrary
                open={libOpen}
                onClose={async () => { setLibOpen(false); setClipCount(await countMediaItems("timeline-clip")); }}
                kind="timeline-clip"
                title="Recorridos grabados"
            />

            {chartFull && (
                <div className="fixed inset-0 z-[70] bg-white flex flex-col" data-testid="visual-chart-fullscreen" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
                    <div className="flex items-center justify-between px-4 py-2 border-b border-black shrink-0">
                        <div className="overline text-[#4A4A4A] truncate">Cuadrante calidad ↔ valoración{tlMode && tl ? ` · ${monthLabel(tl.months[tlIdx])}` : ""}</div>
                        <button onClick={() => setChartFull(false)} className="overline text-xs px-3 py-1.5 border border-black hover:bg-black hover:text-white transition flex items-center gap-1.5 shrink-0" data-testid="visual-chart-fullscreen-close">
                            <X size={14} /> Cerrar
                        </button>
                    </div>
                    <div className="flex-1 min-h-0 p-1 sm:p-2">
                        <PinchZoomPane className="w-full h-full">
                            <ResponsiveContainer width="100%" height="100%">
                                {chartNode}
                            </ResponsiveContainer>
                        </PinchZoomPane>
                    </div>
                    <div className="text-[10px] text-[#7A7A7A] px-4 py-1 text-center shrink-0">Pellizca para hacer zoom · arrastra para desplazar · doble toque para restablecer · gira el móvil para más ancho</div>
                </div>
            )}
        </div>
    );
}

// ---------- Small subcomponents ----------
const AlertBell = ({ ticker, alert, onSaved }) => {
    const initFrom = (a) => ({
        score: { enabled: a?.score?.enabled || false, dir: a?.score?.dir || "gte", value: a?.score?.value ?? "" },
        tam: { enabled: a?.tam?.enabled || false, dir: a?.tam?.dir || "gte", value: a?.tam?.value ?? "" },
        kpi: { enabled: a?.kpi?.enabled || false, dir: a?.kpi?.dir || "gte", value: a?.kpi?.value ?? "" },
    });
    const active = !!alert;
    const btnRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [form, setForm] = useState(initFrom(alert));
    const [saving, setSaving] = useState(false);
    useEffect(() => { setForm(initFrom(alert)); }, [alert]);  // eslint-disable-line react-hooks/exhaustive-deps

    const openPanel = () => {
        const r = btnRef.current?.getBoundingClientRect();
        if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 280)) });
        setOpen((o) => !o);
    };
    const setMetric = (k, patch) => setForm((f) => ({ ...f, [k]: { ...f[k], ...patch } }));

    const save = async () => {
        setSaving(true);
        try {
            const payload = {};
            for (const k of ["score", "tam", "kpi"]) {
                const m = form[k];
                payload[k] = { enabled: !!m.enabled, dir: m.dir, value: m.value === "" ? null : parseFloat(m.value) };
            }
            const res = await alertSave(ticker, payload);
            onSaved(ticker, res.alert || null);
            toast.success(res.removed ? `Alerta de ${ticker} eliminada` : `Alerta de ${ticker} guardada`);
            setOpen(false);
        } catch { toast.error("No se pudo guardar la alerta"); }
        finally { setSaving(false); }
    };
    const remove = async () => {
        setSaving(true);
        try { await alertDelete(ticker); onSaved(ticker, null); toast.success(`Alerta de ${ticker} eliminada`); setOpen(false); }
        catch { toast.error("No se pudo eliminar"); }
        finally { setSaving(false); }
    };

    return (
        <>
            <button ref={btnRef} onClick={openPanel} className={active ? "text-[#B8860B]" : "text-[#B0B0B0] hover:text-[#052049]"} title={active ? "Alerta configurada — clic para editar" : "Configurar alerta de seguimiento"} data-testid={`alert-bell-${ticker}`}>
                {active ? <BellRing size={15} /> : <Bell size={15} />}
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="fixed z-50 w-64 bg-white border-2 border-[#052049] shadow-xl p-3 text-left font-sans" style={{ top: pos.top, left: pos.left }} data-testid={`alert-panel-${ticker}`}>
                        <div className="text-xs font-semibold text-[#052049] mb-2">Alerta · {ticker}</div>
                        {[["score", "Score"], ["tam", "TAM Score"], ["kpi", "Coef KPI"]].map(([k, label]) => (
                            <div key={k} className="mb-2 border-b border-black/5 pb-2">
                                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                    <input type="checkbox" checked={form[k].enabled} onChange={(e) => setMetric(k, { enabled: e.target.checked })} data-testid={`alert-${k}-enabled-${ticker}`} />
                                    <span className="font-medium">{label}</span>
                                </label>
                                {form[k].enabled && (
                                    <div className="flex items-center gap-1 mt-1.5 pl-5">
                                        <select value={form[k].dir} onChange={(e) => setMetric(k, { dir: e.target.value })} className="border border-black/30 text-xs px-1 py-0.5" data-testid={`alert-${k}-dir-${ticker}`}>
                                            <option value="gte">≥</option>
                                            <option value="lte">≤</option>
                                        </select>
                                        <input type="number" step="0.1" value={form[k].value} onChange={(e) => setMetric(k, { value: e.target.value })} placeholder="valor" className="border border-black/30 text-xs px-1.5 py-0.5 w-full font-mono" data-testid={`alert-${k}-value-${ticker}`} />
                                    </div>
                                )}
                            </div>
                        ))}
                        <div className="text-[10px] text-[#7A7A7A] mb-2">Además te avisaré si cruza de barato↔caro. Todo en un único email diario.</div>
                        <div className="flex gap-2">
                            <button onClick={save} disabled={saving} className="flex-1 bg-[#052049] text-white text-xs py-1.5 font-semibold disabled:opacity-50" data-testid={`alert-save-${ticker}`}>Guardar</button>
                            {active && <button onClick={remove} disabled={saving} className="px-2 border border-[#B32A22] text-[#B32A22] text-xs py-1.5" data-testid={`alert-remove-${ticker}`}>Quitar</button>}
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

const FilterField = ({ label, value, step, onChange, testid, suffix }) => (
    <label className="block">
        <div className="text-[11px] text-[#4A4A4A] font-mono mb-1">{label}</div>
        <div className="flex items-center">
            <input
                type="number"
                value={value}
                step={step}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className="border border-black px-2 py-1 text-sm font-mono w-full"
                data-testid={testid}
            />
            {suffix && <span className="ml-1 text-xs text-[#4A4A4A] font-mono">{suffix}</span>}
        </div>
    </label>
);

const SortableTh = ({ label, k, sortKey, sortDir, onSort, tip, align = "right", className = "" }) => {
    const active = sortKey === k;
    const inner = (
        <span className="inline-flex items-center gap-1">
            {label}
            {active ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : null}
        </span>
    );
    return (
        <th className={`p-2 cursor-pointer select-none ${align === "left" ? "text-left" : "text-right"} ${className}`} onClick={() => onSort(k)} data-testid={`sort-${k}`}>
            {tip ? <HoverTip text={tip} maxWidth={300}><span className="cursor-help">{inner}</span></HoverTip> : inner}
        </th>
    );
};
