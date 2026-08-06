"""Suggestions / feedback: two-way threaded conversations between users and the admin,
plus admin broadcast surveys. Mounted under /api.

  POST   /api/feedback/threads                 create a thread (multipart: type, message, metadata, [screenshot])
  GET    /api/feedback/threads                 my threads
  GET    /api/feedback/threads/{id}            thread + messages (owner or admin)
  POST   /api/feedback/threads/{id}/messages   reply (owner or admin)
  GET    /api/feedback/threads/{id}/screenshot serve the screenshot (owner or admin)
  GET    /api/feedback/unread                  badge counts for current user (+admin)
  GET    /api/feedback/admin/threads           all threads (admin) — filter type/status, search q
  PATCH  /api/feedback/admin/threads/{id}       update status (admin)
  POST   /api/feedback/surveys                 create survey (admin)
  GET    /api/feedback/surveys                  active surveys for me (+results if admin)
  POST   /api/feedback/surveys/{id}/vote        vote (auth)
  PATCH  /api/feedback/surveys/{id}             close/open survey (admin)
"""
import os
import uuid
import json
import asyncio
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Response, Query
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

from storage import put_object, get_object, APP_NAME

ADMIN_EMAIL = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
TYPES = {"bug", "suggestion", "feature"}
STATUSES = {"new", "in_progress", "resolved"}


def _now():
    return datetime.now(timezone.utc).isoformat()


class Msg(BaseModel):
    text: str


class StatusUpdate(BaseModel):
    status: str


class SurveyCreate(BaseModel):
    question: str
    options: list


class Vote(BaseModel):
    option_index: int


class SurveyToggle(BaseModel):
    active: bool


