import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// `withCredentials` is required so the session_token httpOnly cookie travels
// with every request once the user has logged in.
export const api = axios.create({ baseURL: API, timeout: 30000, withCredentials: true });

// When running inside the preview iframe, third-party cookies can be blocked, so the
// login popup relays the session_token here (localStorage 'vs:token') and we send it as
// a Bearer token. The backend accepts either the cookie or this header.
export const TOKEN_KEY = "vs:token";
api.interceptors.request.use((config) => {
    try {
        const t = localStorage.getItem(TOKEN_KEY);
        if (t) config.headers.Authorization = `Bearer ${t}`;
    } catch { /* ignore */ }
    return config;
});

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
export const googleLogin = (code, redirect_uri) => api.post(`/auth/google`, { code, redirect_uri }).then(r => r.data);
export const authLogout = () => api.post(`/auth/logout`).then(r => r.data);

// ---------------- Cloud watchlist ----------------
export const cloudWatchlistGet = () => api.get(`/auth/watchlist`).then(r => r.data);
export const cloudWatchlistPut = (entries, deletions = {}) => api.put(`/auth/watchlist`, { entries, deletions }).then(r => r.data);
export const cloudWatchlistDelete = (ticker) => api.post(`/auth/watchlist/delete`, { ticker }).then(r => r.data);

// ---------------- Cloud portfolio ----------------
export const cloudPortfolioGet = () => api.get(`/auth/portfolio`).then(r => r.data);
export const cloudPortfolioPut = (positions, deletions = {}) => api.put(`/auth/portfolio`, { positions, deletions }).then(r => r.data);
export const cloudPortfolioDelete = (ticker) => api.post(`/auth/portfolio/delete`, { ticker }).then(r => r.data);

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

async function pollThesisJob(jobId, { intervalMs = 3000, timeoutMs = 300000, onStatus } = {}) {
    let start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, intervalMs));
        let job;
        try { job = await thesisJob(jobId); } catch { continue; } // transient — keep polling
        if (onStatus) onStatus(job.status);
        if (job.status === "queued") { start = Date.now(); continue; } // waiting in line — don't time out
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

function startAndPoll(data, onStatus) {
    if (data && data.status === "busy") {
        const e = new Error("busy");
        e.busy = data.active || {};
        throw e;
    }
    if (data && data.job_id) return pollThesisJob(data.job_id, { onStatus });
    if (data && data.result) return data.result; // e.g. contra already existed
    return data;
}

export const thesisGenerate = (type, subject, matchedThesisId = null, overwriteThesisId = null, extra = {}, onStatus = null) =>
    api.post(`/thesis/generate`, { type, subject, matched_thesis_id: matchedThesisId, overwrite_thesis_id: overwriteThesisId, ...extra }).then(r => startAndPoll(r.data, onStatus));
// Batch develop: fire generations without polling (used by "Generar todas las particiones").
export const thesisGenerateRaw = (type, subject, extra = {}) =>
    api.post(`/thesis/generate`, { type, subject, ...extra }).then(r => r.data);
export const thesisPollJob = (jobId, onStatus = null) => pollThesisJob(jobId, { onStatus });
export const thesisTamScores = (items) =>
    api.post(`/thesis/tam-scores`, { items }).then(r => startAndPoll(r.data));
export const thesisDiscover = () =>
    api.post(`/thesis/discover`).then(r => startAndPoll(r.data));
export const thesisExplore = (subject) =>
    api.post(`/thesis/explore`, { subject }).then(r => startAndPoll(r.data));
export const thesisAutoTrend = (exclude = []) =>
    api.post(`/thesis/auto-trend`, { exclude }).then(r => startAndPoll(r.data));
export const thesisSaveTendencia = (tendencia, overwriteId = null) =>
    api.post(`/thesis/tendencia/save`, overwriteId ? { tendencia, overwrite_id: overwriteId } : { tendencia }).then(r => r.data);
export const thesisModels = () =>
    api.get(`/thesis/models`).then(r => r.data);
export const thesisSetModel = (preset) =>
    api.put(`/thesis/models`, { preset }).then(r => r.data);
export const thesisGenerateContra = (id) =>
    api.post(`/thesis/${id}/contra`).then(r => startAndPoll(r.data));
