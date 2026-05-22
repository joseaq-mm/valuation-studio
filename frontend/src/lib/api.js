import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, timeout: 30000 });

export const getCompany = (ticker, refresh = false) =>
    api.get(`/company/${encodeURIComponent(ticker)}`, { params: { refresh } }).then(r => r.data);

export const recalc = (ticker, inputs) =>
    api.post(`/company/${encodeURIComponent(ticker)}/calculate`, inputs).then(r => r.data);

export const compare = (tickers) =>
    api.get(`/compare`, { params: { tickers: tickers.join(",") } }).then(r => r.data);

export const searchTickers = (q) =>
    api.get(`/search`, { params: { q } }).then(r => r.data);
