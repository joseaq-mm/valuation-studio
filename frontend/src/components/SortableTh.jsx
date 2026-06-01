import React from "react";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";

/**
 * Clickable table header that drives column sorting.
 * - First click sorts (strings asc, numbers desc by default).
 * - Subsequent clicks on the same column toggle asc/desc.
 */
export function SortableTh({ label, sortKey, sort, onSort, align = "left", children, className = "" }) {
    const active = sort?.key === sortKey;
    const dir = active ? sort.dir : null;
    const thAlign = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
    const btnAlign = align === "right" ? "flex-row-reverse" : align === "center" ? "justify-center" : "justify-start";

    return (
        <th className={`overline ${thAlign} px-2 py-2 ${className}`}>
            <button
                type="button"
                onClick={() => onSort(sortKey)}
                className={`inline-flex items-center gap-1 ${btnAlign} hover:text-[#B32A22] transition-colors ${active ? "text-[#B32A22]" : ""}`}
                data-testid={`sort-${sortKey}`}
            >
                <span>{children ?? label}</span>
                {active
                    ? (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                    : <ChevronsUpDown size={11} className="opacity-30" />}
            </button>
        </th>
    );
}

/**
 * Comparator factory. Nulls/NaN always sink to the bottom regardless of direction.
 */
export function makeSorter(getVal, dir) {
    return (a, b) => {
        const va = getVal(a);
        const vb = getVal(b);
        const aNull = va == null || (typeof va === "number" && Number.isNaN(va));
        const bNull = vb == null || (typeof vb === "number" && Number.isNaN(vb));
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        if (typeof va === "string" || typeof vb === "string") {
            const cmp = String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
            return dir === "asc" ? cmp : -cmp;
        }
        return dir === "asc" ? va - vb : vb - va;
    };
}

/**
 * Toggle helper shared by pages. numericKeys default to "desc" on first click.
 */
export function nextSort(prev, key, numericKeys) {
    if (prev?.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    }
    return { key, dir: numericKeys.has(key) ? "desc" : "asc" };
}
