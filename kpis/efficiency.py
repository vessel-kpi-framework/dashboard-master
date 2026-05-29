# kpis/efficiency.py

from kpis.robustness import hours_by_mode


# Only active mission modes are included in the MEE calculation
MISSION_MODES = ["DP", "Transit"]


def calculate_mee(
    design,
    scenario,
    sfoc_by_mode_g_per_kwh: dict,
    pob_tech: int,
) -> float:

    # Calculates mission output per kg of fuel used in mission modes
    hours = hours_by_mode(design, scenario)
    power = design.power_levels_kw

    # Fuel use is based on mode power, operating hours and SFOC
    mission_fuel_kg = 0.0
    for mode in MISSION_MODES:
        sfoc_kg_per_kwh = float(sfoc_by_mode_g_per_kwh[mode]) / 1000.0
        fuel_kg = float(power[mode]) * float(hours[mode]) * sfoc_kg_per_kwh
        mission_fuel_kg += fuel_kg

    if mission_fuel_kg <= 0:
        raise ValueError("Mission fuel consumption must be positive")

    # Mission output is represented by technician-hours during DP operation
    operative_tech_hours = float(pob_tech) * float(hours["DP"])

    return operative_tech_hours / mission_fuel_kg


def calculate_mee_index(
    design,
    scenario,
    sfoc_by_mode_g_per_kwh: dict,
    pob_tech: int,
    baseline_design,
    baseline_sfoc: dict,
    baseline_pob_tech: int,
) -> float:

    # Compares the design MEE to the baseline MEE
    mee_design   = calculate_mee(design,          scenario, sfoc_by_mode_g_per_kwh, pob_tech)
    mee_baseline = calculate_mee(baseline_design, scenario, baseline_sfoc,          baseline_pob_tech)

    if mee_baseline <= 0:
        raise ValueError("Baseline MEE must be positive")

    # A higher index means better mission energy efficiency than the baseline
    return mee_design / mee_baseline