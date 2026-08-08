"""Comunidad · Fase 1: canal general + grupos (públicos/privados) + mensajes privados 1:1,
con filtro de moderación por IA (Emergent LLM Key) y límite de frecuencia. Montado en /api.

Moderación: bloquea insultos/odio/spam/publicidad engañosa/estafas al publicar (fail-open si la IA falla).
Anti-manipulación de mercado y buscador avanzado → Fase 3.
"""
import os
import re
import uuid
import json
import hashlib
import logging
import asyncio
import unicodedata
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

from services.llm import claude_json

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


# Modelo de moderación más barato posible (clasificación simple).
MOD_MODEL = ("openai", "gpt-4.1-nano")

# Pre-filtro local (sin IA): decide si un texto es "obviamente limpio" y puede
# saltarse la IA. NUNCA bloquea por sí solo — bloquear lo decide siempre la IA.
_URL_RE = re.compile(r"https?://|www\.|t\.me/|@[a-z0-9_]{4,}", re.I)
# Palabras que, si aparecen, fuerzan la revisión por IA (posible insulto/spam/estafa).
_RISKY_WORDS = [
    "puta", "puto", "mierda", "gilipollas", "cabron", "cabrón", "idiota", "imbecil", "imbécil",
    "estupido", "estúpido", "subnormal", "retrasado", "maricon", "maricón", "zorra", "perra",
    "coño", "joder", "capullo", "pendejo", "estafa", "estafador", "timo", "gratis", "promo",
    "promocion", "promoción", "descuento", "regalo", "sorteo", "telegram", "whatsapp", "invierte ya",
    "gana dinero", "dinero facil", "dinero fácil", "señales de trading", "señales gratis", "vip",
    "fuck", "shit", "bitch", "scam", "free money", "click aqui", "click aquí", "haz clic",
]
# Lenguaje de hype/pump-and-dump que dispara la revisión anti-manipulación por IA.
_HYPE_RE = re.compile(
    r"(x\s?\d{1,3}\b|garantiz|asegurad|100\s?%|rentabilidad segura|no puede bajar|no puede subir|"
    r"pump|a la luna|to the moon|multiplic|chicharro|dinero f[aá]cil|forr[ae]|compra ya|vende ya|"
    r"antes de que sea tarde|oportunidad [uú]nica|se dispara|explota|va a explotar)",
    re.I,
)


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _hash(s: str) -> str:
    return hashlib.sha256(_norm(s).encode("utf-8")).hexdigest()


def _looks_clean(text: str) -> bool:
    """True si el texto es corto, sin enlaces y sin palabras de riesgo → se puede
    aprobar sin gastar IA. La inmensa mayoría de mensajes normales caen aquí."""
    t = text.strip()
    if len(t) > 240:
        return False
    if _URL_RE.search(t):
        return False
    n = _norm(t)
    return not any(w in n for w in _RISKY_WORDS)


