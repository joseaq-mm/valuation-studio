import React from "react";
import { ArrowUpDown, ArrowDownAZ, ArrowUpAZ } from "lucide-react";

// Sort control for card views (Nivel 1 & 2). Drives the same `sort` state used
// by the tables, so the selected key/dir applies immediately to the grid.
export const CardSort = ({ options, sort, onChange, testid = "card-sort" }) => {
    const key = sort?.key || "";
    const dir = sort?.dir || "asc";

    const pickField = (e) => {
        const k = e.target.value;
        if (!k) return onChange(null);
        onChange({ key: k, dir: sort?.key === k ? dir : "asc" });
    };
    const toggleDir = () => {
        if (!key) return;
        onChange({ key, dir: dir === "asc" ? "desc" : "asc" });
    };

    return (
        <div className="flex items-center gap-2 mb-3" data-testid={testid}>
            <span className="overline text-[#4A4A4A] text-[10px]">Ordenar por</span>
            <select
                value={key}
                onChange={pickField}
                className="input-paper font-mono text-xs py-1.5 px-2 bg-white border border-black"
                data-testid={`${testid}-field`}
            >
                <option value="">Sin orden</option>
                {options.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                ))}
            </select>
            <button
                type="button"
                onClick={toggleDir}
                disabled={!key}
                title={dir === "asc" ? "Ascendente" : "Descendente"}
                className="border border-black bg-white px-2 py-1.5 hover:bg-[#F1E9D9] disabled:opacity-40 transition-colors"
                data-testid={`${testid}-dir`}
            >
                {!key ? <ArrowUpDown size={14} /> : dir === "asc" ? <ArrowUpAZ size={14} /> : <ArrowDownAZ size={14} />}
            </button>
        </div>
    );
};

export default CardSort;
