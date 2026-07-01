# backend/api/equipment_routes.py
# Equipment master-table read routes.
# Registered in main.py with prefix /api/equipment.

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import get_current_user
from backend.database import fetch_all, fetch_one
from backend.models.equipment_models import EquipmentOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/equipment", tags=["equipment"])


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _row_to_equipment_out(row) -> EquipmentOut:
    """Convert a sqlite3.Row to an EquipmentOut schema instance."""
    return EquipmentOut(
        id=row["id"],
        code=row["code"],
        name=row["name"],
        category=row["category"],
        is_active=row["is_active"],
    )


# ---------------------------------------------------------------------------
# GET /api/equipment
# ---------------------------------------------------------------------------

@router.get("", status_code=status.HTTP_200_OK)
async def list_equipment(
    category: Optional[str] = None,
    active_only: bool = True,
    _current_user: dict = Depends(get_current_user),
) -> List[EquipmentOut]:
    """Return all equipment matching optional category and active_only filters.

    All authenticated roles (Viewer, Engineer / Operator, Administrator) may call this.
    Returns an empty list when no rows match — never a 404.
    Results are ordered by category ASC, code ASC.
    """
    try:
        conditions: list[str] = []
        params: list = []

        if active_only:
            conditions.append("is_active = ?")
            params.append(1)

        if category is not None:
            conditions.append("category = ?")
            params.append(category)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        query = f"SELECT id, code, name, category, is_active FROM equipment {where} ORDER BY category ASC, code ASC"  # noqa: S608

        rows = fetch_all(query, tuple(params))
        return [_row_to_equipment_out(row) for row in rows]

    except Exception:
        logger.exception("Error listing equipment.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving equipment.",
        )


# ---------------------------------------------------------------------------
# GET /api/equipment/{id}
# ---------------------------------------------------------------------------

@router.get("/{equipment_id}", status_code=status.HTTP_200_OK)
async def get_equipment(
    equipment_id: int,
    _current_user: dict = Depends(get_current_user),
) -> EquipmentOut:
    """Return a single active equipment row by integer id.

    Returns 404 when the id does not exist or the row is inactive.
    Exists for future extensibility — not called by the frontend in this session.
    """
    try:
        row = fetch_one(
            "SELECT id, code, name, category, is_active FROM equipment WHERE id = ? AND is_active = 1",
            (equipment_id,),
        )
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Equipment not found.",
            )
        return _row_to_equipment_out(row)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error retrieving equipment id %s.", equipment_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving equipment.",
        )
