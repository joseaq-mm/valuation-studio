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
// Generation runs a live web search + GPT-5.2 + Claude pipeline → ~40-90s,
// so it needs a much longer timeout than the default api instance.
const thesisApi = axios.create({ baseURL: API, timeout: 180000, withCredentials: true });

export const thesisGenerate = (type, subject) =>
    thesisApi.post(`/thesis/generate`, { type, subject }).then(r => r.data);
export const thesisGenerateContra = (id) =>
    thesisApi.post(`/thesis/${id}/contra`).then(r => r.data);
export const thesisList = () => api.get(`/thesis/list`).then(r => r.data);
export const thesisGet = (id) => api.get(`/thesis/${id}`).then(r => r.data);
export const thesisDelete = (id) => api.delete(`/thesis/${id}`).then(r => r.data);
export const thesisAssignFolder = (id, folder_id) =>
    api.put(`/thesis/${id}/folder`, { folder_id }).then(r => r.data);
export const thesisFolders = () => api.get(`/thesis/folders`).then(r => r.data);
export const thesisCreateFolder = (name) => api.post(`/thesis/folders`, { name }).then(r => r.data);
export const thesisDeleteFolder = (id) => api.delete(`/thesis/folders/${id}`).then(r => r.data);
export const thesisCompanyQual = (ticker) =>
    api.get(`/thesis/company/${encodeURIComponent(ticker)}`).then(r => r.data);
