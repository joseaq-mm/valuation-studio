"""Macro indicators route (US macro panel powered by FRED)."""
import logging

from fastapi import APIRouter, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from services.macro import get_macro_indicators

logger = logging.getLogger(__name__)


def make_router(db: AsyncIOMotorDatabase) -> APIRouter:
    router = APIRouter(prefix="/macro")

    @router.get("/indicators")
    async def indicators(refresh: bool = Query(False)):
        """US macro indicators (Buffett proxy, Fed rate, CPI, productivity, M2, oil)."""
        try:
            return await get_macro_indicators(db, refresh=refresh)
        except Exception as e:
            logger.error(f"macro indicators failed: {e}")
            raise HTTPException(status_code=502, detail="No se pudieron obtener los datos macro (FRED). Inténtalo de nuevo en un momento.")

    return router
