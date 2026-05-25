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

export const compare = (tickers) =>
    api.get(`/compare`, { params: { tickers: tickers.join(",") } }).then(r => r.data);

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

// ---------------- Notification prefs ----------------
export const notifyGet = () => api.get(`/auth/notify`).then(r => r.data);
export const notifyPut = (prefs) => api.put(`/auth/notify`, prefs).then(r => r.data);

// ---------------- FX ----------------
export const fxRates = () => api.get(`/fx/rates`).then(r => r.data);
