# contracts/contract_model.py

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Contract:
    # Contract requirements used in the flexibility analysis

    id: str
    category: str  # standard, harsh, green, special

    # Core technical requirements
    DP_class_req: int               # Required DP class
    Hs_req: float                   # Required Hs operability [m]
    technician_capacity_req: int    # Minimum technicians

    # Mission equipment
    crane_capacity_req: float   # Required crane capacity [t]
    gangway_req: bool           # Gangway required

    # Physical constraints
    draft_max: float            # Maximum draft [m]

    # Environmental requirements
    shore_power_req: bool       # Shore power required
    CIO_index_max: Optional[float]  # Optional emission limit