"""Generic exports store: upload a user-generated file (timeline clip now; theses/
trends PDFs later) to object storage and expose a public shareable link.

Local persistence lives in the browser (IndexedDB). This backend is only used
when the user chooses "subir a la nube / compartir por enlace".
"""
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Response

from storage import put_object, get_object, APP_NAME

logger = logging.getLogger(__name__)

_EXT_BY_MIME = {
    "video/webm": "webm", "video/mp4": "mp4", "image/gif": "gif",
    "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf",
}


def make_router(db, auth_required) -> APIRouter:
    router = APIRouter(prefix="/exports", tags=["exports"])

    @router.post("/upload")
    async def upload_export(
        file: UploadFile = File(...),
        name: str = Form("export"),
        kind: str = Form("timeline-clip"),
        user: Dict[str, Any] = Depends(auth_required),
    ):
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Archivo vacío")
        if len(data) > 60 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Archivo demasiado grande (máx 60 MB)")
        mime = file.content_type or "application/octet-stream"
        ext = _EXT_BY_MIME.get(mime, "bin")
        eid = uuid.uuid4().hex
        token = uuid.uuid4().hex
        storage_path = f"{APP_NAME}/exports/{user['user_id']}/{eid}.{ext}"
        try:
            await asyncio.to_thread(put_object, storage_path, data, mime)
        except Exception as e:
            logger.error(f"export upload failed: {e}")
            raise HTTPException(status_code=502, detail="No se pudo subir a la nube")
        doc = {
            "id": eid, "user_id": user["user_id"], "kind": kind,
            "name": name[:120] or "export", "content_type": mime,
            "storage_path": storage_path, "size": len(data),
            "public_token": token, "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.exports.insert_one(doc)
        return {"id": eid, "token": token, "url": f"/api/exports/public/{token}", "size": len(data)}

    @router.get("/public/{token}")
    async def public_export(token: str):
        rec = await db.exports.find_one({"public_token": token}, {"_id": 0})
        if not rec:
            raise HTTPException(status_code=404, detail="No encontrado")
        try:
            data, ctype = await asyncio.to_thread(get_object, rec["storage_path"])
        except Exception as e:
            logger.error(f"export fetch failed: {e}")
            raise HTTPException(status_code=502, detail="No se pudo obtener el archivo")
        return Response(
            content=data, media_type=rec.get("content_type") or ctype,
            headers={"Content-Disposition": f'inline; filename="{rec.get("name", "export")}"'},
        )

    return router
