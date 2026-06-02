// Lightweight squarified treemap layout (Bruls, Huizing & van Wijk).
// Returns each input node with pixel rect {x, y, w, h} inside width×height.
export function squarify(data, width, height) {
    const nodes = (data || []).filter((d) => d.value > 0);
    if (!nodes.length || width <= 0 || height <= 0) return [];
    const total = nodes.reduce((s, d) => s + d.value, 0);
    const scaled = nodes
        .map((d) => ({ ...d, _area: (d.value / total) * width * height }))
        .sort((a, b) => b._area - a._area);

    const result = [];
    const rect = { x: 0, y: 0, w: width, h: height };

    const worst = (row, side) => {
        const sum = row.reduce((s, r) => s + r._area, 0);
        const max = Math.max(...row.map((r) => r._area));
        const min = Math.min(...row.map((r) => r._area));
        const s2 = sum * sum;
        return Math.max((side * side * max) / s2, s2 / (side * side * min));
    };

    const layout = (row) => {
        const side = Math.min(rect.w, rect.h);
        const sum = row.reduce((s, r) => s + r._area, 0);
        const thick = sum / side;
        if (rect.w >= rect.h) {
            let yy = rect.y;
            row.forEach((r) => {
                const hh = r._area / thick;
                result.push({ ...r, x: rect.x, y: yy, w: thick, h: hh });
                yy += hh;
            });
            rect.x += thick; rect.w -= thick;
        } else {
            let xx = rect.x;
            row.forEach((r) => {
                const ww = r._area / thick;
                result.push({ ...r, x: xx, y: rect.y, w: ww, h: thick });
                xx += ww;
            });
            rect.y += thick; rect.h -= thick;
        }
    };

    let row = [];
    for (const it of scaled) {
        const side = Math.min(rect.w, rect.h);
        if (row.length === 0) { row.push(it); continue; }
        if (worst([...row, it], side) <= worst(row, side)) row.push(it);
        else { layout(row); row = [it]; }
    }
    if (row.length) layout(row);
    return result;
}

// Relative red → gold → green gradient. t in [0, 1].
export function heatColor(t) {
    const x = Math.max(0, Math.min(1, t));
    const red = [179, 42, 34], gold = [184, 134, 11], green = [30, 125, 69];
    const lerp = (a, b, k) => Math.round(a + (b - a) * k);
    let c;
    if (x < 0.5) { const k = x / 0.5; c = [lerp(red[0], gold[0], k), lerp(red[1], gold[1], k), lerp(red[2], gold[2], k)]; }
    else { const k = (x - 0.5) / 0.5; c = [lerp(gold[0], green[0], k), lerp(gold[1], green[1], k), lerp(gold[2], green[2], k)]; }
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// Map a value to a heat colour relative to the set's min/max.
export function relColor(v, min, max) {
    if (v == null) return "#9CA3AF";
    if (max === min) return heatColor(0.7);
    return heatColor((v - min) / (max - min));
}
