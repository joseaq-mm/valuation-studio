// Export on-screen charts as high-resolution (retina 2x) JPG images.
//  · downloadSvgJpg / getSvgJpgBlob   → Recharts (pure SVG) charts (Visual / Macro / Company).
//  · downloadHtmlJpg / getHtmlJpgBlob → HTML/div treemap (uses html2canvas).

const APP_FONT = "'IBM Plex Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

// Pick the actual chart <svg>, not the tiny recharts legend-icon <svg>s (which also
// carry class="recharts-surface" and appear FIRST in the DOM). We choose the largest
// svg by rendered area.
function pickChartSvg(container) {
    const svgs = [...container.querySelectorAll("svg")];
    if (!svgs.length) return null;
    let best = null, bestArea = -1;
    for (const s of svgs) {
        const r = s.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = s; }
    }
    return best;
}

async function svgToCanvas(container, scale = 2) {
    if (!container) throw new Error("sin contenedor");
    const svg = pickChartSvg(container);
    if (!svg) throw new Error("no se encontró el gráfico");
    const rect = svg.getBoundingClientRect();
    const w = Math.max(1, Math.ceil(rect.width) || svg.width?.baseVal?.value || 800);
    const h = Math.max(1, Math.ceil(rect.height) || svg.height?.baseVal?.value || 400);

    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", w);
    clone.setAttribute("height", h);
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `text{font-family:${APP_FONT};}`;
    clone.insertBefore(style, clone.firstChild);

    const data = new XMLSerializer().serializeToString(clone);
    const svg64 = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(data);
    const img = new Image();
    await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error("no se pudo renderizar el gráfico"));
        img.src = svg64;
    });

    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
}

function triggerDownload(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename.endsWith(".jpg") ? filename : `${filename}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

export async function downloadSvgJpg(container, filename = "grafico", scale = 2) {
    const canvas = await svgToCanvas(container, scale);
    triggerDownload(canvas.toDataURL("image/jpeg", 0.95), filename);
}

export async function getSvgJpgBlob(container, scale = 2) {
    const canvas = await svgToCanvas(container, scale);
    return await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.95));
}

async function htmlToCanvas(element, scale = 2) {
    if (!element) throw new Error("sin contenedor");
    const html2canvas = (await import("html2canvas")).default;
    return await html2canvas(element, { scale, backgroundColor: "#ffffff", useCORS: true, logging: false });
}

export async function downloadHtmlJpg(element, filename = "grafico", scale = 2) {
    const canvas = await htmlToCanvas(element, scale);
    triggerDownload(canvas.toDataURL("image/jpeg", 0.95), filename);
}

export async function getHtmlJpgBlob(element, scale = 2) {
    const canvas = await htmlToCanvas(element, scale);
    return await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.95));
}
