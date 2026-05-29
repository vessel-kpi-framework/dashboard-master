# models/design.py

from dataclasses import dataclass
from typing import Dict, Optional


# Baseline dimensions used as reference values in the model
_GT_BASE  = 5943.0
_LOA_BASE = 85.5
_B_BASE   = 19.5
_T_BASE   = 5.6


# Mode power fractions are calibrated from baseline vessel data
POWER_FRACTIONS_BY_MODE = {
    "DP":      0.1549,   # Baseline DP load share
    "Standby": 0.1025,  # Baseline standby load share
    "Port":    0.0464,  # Baseline port load share
}


# Transit hotel load covers non-propulsion consumers during transit
TRANSIT_HOTEL_FRACTION = 0.0753


# Default transit propulsion power is used when no design-specific value is set
TRANSIT_PROPULSION_KW_DEFAULT = 1314.0


@dataclass(frozen=True)
class Design:
    key:  str
    name: str

    dwt_t:            float
    gt_t:             float
    dp_class:         int
    steel_weight_t:   float
    n_gensets:        int
    n_thrusters:      int
    battery_included: bool

    # Battery capacity is only used when the design includes batteries
    battery_capacity_kwh: float = 0.0

    # Installed generator capacity is the basis for most power estimates
    total_generator_kw: float = 0.0

    # Share of installed generator capacity assumed available for thrusters
    thruster_power_fraction: float = 0.65

    # Transit propulsion power can be replaced by a design-specific estimate
    transit_propulsion_kw: float = TRANSIT_PROPULSION_KW_DEFAULT

    # Main vessel geometry used in contract and KPI checks
    loa_m:   Optional[float] = None
    beam_m:  Optional[float] = None
    draft_m: Optional[float] = None

    # Concept-stage wave limit used for DP operability
    h_lim_dp: float = 2.5

    # Attributes used when matching the design against generated contracts
    crane_capacity_t:      float = 0.0
    has_gangway:           bool  = False
    supports_shore_power:  bool  = False
    technician_capacity:   int   = 0

    @property
    def power_levels_kw(self) -> Dict[str, float]:
        # Estimates mode power levels from installed capacity and transit power
        if not self.total_generator_kw:
            return {}

        result = {
            m: round(self.total_generator_kw * f)
            for m, f in POWER_FRACTIONS_BY_MODE.items()
        }

        # Transit includes both propulsion and hotel load
        transit_hotel = self.total_generator_kw * TRANSIT_HOTEL_FRACTION
        result["Transit"] = round(self.transit_propulsion_kw + transit_hotel)

        return result

    @property
    def dp_capacity_kw(self) -> float:
        # Estimates available DP power from installed generator capacity
        if self.total_generator_kw:
            return self.total_generator_kw * self.thruster_power_fraction

        return self.power_levels_kw["DP"]

    @property
    def loa(self) -> float:
        # Short alias used by contract and dashboard functions
        return self.loa_m

    @property
    def beam(self) -> float:
        # Short alias used by contract and dashboard functions
        return self.beam_m

    @property
    def draft(self) -> float:
        # Short alias used by contract and dashboard functions
        return self.draft_m