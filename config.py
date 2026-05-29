# config.py

from models.scenario import Scenario
from models.design import Design


TOTAL_HOURS = 8760  # Hours per year


# Common DP wave limit based on VARD industry input
# Typical SOV DP condition: Hs ≈ 2.5 m at Tp ≈ 7 s
H_LIM_DP = 2.5


# Operating scenarios used to compare the design alternatives
SCENARIOS = {
    "A": Scenario(
        key="A",
        name="Scenario A: DP-intensive, higher Hs",
        total_hours=TOTAL_HOURS,
        share_transit=0.30,
        share_dp=0.60,
        share_port=0.10,
        hs_mean=2.5,
        hs_std=0.8,
    ),
    "B": Scenario(
        key="B",
        name="Scenario B: Transit-oriented, lower Hs",
        total_hours=TOTAL_HOURS,
        share_transit=0.55,
        share_dp=0.25,
        share_port=0.20,
        hs_mean=2.0,
        hs_std=0.6,
    ),
}


# Baseline and alternative vessel concepts used in the case study
DESIGNS = {

    "BASE": Design(
        key="BASE",
        name="Baseline vessel",
        dwt_t=2000,
        gt_t=5943,
        dp_class=2,
        steel_weight_t=800,
        n_gensets=4,
        n_thrusters=5,
        battery_included=True,
        battery_capacity_kwh=745,
        loa_m=85.5,
        beam_m=19.5,
        draft_m=5.6,
        h_lim_dp=H_LIM_DP,
        total_generator_kw=5560,
        transit_propulsion_kw=1314,
        crane_capacity_t=6,
        has_gangway=True,
        supports_shore_power=True,
        technician_capacity=60,
    ),

    "D1": Design(
        key="D1",
        name="Design 1 - reduced capacity",
        dwt_t=2000,
        gt_t=5943,
        dp_class=2,
        steel_weight_t=770,
        n_gensets=4,
        n_thrusters=5,
        battery_included=True,
        battery_capacity_kwh=600,
        loa_m=85.5,
        beam_m=19.5,
        draft_m=5.6,
        h_lim_dp=H_LIM_DP,  # switch between H_LIM_DP and 2.4
        total_generator_kw=5100,
        transit_propulsion_kw=1314,
        crane_capacity_t=6,
        has_gangway=True,
        supports_shore_power=True,
        technician_capacity=50,
    ),

    "D2": Design(
        key="D2",
        name="Design 2 - DP3 variant",
        dwt_t=2100,
        gt_t=6200,
        dp_class=3,
        steel_weight_t=860,
        n_gensets=5,
        n_thrusters=6,
        battery_included=True,
        battery_capacity_kwh=1000,
        loa_m=87.0,
        beam_m=20.0,
        draft_m=5.7,
        h_lim_dp=H_LIM_DP,  # switch between H_LIM_DP and 2.6
        total_generator_kw=6200,
        transit_propulsion_kw=1325,
        crane_capacity_t=10,
        has_gangway=True,
        supports_shore_power=True,
        technician_capacity=70,
    ),

    "D3": Design(
        key="D3",
        name="Design 3 - high capacity",
        dwt_t=2300,
        gt_t=6800,
        dp_class=2,
        steel_weight_t=900,
        n_gensets=5,
        n_thrusters=6,
        battery_included=True,
        battery_capacity_kwh=1250,
        loa_m=89.0,
        beam_m=20.5,
        draft_m=5.8,
        h_lim_dp=H_LIM_DP,  # switch between H_LIM_DP and 2.7
        total_generator_kw=6500,
        transit_propulsion_kw=1340,
        crane_capacity_t=20,
        has_gangway=True,
        supports_shore_power=True,
        technician_capacity=85,
    ),
}


# Fuel library with tank-to-wake emission factors
FUELS = {
    "MGO":   {"label": "MGO (diesel)", "emission_factor": 3.206},
    "VLSFO": {"label": "VLSFO",        "emission_factor": 3.188},
    "LNG":   {"label": "LNG",          "emission_factor": 2.750},
}


# Default SFOC values used when no design-specific values are given
DEFAULT_SFOC_G_PER_KWH_BY_MODE = {
    "Transit": 223,
    "DP":      250,
    "Standby": 273,
    "Port":    260,
}

DEFAULT_FUEL_KEY = "MGO"


# Baseline values are locked to keep normalisation consistent
LOCKED_DESIGN_KEYS = {"BASE"}

BASELINE_SFOC_G_PER_KWH_BY_MODE = {
    "Transit": 223,
    "DP":      250,
    "Standby": 273,
    "Port":    260,
}


# DP class scores are screening values relative to the DP2 baseline
DP_CLASS_SCREENING_SCORE = {
    1: 0.70,
    2: 1.00,
    3: 1.10,
}