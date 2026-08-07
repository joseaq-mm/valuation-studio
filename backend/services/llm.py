"""Helper compartido para resúmenes/razonamiento por IA (Emergent LLM Key).

Uso: `data = await claude_json(system_message, user_text)` → devuelve dict parseado.
Lanza excepción si la IA no responde o el JSON no parsea (el llamante decide fail-open).
"""
import os
import json
import uuid
import asyncio
import logging

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-4-6"


def _strip_json(s: str) -> str:
    s = (s or "").strip()
    if s.startswith("```"):
        s = s.split("```")[1] if "```" in s[3:] else s.strip("`")
        s = s.replace("json", "", 1).strip() if s.lstrip().lower().startswith("json") else s
    # extrae el primer bloque {...} o [...] por robustez
    return s.strip()


async def claude_json(system_message: str, user_text: str, timeout: int = 60,
                      provider: str = "anthropic", model: str = DEFAULT_MODEL) -> dict:
    """Llama al modelo (Claude Sonnet 4.6 por defecto) y devuelve el JSON parseado."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(
        api_key=os.environ["EMERGENT_LLM_KEY"],
        session_id=f"sum-{uuid.uuid4().hex[:8]}",
        system_message=system_message,
    ).with_model(provider, model)
    resp = await asyncio.wait_for(chat.send_message(UserMessage(text=user_text[:24000])), timeout=timeout)
    return json.loads(_strip_json(resp))
