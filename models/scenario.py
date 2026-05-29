# models/scenario.py

from dataclasses import dataclass


@dataclass(frozen=True)
class Scenario:
    # Defines one operating case used in the KPI calculations

    key: str
    name: str
    total_hours: float

    # Operating profile before weather-related standby is added
    share_transit: float
    share_dp: float
    share_port: float

    # Wave climate used to estimate DP operability
    hs_mean: float
    hs_std: float