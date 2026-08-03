"""Sharing: create public (tokenised, 15-day) links to a generated document and
serve them via a login-free viewer. Also per-user integration settings (Discord /
Slack incoming webhooks) used to post a title + link to the user's own channel.

Full paths (this router is mounted under the /api prefix):
  GET/PUT  /api/settings
  POST     /api/settings/test-webhook
  POST     /api/share/create           (server-generated docs: thesis / kpi_snapshot / kpi_file)
  POST     /api/share/upload           (client-generated blobs: chart JPG / page PDF)
  POST     /api/share/webhook          (post title + link to the user's Discord/Slack)
  GET      /api/share/{token}          (public metadata)
  GET      /api/share/{token}/file     (public bytes; ?dl=1 forces download)
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from urllib.parse import urlparse, quote

import httpx
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Response, Query
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

from storage import put_object, get_object, APP_NAME
import services.doc_export as dx

logger = logging.getLogger(__name__)

SHARE_TTL_DAYS = 15
FMT_MEDIA = {
    "pdf": ("application/pdf", "pdf"),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"),
    "jpg": ("image/jpeg", "jpg"),
}
WEBHOOK_HOSTS = {
    "discord": {"discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"},
    "slack": {"hooks.slack.com"},
}


def _mask(url: str) -> str:
    if not url:
        return ""
    tail = url[-6:]
    return f"…{tail}"


def _validate_webhook(target: str, url: str):
    if target not in WEBHOOK_HOSTS:
        raise HTTPException(400, "Destino no soportado")
    p = urlparse(url or "")
    if p.scheme != "https" or not p.hostname:
        raise HTTPException(422, "El webhook debe ser una URL https válida")
    if p.hostname not in WEBHOOK_HOSTS[target]:
        raise HTTPException(422, f"La URL no corresponde a {target}")


async def _post_webhook(target: str, url: str, title: str, link: str):
    _validate_webhook(target, url)
    if target == "discord":
        endpoint = url + ("&" if "?" in url else "?") + "wait=false"
        payload = {"content": f"**{title}**\n{link}", "allowed_mentions": {"parse": []}}
    else:
        endpoint = url
        payload = {"text": f"*{title}*\n<{link}|Abrir documento>"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            r = await client.post(endpoint, json=payload, headers={"Content-Type": "application/json"})
    except httpx.TimeoutException:
        raise HTTPException(504, "El servicio tardó demasiado en responder")
    except httpx.RequestError:
        raise HTTPException(502, "No se pudo conectar con el servicio")
    if target == "discord":
        if r.status_code in (200, 204):
            return
        if r.status_code in (401, 403, 404):
            raise HTTPException(400, "El webhook de Discord no es válido o ha caducado. Revísalo en Ajustes.")
        if r.status_code == 429:
            raise HTTPException(429, "Discord está limitando peticiones; inténtalo en un momento.")
        raise HTTPException(502, f"Discord rechazó el mensaje ({r.status_code})")
    else:
        if r.status_code == 200 and r.text.strip() == "ok":
            return
        if r.status_code == 429:
            raise HTTPException(429, "Slack está limitando peticiones; inténtalo en un momento.")
        if r.status_code in (400, 403, 404):
            raise HTTPException(400, "El webhook de Slack no es válido o ha caducado. Revísalo en Ajustes.")
        raise HTTPException(502, f"Slack rechazó el mensaje ({r.status_code})")


class SettingsUpdate(BaseModel):
    discord_webhook: Optional[str] = None
    slack_webhook: Optional[str] = None


class TestWebhook(BaseModel):
    target: str


class ShareCreate(BaseModel):
    kind: str                    # thesis | kpi_snapshot | kpi_file
    fmt: str                     # pdf | docx | jpg
    id: Optional[str] = None            # thesis id
    company_id: Optional[str] = None    # for kpi_snapshot / kpi_file
    file_id: Optional[str] = None       # for kpi_file
    title: Optional[str] = None


class WebhookShare(BaseModel):
    target: str
    title: str
    url: str


def make_router(db: AsyncIOMotorDatabase, auth_required, auth_optional) -> APIRouter:
    router = APIRouter()

    # ---------- Settings ----------
    def _settings_public(s):
        s = s or {}
        d = s.get("discord_webhook") or ""
        k = s.get("slack_webhook") or ""
        return {
            "discord_webhook_set": bool(d), "discord_webhook_masked": _mask(d),
            "slack_webhook_set": bool(k), "slack_webhook_masked": _mask(k),
        }

    @router.get("/settings")
    async def get_settings(user: Dict[str, Any] = Depends(auth_required)):
        s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
        return _settings_public(s)

    @router.put("/settings")
    async def put_settings(req: SettingsUpdate, user: Dict[str, Any] = Depends(auth_required)):
        upd = {}
        if req.discord_webhook is not None:
            v = req.discord_webhook.strip()
            if v:
                _validate_webhook("discord", v)
            upd["discord_webhook"] = v
        if req.slack_webhook is not None:
            v = req.slack_webhook.strip()
            if v:
                _validate_webhook("slack", v)
            upd["slack_webhook"] = v
        if upd:
            upd["updated_at"] = datetime.now(timezone.utc).isoformat()
            await db.user_settings.update_one(
                {"user_id": user["user_id"]}, {"$set": upd}, upsert=True)
        s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
        return _settings_public(s)

    @router.post("/settings/test-webhook")
    async def test_webhook(req: TestWebhook, user: Dict[str, Any] = Depends(auth_required)):
        s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
        url = (s or {}).get(f"{req.target}_webhook")
        if not url:
            raise HTTPException(400, "No hay webhook configurado para ese destino")
        await _post_webhook(req.target, url, "Prueba de Valuation Studio",
                            "https://valuation-studio.preview.emergentagent.com")
        return {"ok": True}

    # ---------- Share creation ----------
    async def _gen_thesis(user_id, tid, fmt):
        doc = await db.theses.find_one({"id": tid, "user_id": user_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Tesis no encontrada")
        title = doc.get("title") or (doc.get("company") or {}).get("name") or "tesis"
        data = dx.thesis_pdf(doc) if fmt == "pdf" else dx.thesis_docx(doc)
        return data, title

    async def _gen_kpi_snapshot(user_id, company_id, fmt):
        doc = await db.theses.find_one(
            {"id": company_id, "user_id": user_id, "type": "company"},
            {"_id": 0, "company": 1, "kpi_snapshot": 1})
        if not doc or not (doc.get("kpi_snapshot") or {}).get("kpis"):
            raise HTTPException(404, "No hay KPIs para compartir")
        snap = doc["kpi_snapshot"]
        name = (doc.get("company") or {}).get("name") or (doc.get("company") or {}).get("ticker") or "empresa"
        data = dx.kpi_snapshot_pdf(name, snap) if fmt == "pdf" else dx.kpi_snapshot_docx(name, snap)
        return data, f"KPIs {name}"

    async def _gen_kpi_file(user_id, company_id, file_id, fmt):
        rec = await db.kpi_files.find_one(
            {"id": file_id, "company_id": company_id, "user_id": user_id, "is_deleted": False}, {"_id": 0})
        if not rec:
            raise HTTPException(404, "Documento no encontrado")
        ctype = rec.get("content_type") or ""
        title = rec.get("display_name") or rec.get("original_filename") or "documento"
        is_image = ctype.startswith("image/")
        is_pdf = "pdf" in ctype
        if fmt == "jpg" and not (is_image and rec.get("storage_path")):
            raise HTTPException(400, "JPG solo disponible para documentos de imagen")
        if rec.get("storage_path") and (is_image or is_pdf):
            import asyncio
            raw, _ = await asyncio.to_thread(get_object, rec["storage_path"])
            if is_image:
                data = {"jpg": dx.image_to_jpg, "pdf": dx.image_to_pdf}.get(fmt, lambda d: dx.image_to_docx(d, title))(raw)
            else:
                data = raw if fmt == "pdf" else dx.pdf_to_docx(raw, title)
        else:
            text = rec.get("extracted_text") or ""
            if not text:
                raise HTTPException(404, "Sin contenido descargable")
            data = dx.text_to_pdf(title, text) if fmt == "pdf" else dx.text_to_docx(title, text)
        return data, title

    async def _store_share(user_id, data: bytes, fmt: str, title: str):
        if fmt not in FMT_MEDIA:
            raise HTTPException(400, "Formato no soportado")
        media, ext = FMT_MEDIA[fmt]
        token = uuid.uuid4().hex
        path = f"{APP_NAME}/shared/{token}.{ext}"
        import asyncio
        await asyncio.to_thread(put_object, path, data, media)
        now = datetime.now(timezone.utc)
        rec = {
            "id": token, "user_id": user_id, "title": title, "format": fmt,
            "content_type": media, "ext": ext, "storage_path": path,
            "filename": dx.safe_filename(title, ext),
            "created_at": now.isoformat(),
            "expires_at": (now + timedelta(days=SHARE_TTL_DAYS)).isoformat(),
        }
        await db.shared_docs.insert_one(rec)
        return {"token": token, "expires_at": rec["expires_at"], "format": fmt}

    @router.post("/share/create")
    async def share_create(req: ShareCreate, user: Dict[str, Any] = Depends(auth_required)):
        import asyncio
        uid = user["user_id"]
        if req.kind == "thesis":
            if not req.id:
                raise HTTPException(400, "Falta id de tesis")
            data, title = await _gen_thesis(uid, req.id, req.fmt)
        elif req.kind == "kpi_snapshot":
            if not req.company_id:
                raise HTTPException(400, "Falta company_id")
            data, title = await _gen_kpi_snapshot(uid, req.company_id, req.fmt)
        elif req.kind == "kpi_file":
            if not (req.company_id and req.file_id):
                raise HTTPException(400, "Faltan identificadores del documento")
            data, title = await _gen_kpi_file(uid, req.company_id, req.file_id, req.fmt)
        else:
            raise HTTPException(400, "Tipo no soportado")
        return await _store_share(uid, data, req.fmt, req.title or title)

    @router.post("/share/upload")
    async def share_upload(file: UploadFile = File(...), format: str = Form(...),
                           title: str = Form("documento"), user: Dict[str, Any] = Depends(auth_required)):
        if format not in FMT_MEDIA:
            raise HTTPException(400, "Formato no soportado")
        data = await file.read()
        if len(data) > 50 * 1024 * 1024:
            raise HTTPException(400, "El archivo supera 50 MB")
        return await _store_share(user["user_id"], data, format, title)

    @router.post("/share/webhook")
    async def share_webhook(req: WebhookShare, user: Dict[str, Any] = Depends(auth_required)):
        s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
        url = (s or {}).get(f"{req.target}_webhook")
        if not url:
            raise HTTPException(400, "no_webhook")
        await _post_webhook(req.target, url, req.title[:280], req.url)
        return {"ok": True}

    # ---------- Public viewer (no auth) ----------
    async def _get_share(token):
        rec = await db.shared_docs.find_one({"id": token}, {"_id": 0})
        if not rec:
            raise HTTPException(404, "Enlace no encontrado")
        expired = False
        try:
            expired = datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc)
        except Exception:
            pass
        return rec, expired

    @router.get("/share/{token}")
    async def share_meta(token: str):
        rec, expired = await _get_share(token)
        return {
            "title": rec.get("title"), "format": rec.get("format"),
            "content_type": rec.get("content_type"), "filename": rec.get("filename"),
            "expires_at": rec.get("expires_at"), "expired": expired,
        }

    @router.get("/share/{token}/file")
    async def share_file(token: str, dl: int = Query(0)):
        rec, expired = await _get_share(token)
        if expired:
            raise HTTPException(410, "Este enlace ha caducado")
        import asyncio
        data, _ = await asyncio.to_thread(get_object, rec["storage_path"])
        disp = "attachment" if dl else "inline"
        fname = rec.get("filename") or f"documento.{rec.get('ext', 'pdf')}"
        return Response(content=data, media_type=rec.get("content_type"),
                        headers={"Content-Disposition": f"{disp}; filename*=UTF-8''{quote(fname)}"})

    return router
