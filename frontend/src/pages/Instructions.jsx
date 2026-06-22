import React, { useState, useRef } from "react";
import { Download, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// NOTE: This is PROVISIONAL content. The user is preparing the final document and
// will hand it over; only the CONTENT object below needs to be swapped then.
const CONTENT = {
    es: {
        title: "Valuation Studio — Guía rápida",
        subtitle: "Tu Excel de valoración de empresas, convertido en una app que se actualiza sola",
        intro: "Valuation Studio nace de un Excel donde introducías a mano datos fundamentales y precios para obtener ratios que te dicen si una acción está cara o barata. La app hace lo mismo, pero ingiere los datos automáticamente (Yahoo Finance), aplica TUS fórmulas y los mantiene siempre frescos. Tiene dos grandes mitades: un módulo CUANTITATIVO (números y ratios) y un módulo CUALITATIVO con IA (el «Thesis Engine»: tendencias, drivers de crecimiento y tesis de inversión).",
        sections: [
            {
                h: "1. ¿Qué puedes hacer? (las pantallas)",
                bullets: [
                    ["Empresa", "busca cualquier ticker (AAPL, SAP.DE, SAN.MC…) y ves sus KPIs, ratios clásicos, métricas de crecimiento, gráficos y los precios objetivo POC/POV. Puedes editar los inputs a mano y recalcular en vivo."],
                    ["Nivel 2", "acciones que no son tus preferidas pero te interesan: lista de seguimiento con snapshots manuales y alertas por fila (campana) cuando una empresa cruza de cara a barata."],
                    ["Nivel 1", "tus acciones preferidas y posiciones reales con P/L vivo, P/L % y KPIs totales; también posiciones de «solo seguimiento»."],
                    ["Comparar", "hasta 6 empresas lado a lado."],
                    ["Tesis (Thesis Engine)", "el cerebro cualitativo: explora tendencias, genera tesis por empresa y agrupa todo en «Megatesis»."],
                ],
            },
            {
                h: "2. Los ratios y por qué existen",
                intro: "Todo gira en torno a dos precios objetivo calculados con TUS fórmulas:",
                bullets: [
                    ["POC — Precio Objetivo de Compra", "estima lo que «vale» la acción hoy combinando ingresos por acción, margen bruto, caja libre frente a deuda y capitalización, y el crecimiento esperado de ingresos y FCF. Es tu ancla: si el precio actual está muy por debajo del POC, hay margen de compra."],
                    ["Ratio de Compra (%)", "cuánto separa el precio actual del POC. Positivo y alto = potencialmente barata."],
                    ["POV — Precio Objetivo de Venta", "el POC ajustado por el margen operativo; marca la zona donde la acción empieza a estar exigente."],
                    ["Ratio de Venta (%)", "distancia del precio actual al POV; te avisa de cuándo el recorrido se agota."],
                ],
                outro: "Además verás ratios clásicos (P/E, PEG, P/B, P/S, EV/EBITDA, ROE, ROA, márgenes, deuda/equity…) y una sección de crecimiento (CAGR, margen de FCF, Rule of 40, breakeven). Cada fila tiene un punto de salud verde/ámbar/rojo y un tooltip que explica qué mide y sus rangos «barato/normal/caro». Las proyecciones se generan solas, pero se avisa (en ámbar) cuando un crecimiento es extremo y conviene revisarlo a mano.",
            },
            {
                h: "3. El Thesis Engine: tendencias, drivers y tesis",
                intro: "Aquí la IA busca información en vivo y estructura el análisis. Conceptos clave:",
                bullets: [
                    ["Tendencia", "un tema o megatendencia (IA, vehículos eléctricos, energía nuclear…). Al explorarla ves su cadena de valor con LÍDERES, COMPETIDORES y DISRUPTORES, además de su TAM y CAGR."],
                    ["Tesis", "una apuesta de alta convicción sobre un DRIVER DE CRECIMIENTO independiente de una empresa, con su propio TAM que NO se solapa con otros (para no contar dos veces el mismo mercado). Se etiquetan «Crecimiento actual» o «Apuesta futura»."],
                    ["Planificar → Ejecutar", "primero organizas los drivers (fusionar parecidos, partir uno grande) hasta dejar el TAM 100% mutuamente excluyente; luego generas todas las tesis de golpe."],
                    ["Tendencia / Tesis automática", "descubre temas emergentes por momentum para que no partas de cero."],
                ],
            },
            {
                h: "4. Los scores y su porqué",
                bullets: [
                    ["Score global tendencia (0–100)", "calidad cualitativa de la empresa dentro de una tendencia. Combina cuatro sub-scores: posición competitiva, momentum del sector, calidad del management y resiliencia financiera. Responde a «¿qué tan buena es esta empresa en este tema?»."],
                    ["Probabilidad (0–10)", "certeza de que la tendencia realmente ocurra, según la evidencia de las fuentes. La «contratesis» mide quién pierde si la tendencia avanza."],
                    ["TAM Score", "el puente entre lo cualitativo y lo cuantitativo. Mezcla la calidad con el trozo de mercado que le toca a la empresa frente a sus ingresos proyectados. Mayor que 1 (verde) = la oportunidad es grande respecto a su tamaño actual; menor que 1 (ámbar) = más modesta."],
                    ["Win probability (0–10)", "probabilidad de que la empresa sea ganadora en ese driver concreto."],
                ],
            },
            {
                h: "5. Cómo empezar en 5 minutos",
                bullets: [
                    ["1", "Busca una empresa que conozcas y mira su POC, POV y los puntos de salud de los ratios."],
                    ["2", "Edita algún input (p. ej. el crecimiento) y recalcula para ver cómo se mueve el POC."],
                    ["3", "Añádela a tu Nivel 2 (o Nivel 1) y activa la campana para recibir alertas cuando cruce a «barata»."],
                    ["4", "Ve a «Tesis», explora una tendencia o genera una tesis y observa los scores."],
                    ["5", "Inicia sesión con Google para sincronizar todo entre dispositivos y activar las alertas por email."],
                ],
            },
        ],
        keyIdea: "Idea clave: los números (POC/POV/ratios) te dicen si está BARATA; el Thesis Engine te dice si el negocio va a CRECER. Las mejores oportunidades aciertan en las dos cosas a la vez.",
        download: "Descargar PDF",
        generating: "Generando…",
    },
    en: {
        title: "Valuation Studio — Quick guide",
        subtitle: "Your stock-valuation Excel, turned into a self-updating app",
        intro: "Valuation Studio comes from an Excel where you manually entered fundamentals and prices to get ratios telling you whether a stock is expensive or cheap. The app does the same, but ingests data automatically (Yahoo Finance), applies YOUR formulas and keeps everything fresh. It has two halves: a QUANTITATIVE module (numbers and ratios) and a QUALITATIVE AI module (the «Thesis Engine»: trends, growth drivers and investment theses).",
        sections: [
            {
                h: "1. What can you do? (the screens)",
                bullets: [
                    ["Company", "search any ticker (AAPL, SAP.DE, SAN.MC…) and see its KPIs, classic ratios, growth metrics, charts and the POC/POV target prices. You can edit inputs and recompute live."],
                    ["Level 2", "stocks that aren't your favorites but interest you: a watchlist with manual snapshots and per-row alerts (bell) when a company crosses from expensive to cheap."],
                    ["Level 1", "your preferred stocks and real positions with live P/L, P/L % and totals; also «watch-only» positions."],
                    ["Compare", "up to 6 companies side by side."],
                    ["Thesis (Thesis Engine)", "the qualitative brain: explore trends, generate theses per company and group everything into «Megatheses»."],
                ],
            },
            {
                h: "2. The ratios and why they exist",
                intro: "Everything revolves around two target prices computed with YOUR formulas:",
                bullets: [
                    ["POC — Buy target price", "estimates what the share is «worth» today, combining revenue per share, gross margin, free cash flow vs debt and market cap, and expected revenue and FCF growth. It's your anchor: if the current price is well below POC, there's buying room."],
                    ["Buy Ratio (%)", "how far the current price is from POC. High and positive = potentially cheap."],
                    ["POV — Sell target price", "POC adjusted by the operating margin; marks where the stock starts to look demanding."],
                    ["Sell Ratio (%)", "distance from the current price to POV; tells you when the upside runs out."],
                ],
                outro: "You'll also see classic ratios (P/E, PEG, P/B, P/S, EV/EBITDA, ROE, ROA, margins, debt/equity…) and a growth section (CAGR, FCF margin, Rule of 40, breakeven). Each row has a green/amber/red health dot and a tooltip explaining what it measures and its «cheap/normal/expensive» ranges. Projections are auto-generated, with an amber warning when growth is extreme and should be reviewed manually.",
            },
            {
                h: "3. The Thesis Engine: trends, drivers and theses",
                intro: "Here the AI searches the web live and structures the analysis. Key concepts:",
                bullets: [
                    ["Trend", "a theme or megatrend (AI, EVs, nuclear energy…). Exploring it shows its value chain with LEADERS, COMPETITORS and DISRUPTORS, plus its TAM and CAGR."],
                    ["Thesis", "a high-conviction bet on an independent GROWTH DRIVER of a company, with its own TAM that does NOT overlap with others (to avoid double-counting the same market). Tagged «Current growth» or «Future bet»."],
                    ["Plan → Execute", "first you organize the drivers (merge similar ones, split a big one) until the TAM is 100% mutually exclusive; then you generate all theses at once."],
                    ["Auto trend / thesis", "discovers emerging themes by momentum so you don't start from scratch."],
                ],
            },
            {
                h: "4. The scores and why",
                bullets: [
                    ["Trend overall score (0–100)", "the company's qualitative quality within a trend. Combines four sub-scores: competitive position, sector momentum, management quality and financial resilience. Answers «how good is this company at this theme?»."],
                    ["Probability (0–10)", "certainty that the trend will actually happen, based on source evidence. The «counter-thesis» measures who loses if the trend advances."],
                    ["TAM Score", "the bridge between qualitative and quantitative. Mixes quality with the slice of market the company gets versus its projected revenue. Above 1 (green) = big opportunity relative to its current size; below 1 (amber) = more modest."],
                    ["Win probability (0–10)", "probability the company wins in that specific driver."],
                ],
            },
            {
                h: "5. How to start in 5 minutes",
                bullets: [
                    ["1", "Search a company you know and look at its POC, POV and the ratio health dots."],
                    ["2", "Edit an input (e.g. growth) and recompute to see how POC moves."],
                    ["3", "Add it to your Level 2 (or Level 1) and turn on the bell to get alerts when it turns «cheap»."],
                    ["4", "Go to «Thesis», explore a trend or generate a thesis and look at the scores."],
                    ["5", "Sign in with Google to sync everything across devices and enable email alerts."],
                ],
            },
        ],
        keyIdea: "Key idea: the numbers (POC/POV/ratios) tell you if it's CHEAP; the Thesis Engine tells you if the business will GROW. The best opportunities get both right.",
        download: "Download PDF",
        generating: "Generating…",
    },
};

export default function Instructions() {
    const { lang: globalLang } = useI18n();
    const [lang, setLang] = useState(globalLang === "en" ? "en" : "es");
    const [busy, setBusy] = useState(false);
    const docRef = useRef(null);
    const c = CONTENT[lang];

    const downloadPdf = async () => {
        if (!docRef.current || busy) return;
        setBusy(true);
        try {
            const html2pdf = (await import("html2pdf.js")).default;
            await html2pdf()
                .set({
                    margin: [12, 12, 12, 12],
                    filename: lang === "en" ? "Valuation_Studio_Quick_Guide.pdf" : "Valuation_Studio_Guia_Rapida.pdf",
                    image: { type: "jpeg", quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
                    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
                    pagebreak: { mode: ["css", "avoid-all"] },
                })
                .from(docRef.current)
                .save();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div data-testid="instructions-page">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                <div className="overline text-[#B32A22]">{lang === "en" ? "User guide" : "Guía de uso"}</div>
                <div className="flex items-center gap-3">
                    <div className="flex border border-black" data-testid="instructions-lang-toggle">
                        <button
                            onClick={() => setLang("es")}
                            className={`text-xs uppercase tracking-[0.12em] font-semibold px-3 py-1.5 ${lang === "es" ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                            data-testid="instructions-lang-es"
                        >ES</button>
                        <button
                            onClick={() => setLang("en")}
                            className={`text-xs uppercase tracking-[0.12em] font-semibold px-3 py-1.5 border-l border-black ${lang === "en" ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                            data-testid="instructions-lang-en"
                        >EN</button>
                    </div>
                    <button
                        onClick={downloadPdf}
                        disabled={busy}
                        className="btn-primary flex items-center gap-2 disabled:opacity-50"
                        data-testid="instructions-download-pdf"
                    >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                        {busy ? c.generating : c.download}
                    </button>
                </div>
            </div>

            {/* Document */}
            <article ref={docRef} className="border border-black bg-white p-8 sm:p-12 max-w-3xl mx-auto" data-testid="instructions-doc">
                <h1 className="font-serif text-4xl sm:text-5xl tracking-tight leading-none font-medium text-[#B32A22] mb-2">{c.title}</h1>
                <p className="italic text-[#4A4A4A] mb-6">{c.subtitle}</p>
                <p className="text-sm leading-relaxed text-[#2A2A2A] mb-6">{c.intro}</p>

                {c.sections.map((s, i) => (
                    <section key={i} className="mb-6">
                        <h2 className="font-serif text-2xl text-[#B32A22] mb-2">{s.h}</h2>
                        {s.intro && <p className="text-sm leading-relaxed text-[#2A2A2A] mb-2">{s.intro}</p>}
                        <ul className="space-y-1.5 list-disc pl-5">
                            {s.bullets.map((b, j) => (
                                <li key={j} className="text-sm leading-relaxed text-[#2A2A2A]">
                                    <span className="font-semibold">{b[0]}:</span> {b[1]}
                                </li>
                            ))}
                        </ul>
                        {s.outro && <p className="text-sm leading-relaxed text-[#2A2A2A] mt-2">{s.outro}</p>}
                    </section>
                ))}

                <p className="italic text-[13px] text-[#4A4A4A] border-t border-black/15 pt-4 mt-6">{c.keyIdea}</p>
            </article>
        </div>
    );
}
