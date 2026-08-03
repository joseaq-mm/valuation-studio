import React from "react";
import FormatDownloadMenu from "@/components/FormatDownloadMenu";
import { thesisExport } from "@/lib/api";

/** Single split-button to download a saved thesis (company / tendencia) as PDF or
 *  Word (.docx): the symbol downloads the selected format; the caret switches it.
 *  Requires a persisted thesis id (auth Bearer via api.js). */
export default function ThesisDownloadButtons({ thesisId, title, className = "" }) {
    if (!thesisId) return null;
    return (
        <div className={className}>
            <FormatDownloadMenu
                size="md"
                formats={["pdf", "docx"]}
                defaultFmt="pdf"
                fetcher={(fmt) => thesisExport(thesisId, fmt)}
                fallbackName={title || "tesis"}
                testids={{
                    menu: "thesis-download-menu",
                    btn: "thesis-download-btn",
                    caret: "thesis-download-caret",
                    optMenu: "thesis-download-format-menu",
                    opt: (fmt) => `thesis-download-${fmt}`,
                }}
            />
        </div>
    );
}
