import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// `withCredentials` is required so the session_token httpOnly cookie travels
// with every request once the user has logged in.
export const api = axios.create({ baseURL: API, timeout: 30000, withCredentials: true });

export const getCompany = (ticker, refresh = false) =>
    api.get(`/company/${encodeURIComponent(ticker)}`, { params: { refresh } }).then(r => r.data);

export const recalc = (ticker, inputs) =>
    api.post(`/company/${encodeURIComponent(ticker)}/calculate`, inputs).then(r => r.data);

export const compare = async (tickers) => {
    if (!tickers || tickers.length === 0) return { results: [] };
    // Chunk to keep each request small (yfinance + cache friendly)
    const CHUNK = 6;
    const chunks = [];
    for (let i = 0; i < tickers.length; i += CHUNK) chunks.push(tickers.slice(i, i + CHUNK));
    const responses = await Promise.all(
        chunks.map(c => api.get(`/compare`, { params: { tickers: c.join(",") } }).then(r => r.data))
    );
    const merged = responses.flatMap(r => r.results || []);
    return { results: merged };
};

export const searchTickers = (q) =>
    api.get(`/search`, { params: { q } }).then(r => r.data);

export const translateSummary = (ticker) =>
    api.get(`/company/${encodeURIComponent(ticker)}/translate-summary`).then(r => r.data);

// ---------------- Auth ----------------
export const authMe = () => api.get(`/auth/me`).then(r => r.data);
export const authSession = (session_id) => api.post(`/auth/session`, { session_id }).then(r => r.data);
export const authLogout = () => api.post(`/auth/logout`).then(r => r.data);

// ---------------- Cloud watchlist ----------------
export const cloudWatchlistGet = () => api.get(`/auth/watchlist`).then(r => r.data);
export const cloudWatchlistPut = (entries) => api.put(`/auth/watchlist`, { entries }).then(r => r.data);

// ---------------- Cloud portfolio ----------------
export const cloudPortfolioGet = () => api.get(`/auth/portfolio`).then(r => r.data);
export const cloudPortfolioPut = (positions) => api.put(`/auth/portfolio`, { positions }).then(r => r.data);

// ---------------- Notification prefs ----------------
export const notifyGet = () => api.get(`/auth/notify`).then(r => r.data);
export const notifyPut = (prefs) => api.put(`/auth/notify`, prefs).then(r => r.data);

// ---------------- FX ----------------
export const fxRates = () => api.get(`/fx/rates`).then(r => r.data);

// ---------------- Thesis Engine (qualitative AI) ----------------
// Generation runs a live web search + GPT-5.2 + Claude pipeline (~1-2 min).
// To survive the ~60s ingress timeout, the backend runs it as a background job:
// POST returns a job_id immediately and we poll until it is done.
export const thesisJob = (jobId) => api.get(`/thesis/job/${jobId}`).then(r => r.data);

async function pollThesisJob(jobId, { intervalMs = 3000, timeoutMs = 300000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, intervalMs));
        let job;
        try { job = await thesisJob(jobId); } catch { continue; } // transient — keep polling
        if (job.status === "done") return job.result;
        if (job.status === "error") {
            const e = new Error(job.error || "error");
            e.response = { data: { detail: job.error || "Error generando la tesis" } };
            throw e;
        }
    }
    const e = new Error("timeout");
    e.response = { data: { detail: "La generación tardó demasiado. Inténtalo de nuevo." } };
    throw e;
}

function startAndPoll(data) {
    if (data && data.job_id) return pollThesisJob(data.job_id);
    if (data && data.result) return data.result; // e.g. contra already existed
    return data;
}

export const thesisGenerate = (type, subject, matchedThesisId = null, overwriteThesisId = null, extra = {}) =>
    api.post(`/thesis/generate`, { type, subject, matched_thesis_id: matchedThesisId, overwrite_thesis_id: overwriteThesisId, ...extra }).then(r => startAndPoll(r.data));
export const thesisTamScores = (items) =>
    api.post(`/thesis/tam-scores`, { items }).then(r => startAndPoll(r.data));
export const thesisDiscover = () =>
    api.post(`/thesis/discover`).then(r => startAndPoll(r.data));
export const thesisGenerateContra = (id) =>
    api.post(`/thesis/${id}/contra`).then(r => startAndPoll(r.data));
export const thesisList = () => api.get(`/thesis/list`).then(r => r.data);
export const thesisGet = (id) => api.get(`/thesis/${id}`).then(r => r.data);
export const thesisDelete = (id) => api.delete(`/thesis/${id}`).then(r => r.data);
export const thesisAssignFolder = (id, folder_id) =>
    api.put(`/thesis/${id}/folder`, { folder_id }).then(r => r.data);
export const thesisAssignParent = (id, parent_id) =>
    api.put(`/thesis/${id}/parent`, { parent_id }).then(r => r.data);
export const thesisRecordSplit = (id, body) =>
    api.post(`/thesis/${id}/split-developed`, body).then(r => r.data);
export const thesisFolders = () => api.get(`/thesis/folders`).then(r => r.data);
export const thesisCreateFolder = (name) => api.post(`/thesis/folders`, { name }).then(r => r.data);
export const thesisDeleteFolder = (id, mode = "ungroup") =>
    api.delete(`/thesis/folders/${id}`, { params: { mode } }).then(r => r.data);
export const thesisRestore = (payload) => api.post(`/thesis/restore`, payload).then(r => r.data);
export const thesisDashboard = () => api.get(`/thesis/dashboard`).then(r => r.data);
export const thesisCompanyQual = (ticker) =>
    api.get(`/thesis/company/${encodeURIComponent(ticker)}`).then(r => r.data);
export const thesisCompanyProfile = (ticker) =>
    api.get(`/thesis/company/${encodeURIComponent(ticker)}/profile`).then(r => r.data);

// F5: cross-linking company ↔ existing theses
export const thesisLinkSuggestions = (id) =>
    api.post(`/thesis/${id}/link-suggestions`).then(r => r.data);
export const thesisAddCompany = (id, ticker, name, entry = null) =>
    api.post(`/thesis/${id}/add-company`, { ticker, name, entry }).then(r => startAndPoll(r.data));
export const thesisEvaluateCompany = (id, ticker, name) =>
    api.post(`/thesis/${id}/evaluate-company`, { ticker, name }).then(r => startAndPoll(r.data));

// Weekly trend radar (email)
export const thesisRadarStatus = () => api.get(`/thesis/radar/status`).then(r => r.data);
export const thesisRadarSubscribe = (enabled) =>
    api.post(`/thesis/radar/subscribe`, { enabled }).then(r => r.data);

// Weekly thesis refresh + news watch (email)
export const thesisRefreshStatus = () => api.get(`/thesis/refresh/status`).then(r => r.data);
export const thesisRefreshSubscribe = (enabled) =>
    api.post(`/thesis/refresh/subscribe`, { enabled }).then(r => r.data);