class TopicCreate(BaseModel):
    scope: str = "general"          # general | group | idea
    group_id: Optional[str] = None
    title: str
    body: str = ""
    # Fase 2 · Ideas de inversión (solo scope="idea")
    ticker: Optional[str] = None
    stance: Optional[str] = None     # bull | bear | neutral
    target_price: Optional[float] = None
    metrics: Optional[Dict[str, Any]] = None


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
        """Devuelve (allow, reason). Ahorro de coste: aprueba localmente el texto
        obviamente limpio (sin IA), cachea por hash y solo escala a la IA los casos dudosos."""
        text = (text or "").strip()
        if not text:
            return True, None
        # 1) Fast-path local: texto corto, sin enlaces ni palabras de riesgo → aprobar sin IA.
        if _looks_clean(text):
            return True, None
        # 2) Caché por hash de contenido (evita re-llamar a la IA con el mismo texto).
        h = _hash(text)
        cached = await db.community_mod_cache.find_one({"h": h}, {"_id": 0, "allow": 1, "reason": 1})
        if cached is not None:
            return bool(cached.get("allow", True)), cached.get("reason")
        # 3) Escalar solo lo dudoso a la IA (modelo más barato).
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            chat = LlmChat(
                api_key=os.environ["EMERGENT_LLM_KEY"],
                session_id=f"mod-{uuid.uuid4().hex[:8]}",
                system_message=MODERATION_SYS,
            ).with_model(*MOD_MODEL)
            resp = await asyncio.wait_for(chat.send_message(UserMessage(text=text[:1200])), timeout=12)
            data = json.loads(_strip_json(resp))
            allow = bool(data.get("allow", True))
            reason = None if allow else (data.get("reason") or f"Contenido bloqueado ({data.get('category') or 'no permitido'}).")
            await db.community_mod_cache.update_one(
                {"h": h}, {"$set": {"h": h, "allow": allow, "reason": reason, "at": _now()}}, upsert=True)
            return allow, reason
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

    IDEA_ASSESS_SYS = (
        "Eres un supervisor de una comunidad de inversión en español. Evalúa si una IDEA de inversión "
        "muestra señales de MANIPULACIÓN o mala praxis (NO si es ofensiva). Señales: presión/urgencia para "
        "comprar o vender ya, promesas de rentabilidad garantizada o 'x2/x10 seguro', objetivos de precio "
        "sin fundamento, lenguaje de pump-and-dump. Una tesis argumentada y educada NO es sospechosa aunque sea muy alcista. "
        'Devuelve SOLO JSON: {"suspicious": true|false, "reason": "motivo breve en español"}.'
    )

    async def assess_idea(title, body, ticker, stance, target_price, metrics):
        """Anti-manipulación: NO bloquea; devuelve (suspicious, reason) para la cola del Admin.
        Ahorro de coste: la IA SOLO se invoca si hay un disparador local (el objetivo contradice
        fuertemente tus POC/POV, o hay lenguaje de hype/pump-and-dump). Sin disparador → sin IA."""
        reasons = []
        m = metrics or {}
        poc, pov = m.get("poc"), m.get("pov")
        try:
            tp = float(target_price) if target_price is not None else None
        except Exception:
            tp = None
        if tp is not None:
            if stance == "bull" and isinstance(pov, (int, float)) and pov > 0 and tp > pov * 1.4:
                reasons.append(f"Objetivo ({tp}) muy por encima de tu Precio Objetivo de Venta/POV ({pov}).")
            if stance == "bear" and isinstance(poc, (int, float)) and poc > 0 and tp < poc * 0.6:
                reasons.append(f"Objetivo ({tp}) muy por debajo de tu Precio Objetivo de Compra/POC ({poc}).")
        has_hype = bool(_HYPE_RE.search(f"{title or ''} {body or ''}"))
        # Sin señal local (ni divergencia ni hype) → no gastamos IA.
        if not reasons and not has_hype:
            return False, ""
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            chat = LlmChat(
                api_key=os.environ["EMERGENT_LLM_KEY"],
                session_id=f"idea-{uuid.uuid4().hex[:8]}",
                system_message=IDEA_ASSESS_SYS,
            ).with_model(*MOD_MODEL)
            payload = f"Ticker: {ticker} · Postura: {stance} · Objetivo: {target_price}\nTítulo: {title}\n{body}"
            resp = await asyncio.wait_for(chat.send_message(UserMessage(text=payload[:1200])), timeout=12)
            data = json.loads(_strip_json(resp))
            if data.get("suspicious"):
                reasons.append(data.get("reason") or "Posible lenguaje de manipulación.")
        except Exception as e:
            logger.warning(f"assess_idea fail-open: {e}")
        return (len(reasons) > 0), " ".join(reasons)

    # ---------------- Serializers ----------------
    def topic_pub(t, uid):
        liked = t.get("liked_by") or []
        out = {
            "id": t["id"], "scope": t.get("scope"), "group_id": t.get("group_id"),
            "title": t.get("title"), "body": t.get("body"),
            "author_id": t.get("author_id"), "author_name": t.get("author_name"),
            "created_at": t.get("created_at"), "last_activity_at": t.get("last_activity_at"),
            "reply_count": t.get("reply_count", 0),
            "like_count": len(liked), "liked_by_me": uid in liked,
            "can_delete": t.get("author_id") == uid,
        }
        if t.get("scope") == "idea":
            out.update({
                "ticker": t.get("ticker"), "stance": t.get("stance"),
                "target_price": t.get("target_price"), "metrics": t.get("metrics"),
            })
        return out

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
        q = {"scope": scope, "is_removed": {"$ne": True}, "hidden": {"$ne": True}}
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
        if req.scope not in ("general", "group", "idea"):
            raise HTTPException(400, "scope no válido")
        if not req.title.strip():
            raise HTTPException(400, "El título no puede estar vacío")
        if req.scope == "group":
            g = await _group_or_404(req.group_id)
            if not _can_view_group(g, user):
                raise HTTPException(403, "No puedes publicar en este grupo")
        if req.scope == "idea" and not (req.ticker or "").strip():
            raise HTTPException(400, "La idea debe llevar un ticker")
        await guard_post(user["user_id"], f"{req.title}\n{req.body}")
        tid = uuid.uuid4().hex
        now = _now()
        doc = {
            "id": tid, "scope": req.scope, "group_id": req.group_id if req.scope == "group" else None,
            "title": req.title.strip()[:160], "body": req.body.strip()[:5000],
            "author_id": user["user_id"], "author_name": user.get("name") or user.get("email"),
            "created_at": now, "last_activity_at": now, "reply_count": 0, "liked_by": [], "is_removed": False,
        }
        if req.scope == "idea":
            stance = req.stance if req.stance in ("bull", "bear", "neutral") else "neutral"
            doc.update({
                "ticker": (req.ticker or "").upper().strip()[:12],
                "stance": stance,
                "target_price": req.target_price,
                "metrics": req.metrics or {},
            })
        await db.community_topics.insert_one(doc)
        if req.scope == "idea":
            async def _flag_idea_bg():
                try:
                    suspicious, reason = await assess_idea(doc["title"], doc["body"], doc["ticker"], doc["stance"], doc.get("target_price"), doc.get("metrics"))
                    if suspicious:
                        await db.community_mod.insert_one({
                            "id": uuid.uuid4().hex, "kind": "ai", "source": "ai",
                            "target_type": "topic", "target_id": tid, "ticker": doc["ticker"],
                            "preview": doc["title"], "author_name": doc["author_name"],
                            "reporters": [], "reason": reason or "Posible manipulación de mercado.",
                            "status": "open", "created_at": now,
                        })
                except Exception as e:
                    logger.warning(f"idea anti-manip flag failed: {e}")
            asyncio.create_task(_flag_idea_bg())  # en segundo plano: no bloquea la respuesta
        return {"id": tid}

    @router.get("/topics/{tid}")
    async def get_topic(tid: str, user: Dict[str, Any] = Depends(auth_required)):
        t = await db.community_topics.find_one({"id": tid, "is_removed": {"$ne": True}, "hidden": {"$ne": True}}, {"_id": 0})
        if not t:
            raise HTTPException(404, "Tema no encontrado")
        if t.get("scope") == "group":
            g = await _group_or_404(t.get("group_id"))
            if not _can_view_group(g, user):
                raise HTTPException(403, "Grupo privado")
        replies = [reply_pub(r, user["user_id"]) async for r in
                   db.community_replies.find({"topic_id": tid, "is_removed": {"$ne": True}, "hidden": {"$ne": True}}, {"_id": 0}).sort("created_at", 1)]
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
        import re
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
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
        mod_open = 0
        if is_admin(user):
            mod_open = await db.community_mod.count_documents({"status": "open"})
        return {"dm": dm, "notifications": notif, "mod_open": mod_open, "total": dm + notif}

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

    # ================= SEARCH (Mongo text index) =================
    @router.get("/search")
    async def search(q: str = Query(..., min_length=2), user: Dict[str, Any] = Depends(auth_required)):
        uid = user["user_id"]
        base = {"$text": {"$search": q}, "is_removed": {"$ne": True}, "hidden": {"$ne": True}}
        # visible group ids for this user
        vis_groups = set()
        async for g in db.community_groups.find({}, {"_id": 0, "id": 1, "visibility": 1, "members": 1}):
            if g.get("visibility") == "public" or is_admin(user) or uid in (g.get("members") or []):
                vis_groups.add(g["id"])

        def _visible(t):
            return t.get("scope") != "group" or t.get("group_id") in vis_groups

        topics, ideas = [], []
        try:
            cur = db.community_topics.find(base, {"_id": 0, "score": {"$meta": "textScore"}}).sort([("score", {"$meta": "textScore"})]).limit(40)
            async for t in cur:
                if not _visible(t):
                    continue
                item = {"id": t["id"], "scope": t.get("scope"), "title": t.get("title"),
                        "snippet": (t.get("body") or "")[:140], "author_name": t.get("author_name"),
                        "ticker": t.get("ticker"), "created_at": t.get("created_at")}
                (ideas if t.get("scope") == "idea" else topics).append(item)
        except Exception as e:
            logger.warning(f"search topics failed: {e}")

        replies = []
        try:
            cur = db.community_replies.find({"$text": {"$search": q}, "is_removed": {"$ne": True}, "hidden": {"$ne": True}},
                                            {"_id": 0, "score": {"$meta": "textScore"}}).sort([("score", {"$meta": "textScore"})]).limit(30)
            async for r in cur:
                parent = await db.community_topics.find_one({"id": r["topic_id"], "is_removed": {"$ne": True}, "hidden": {"$ne": True}},
                                                            {"_id": 0, "id": 1, "title": 1, "scope": 1, "group_id": 1})
                if not parent or not _visible(parent):
                    continue
                replies.append({"id": r["id"], "topic_id": parent["id"], "topic_title": parent.get("title"),
                                "scope": parent.get("scope"), "snippet": (r.get("body") or "")[:140],
                                "author_name": r.get("author_name"), "created_at": r.get("created_at")})
        except Exception as e:
            logger.warning(f"search replies failed: {e}")

        return {"topics": topics[:20], "ideas": ideas[:20], "replies": replies[:20]}

    # ================= REPORTS =================
    class ReportReq(BaseModel):
        target_type: str            # topic | reply
        target_id: str
        reason: Optional[str] = None

    @router.post("/report")
    async def report(req: ReportReq, user: Dict[str, Any] = Depends(auth_required)):
        if req.target_type not in ("topic", "reply"):
            raise HTTPException(400, "target_type no válido")
        coll = "community_topics" if req.target_type == "topic" else "community_replies"
        target = await db[coll].find_one({"id": req.target_id, "is_removed": {"$ne": True}}, {"_id": 0})
        if not target:
            raise HTTPException(404, "Contenido no encontrado")
        uid = user["user_id"]
        existing = await db.community_mod.find_one({"kind": "report", "target_type": req.target_type, "target_id": req.target_id, "status": "open"}, {"_id": 0})
        if existing:
            if uid in (existing.get("reporters") or []):
                return {"ok": True, "already": True}
            await db.community_mod.update_one({"id": existing["id"]}, {"$addToSet": {"reporters": uid}})
            reporters = list(set((existing.get("reporters") or []) + [uid]))
        else:
            preview = target.get("title") or (target.get("body") or "")[:80]
            await db.community_mod.insert_one({
                "id": uuid.uuid4().hex, "kind": "report", "source": "user",
                "target_type": req.target_type, "target_id": req.target_id,
                "ticker": target.get("ticker"), "preview": preview, "author_name": target.get("author_name"),
                "reporters": [uid], "reason": (req.reason or "").strip()[:300] or "Reporte de la comunidad",
                "status": "open", "created_at": _now(),
            })
            reporters = [uid]
        # Auto-hide once 3 distinct users report it.
        if len(reporters) >= 3:
            await db[coll].update_one({"id": req.target_id}, {"$set": {"hidden": True}})
        return {"ok": True, "reports": len(reporters)}

    # ================= ADMIN MODERATION QUEUE =================
    @router.get("/admin/moderation")
    async def admin_moderation(status: str = Query("open"), user: Dict[str, Any] = Depends(auth_required)):
        if not is_admin(user):
            raise HTTPException(403, "Solo administrador")
        q = {} if status == "all" else {"status": status}
        out = []
        async for m in db.community_mod.find(q, {"_id": 0}).sort("created_at", -1).limit(100):
            coll = "community_topics" if m.get("target_type") == "topic" else "community_replies"
            tgt = await db[coll].find_one({"id": m.get("target_id")}, {"_id": 0})
            out.append({
                "id": m["id"], "kind": m.get("kind"), "source": m.get("source"),
                "target_type": m.get("target_type"), "target_id": m.get("target_id"),
                "ticker": m.get("ticker"), "preview": m.get("preview"), "author_name": m.get("author_name"),
                "reason": m.get("reason"), "reporters": len(m.get("reporters") or []),
                "status": m.get("status"), "created_at": m.get("created_at"),
                "content": (tgt or {}).get("title") or (tgt or {}).get("body"),
                "content_body": (tgt or {}).get("body"),
                "removed": bool((tgt or {}).get("is_removed")), "hidden": bool((tgt or {}).get("hidden")),
            })
        return {"items": out}

    class ModAction(BaseModel):
        action: str                 # approve | delete

    @router.post("/admin/moderation/{mid}")
    async def resolve_moderation(mid: str, req: ModAction, user: Dict[str, Any] = Depends(auth_required)):
        if not is_admin(user):
            raise HTTPException(403, "Solo administrador")
        m = await db.community_mod.find_one({"id": mid}, {"_id": 0})
        if not m:
            raise HTTPException(404, "No encontrado")
        coll = "community_topics" if m.get("target_type") == "topic" else "community_replies"
        if req.action == "delete":
            await db[coll].update_one({"id": m.get("target_id")}, {"$set": {"is_removed": True}})
            if m.get("target_type") == "reply":
                r = await db.community_replies.find_one({"id": m.get("target_id")}, {"_id": 0, "topic_id": 1})
                if r:
                    await db.community_topics.update_one({"id": r["topic_id"]}, {"$inc": {"reply_count": -1}})
        elif req.action == "approve":
            await db[coll].update_one({"id": m.get("target_id")}, {"$set": {"hidden": False}})
        else:
            raise HTTPException(400, "Acción no válida")
        await db.community_mod.update_one({"id": mid}, {"$set": {"status": "resolved", "resolved_at": _now()}})
        return {"ok": True}

    @router.get("/ideas/signal")
    async def ideas_signal(user: Dict[str, Any] = Depends(auth_required)):
        """Señal de comunidad: tickers más comentados en Ideas con el reparto de posturas."""
        agg: Dict[str, Dict[str, Any]] = {}
        async for t in db.community_topics.find(
            {"scope": "idea", "is_removed": {"$ne": True}},
            {"_id": 0, "ticker": 1, "stance": 1, "metrics": 1, "reply_count": 1, "liked_by": 1},
        ):
            tk = (t.get("ticker") or "").upper().strip()
            if not tk:
                continue
            a = agg.setdefault(tk, {"ticker": tk, "ideas": 0, "bull": 0, "bear": 0, "neutral": 0,
                                    "engagement": 0, "combined": None})
            a["ideas"] += 1
            st = t.get("stance") or "neutral"
            a[st if st in ("bull", "bear", "neutral") else "neutral"] += 1
            a["engagement"] += (t.get("reply_count") or 0) + len(t.get("liked_by") or [])
            m = t.get("metrics") or {}
            if a["combined"] is None and isinstance(m.get("combined"), (int, float)):
                a["combined"] = m.get("combined")
        rows = sorted(agg.values(), key=lambda x: (x["ideas"], x["engagement"]), reverse=True)
        return {"signal": rows[:12]}

    # ============ FASE 4 · SEÑAL DE INVERSIÓN IA (comunidad) ============
    async def _signal_agg() -> List[Dict[str, Any]]:
        """Agrega ideas por ticker con posturas, engagement y foto de valoración."""
        agg: Dict[str, Dict[str, Any]] = {}
        async for t in db.community_topics.find(
            {"scope": "idea", "is_removed": {"$ne": True}, "hidden": {"$ne": True}},
            {"_id": 0, "ticker": 1, "stance": 1, "metrics": 1, "reply_count": 1,
             "liked_by": 1, "title": 1, "target_price": 1},
        ):
            tk = (t.get("ticker") or "").upper().strip()
            if not tk:
                continue
            a = agg.setdefault(tk, {"ticker": tk, "ideas": 0, "bull": 0, "bear": 0, "neutral": 0,
                                    "engagement": 0, "metrics": None, "titles": [], "targets": []})
            a["ideas"] += 1
            st = t.get("stance") or "neutral"
            a[st if st in ("bull", "bear", "neutral") else "neutral"] += 1
            a["engagement"] += (t.get("reply_count") or 0) + len(t.get("liked_by") or [])
            if a["metrics"] is None and isinstance(t.get("metrics"), dict) and t["metrics"]:
                a["metrics"] = t["metrics"]
            if t.get("title"):
                a["titles"].append(t["title"][:120])
            if isinstance(t.get("target_price"), (int, float)):
                a["targets"].append(t["target_price"])
        return sorted(agg.values(), key=lambda x: (x["ideas"], x["engagement"]), reverse=True)

    SIGNAL_SYS = (
        "Eres un analista de inversión senior de Valuation Studio. Escribes en español de España, con rigor y sin "
        "recomendaciones de compra/venta directas (solo análisis). Para cada acción recibes: el consenso de la comunidad "
        "(nº de ideas alcistas/bajistas/neutrales y engagement) y la foto de valoración propia de la app: precio actual, "
        "POC (precio objetivo de compra), POV (precio objetivo de venta), Ratio Compra % y Ratio Venta % (positivos = "
        "infravalorada según ese objetivo), y si existe, métricas cualitativas (Score, TAM, Coef KPI, combinados %). "
        "Tu trabajo es CONTRASTAR el sentimiento de la comunidad con la valoración cuantitativa. Un veredicto 'mixed' es "
        "correcto cuando comunidad y valoración discrepan (p.ej. comunidad muy alcista pero POC/POV indican que ya está cara). "
        "Devuelve SOLO un JSON válido: "
        '{"items":[{"ticker":"XXX","verdict":"bull|bear|mixed","confidence":"alta|media|baja",'
        '"summary":"2-3 frases en español que contrastan comunidad vs valoración","alignment":"comunidad y valoración alineadas|en conflicto|neutral"}]}. '
        "Incluye SOLO los tickers recibidos. No inventes datos que no estén en el contexto."
    )

    def _fmt_metrics_for_ai(m: Optional[Dict[str, Any]]) -> str:
        if not isinstance(m, dict) or not m:
            return "sin foto de valoración"
        def g(k):
            v = m.get(k)
            return f"{v}" if isinstance(v, (int, float)) else "—"
        base = (f"precio={g('current_price')}, POC={g('poc')}, POV={g('pov')}, "
                f"RatioCompra%={g('ratio_compra_pct')}, RatioVenta%={g('ratio_venta_pct')}")
        if m.get("has_qual"):
            base += (f"; Score={g('score')}, TAM={g('tam_score')}, CoefKPI={g('kpi_coef')}, "
                     f"CombCual%={g('combined_qual')}, CombTotal%={g('combined')}")
        return base

    @router.get("/ideas/signal/ai")
    async def signal_ai(user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.community_ai.find_one({"id": "signal"}, {"_id": 0})
        return {"ai": doc}

    @router.post("/ideas/signal/generate")
    async def signal_generate(user: Dict[str, Any] = Depends(auth_required)):
        rows = (await _signal_agg())[:10]
        if not rows:
            raise HTTPException(400, "Aún no hay ideas para analizar")
        lines = []
        for r in rows:
            avg_target = round(sum(r["targets"]) / len(r["targets"]), 2) if r["targets"] else None
            lines.append(
                f"- {r['ticker']}: comunidad {r['bull']}▲/{r['bear']}▼/{r['neutral']}■ ({r['ideas']} ideas, "
                f"engagement {r['engagement']}). Objetivo medio comunidad: {avg_target if avg_target is not None else '—'}. "
                f"Valoración app: {_fmt_metrics_for_ai(r['metrics'])}."
            )
        prompt = "Analiza estas acciones y contrasta comunidad vs valoración:\n" + "\n".join(lines)
        try:
            data = await claude_json(SIGNAL_SYS, prompt, timeout=70)
            ai_items = {i.get("ticker", "").upper(): i for i in (data.get("items") or []) if i.get("ticker")}
        except Exception as e:
            logger.warning(f"signal_generate IA falló: {e}")
            raise HTTPException(502, "El análisis por IA no está disponible ahora mismo. Inténtalo de nuevo.")
        items = []
        for r in rows:
            ai = ai_items.get(r["ticker"], {})
            items.append({
                "ticker": r["ticker"], "ideas": r["ideas"], "bull": r["bull"], "bear": r["bear"],
                "neutral": r["neutral"], "engagement": r["engagement"], "metrics": r["metrics"],
                "verdict": ai.get("verdict") or "mixed", "confidence": ai.get("confidence") or "media",
                "summary": ai.get("summary") or "", "alignment": ai.get("alignment") or "neutral",
            })
        doc = {"id": "signal", "generated_at": _now(),
               "generated_by": user.get("name") or user.get("email"), "items": items}
        await db.community_ai.update_one({"id": "signal"}, {"$set": doc}, upsert=True)
        doc.pop("_id", None)
        return {"ai": doc}

    return router
