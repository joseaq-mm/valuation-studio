/**
 * Client-side replica of compute_custom_ratios from backend/server.py.
 * Keeps backend formula authoritative; this mirror is for fast UI updates
 * (e.g. when watchlist applies overrides on load, or when previewing edits).
 *
 * Formula (user's own valuation system):
 *   POC = (revenue_2y / shares) × (1 + gross_margin) × ((fcf_2y − net_debt)/market_cap × 100)
 *         × (1 + revenue_cagr_4y) × (1 + fcf_cagr_4y)
 *   Ratio Compra = (POC / current_price − 1) × 100
 *   POV = POC × (1 + operating_margin)
 *   Ratio Venta = (POV / current_price − 1) × 100
 */

const FIELDS = [
    "revenue_2y", "fcf_2y", "shares_outstanding", "gross_margin", "operating_margin",
    "net_debt", "market_cap", "revenue_cagr_4y", "fcf_cagr_4y", "current_price",
];

const _num = (v) => {
    if (v === null || v === undefined) return null;
    const f = typeof v === "number" ? v : parseFloat(v);
    if (isNaN(f) || !isFinite(f)) return null;
    return f;
};

export const computeCustomRatios = (inputs) => {
    const vals = {};
    for (const f of FIELDS) vals[f] = _num(inputs[f]);

    const missing = FIELDS.filter(f => vals[f] === null);
    if (missing.length) {
        return { poc: null, pov: null, ratio_compra_pct: null, ratio_venta_pct: null, missing_inputs: missing };
    }
    if (vals.shares_outstanding <= 0 || vals.market_cap <= 0 || vals.current_price <= 0) {
        return { poc: null, pov: null, ratio_compra_pct: null, ratio_venta_pct: null, missing_inputs: ["non_positive_denominator"] };
    }

    const revPerShare2y = vals.revenue_2y / vals.shares_outstanding;
    const marginFactor = 1 + vals.gross_margin;

    // Raw FCF yield after net debt, in %
    const xRaw = ((vals.fcf_2y - vals.net_debt) / vals.market_cap) * 100;
    let xFactor;
    if (xRaw < 0) xFactor = 1 + xRaw / 100;
    else if (xRaw <= 1) xFactor = 1;
    else if (xRaw > 10) xFactor = 10; // Upper cap: very high FCF yields often signal cash trap / no reinvestment / no buybacks
    else xFactor = xRaw;

    const revGrowthFactor = 1 + vals.revenue_cagr_4y;
    const fcfGrowthFactor = 1 + vals.fcf_cagr_4y;

    const poc = revPerShare2y * marginFactor * xFactor * revGrowthFactor * fcfGrowthFactor;

    // Operating margin factor (same shape as xFactor)
    const yPct = vals.operating_margin * 100;
    let yFactor;
    if (yPct < 0) yFactor = 1 + yPct / 100;
    else if (yPct <= 1) yFactor = 1;
    else yFactor = 1 + yPct / 100;

    const pov = poc * yFactor;

    return {
        poc,
        pov,
        ratio_compra_pct: (poc / vals.current_price - 1) * 100,
        ratio_venta_pct: (pov / vals.current_price - 1) * 100,
        breakdown: {
            rev_per_share_2y: revPerShare2y,
            margin_factor: marginFactor,
            x_raw_pct: xRaw,
            fcf_minus_netdebt_over_mcap_pct: xFactor,
            rev_growth_factor: revGrowthFactor,
            fcf_growth_factor: fcfGrowthFactor,
            y_factor: yFactor,
        },
        missing_inputs: [],
    };
};

/**
 * Given backend company data, return the "auto" inputs object (the snapshot
 * of values the user would see before any manual edits).
 */
export const autoInputsFromData = (data) => ({
    revenue_2y: data.auto_projections?.revenue_2y,
    fcf_2y: data.auto_projections?.fcf_2y,
    shares_outstanding: data.shares_outstanding,
    gross_margin: data.gross_margin,
    operating_margin: data.operating_margin,
    net_debt: data.net_debt,
    market_cap: data.market_cap,
    revenue_cagr_4y: data.auto_projections?.revenue_cagr_4y,
    fcf_cagr_4y: data.auto_projections?.fcf_cagr_4y,
    current_price: data.current_price,
});

/** Compare two values with a small relative tolerance to avoid float jitter. */
export const valuesEqual = (a, b) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (a === 0 && b === 0) return true;
    const diff = Math.abs(a - b);
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return diff / scale <= 0.001;
};

/**
 * Compute which fields differ from auto values. Returns object {field: value}
 * containing only the fields that have been overridden. Price is excluded
 * (we never persist price — Yahoo always wins).
 */
export const computeOverrides = (currentInputs, autoInputs) => {
    const overrides = {};
    for (const f of FIELDS) {
        if (f === "current_price") continue;
        if (!valuesEqual(currentInputs[f], autoInputs[f])) {
            overrides[f] = currentInputs[f];
        }
    }
    return overrides;
};
