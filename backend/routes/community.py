"""Comunidad · Fase 1: canal general + grupos (públicos/privados) + mensajes privados 1:1,
con filtro de moderación por IA (Emergent LLM Key) y límite de frecuencia. Montado en /api.

Moderación: bloquea insultos/odio/spam/publicidad engañosa/estafas al publicar (fail-open si la IA falla).
Anti-manipulación de mercado y buscador avanzado → Fase 3.
"""
import os
import uuid
import json
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

ADMIN_EMAIL = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
RATE_MAX = 6          # máx. publicaciones
RATE_WINDOW = 60      # por ventana de segundos

MODERATION_SYS = (
    "Eres un moderador de una comunidad de inversión en español. Clasifica el mensaje del usuario. "
    "Devuelve SOLO un JSON válido con esta forma exacta: "
    '{"allow": true|false, "category": "insulto|odio|spam|publicidad_enganosa|estafa|ok", "reason": "motivo breve en español"}. '
    "allow=false SOLO si hay insultos/ataques personales, lenguaje de odio, spam, publicidad engañosa o estafas. "
    "allow=true en cualquier caso normal, INCLUIDAS opiniones de inversión legítimas, críticas educadas y desacuerdos. "
    "No bloquees por opinar que una acción subirá o bajará; eso es legítimo."
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_json(s: str) -> str:
    s = (s or "").strip()
    if s.startswith("```"):
        s = s.split("```")[1] if "```" in s[3:] else s.strip("`")
        s = s.replace("json", "", 1).strip() if s.lstrip().lower().startswith("json") else s
    return s.strip()


class TopicCreate(BaseModel):
    scope: str = "general"          # general | group
    group_id: Optional[str] = None
    title: str
    body: str = ""


class ReplyCreate(BaseModel):
    body: str


class GroupCreate(BaseModel):
    name: str
    description: str = ""
    visibility: str = "public"      # public | private


class MemberReq(BaseModel):
    user_id: str


class DmStart(BaseModel):
    user_id: str


class DmMessage(BaseModel):
    text: str


def make_router(db: AsyncIOMotorDatabase, auth_required) -> APIRouter:
    router = APIRouter(prefix="/community")

    def is_admin(user) -> bool:
        return bool(ADMIN_EMAIL) and (user.get("email") or "").strip().lower() == ADMIN_EMAIL

    # ---------------- Moderation + rate limit ----------------
    async def moderate(text: str):
        text = (text or "").strip()
        if not text:
            return True, None
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            chat = LlmChat(
                api_key=os.environ["EMERGENT_LLM_KEY"],
                session_id=f"mod-{uuid.uuid4().hex[:8]}",
                system_message=MODERATION_SYS,
            ).with_model("openai", "gpt-4.1-mini")
            resp = await asyncio.wait_for(chat.send_message(UserMessage(text=text[:2000])), timeout=12)
            data = json.loads(_strip_json(resp))
            if not data.get("allow", True):
                cat = data.get("category") or "no permitido"
                return False, data.get("reason") or f"Contenido bloqueado ({cat})."
            return True, None
        except Exception as e:
            logger.warning(f"moderation fail-open: {e}")
            return True, None  # fail-open: no bloquear si la IA no responde

    async def check_rate(uid: str):
        now = datetime.now(timezone.utc)
        doc = await db.community_ratelimit.find_one({"user_id": uid}, {"_id": 0})
        times = []
        for t in (doc or {}).get("times", []):
            try:
                if now - datetime.fromisoformat(t) < timedelta(seconds=RATE_WINDOW):
                    times.append(t)
            except Exception:
                pass
        if len(times) >= RATE_MAX:
            return False
        times.append(now.isoformat())
        await db.community_ratelimit.update_one({"user_id": uid}, {"$set": {"user_id": uid, "times": times}}, upsert=True)
        return True

    async def guard_post(uid: str, text: str):
        if not await check_rate(uid):
            raise HTTPException(429, "Vas demasiado rápido. Espera unos segundos antes de volver a publicar.")
        ok, reason = await moderate(text)
        if not ok:
            raise HTTPException(422, reason or "Contenido no permitido por las normas de la comunidad.")

    # ---------------- Serializers ----------------
    def topic_pub(t, uid):
        liked = t.get("liked_by") or []
        return {
            "id": t["id"], "scope": t.get("scope"), "group_id": t.get("group_id"),
            "title": t.get("title"), "body": t.get("body"),
            "author_id": t.get("author_id"), "author_name": t.get("author_name"),
            "created_at": t.get("created_at"), "last_activity_at": t.get("last_activity_at"),
            "reply_count": t.get("reply_count", 0),
            "like_count": len(liked), "liked_by_me": uid in liked,
            "can_delete": t.get("author_id") == uid,
        }

    def reply_pub(r, uid):
        liked = r.get("liked_by") or []
        return {
            "id": r["id"], "topic_id": r["topic_id"], "body": r.get("body"),
            "author_id": r.get("author_id"), "author_name": r.get("author_name"),
            "created_at": r.get("created_at"),
            "like_count": len(liked), "liked_by_me": uid in liked,
            "can_delete": r.get("author_id") == uid,
        }

    async def _group_or_404(gid):
        g = await db.community_groups.find_one({"id": gid}, {"_id": 0})
        if not g:
            raise HTTPException(404, "Grupo no encontrado")
        return g

    def _can_view_group(g, user):
        if g.get("visibility") == "public" or is_admin(user):
            return True
        return user["user_id"] in (g.get("members") or [])

    # ================= TOPICS (general + groups) =================
    @router.get("/topics")
    async def list_topics(scope: str = Query("general"), group_id: Optional[str] = Query(None),
                          sort: str = Query("recent"), user: Dict[str, Any] = Depends(auth_required)):
        q = {"scope": scope, "is_removed": {"$ne": True}}
        if scope == "group":
            if not group_id:
                raise HTTPException(400, "group_id requerido")
            g = await _group_or_404(group_id)
            if not _can_view_group(g, user):
                raise HTTPException(403, "Grupo privado: no eres miembro")
            q["group_id"] = group_id
        sort_field = "like_count" if sort == "popular" else "last_activity_at"
        cur = db.community_topics.find(q, {"_id": 0}).limit(200)
        items = [t async for t in cur]
        if sort == "popular":
            items.sort(key=lambda t: len(t.get("liked_by") or []), reverse=True)
        else:
            items.sort(key=lambda t: t.get("last_activity_at") or "", reverse=True)
        return {"topics": [topic_pub(t, user["user_id"]) for t in items]}

    @router.post("/topics")
    async def create_topic(req: TopicCreate, user: Dict[str, Any] = Depends(auth_required)):
        if req.scope not in ("general", "group"):
            raise HTTPException(400, "scope no válido")
        if not req.title.strip():
            raise HTTPException(400, "El título no puede estar vacío")
        if req.scope == "group":
            g = await _group_or_404(req.group_id)
            if not _can_view_group(g, user):
                raise HTTPException(403, "No puedes publicar en este grupo")
        await guard_post(user["user_id"], f"{req.title}\n{req.body}")
        tid = uuid.uuid4().hex
        now = _now()
        await db.community_topics.insert_one({
            "id": tid, "scope": req.scope, "group_id": req.group_id if req.scope == "group" else None,
            "title": req.title.strip()[:160], "body": req.body.strip()[:5000],
            "author_id": user["user_id"], "author_name": user.get("name") or user.get("email"),
            "created_at": now, "last_activity_at": now, "reply_count": 0, "liked_by": [], "is_removed": False,
        })
        return {"id": tid}

    @router.get("/topics/{tid}")
    async def get_topic(tid: str, user: Dict[str, Any] = Depends(auth_required)):
        t = await db.community_topics.find_one({"id": tid, "is_removed": {"$ne": True}}, {"_id": 0})
        if not t:
            raise HTTPException(404, "Tema no encontrado")
        if t.get("scope") == "group":
            g = await _group_or_404(t.get("group_id"))
            if not _can_view_group(g, user):
                raise HTTPException(403, "Grupo privado")
        replies = [reply_pub(r, user["user_id"]) async for r in
                   db.community_replies.find({"topic_id": tid, "is_removed": {"$ne": True}}, {"_id": 0}).sort("created_at", 1)]
        return {"topic": topic_pub(t, user["user_id"]), "replies": replies}

    @router.post("/topics/{tid}/replies")
    async def add_reply(tid: str, req: ReplyCreate, user: Dict[str, Any] = Depends(auth_required)):
        if not req.body.strip():
            raise HTTPException(400, "La respuesta no puede estar vacía")
        t = await db.community_topics.find_one({"id": tid, "is_removed": {"$ne": True}}, {"_id": 0})
        if not t:
            raise HTTPException(404, "Tema no encontrado")
        if t.get("scope") == "group":
            g = await _group_or_404(t.get("group_id"))
            if not _can_view_group(g, user):
                raise HTTPException(403, "No puedes responder en este grupo")
        await guard_post(user["user_id"], req.body)
        now = _now()
        await db.community_replies.insert_one({
            "id": uuid.uuid4().hex, "topic_id": tid, "body": req.body.strip()[:5000],
            "author_id": user["user_id"], "author_name": user.get("name") or user.get("email"),
            "created_at": now, "liked_by": [], "is_removed": False,
        })
        await db.community_topics.update_one({"id": tid}, {"$inc": {"reply_count": 1}, "$set": {"last_activity_at": now}})
        # Notify the topic author (except self-replies).
        if t.get("author_id") and t["author_id"] != user["user_id"]:
            await db.community_notifications.insert_one({
                "id": uuid.uuid4().hex, "user_id": t["author_id"], "type": "reply",
                "topic_id": tid, "actor": user.get("name") or "Alguien",
                "text": f"{user.get('name') or 'Alguien'} respondió a tu tema «{(t.get('title') or '')[:50]}»",
                "read": False, "created_at": now,
            })
        return {"ok": True}

    async def _toggle_like(coll, doc_id, uid):
        doc = await db[coll].find_one({"id": doc_id, "is_removed": {"$ne": True}}, {"_id": 0, "liked_by": 1})
        if not doc:
            raise HTTPException(404, "No encontrado")
        liked = doc.get("liked_by") or []
        if uid in liked:
            await db[coll].update_one({"id": doc_id}, {"$pull": {"liked_by": uid}})
            return {"liked": False, "like_count": len(liked) - 1}
        await db[coll].update_one({"id": doc_id}, {"$addToSet": {"liked_by": uid}})
        return {"liked": True, "like_count": len(liked) + 1}

    @router.post("/topics/{tid}/like")
    async def like_topic(tid: str, user: Dict[str, Any] = Depends(auth_required)):
        return await _toggle_like("community_topics", tid, user["user_id"])

    @router.post("/replies/{rid}/like")
    async def like_reply(rid: str, user: Dict[str, Any] = Depends(auth_required)):
        return await _toggle_like("community_replies", rid, user["user_id"])

    @router.delete("/topics/{tid}")
    async def del_topic(tid: str, user: Dict[str, Any] = Depends(auth_required)):
        t = await db.community_topics.find_one({"id": tid}, {"_id": 0, "author_id": 1})
        if not t:
            raise HTTPException(404, "No encontrado")
        if t["author_id"] != user["user_id"] and not is_admin(user):
            raise HTTPException(403, "No autorizado")
        await db.community_topics.update_one({"id": tid}, {"$set": {"is_removed": True}})
        return {"ok": True}

    @router.delete("/replies/{rid}")
    async def del_reply(rid: str, user: Dict[str, Any] = Depends(auth_required)):
        r = await db.community_replies.find_one({"id": rid}, {"_id": 0, "author_id": 1, "topic_id": 1})
        if not r:
            raise HTTPException(404, "No encontrado")
        if r["author_id"] != user["user_id"] and not is_admin(user):
            raise HTTPException(403, "No autorizado")
        await db.community_replies.update_one({"id": rid}, {"$set": {"is_removed": True}})
        await db.community_topics.update_one({"id": r["topic_id"]}, {"$inc": {"reply_count": -1}})
        return {"ok": True}

    # ================= GROUPS =================
    @router.get("/groups")
    async def list_groups(user: Dict[str, Any] = Depends(auth_required)):
        uid = user["user_id"]
        out = []
        async for g in db.community_groups.find({}, {"_id": 0}).sort("created_at", -1):
            members = g.get("members") or []
            if g.get("visibility") == "private" and not (uid in members or is_admin(user)):
                continue
            out.append({
                "id": g["id"], "name": g.get("name"), "description": g.get("description"),
                "visibility": g.get("visibility"), "member_count": len(members),
                "is_member": uid in members, "created_at": g.get("created_at"),
            })
        return {"groups": out}

    @router.post("/groups")
    async def create_group(req: GroupCreate, user: Dict[str, Any] = Depends(auth_required)):
        if not is_admin(user):
            raise HTTPException(403, "Solo el administrador puede crear grupos")
        if not req.name.strip():
            raise HTTPException(400, "El nombre no puede estar vacío")
        if req.visibility not in ("public", "private"):
            raise HTTPException(400, "visibility no válida")
        gid = uuid.uuid4().hex
        await db.community_groups.insert_one({
            "id": gid, "name": req.name.strip()[:80], "description": req.description.strip()[:500],
            "visibility": req.visibility, "created_by": user["user_id"],
            "members": [user["user_id"]], "created_at": _now(),
        })
        return {"id": gid}

    @router.get("/groups/{gid}")
    async def get_group(gid: str, user: Dict[str, Any] = Depends(auth_required)):
        g = await _group_or_404(gid)
        if not _can_view_group(g, user):
            raise HTTPException(403, "Grupo privado")
        members = g.get("members") or []
        return {"id": g["id"], "name": g.get("name"), "description": g.get("description"),
                "visibility": g.get("visibility"), "member_count": len(members),
                "is_member": user["user_id"] in members}

    @router.post("/groups/{gid}/join")
    async def join_group(gid: str, user: Dict[str, Any] = Depends(auth_required)):
        g = await _group_or_404(gid)
        if g.get("visibility") != "public" and not is_admin(user):
            raise HTTPException(403, "Este grupo es privado; solo por invitación")
        await db.community_groups.update_one({"id": gid}, {"$addToSet": {"members": user["user_id"]}})
        return {"ok": True}

    @router.post("/groups/{gid}/leave")
    async def leave_group(gid: str, user: Dict[str, Any] = Depends(auth_required)):
        await db.community_groups.update_one({"id": gid}, {"$pull": {"members": user["user_id"]}})
        return {"ok": True}

    @router.post("/groups/{gid}/members")
    async def add_member(gid: str, req: MemberReq, user: Dict[str, Any] = Depends(auth_required)):
        if not is_admin(user):
            raise HTTPException(403, "Solo el administrador puede invitar a grupos privados")
        await _group_or_404(gid)
        await db.community_groups.update_one({"id": gid}, {"$addToSet": {"members": req.user_id}})
        return {"ok": True}

    # ================= USERS (para iniciar DM) =================
    @router.get("/users/search")
    async def search_users(q: str = Query(..., min_length=1), user: Dict[str, Any] = Depends(auth_required)):
        rx = {"$regex": q.strip(), "$options": "i"}
        out = []
        async for u in db.users.find({"$or": [{"name": rx}, {"email": rx}]}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1}).limit(8):
            if u.get("user_id") == user["user_id"]:
                continue
            out.append({"user_id": u["user_id"], "name": u.get("name"), "email": u.get("email"), "picture": u.get("picture")})
        return {"users": out}

    # ================= DIRECT MESSAGES (1:1) =================
    def _pair(a, b):
        return sorted([a, b])

    @router.get("/dms")
    async def list_dms(user: Dict[str, Any] = Depends(auth_required)):
        uid = user["user_id"]
        out = []
        async for d in db.community_dm_threads.find({"participants": uid}, {"_id": 0}).sort("last_message_at", -1):
            other = next((p for p in d["participants"] if p != uid), uid)
            out.append({
                "id": d["id"], "other_id": other,
                "other_name": (d.get("names") or {}).get(other) or "Usuario",
                "last_text": d.get("last_text"), "last_message_at": d.get("last_message_at"),
                "unread": (d.get("unread") or {}).get(uid, 0),
            })
        return {"dms": out}

    @router.post("/dms")
    async def start_dm(req: DmStart, user: Dict[str, Any] = Depends(auth_required)):
        uid = user["user_id"]
        if req.user_id == uid:
            raise HTTPException(400, "No puedes enviarte mensajes a ti mismo")
        other = await db.users.find_one({"user_id": req.user_id}, {"_id": 0, "user_id": 1, "name": 1, "email": 1})
        if not other:
            raise HTTPException(404, "Usuario no encontrado")
        pair = _pair(uid, req.user_id)
        existing = await db.community_dm_threads.find_one({"participants": pair}, {"_id": 0})
        if existing:
            return {"id": existing["id"]}
        did = uuid.uuid4().hex
        await db.community_dm_threads.insert_one({
            "id": did, "participants": pair,
            "names": {uid: user.get("name") or user.get("email"), req.user_id: other.get("name") or other.get("email")},
            "last_text": None, "last_message_at": _now(), "unread": {uid: 0, req.user_id: 0},
        })
        return {"id": did}

    async def _dm_or_403(did, uid):
        d = await db.community_dm_threads.find_one({"id": did}, {"_id": 0})
        if not d:
            raise HTTPException(404, "Conversación no encontrada")
        if uid not in d["participants"]:
            raise HTTPException(403, "No autorizado")
        return d

    @router.get("/dms/{did}")
    async def get_dm(did: str, user: Dict[str, Any] = Depends(auth_required)):
        uid = user["user_id"]
        d = await _dm_or_403(did, uid)
        await db.community_dm_threads.update_one({"id": did}, {"$set": {f"unread.{uid}": 0}})
        msgs = [{"id": m["id"], "sender_id": m["sender_id"], "text": m["text"], "created_at": m["created_at"],
                 "mine": m["sender_id"] == uid}
                async for m in db.community_dm_messages.find({"dm_id": did}, {"_id": 0}).sort("created_at", 1)]
        other = next((p for p in d["participants"] if p != uid), uid)
        return {"id": did, "other_name": (d.get("names") or {}).get(other) or "Usuario", "messages": msgs}

    @router.post("/dms/{did}/messages")
    async def send_dm(did: str, req: DmMessage, user: Dict[str, Any] = Depends(auth_required)):
        if not req.text.strip():
            raise HTTPException(400, "El mensaje no puede estar vacío")
        uid = user["user_id"]
        d = await _dm_or_403(did, uid)
        await guard_post(uid, req.text)
        other = next((p for p in d["participants"] if p != uid), uid)
        now = _now()
        await db.community_dm_messages.insert_one({
            "id": uuid.uuid4().hex, "dm_id": did, "sender_id": uid, "text": req.text.strip()[:4000], "created_at": now,
        })
        await db.community_dm_threads.update_one(
            {"id": did},
            {"$set": {"last_text": req.text.strip()[:120], "last_message_at": now}, "$inc": {f"unread.{other}": 1}},
        )
        return {"ok": True}

    # ================= NOTIFICATIONS / UNREAD =================
    @router.get("/unread")
    async def unread(user: Dict[str, Any] = Depends(auth_required)):
        uid = user["user_id"]
        dm = 0
        async for d in db.community_dm_threads.find({"participants": uid}, {"_id": 0, "unread": 1}):
            dm += (d.get("unread") or {}).get(uid, 0)
        notif = await db.community_notifications.count_documents({"user_id": uid, "read": False})
        return {"dm": dm, "notifications": notif, "total": dm + notif}

    @router.get("/notifications")
    async def notifications(user: Dict[str, Any] = Depends(auth_required)):
        out = [{"id": n["id"], "type": n.get("type"), "text": n.get("text"),
                "topic_id": n.get("topic_id"), "read": n.get("read", False), "created_at": n.get("created_at")}
               async for n in db.community_notifications.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).limit(50)]
        return {"notifications": out}

    @router.post("/notifications/read")
    async def mark_read(user: Dict[str, Any] = Depends(auth_required)):
        await db.community_notifications.update_many({"user_id": user["user_id"], "read": False}, {"$set": {"read": True}})
        return {"ok": True}

    return router
