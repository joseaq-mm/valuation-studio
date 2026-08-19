"""Compatible LlmChat / UserMessage API backed by litellm (local/dev).

Priority for credentials:
  1. Provider-native env vars (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY / GOOGLE_API_KEY)
  2. Constructor api_key when it is NOT an Emergent universal key (sk-emergent-*)
  3. Mock response so the app stays usable without any LLM credentials
"""
from __future__ import annotations

import base64
import logging
import os
from dataclasses import dataclass, field
from typing import Any, List, Optional

logger = logging.getLogger(__name__)

_PROVIDER_ENV = {
    "openai": ("OPENAI_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
    "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"),
    "google": ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"),
}


@dataclass
class FileContentWithMimeType:
    file_path: str
    mime_type: str


@dataclass
class UserMessage:
    text: str = ""
    file_contents: List[FileContentWithMimeType] = field(default_factory=list)


def _is_emergent_key(key: Optional[str]) -> bool:
    return bool(key) and str(key).startswith("sk-emergent-")


def _provider_key(provider: str, explicit: Optional[str] = None) -> Optional[str]:
    for env_name in _PROVIDER_ENV.get((provider or "").lower(), ()):
        val = os.environ.get(env_name)
        if val:
            return val
    if explicit and not _is_emergent_key(explicit):
        return explicit
    emergent = os.environ.get("EMERGENT_LLM_KEY")
    if emergent and not _is_emergent_key(emergent):
        return emergent
    return None


def _litellm_model(provider: str, model: str) -> str:
    p = (provider or "").lower()
    if "/" in (model or ""):
        return model
    if p in ("gemini", "google"):
        return f"gemini/{model}"
    if p == "anthropic":
        return f"anthropic/{model}"
    if p == "openai":
        return model
    return f"{provider}/{model}" if provider else model


def _file_part(fc: FileContentWithMimeType) -> dict:
    with open(fc.file_path, "rb") as f:
        raw = f.read()
    b64 = base64.b64encode(raw).decode("ascii")
    mime = fc.mime_type or "application/octet-stream"
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{mime};base64,{b64}"},
    }


def _mock_reply(text: str) -> str:
    lowered = (text or "").lower()
    if "json" in lowered or "devuelve solo" in lowered or "devuelve únicamente" in lowered:
        return (
            '{"mock": true, "note": "LLM mock — set OPENAI_API_KEY / ANTHROPIC_API_KEY / '
            'GEMINI_API_KEY for real responses", "items": [], "kpis": [], "trends": [], '
            '"reply": "Modo mock local"}'
        )
    return (
        "[Mock LLM local] No hay clave de proveedor configurada. "
        "Define OPENAI_API_KEY, ANTHROPIC_API_KEY o GEMINI_API_KEY para respuestas reales. "
        f"Recibí {len(text or '')} caracteres."
    )


class LlmChat:
    def __init__(
        self,
        api_key: Optional[str] = None,
        session_id: str = "",
        system_message: str = "",
    ):
        self.api_key = api_key or os.environ.get("EMERGENT_LLM_KEY") or ""
        self.session_id = session_id
        self.system_message = system_message or ""
        self.provider = "openai"
        self.model = "gpt-4o-mini"
        self._messages: List[dict[str, Any]] = []
        if self.system_message:
            self._messages.append({"role": "system", "content": self.system_message})

    def with_model(self, provider: str, model: str) -> "LlmChat":
        self.provider = provider
        self.model = model
        return self

    async def send_message(self, message: UserMessage) -> str:
        text = getattr(message, "text", "") or ""
        files = getattr(message, "file_contents", None) or []

        if files:
            parts: List[Any] = [{"type": "text", "text": text}]
            for fc in files:
                try:
                    parts.append(_file_part(fc))
                except Exception as e:
                    logger.warning("Could not attach file %s: %s", getattr(fc, "file_path", fc), e)
            user_content: Any = parts
        else:
            user_content = text

        self._messages.append({"role": "user", "content": user_content})

        api_key = _provider_key(self.provider, self.api_key)
        if not api_key:
            reply = _mock_reply(text)
            self._messages.append({"role": "assistant", "content": reply})
            logger.warning(
                "LlmChat mock mode (session=%s provider=%s model=%s): no provider API key",
                self.session_id,
                self.provider,
                self.model,
            )
            return reply

        try:
            import litellm

            model_name = _litellm_model(self.provider, self.model)
            kwargs: dict[str, Any] = {
                "model": model_name,
                "messages": self._messages,
                "api_key": api_key,
            }
            resp = await litellm.acompletion(**kwargs)
            reply = (resp.choices[0].message.content or "").strip()
        except Exception:
            logger.exception(
                "LlmChat litellm call failed (session=%s model=%s/%s)",
                self.session_id,
                self.provider,
                self.model,
            )
            raise

        self._messages.append({"role": "assistant", "content": reply})
        return reply
