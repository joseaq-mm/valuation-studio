import React from "react";
import FormatDownloadMenu from "@/components/FormatDownloadMenu";
import ShareMenu from "@/components/ShareMenu";
import { thesisExport, shareCreate } from "@/lib/api";

/** Single split-button to download a saved thesis (company / tendencia) as PDF or
 *  Word (.docx) + a Share button (shares the currently-selected format). */
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
                leftSlot={(fmt) => (
                    <ShareMenu
                        size="md"
                        title={title || "Tesis"}
                        testidPrefix="thesis-share"
                        createShare={() => shareCreate({ kind: "thesis", id: thesisId, fmt })}
                    />
                )}
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