// Download a saved thesis (company/tendencia) as PDF or Word (.docx). Returns the
// raw axios response (blob) so the caller can read Content-Disposition for the name.
export const thesisExport = (id, fmt) =>
    api.get(`/thesis/${id}/export/${fmt}`, { responseType: "blob", timeout: 120000 });
export const thesisList = () => api.get(`/thesis/list`).then(r => r.data);
export const thesisGet = (id) => api.get(`/thesis/${id}`).then(r => r.data);
export const thesisDelete = (id) => api.delete(`/thesis/${id}`).then(r => r.data);
export const thesisAssignFolder = (id, folder_id) =>
    api.put(`/thesis/${id}/folder`, { folder_id }).then(r => r.data);
export const thesisAssignParent = (id, parent_id) =>
    api.put(`/thesis/${id}/parent`, { parent_id }).then(r => r.data);
export const thesisRecordSplit = (id, body) =>
    api.post(`/thesis/${id}/split-developed`, body).then(r => r.data);
// Plan → Execute: mark a driver as "whole"/"split" (no LLM), then execute the whole plan.
export const thesisSetPlan = (id, core, plan) =>
    api.post(`/thesis/${id}/plan`, { core, plan }).then(r => r.data);
export const thesisGeneratePlan = (id) =>
    api.post(`/thesis/${id}/generate-plan`).then(r => r.data);
// Wait for a company plan execution to FULLY finish (every queued job done), not just
// the first one. Polls the company thesis every `intervalMs` and pushes each fresh doc
// to `onProgress`; resolves when `inflight_count` drops to 0. Falls back gracefully on
// transient errors and gives up after `timeoutMs`.
export const thesisWaitPlanDone = async (companyId, { intervalMs = 4000, timeoutMs = 1800000, onProgress } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, intervalMs));
        let doc;
        try { doc = await thesisGet(companyId); } catch { continue; }
        if (onProgress) onProgress(doc);
        if ((doc?.inflight_count ?? 0) === 0) return doc;
    }
    return null;
};
export const thesisMerge = (id, source, target) =>
    api.post(`/thesis/${id}/merge`, { source, target }).then(r => r.data);
export const thesisUnmerge = (id, source) =>
    api.post(`/thesis/${id}/unmerge`, { source }).then(r => r.data);
export const thesisMergeThesis = (id, source_thesis_id, target_thesis_id) =>
    api.post(`/thesis/${id}/merge-thesis`, { source_thesis_id, target_thesis_id }).then(r => r.data);
export const thesisUnmergeThesis = (id, source_thesis_id) =>
    api.post(`/thesis/${id}/unmerge-thesis`, { source_thesis_id }).then(r => r.data);
export const thesisFolders = () => api.get(`/thesis/folders`).then(r => r.data);
export const thesisCreateFolder = (name) => api.post(`/thesis/folders`, { name }).then(r => r.data);
export const thesisDeleteFolder = (id, mode = "ungroup") =>
    api.delete(`/thesis/folders/${id}`, { params: { mode } }).then(r => r.data);
export const thesisRestore = (payload) => api.post(`/thesis/restore`, payload).then(r => r.data);
export const thesisDashboard = () => api.get(`/thesis/dashboard`).then(r => r.data);
export const thesisCompanyQual = (ticker) =>
    api.get(`/thesis/company/${encodeURIComponent(ticker)}`).then(r => r.data);
export const thesisCompanyProfile = (ticker, fromCompany = null) =>
    api.get(`/thesis/company/${encodeURIComponent(ticker)}/profile`, {
        params: fromCompany ? { from_company: fromCompany } : undefined,
    }).then(r => r.data);

// Weekly trend radar (email)
export const thesisRadarStatus = () => api.get(`/thesis/radar/status`).then(r => r.data);
export const thesisRadarSubscribe = (payload) =>
    api.post(`/thesis/radar/subscribe`, payload).then(r => r.data);
export const thesisRadarSendNow = () =>
    api.post(`/thesis/radar/send-now`).then(r => r.data);

// Weekly thesis refresh (data + TAM). Manual run shares the same logic.
export const thesisRefreshRun = ({ thesis_id = null, ticker = null } = {}) =>
    api.post(`/thesis/refresh/run`, { thesis_id, ticker }).then(r => r.data);


