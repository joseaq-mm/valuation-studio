import React, { useState, useRef } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// Public URL of the downloadable Word manual (kept in /public). Validated as reachable.
const DOCX_URL = "/Valuation_Studio_Manual.docx";

const CONTENT = {
    es: {
        title: "Valuation Studio — Manual de uso",
        subtitle: "Todas las páginas, funcionalidades y la filosofía de la app",
        intro: "Valuation Studio nace de un Excel de valoración fundamental de empresas. En ese Excel se introducían a mano datos y precios para obtener ratios que daban una idea de si una acción estaba cara o barata. La app hace lo mismo, pero ingiere los datos automáticamente (Yahoo Finance), aplica las fórmulas del autor y los mantiene siempre frescos. Además añade un cerebro cualitativo con IA (el «Thesis Engine») y un módulo macro que mide si el mercado, en su conjunto, está caro o barato.",
        sections: [
            {
                h: "1. La filosofía: dos preguntas, una decisión",
                intro: "Toda la app gira en torno a responder dos preguntas independientes sobre cada empresa, y a juntarlas para decidir:",
                bullets: [
                    ["¿Está BARATA?", "es la parte CUANTITATIVA. Se responde con precios objetivo y ratios calculados con las fórmulas (POC, POV, Ratio de Compra/Venta)."],
                    ["¿Va a CRECER y es BUEN NEGOCIO?", "es la parte CUALITATIVA (con IA). Se responde con tendencias, tesis de crecimiento, scores de calidad y de TAM, y la validación operativa vía KPIs."],
                ],
                outro: "Encima de todo, el módulo Macro te dice si conviene ser más agresivo (mercado barato → crecimiento) o más defensivo (mercado caro → efectivo/defensivas), para modular cuánto peso das a cada tipo de empresa. Filosofía de niveles: organizas tus empresas en Nivel 1 (tus preferidas y posiciones reales) y Nivel 2 (interesantes, en seguimiento). Sobre ellas construyes tesis y KPIs, y las vigilas en el tiempo, reescribiendo lo que envejece o cuando hay noticias y resultados relevantes.",
            },
            {
                h: "2. Inicio y buscador",
                intro: "Punto de entrada. Busca cualquier ticker (AAPL, SAP.DE, SAN.MC…) desde la barra superior, disponible en todas las páginas. Al iniciar sesión con Google, todo se sincroniza entre dispositivos y se activan las alertas por email que tengas configuradas.",
                bullets: [],
            },
            {
                h: "3. Empresa (ficha individual)",
                intro: "La radiografía cuantitativa de una acción. Contiene:",
                bullets: [
                    ["Información de la empresa", "nombre, ticker, precio, market cap, negocio…"],
                    ["Añadir a Nivel 1 / Nivel 2", "desde la ficha incorporas la empresa a tus listas."],
                    ["Tesis", "aquí encontrarás las tesis desarrolladas sobre esta empresa."],
                    ["POC y POV", "los dos precios objetivo (compra y venta) a 2 años vista; ver la sección de conceptos."],
                    ["Avisos sobre las proyecciones automáticas", "los datos se importan de Yahoo Finance, pero pueden tener fallos o estar desactualizados. En esos casos el programa realiza ajustes automáticos y te avisa en esta sección; por eso es muy recomendable leerla con atención y ajustar a mano si es necesario."],
                    ["Precio objetivo anómalo", "aviso que aparece cuando los ratios son excesivamente optimistas o pesimistas; explica qué puede estar pasando para que tomes decisiones informadas."],
                    ["Inputs y proyecciones", "muestra los componentes de la fórmula, cada uno editable a mano. El FCF proyectado tiene varias opciones de cálculo. Si cambias algún concepto, el valor cambia de color y, al guardar en Nivel 1 o 2, aparece marcado con la palabra «MAN»."],
                    ["Ratios clásicos", "P/E, PEG, P/B, P/S, EV/EBITDA, ROE, ROA, márgenes, deuda/equity… Cada fila con un punto de salud verde/ámbar/rojo y un tooltip que explica qué mide y sus rangos barato/normal/caro."],
                    ["Gráficos", "de ingresos y FCF, con datos históricos y proyecciones."],
                    ["Desglose del cálculo (educativo)", "explicación de cómo se obtienen POC y POV, y por tanto los ratios de compra y venta (diferencia en % sobre el precio actual)."],
                    ["Modo sensibilidad (educativo)", "ejercicio para ver cómo varían los resultados del cálculo (métrica) según la variación de los datos (por ejemplo, ±10 % a mano) en las proyecciones y los crecimientos de ingresos y FCF."],
                ],
            },
            {
                h: "4. Nivel 1 y Nivel 2",
                intro: "Tus listas de convicción y seguimiento:",
                bullets: [
                    ["Nivel 1 (preferidas + cartera real)", "tus acciones de mayor convicción y tus posiciones reales. Admite también posiciones de «solo seguimiento» (sin dinero invertido). Puedes activar alertas para saber cuándo una acción pasa de cara a barata (cruza por debajo del POC) o al revés, de barata a cara (cruza por encima del POV), recibiendo un email."],
                    ["Nivel 2 (seguimiento)", "acciones que te interesan pero no son tus preferidas, también con alertas."],
                ],
            },
            {
                h: "5. Comparar",
                intro: "Hasta 6 empresas lado a lado para contrastar, de un vistazo, ratios, crecimiento, precios objetivo y scores cualitativos.",
                bullets: [],
            },
            {
                h: "6. Tesis (Thesis Engine): el cerebro cualitativo",
                intro: "Aquí la IA busca información en vivo y estructura el análisis. Tiene dos modos de trabajo:",
                bullets: [
                    ["Modo Empresa", "generas la tesis de una empresa concreta y organizas sus drivers de crecimiento (fusionar parecidos, partir uno grande). El TAM siempre será 100 % mutuamente excluyente (sin contar dos veces el mismo mercado). Al ejecutar el plan, generas todas las tesis de golpe y obtienes los scores cualitativos y de TAM por tesis, más la media del score cualitativo y la suma de los TAM Score de todas las tesis de esa empresa."],
                    ["Modo Explorar (Tendencias → Empresas)", "partes de una tendencia o tema y descubres las empresas de su cadena de valor (líderes, competidores, disruptores), su TAM y CAGR, e incluso ETFs y fondos de la temática."],
                    ["Tendencia automática", "con un clic descubre un tema emergente por momentum, para no empezar de cero."],
                    ["Megatesis", "agrupas varias tesis o tendencias relacionadas en una carpeta (megatendencia)."],
                    ["Deshacer/Rehacer y Refrescar datos", "puedes revertir cambios y volver a leer los fundamentales de Yahoo para recalcular los TAM Score con números frescos (no toca los scores cualitativos)."],
                ],
                outro: "El mapa (treemap) del explorador muestra tus datos como rectángulos: cuanto más grande y más verde, mejor en la métrica elegida. Tiene 5 vistas — Megatendencias (media del CAGR a 4 años; muestra el TAM total), Tendencias (dimensionadas por CAGR, TAM o la media normalizada de ambas), Convergencia (empresas presentes en varias tendencias a la vez; las que están en 2 o más llevan borde dorado), Empresas · score medio y Empresas · TAM total. En la barra lateral ves tus tendencias desarrolladas (y les asignas una megatendencia), qué empresas has buscado, cuántas tesis se han desarrollado de su plan y los días desde que se desarrolló cada tesis.",
            },
            {
                h: "7. Visual: mapa de oportunidades",
                intro: "Cruza en una sola pantalla lo cuantitativo y lo cualitativo de todas las empresas que son miembro de tus tesis. Dos elementos: el gráfico (scatter/cuadrante, cada burbuja es una empresa; ver «Cómo leer el gráfico de Visual») y la tabla (todas las empresas con Score, TAM Score, Coef KPI, Combinado cualitativo, Ratio Compra %, Ratio Venta % y Combinado total, ordenable por cualquier columna). Herramientas:",
                bullets: [
                    ["Filtros", "Score, TAM Score, Coef KPI, Ratio Compra, Ratio Venta, Combinado cualitativo y Combinado total. Al aplicarlos, además de filtrar el gráfico, marcan o desmarcan automáticamente las filas de la tabla."],
                    ["Campana de alerta (por empresa)", "junto al nombre. Al pulsarla configuras umbrales de Score, TAM Score y Coef KPI (con dirección ≥ o ≤). Si la empresa alcanza esa situación, recibes un email ese día. Las empresas con campana en tus listas de Nivel 1 y 2 también avisan al cruzar de barato ↔ caro. Todo se consolida en UN único email diario para no saturarte."],
                ],
            },
            {
                h: "8. KPIs: validación operativa",
                intro: "Comprueba si lo que promete la tesis se está cumpliendo en los números reales de la empresa.",
                bullets: [
                    ["Extracción de documentos", "sube o deja que la app busque informes/PDF de la empresa y extrae los KPIs operativos automáticamente (con reintentos y lectura local de PDF)."],
                    ["Coeficiente KPI", "un número que resume si los KPIs se están validando (por encima de su punto neutro) o deteriorando (por debajo)."],
                    ["Fuentes trazables", "cada KPI enlaza a su documento de origen y muestra la cita textual en un tooltip."],
                    ["Indicador de tendencia", "junto al coeficiente, una flecha ↑/↓ indica cómo ha cambiado respecto al análisis anterior (histórico de reanálisis)."],
                    ["Ordenación", "los KPIs se pueden ordenar por antigüedad del análisis, alfabéticamente, por coeficiente y por antigüedad de la tesis."],
                ],
            },
            {
                h: "9. Macro: ¿el mercado está caro o barato?",
                intro: "Calcula un coeficiente de mercado en tiempo real para saber si conviene ser agresivo o defensivo. Contiene:",
                bullets: [
                    ["Indicadores", "renta variable, PIB, M3 proxy, tipo FED, inflación, productividad, petróleo y mix energético. Renta variable y PIB muestran el valor oficial y, en grande, una estimación EN VIVO (la renta variable se ajusta por el índice elegido — S&P 500, NASDAQ 100 o Dow Jones; el PIB por su crecimiento interanual prorrateado)."],
                    ["Coeficiente de mercado (aguja/dial)", "por debajo de 1 = mercado caro (sesgo defensivo / mantener efectivo); por encima de 1 = barato (sesgo crecimiento). Al lado, dentro del cuadro caro/barato correspondiente, se muestra la diferencia hasta 1 en %."],
                    ["Petróleo con deslizador", "compara el precio actual con su media histórica (eliges los años)."],
                    ["Mix energético mundial", "peso de cada fuente de energía."],
                    ["Gráfico de evolución (10 años)", "renta variable, PIB, su resta y productividad en el tiempo, con doble eje Y; el último punto es estimado. Ampliable."],
                    ["Histórico del coeficiente", "mini-gráfico con zonas sombreadas (verde = barato, rojo = caro) y línea neutra en 1. Ampliable."],
                ],
            },
            {
                h: "10. Conceptos clave (glosario)",
                bullets: [
                    ["POC — Precio Objetivo de Compra", "lo que «vale» la acción hoy según tus fórmulas si la mantuvieras como mínimo 2 años (ingresos por acción, margen bruto, caja libre frente a deuda y capitalización, y crecimiento esperado)."],
                    ["Ratio de Compra (%)", "distancia del precio actual al POC. Positivo y alto = potencialmente barata; es una estimación de la revalorización hasta 2 años adelante."],
                    ["POV — Precio Objetivo de Venta", "el POC ajustado por el margen operativo; zona donde la acción empieza a estar exigente. Una acción de calidad con margen operativo alto tendrá un POV bastante mayor que su POC (más margen para mantener); un POV menor por margen operativo negativo indica una acción de crecimiento de alto riesgo y recompensa, y da idea de cuán lejos está la empresa de generar beneficios con su operativa."],
                    ["Ratio de Venta (%)", "distancia del precio actual al POV; avisa de cuándo se agota el recorrido."],
                    ["Score global tesis (0–100)", "calidad cualitativa de la empresa en un tema. Combina posición competitiva, momentum del sector, calidad del management y resiliencia financiera."],
                    ["TAM Score", "el puente entre lo cualitativo y lo cuantitativo: mezcla la calidad con el trozo de mercado (TAM) que le toca a la empresa frente a sus ingresos proyectados. >1 (verde) = oportunidad grande respecto a su tamaño; <1 (ámbar) = más modesta."],
                    ["Coeficiente KPI", "resume si los KPIs operativos validan (>punto neutro) o deterioran (<) la tesis."],
                    ["Combinado cualitativo", "une el Score y el TAM Score con el Coef KPI (calidad + potencial + validación operativa)."],
                    ["Combinado total", "une lo cualitativo con lo cuantitativo (precio). Es la nota global de oportunidad."],
                    ["Tendencia", "un tema o megatendencia (IA, vehículos eléctricos, energía nuclear…), con su cadena de valor, TAM y CAGR."],
                    ["Tesis / Driver de crecimiento", "una apuesta de alta convicción sobre un motor de crecimiento con su propio TAM que no se solapa con otros. La tesis expone la cadena de valor del tema y sitúa en cada eslabón tanto a la empresa objeto (con su score cualitativo y su TAM Score) como a otras empresas candidatas, clasificándolas entre líderes, competidores y disruptores."],
                    ["TAM y CAGR", "TAM = tamaño del mercado total abordable; CAGR = crecimiento compuesto anual estimado."],
                    ["Convergencia", "una empresa que aparece en varias de tus tendencias a la vez: señal de que está en el cruce de varias megatendencias."],
                    ["Coeficiente de mercado (Macro)", "medida global cara/barata del mercado que orienta tu sesgo agresivo/defensivo."],
                ],
            },
            {
                h: "11. Cómo se relacionan las páginas",
                intro: "El flujo natural conecta todo: descubres ideas en Tendencias → Empresas (explorando o con «Tendencia automática») o buscas empresas concretas en Empresa → Tesis para conocer sus POC y POV. Clasificas las que te convencen en Nivel 1 y Nivel 2. Desarrollas su tesis (cualitativo) y sus KPIs (validación), que alimentan el Score, el TAM Score y el Coef KPI. Todas esas empresas y métricas aparecen juntas en Visual (gráfico + tabla), donde comparas y filtras. Macro te dice el clima general (caro/barato) para modular cuánto peso dar a cada tipo de empresa y cuánto efectivo mantener. Pones campanas de alerta en Visual y recibes un email diario cuando algo cambia. Reescribes tesis y KPIs cuando envejecen o hay noticias y resultados.",
                bullets: [],
            },
            {
                h: "12. Cómo leer el gráfico de Visual",
                intro: "El gráfico de Visual es un cuadrante tipo BCG. Cada burbuja es una empresa:",
                bullets: [
                    ["Eje horizontal (X) = Score cualitativo", "a la derecha, mejor calidad de negocio."],
                    ["Eje vertical (Y) = Ratio de Compra %", "más arriba, más barata (más margen hasta el POC)."],
                    ["Tamaño de la burbuja = TAM Score", "más grande, mayor oportunidad de mercado relativa."],
                    ["Color", "refleja la señal barato/normal/caro según tus umbrales para el POV."],
                    ["Líneas discontinuas (medianas)", "dividen el gráfico en 4 cuadrantes respecto a la mediana de Score y de Ratio de Compra."],
                    ["Flecha", "indica hacia dónde apunta el Coeficiente KPI; cuanto mayor es, más se acerca a un ángulo de 45° hacia arriba y a la derecha (mejor cuadrante)."],
                ],
                outro: "Lectura práctica: el cuadrante SUPERIOR DERECHO (alta calidad + barata) es el de las mejores oportunidades (buen negocio a buen precio). El inferior izquierdo (baja calidad + cara) es el menos atractivo. Arriba-izquierda = barata pero de menor calidad (cautela); abajo-derecha = gran negocio pero caro (paciencia / lista de espera). Diferencia con el treemap de Tesis: el treemap sirve para ver el PESO relativo de tus tendencias y empresas (tamaño = magnitud de una métrica; verde → rojo = alto → bajo); el gráfico de Visual sirve para POSICIONAR cada empresa en calidad vs. precio.",
            },
            {
                h: "13. Dos formas de usar la app",
                bullets: [
                    ["A) Inversor con cartera", "busca sus acciones y las clasifica en Nivel 1 (preferidas/posiciones) y Nivel 2 (seguimiento). Desarrolla la tesis y los KPIs de cada empresa (Score, TAM Score, Coef KPI). Consulta Macro para decidir el peso de cada tipología y el nivel de efectivo (más defensivo si el mercado está caro; más crecimiento si está barato). Vigila la evolución: reescribe las tesis y KPIs más antiguos o cuando hay noticias/resultados. Busca nuevas ideas con «Tendencias → Empresas» (donde también aparecen ETFs), pone campanas de alerta sobre sus empresas clave y recibe el email diario consolidado."],
                    ["B) Inversor que empieza de cero", "explora primero con las tendencias (o con «Tendencia automática») para descubrir temas y empresas, incluidos ETFs. Alternativamente, escribe empresas directamente en el buscador para ver su Ratio de Compra/Venta y su tesis. Con esa información monta sus listas de Nivel 1 y/o Nivel 2 y decide dónde invertir. A partir de ahí sigue el mismo camino: desarrolla tesis y KPIs, consulta Macro, vigila con alertas y actualiza lo que envejece."],
                ],
                outro: "En ambos casos, el objetivo es el mismo: encontrar buenos negocios (cualitativo) a buen precio (cuantitativo), en el momento adecuado del mercado (macro), y no perderles la pista (alertas).",
            },
            {
                h: "14. Una última recomendación",
                intro: "Esta aplicación está construida con fines informativos, didácticos y de organización de información; en ningún caso constituye un consejo imperativo de inversión. Los precios objetivo son orientativos, basados en datos fundamentales y en un cálculo propio subjetivo. Cada inversor debe hacer su propio análisis. Mantente informado de las empresas de tu cartera y toma decisiones meditadas, contrastando la información antes de realizar movimientos.",
                bullets: [],
            },
        ],
        keyIdea: "Idea clave: los números te dicen si está BARATA; el análisis cualitativo te dice si el negocio va a CRECER. Las mejores oportunidades aciertan en las DOS cosas a la vez.",
        download: "Descargar PDF",
        downloadDocx: "Descargar Word",
        generating: "Generando…",
    },
    en: {
        title: "Valuation Studio — User manual",
        subtitle: "Every page, feature and the philosophy behind the app",
        intro: "Valuation Studio comes from an Excel for fundamental stock valuation. In that Excel you entered data and prices by hand to get ratios telling you whether a stock was expensive or cheap. The app does the same, but ingests data automatically (Yahoo Finance), applies the author's formulas and keeps everything fresh. It also adds a qualitative AI brain (the «Thesis Engine») and a macro module that measures whether the market as a whole is expensive or cheap.",
        sections: [
            {
                h: "1. The philosophy: two questions, one decision",
                intro: "The whole app revolves around answering two independent questions about each company, and combining them to decide:",
                bullets: [
                    ["Is it CHEAP?", "the QUANTITATIVE side. Answered with target prices and ratios computed from the formulas (POC, POV, Buy/Sell Ratio)."],
                    ["Will it GROW and is it a GOOD BUSINESS?", "the QUALITATIVE (AI) side. Answered with trends, growth theses, quality and TAM scores, and operating validation via KPIs."],
                ],
                outro: "On top of everything, the Macro module tells you whether to be more aggressive (cheap market → growth) or more defensive (expensive market → cash/defensives), to weight each type of company. Levels philosophy: you organize companies into Level 1 (favorites and real positions) and Level 2 (interesting, on watch). On top of them you build theses and KPIs, and monitor them over time, rewriting what ages or when there is relevant news and earnings.",
            },
            {
                h: "2. Home and search",
                intro: "Entry point. Search any ticker (AAPL, SAP.DE, SAN.MC…) from the top bar, available on every page. Signing in with Google syncs everything across devices and enables any email alerts you have configured.",
                bullets: [],
            },
            {
                h: "3. Company (individual sheet)",
                intro: "The quantitative X-ray of a stock. It contains:",
                bullets: [
                    ["Company info", "name, ticker, price, market cap, business…"],
                    ["Add to Level 1 / Level 2", "add the company to your lists from the sheet."],
                    ["Thesis", "here you'll find the theses developed for this company."],
                    ["POC and POV", "the two target prices (buy and sell) on a 2-year horizon; see the concepts section."],
                    ["Automatic-projection warnings", "data is imported from Yahoo Finance but can have errors or be stale. In those cases the app makes automatic adjustments and warns you here; read it carefully and adjust manually if needed."],
                    ["Anomalous target price", "a warning shown when ratios are excessively optimistic or pessimistic; it explains what may be happening so you decide with full information."],
                    ["Inputs and projections", "shows the formula components, each editable by hand. Projected FCF has several calculation options. If you change a value it changes color and, when saved to Level 1 or 2, it's marked «MAN»."],
                    ["Classic ratios", "P/E, PEG, P/B, P/S, EV/EBITDA, ROE, ROA, margins, debt/equity… Each row with a green/amber/red health dot and a tooltip explaining what it measures and its cheap/normal/expensive ranges."],
                    ["Charts", "revenue and FCF, with historical data and projections."],
                    ["Calculation breakdown (educational)", "explains how POC and POV are obtained, and therefore the buy and sell ratios (% difference vs current price)."],
                    ["Sensitivity mode (educational)", "an exercise to see how the result (metric) varies with changes in the data (e.g. ±10% by hand) to projections and revenue/FCF growth."],
                ],
            },
            {
                h: "4. Level 1 and Level 2",
                intro: "Your conviction and watch lists:",
                bullets: [
                    ["Level 1 (favorites + real portfolio)", "your highest-conviction stocks and real positions. Also supports «watch-only» positions (no money invested). You can enable alerts to know when a stock goes from expensive to cheap (crosses below POC) or vice versa, from cheap to expensive (crosses above POV), by email."],
                    ["Level 2 (watch)", "stocks that interest you but aren't your favorites, also with alerts."],
                ],
            },
            {
                h: "5. Compare",
                intro: "Up to 6 companies side by side to contrast ratios, growth, target prices and qualitative scores at a glance.",
                bullets: [],
            },
            {
                h: "6. Thesis (Thesis Engine): the qualitative brain",
                intro: "Here the AI searches live and structures the analysis. It has two working modes:",
                bullets: [
                    ["Company mode", "you generate a specific company's thesis and organize its growth drivers (merge similar ones, split a big one). The TAM is always 100% mutually exclusive (no double-counting the same market). Running the plan generates all theses at once, giving qualitative and TAM scores per thesis, plus the average qualitative score and the sum of TAM Scores across all the company's theses."],
                    ["Explore mode (Trends → Companies)", "you start from a trend/theme and discover the companies in its value chain (leaders, competitors, disruptors), their TAM and CAGR, and even themed ETFs/funds."],
                    ["Auto trend", "one click discovers an emerging theme by momentum, so you don't start from scratch."],
                    ["Megathesis", "group several related theses/trends into a folder (megatrend)."],
                    ["Undo/Redo and Refresh data", "revert changes and re-read Yahoo fundamentals to recompute TAM Scores with fresh numbers (does not touch qualitative scores)."],
                ],
                outro: "The explorer's treemap shows your data as rectangles: the bigger and greener, the better on the chosen metric. It has 5 views — Megatrends (average 4-year CAGR; shows total TAM), Trends (sized by CAGR, TAM or the normalized average of both), Convergence (companies present in several trends at once; those in 2+ get a gold border), Companies · average score, and Companies · total TAM. The sidebar shows your developed trends (and lets you assign a megatrend), which companies you've searched, how many theses were developed from their plan, and days since each thesis was developed.",
            },
            {
                h: "7. Visual: opportunity map",
                intro: "Crosses the quantitative and qualitative of every company that is a member of your theses on a single screen. Two elements: the chart (scatter/quadrant, each bubble a company; see «How to read the Visual chart») and the table (all companies with Score, TAM Score, KPI Coef, Qualitative combined, Buy Ratio %, Sell Ratio % and Total combined, sortable by any column). Tools:",
                bullets: [
                    ["Filters", "Score, TAM Score, KPI Coef, Buy Ratio, Sell Ratio, Qualitative combined and Total combined. Applying them filters the chart and automatically checks/unchecks the table rows."],
                    ["Alert bell (per company)", "next to the name. Tapping it sets thresholds for Score, TAM Score and KPI Coef (with ≥ or ≤ direction). If the company reaches that state you get an email that day. Companies with a bell in your Level 1 and 2 lists also alert on cheap ↔ expensive crossings. Everything is consolidated into ONE daily email."],
                ],
            },
            {
                h: "8. KPIs: operating validation",
                intro: "Checks whether what the thesis promises is being met in the company's real numbers.",
                bullets: [
                    ["Document extraction", "upload or let the app find company reports/PDFs and extract operating KPIs automatically (with retries and local PDF reading)."],
                    ["KPI Coefficient", "a number summarizing whether KPIs are validating (above their neutral point) or deteriorating (below)."],
                    ["Traceable sources", "each KPI links to its source document and shows the literal quote in a tooltip."],
                    ["Trend indicator", "next to the coefficient, an ↑/↓ arrow shows how it changed vs the previous analysis (re-analysis history)."],
                    ["Sorting", "KPIs can be sorted by analysis age, alphabetically, by coefficient and by thesis age."],
                ],
            },
            {
                h: "9. Macro: is the market expensive or cheap?",
                intro: "Computes a real-time market coefficient to know whether to be aggressive or defensive. It contains:",
                bullets: [
                    ["Indicators", "equities, GDP, M3 proxy, FED rate, inflation, productivity, oil and energy mix. Equities and GDP show the official value and, in large, a LIVE estimate (equities adjusted by the chosen index — S&P 500, NASDAQ 100 or Dow Jones; GDP by its prorated YoY growth)."],
                    ["Market coefficient (dial)", "below 1 = expensive market (defensive bias / hold cash); above 1 = cheap (growth bias). Next to it, inside the matching expensive/cheap box, the % gap to 1 is shown."],
                    ["Oil with a slider", "compares the current price with its historical average (you pick the years)."],
                    ["Global energy mix", "weight of each energy source."],
                    ["Evolution chart (10 years)", "equities, GDP, their difference and productivity over time, with dual Y axis; the last point is estimated. Expandable."],
                    ["Coefficient history", "mini chart with shaded zones (green = cheap, red = expensive) and a neutral line at 1. Expandable."],
                ],
            },
            {
                h: "10. Key concepts (glossary)",
                bullets: [
                    ["POC — Buy Target Price", "what the share is «worth» today per your formulas if held for at least 2 years (revenue per share, gross margin, free cash flow vs debt and market cap, and expected growth)."],
                    ["Buy Ratio (%)", "distance from the current price to POC. High and positive = potentially cheap; an estimate of the upside up to 2 years out."],
                    ["POV — Sell Target Price", "POC adjusted by the operating margin; the zone where the stock starts to look demanding. A quality stock with high operating margin will have a POV well above its POC (more room to hold); a lower POV due to negative operating margin signals a high-risk/high-reward growth stock, and hints how far the company is from making operating profits."],
                    ["Sell Ratio (%)", "distance from the current price to POV; warns when the upside runs out."],
                    ["Thesis overall score (0–100)", "the company's qualitative quality in a theme. Combines competitive position, sector momentum, management quality and financial resilience."],
                    ["TAM Score", "the bridge between qualitative and quantitative: mixes quality with the slice of market (TAM) the company gets vs its projected revenue. >1 (green) = big opportunity relative to its size; <1 (amber) = more modest."],
                    ["KPI Coefficient", "summarizes whether operating KPIs validate (>neutral) or deteriorate (<) the thesis."],
                    ["Qualitative combined", "joins Score and TAM Score with the KPI Coef (quality + potential + operating validation)."],
                    ["Total combined", "joins qualitative with quantitative (price). The overall opportunity grade."],
                    ["Trend", "a theme/megatrend (AI, EVs, nuclear energy…), with its value chain, TAM and CAGR."],
                    ["Thesis / Growth driver", "a high-conviction bet on a growth engine with its own non-overlapping TAM. The thesis lays out the theme's value chain and places at each link the subject company (with its qualitative and TAM scores) and other candidates, classifying them as leaders, competitors and disruptors."],
                    ["TAM and CAGR", "TAM = total addressable market size; CAGR = estimated compound annual growth rate."],
                    ["Convergence", "a company appearing in several of your trends at once: a sign it's at the crossroads of multiple megatrends."],
                    ["Market coefficient (Macro)", "a global expensive/cheap measure of the market that guides your aggressive/defensive bias."],
                ],
            },
            {
                h: "11. How the pages connect",
                intro: "The natural flow connects everything: you discover ideas in Trends → Companies (exploring or via «Auto trend») or search specific companies in Company → Thesis to learn their POC and POV. You classify the convincing ones into Level 1 and Level 2. You develop their thesis (qualitative) and KPIs (validation), which feed the Score, TAM Score and KPI Coef. All those companies and metrics appear together in Visual (chart + table), where you compare and filter. Macro tells you the general climate (expensive/cheap) to weight each type of company and how much cash to hold. You set alert bells in Visual and get a daily email when something changes. You rewrite theses and KPIs when they age or there's news and earnings.",
                bullets: [],
            },
            {
                h: "12. How to read the Visual chart",
                intro: "The Visual chart is a BCG-style quadrant. Each bubble is a company:",
                bullets: [
                    ["Horizontal axis (X) = Qualitative score", "to the right, better business quality."],
                    ["Vertical axis (Y) = Buy Ratio %", "higher up, cheaper (more room to POC)."],
                    ["Bubble size = TAM Score", "bigger, larger relative market opportunity."],
                    ["Color", "reflects the cheap/normal/expensive signal per your POV thresholds."],
                    ["Dashed lines (medians)", "split the chart into 4 quadrants around the median Score and Buy Ratio."],
                    ["Arrow", "points where the KPI Coefficient heads; the higher it is, the closer to a 45° angle up and to the right (best quadrant)."],
                ],
                outro: "Practical reading: the TOP-RIGHT quadrant (high quality + cheap) holds the best opportunities (good business at a good price). Bottom-left (low quality + expensive) is the least attractive. Top-left = cheap but lower quality (caution); bottom-right = great business but expensive (patience / waiting list). Difference vs the Thesis treemap: the treemap shows the relative WEIGHT of your trends and companies (size = magnitude of a metric; green → red = high → low); the Visual chart POSITIONS each company on quality vs price.",
            },
            {
                h: "13. Two ways to use the app",
                bullets: [
                    ["A) Investor with a portfolio", "searches their stocks and classifies them into Level 1 (favorites/positions) and Level 2 (watch). Develops each company's thesis and KPIs (Score, TAM Score, KPI Coef). Checks Macro to decide each type's weight and the cash level (more defensive if the market is expensive; more growth if cheap). Monitors evolution: rewrites the oldest theses and KPIs or when there's news/earnings. Finds new ideas with «Trends → Companies» (also showing ETFs), sets alert bells on key companies and gets the consolidated daily email."],
                    ["B) Investor starting from scratch", "explores first with trends (or «Auto trend») to discover themes and companies, including ETFs. Alternatively, types companies directly in the search box to see their Buy/Sell Ratio and thesis. With that info they build their Level 1 and/or Level 2 lists and decide where to invest. From there, the same path: develop theses and KPIs, check Macro, monitor with alerts and update what ages."],
                ],
                outro: "In both cases the goal is the same: find good businesses (qualitative) at a good price (quantitative), at the right market moment (macro), and never lose track of them (alerts).",
            },
            {
                h: "14. One last recommendation",
                intro: "This app is built for informational, educational and information-organizing purposes; it is in no way imperative investment advice. Target prices are indicative, based on fundamental data and a subjective proprietary calculation. Each investor must do their own analysis. Stay informed about your portfolio companies and make thoughtful decisions, cross-checking information before acting.",
                bullets: [],
            },
        ],
        keyIdea: "Key idea: the numbers tell you if it's CHEAP; the qualitative analysis tells you if the business will GROW. The best opportunities get BOTH right.",
        download: "Download PDF",
        downloadDocx: "Download Word",
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
                    filename: lang === "en" ? "Valuation_Studio_Manual.pdf" : "Valuation_Studio_Manual.pdf",
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
                    <a
                        href={DOCX_URL}
                        download
                        className="border border-black bg-white text-black hover:bg-[#F5E4D4] transition-colors flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-[0.12em] font-semibold"
                        data-testid="instructions-download-docx"
                    >
                        <FileText size={15} />
                        {c.downloadDocx}
                    </a>
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
                        {s.bullets && s.bullets.length > 0 && (
                            <ul className="space-y-1.5 list-disc pl-5">
                                {s.bullets.map((b, j) => (
                                    <li key={j} className="text-sm leading-relaxed text-[#2A2A2A]">
                                        <span className="font-semibold">{b[0]}:</span> {b[1]}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {s.outro && <p className="text-sm leading-relaxed text-[#2A2A2A] mt-2">{s.outro}</p>}
                    </section>
                ))}

                <p className="italic text-[13px] text-[#4A4A4A] border-t border-black/15 pt-4 mt-6">{c.keyIdea}</p>
            </article>
        </div>
    );
}