def make_router(db: AsyncIOMotorDatabase, auth_required) -> APIRouter:
    router = APIRouter(prefix="/feedback")

    def is_admin(user) -> bool:
        return bool(ADMIN_EMAIL) and (user.get("email") or "").strip().lower() == ADMIN_EMAIL

    def thread_public(t, viewer_is_admin):
        return {
            "id": t["id"], "type": t.get("type"), "status": t.get("status"),
            "subject": t.get("subject"), "created_at": t.get("created_at"),
            "last_message_at": t.get("last_message_at"), "has_screenshot": bool(t.get("screenshot_path")),
            "unread_for_user": t.get("unread_for_user", 0),
            "unread_for_admin": t.get("unread_for_admin", 0) if viewer_is_admin else None,
            "user_email": t.get("user_email") if viewer_is_admin else None,
            "user_name": t.get("user_name") if viewer_is_admin else None,
            "metadata": t.get("metadata") if viewer_is_admin else None,
        }

    # ---------------- User threads ----------------
    @router.post("/threads")
    async def create_thread(type: str = Form(...), message: str = Form(...),
                            metadata: str = Form("{}"), screenshot: Optional[UploadFile] = File(None),
                            user: Dict[str, Any] = Depends(auth_required)):
        if type not in TYPES:
            raise HTTPException(400, "Tipo no válido")
        if not message.strip():
            raise HTTPException(400, "El mensaje no puede estar vacío")
        try:
            meta = json.loads(metadata or "{}")
        except Exception:
            meta = {}
        meta["user_status"] = "logueado"
        tid = uuid.uuid4().hex
        shot_path = None
        if screenshot is not None:
            data = await screenshot.read()
            if data:
                if len(data) > 15 * 1024 * 1024:
                    raise HTTPException(400, "La captura supera 15 MB")
                shot_path = f"{APP_NAME}/feedback/{tid}.jpg"
                await asyncio.to_thread(put_object, shot_path, data, screenshot.content_type or "image/jpeg")
        now = _now()
        subject = message.strip().split("\n")[0][:90]
        await db.feedback_threads.insert_one({
            "id": tid, "user_id": user["user_id"], "user_email": user.get("email"),
            "user_name": user.get("name"), "type": type, "status": "new",
            "scope": "feedback",
            "subject": subject, "screenshot_path": shot_path, "metadata": meta,
            "created_at": now, "last_message_at": now,
            "unread_for_admin": 1, "unread_for_user": 0,
        })
        await db.feedback_messages.insert_one({
            "id": uuid.uuid4().hex, "thread_id": tid, "sender": "user",
            "text": message.strip(), "created_at": now,
        })
        return {"id": tid}

    @router.get("/threads")
    async def my_threads(user: Dict[str, Any] = Depends(auth_required)):
        cur = db.feedback_threads.find({"user_id": user["user_id"], "scope": "feedback"}, {"_id": 0}).sort("last_message_at", -1)
        return {"threads": [thread_public(t, False) async for t in cur]}

    async def _load_thread(tid, user):
        t = await db.feedback_threads.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(404, "Hilo no encontrado")
        admin = is_admin(user)
        if not admin and t["user_id"] != user["user_id"]:
            raise HTTPException(403, "No autorizado")
        return t, admin

    @router.get("/threads/{tid}")
    async def get_thread(tid: str, user: Dict[str, Any] = Depends(auth_required)):
        t, admin = await _load_thread(tid, user)
        # Mark read for the viewer.
        field = "unread_for_admin" if admin else "unread_for_user"
        if t.get(field):
            await db.feedback_threads.update_one({"id": tid}, {"$set": {field: 0}})
            t[field] = 0
        msgs = [m async for m in db.feedback_messages.find({"thread_id": tid}, {"_id": 0}).sort("created_at", 1)]
        return {"thread": thread_public(t, admin), "messages": msgs}

    @router.post("/threads/{tid}/messages")
    async def add_message(tid: str, req: Msg, user: Dict[str, Any] = Depends(auth_required)):
        if not req.text.strip():
            raise HTTPException(400, "El mensaje no puede estar vacío")
        t, admin = await _load_thread(tid, user)
        now = _now()
        await db.feedback_messages.insert_one({
            "id": uuid.uuid4().hex, "thread_id": tid,
            "sender": "admin" if admin else "user", "text": req.text.strip(), "created_at": now,
        })
        inc = {"unread_for_user": 1} if admin else {"unread_for_admin": 1}
        upd = {"$set": {"last_message_at": now}, "$inc": inc}
        # A user's reply re-opens a resolved thread.
        if not admin and t.get("status") == "resolved":
            upd["$set"]["status"] = "in_progress"
        await db.feedback_threads.update_one({"id": tid}, upd)
        return {"ok": True}

    @router.get("/threads/{tid}/screenshot")
    async def get_screenshot(tid: str, user: Dict[str, Any] = Depends(auth_required)):
        t, _ = await _load_thread(tid, user)
        if not t.get("screenshot_path"):
            raise HTTPException(404, "Sin captura")
        data, _ct = await asyncio.to_thread(get_object, t["screenshot_path"])
        return Response(content=data, media_type="image/jpeg")

    @router.get("/unread")
    async def unread(user: Dict[str, Any] = Depends(auth_required)):
        admin = is_admin(user)
        my_unread = 0
        async for t in db.feedback_threads.find({"user_id": user["user_id"], "scope": "feedback"}, {"_id": 0, "unread_for_user": 1}):
            my_unread += t.get("unread_for_user", 0)
        # Active surveys the user hasn't voted yet.
        voted = set()
        async for v in db.survey_votes.find({"user_id": user["user_id"]}, {"_id": 0, "survey_id": 1}):
            voted.add(v["survey_id"])
        pending_surveys = 0
        async for s in db.surveys.find({"active": True}, {"_id": 0, "id": 1}):
            if s["id"] not in voted:
                pending_surveys += 1
        admin_unread = 0
        if admin:
            async for t in db.feedback_threads.find({"unread_for_admin": {"$gt": 0}, "scope": "feedback"}, {"_id": 0, "id": 1}):
                admin_unread += 1
        return {"user_total": my_unread + pending_surveys, "user_threads": my_unread,
                "pending_surveys": pending_surveys, "is_admin": admin, "admin_threads": admin_unread}

    # ---------------- Admin ----------------
    @router.get("/admin/threads")
    async def admin_threads(status: Optional[str] = Query(None), type: Optional[str] = Query(None),
                            q: Optional[str] = Query(None), user: Dict[str, Any] = Depends(auth_required)):
        if not is_admin(user):
            raise HTTPException(403, "Solo administrador")
        query = {"scope": "feedback"}
        if status in STATUSES:
            query["status"] = status
        if type in TYPES:
            query["type"] = type
        if q and q.strip():
            rx = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [{"subject": rx}, {"user_email": rx}, {"user_name": rx}]
        cur = db.feedback_threads.find(query, {"_id": 0}).sort("last_message_at", -1).limit(300)
        return {"threads": [thread_public(t, True) async for t in cur]}

    @router.patch("/admin/threads/{tid}")
    async def admin_update(tid: str, req: StatusUpdate, user: Dict[str, Any] = Depends(auth_required)):
        if not is_admin(user):
            raise HTTPException(403, "Solo administrador")
        if req.status not in STATUSES:
            raise HTTPException(400, "Estado no válido")
        r = await db.feedback_threads.update_one({"id": tid}, {"$set": {"status": req.status}})
        if not r.matched_count:
            raise HTTPException(404, "Hilo no encontrado")
        return {"ok": True}

    # ---------------- Surveys ----------------
    @router.post("/surveys")
    async def create_survey(req: SurveyCreate, user: Dict[str, Any] = Depends(auth_required)):
        if not is_admin(user):
            raise HTTPException(403, "Solo administrador")
        opts = [o.strip() for o in req.options if o and o.strip()]
        if not req.question.strip() or len(opts) < 2:
            raise HTTPException(400, "La encuesta necesita pregunta y al menos 2 opciones")
        sid = uuid.uuid4().hex
        await db.surveys.insert_one({
            "id": sid, "question": req.question.strip(), "options": opts,
            "active": True, "created_at": _now(), "created_by": user["user_id"],
        })
        return {"id": sid}

    @router.get("/surveys")
    async def list_surveys(user: Dict[str, Any] = Depends(auth_required)):
        admin = is_admin(user)
        out = []
        cur = db.surveys.find({} if admin else {"active": True}, {"_id": 0}).sort("created_at", -1)
        async for s in cur:
            votes = [v async for v in db.survey_votes.find({"survey_id": s["id"]}, {"_id": 0})]
            mine = next((v["option_index"] for v in votes if v["user_id"] == user["user_id"]), None)
            item = {"id": s["id"], "question": s["question"], "options": s["options"],
                    "active": s.get("active", True), "created_at": s.get("created_at"),
                    "my_vote": mine, "total_votes": len(votes)}
            if admin or mine is not None or not s.get("active", True):
                counts = [0] * len(s["options"])
                for v in votes:
                    if 0 <= v["option_index"] < len(counts):
                        counts[v["option_index"]] += 1
                item["results"] = counts
            out.append(item)
        return {"surveys": out}

    @router.post("/surveys/{sid}/vote")
    async def vote(sid: str, req: Vote, user: Dict[str, Any] = Depends(auth_required)):
        s = await db.surveys.find_one({"id": sid}, {"_id": 0})
        if not s or not s.get("active", True):
            raise HTTPException(404, "Encuesta no disponible")
        if not (0 <= req.option_index < len(s["options"])):
            raise HTTPException(400, "Opción no válida")
        await db.survey_votes.update_one(
            {"survey_id": sid, "user_id": user["user_id"]},
            {"$set": {"survey_id": sid, "user_id": user["user_id"],
                      "option_index": req.option_index, "created_at": _now()}},
            upsert=True)
        return {"ok": True}

    @router.patch("/surveys/{sid}")
    async def toggle_survey(sid: str, req: SurveyToggle, user: Dict[str, Any] = Depends(auth_required)):
        if not is_admin(user):
            raise HTTPException(403, "Solo administrador")
        r = await db.surveys.update_one({"id": sid}, {"$set": {"active": req.active}})
        if not r.matched_count:
            raise HTTPException(404, "Encuesta no encontrada")
        return {"ok": True}

    return router