// Visual page: aggregated rows for the BCG quadrant + opportunities table
export const thesisVisualData = () =>
    api.get(`/thesis/visual`).then(r => r.data);

// Visual time dial (evolution over time). Historical price reconstruction may
// fetch prices on first call → allow a longer timeout.
export const thesisVisualTimeline = () =>
    api.get(`/thesis/visual-timeline`, { timeout: 120000 }).then(r => r.data);

// Generic exports store (upload local artifact to object storage → shareable link).
export const exportUpload = (blob, name, kind = "timeline-clip") => {
    const fd = new FormData();
    const ext = (blob.type || "").split("/")[1] || "bin";
    fd.append("file", blob, `${name}.${ext}`);
    fd.append("name", name);
    fd.append("kind", kind);
    return api.post(`/exports/upload`, fd, { timeout: 180000, headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
};
export const exportPublicUrl = (token) => `${API}/exports/public/${token}`;

// Per-company watch alerts (Visual bell)
export const alertsGet = () => api.get(`/thesis/alerts`).then(r => r.data);
export const alertSave = (ticker, config) => api.put(`/thesis/alerts/${encodeURIComponent(ticker)}`, config).then(r => r.data);
export const alertDelete = (ticker) => api.delete(`/thesis/alerts/${encodeURIComponent(ticker)}`).then(r => r.data);

// In-app help assistant chat (Gemini Flash, keeps per-session memory backend-side)
export const helpChat = (session_id, message) =>
    api.post(`/help/chat`, { session_id, message }, { timeout: 60000 }).then(r => r.data);

// ---- KPI validation module ----
export const kpiCompanies = () =>
    api.get(`/thesis/kpi-companies`).then(r => r.data);
export const kpiGet = (companyId) =>
    api.get(`/thesis/${companyId}/kpis`).then(r => r.data);
export const kpiRun = (companyId, onStatus = null, mode = "full") =>
    api.post(`/thesis/${companyId}/kpis`, null, { params: { mode } }).then(r => startAndPoll(r.data, onStatus));
export const kpiEdit = (companyId, kpis) =>
    api.put(`/thesis/${companyId}/kpis`, { kpis }).then(r => r.data);
export const kpiSearch = (companyId, query, onStatus = null) =>
    api.post(`/thesis/${companyId}/kpis/search`, { query }).then(r => startAndPoll(r.data, onStatus));

// KPI source files (PDF / images / pasted transcript)
export const kpiFilesList = (companyId) =>
    api.get(`/thesis/${companyId}/kpis/files`).then(r => r.data);
export const kpiFileUpload = (companyId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post(`/thesis/${companyId}/kpis/files`, fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 180000 }).then(r => r.data);
};
export const kpiTranscriptAdd = (companyId, text, title) =>
    api.post(`/thesis/${companyId}/kpis/files/transcript`, { text, title }).then(r => r.data);
export const kpiFileToggle = (companyId, fileId, selected) =>
    api.patch(`/thesis/${companyId}/kpis/files/${fileId}`, { selected }).then(r => r.data);
export const kpiFileUpdate = (companyId, fileId, fields) =>
    api.patch(`/thesis/${companyId}/kpis/files/${fileId}`, fields).then(r => r.data);
export const kpiFileDelete = (companyId, fileId) =>
    api.delete(`/thesis/${companyId}/kpis/files/${fileId}`).then(r => r.data);
export const kpiFileRetry = (companyId, fileId) =>
    api.post(`/thesis/${companyId}/kpis/files/${fileId}/retry`).then(r => r.data);
export const kpiChat = (companyId, sessionId, message) =>
    api.post(`/thesis/${companyId}/kpis/chat`, { session_id: sessionId, message }, { timeout: 120000 }).then(r => r.data);
export const kpiChatSave = (companyId, sessionId, title) =>
    api.post(`/thesis/${companyId}/kpis/chat/save`, { session_id: sessionId, title }).then(r => r.data);
export const kpiChatProposeThesis = (companyId, sessionId, origin = "usuario") =>
    api.post(`/thesis/${companyId}/kpis/chat/propose-thesis`, { session_id: sessionId, origin }, { timeout: 90000 }).then(r => r.data);
export const kpiChatAddThesis = (companyId, payload) =>
    api.post(`/thesis/${companyId}/kpis/chat/add-thesis`, payload).then(r => r.data);
export const kpiChatLast = (companyId) =>
    api.get(`/thesis/${companyId}/kpis/chat/last`).then(r => r.data);
export const kpiChatReplace = (companyId, sessionId, messages) =>
    api.put(`/thesis/${companyId}/kpis/chat`, { session_id: sessionId, messages }).then(r => r.data);

export const macroIndicators = (refresh = false) =>
    api.get(`/macro/indicators`, { params: { refresh } }).then(r => r.data);
export const kpiFileDownload = (companyId, fileId) =>
    api.get(`/thesis/${companyId}/kpis/files/${fileId}/download`, { responseType: "blob", timeout: 180000 });

// Convert an uploaded KPI source document (original) to a chosen output format
// (pdf | docx | jpg). Returns the raw axios response (blob).
export const kpiFileExport = (companyId, fileId, fmt) =>
    api.get(`/thesis/${companyId}/kpis/files/${fileId}/export/${fmt}`, { responseType: "blob", timeout: 180000 });

// ---- Settings (integrations) ----
export const settingsGet = () => api.get(`/settings`).then(r => r.data);
export const settingsUpdate = (payload) => api.put(`/settings`, payload).then(r => r.data);
export const settingsTestWebhook = (target) => api.post(`/settings/test-webhook`, { target }).then(r => r.data);

// ---- Sharing ----
export const shareCreate = (payload) => api.post(`/share/create`, payload).then(r => r.data);
export const shareUpload = (blob, format, title) => {
    const fd = new FormData();
    fd.append("file", blob, `${title || "documento"}.${format}`);
    fd.append("format", format);
    fd.append("title", title || "documento");
    return api.post(`/share/upload`, fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 }).then(r => r.data);
};
export const shareWebhook = (target, title, url) => api.post(`/share/webhook`, { target, title, url }).then(r => r.data);
export const shareMeta = (token) => api.get(`/share/${token}`).then(r => r.data);
export const shareFileUrl = (token, dl = false) => `${API}/share/${token}/file${dl ? "?dl=1" : ""}`;

