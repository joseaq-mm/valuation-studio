import React from "react";
import { LayoutGrid, Table2 } from "lucide-react";

// Table ⇄ Cards view switcher. Reusable in Nivel 1 (Portfolio) and Nivel 2 (Watchlist).
export const ViewToggle = ({ view, onChange, testid = "view-toggle" }) => (
    <div className="flex border border-black" data-testid={testid}>
        <button
            onClick={() => onChange("table")}
            className={`px-2.5 py-1.5 flex items-center gap-1 text-xs font-mono transition ${view === "table" ? "bg-black text-white" : "bg-white hover:bg-[#F1E9D9]"}`}
            data-testid={`${testid}-table`}
        >
            <Table2 size={13} /> Tabla
        </button>
        <button
            onClick={() => onChange("cards")}
            className={`px-2.5 py-1.5 flex items-center gap-1 text-xs font-mono border-l border-black transition ${view === "cards" ? "bg-black text-white" : "bg-white hover:bg-[#F1E9D9]"}`}
            data-testid={`${testid}-cards`}
        >
            <LayoutGrid size={13} /> Tarjetas
        </button>
    </div>
);

export default ViewToggle;