// Download the company KPI validation snapshot as PDF / Word (.docx). Returns the
// raw axios response (blob) so the caller can read Content-Disposition for the name.
export const kpiExport = (companyId, fmt) =>
    api.get(`/thesis/${companyId}/kpis/export/${fmt}`, { responseType: "blob", timeout: 120000 });

// KPI qualitative news (inform scores; aged out over time)
export const kpiNewsList = (companyId) =>
    api.get(`/thesis/${companyId}/kpis/news`).then(r => r.data);
export const kpiNewsSearch = (companyId, query = null, onStatus = null) =>
    api.post(`/thesis/${companyId}/kpis/news`, { query }).then(r => startAndPoll(r.data, onStatus));
export const kpiNewsDelete = (companyId, newsId) =>
    api.delete(`/thesis/${companyId}/kpis/news/${newsId}`).then(r => r.data);
export const kpiIrSourcesGet = (companyId) =>
    api.get(`/thesis/${companyId}/kpis/ir-sources`).then(r => r.data);
export const kpiIrSourcesSet = (companyId, urls) =>
    api.put(`/thesis/${companyId}/kpis/ir-sources`, { urls }).then(r => r.data);
export const kpiIrRefresh = (companyId, onStatus = null) =>
    api.post(`/thesis/${companyId}/kpis/ir-refresh`).then(r => startAndPoll(r.data, onStatus));

// ---------------- Feedback / Suggestions ----------------
export const feedbackCreateThread = (type, message, metadata, screenshotBlob = null) => {
    const fd = new FormData();
    fd.append("type", type);
    fd.append("message", message);
    fd.append("metadata", JSON.stringify(metadata || {}));
    if (screenshotBlob) fd.append("screenshot", screenshotBlob, "captura.jpg");
    return api.post(`/feedback/threads`, fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 }).then(r => r.data);
};
export const feedbackMyThreads = () => api.get(`/feedback/threads`).then(r => r.data);
export const feedbackGetThread = (id) => api.get(`/feedback/threads/${id}`).then(r => r.data);
export const feedbackReply = (id, text) => api.post(`/feedback/threads/${id}/messages`, { text }).then(r => r.data);
export const feedbackScreenshot = (id) =>
    api.get(`/feedback/threads/${id}/screenshot`, { responseType: "blob" }).then(r => r.data);
export const feedbackUnread = () => api.get(`/feedback/unread`).then(r => r.data);
export const feedbackAdminThreads = ({ status = null, type = null, q = null } = {}) =>
    api.get(`/feedback/admin/threads`, { params: { status, type, q } }).then(r => r.data);
export const feedbackAdminUpdateStatus = (id, status) =>
    api.patch(`/feedback/admin/threads/${id}`, { status }).then(r => r.data);
export const feedbackSurveys = () => api.get(`/feedback/surveys`).then(r => r.data);
export const feedbackCreateSurvey = (question, options) =>
    api.post(`/feedback/surveys`, { question, options }).then(r => r.data);
export const feedbackVote = (id, option_index) =>
    api.post(`/feedback/surveys/${id}/vote`, { option_index }).then(r => r.data);
export const feedbackToggleSurvey = (id, active) =>
    api.patch(`/feedback/surveys/${id}`, { active }).then(r => r.data);

// ---------------- Community (Fase 1: general + groups + DMs) ----------------
export const communityTopics = (scope = "general", groupId = null, sort = "recent") =>
    api.get(`/community/topics`, { params: { scope, group_id: groupId, sort } }).then(r => r.data);
export const communityCreateTopic = (payload) => api.post(`/community/topics`, payload).then(r => r.data);
export const communityGetTopic = (id) => api.get(`/community/topics/${id}`).then(r => r.data);
export const communityReply = (id, body) => api.post(`/community/topics/${id}/replies`, { body }).then(r => r.data);
export const communityLikeTopic = (id) => api.post(`/community/topics/${id}/like`).then(r => r.data);
export const communityLikeReply = (id) => api.post(`/community/replies/${id}/like`).then(r => r.data);
export const communityDeleteTopic = (id) => api.delete(`/community/topics/${id}`).then(r => r.data);
export const communityDeleteReply = (id) => api.delete(`/community/replies/${id}`).then(r => r.data);
export const communityGroups = () => api.get(`/community/groups`).then(r => r.data);
export const communityCreateGroup = (payload) => api.post(`/community/groups`, payload).then(r => r.data);
export const communityGetGroup = (id) => api.get(`/community/groups/${id}`).then(r => r.data);
export const communityJoinGroup = (id) => api.post(`/community/groups/${id}/join`).then(r => r.data);
export const communityLeaveGroup = (id) => api.post(`/community/groups/${id}/leave`).then(r => r.data);
export const communitySearchUsers = (q) => api.get(`/community/users/search`, { params: { q } }).then(r => r.data);
export const communityDms = () => api.get(`/community/dms`).then(r => r.data);
export const communityStartDm = (userId) => api.post(`/community/dms`, { user_id: userId }).then(r => r.data);
export const communityGetDm = (id) => api.get(`/community/dms/${id}`).then(r => r.data);
export const communitySendDm = (id, text) => api.post(`/community/dms/${id}/messages`, { text }).then(r => r.data);
export const communityUnread = () => api.get(`/community/unread`).then(r => r.data);
export const communityNotifications = () => api.get(`/community/notifications`).then(r => r.data);
export const communityMarkNotifsRead = () => api.post(`/community/notifications/read`).then(r => r.data);
export const communityIdeasSignal = () => api.get(`/community/ideas/signal`).then(r => r.data);
export const thesisTickerMetrics = (ticker) => api.get(`/thesis/ticker-metrics/${ticker}`).then(r => r.data);
export const communitySearch = (q) => api.get(`/community/search`, { params: { q } }).then(r => r.data);
export const communityReport = (target_type, target_id, reason = null) =>
    api.post(`/community/report`, { target_type, target_id, reason }).then(r => r.data);
export const communityAdminModeration = (status = "open") =>
    api.get(`/community/admin/moderation`, { params: { status } }).then(r => r.data);
export const communityResolveModeration = (id, action) =>
    api.post(`/community/admin/moderation/${id}`, { action }).then(r => r.data);
