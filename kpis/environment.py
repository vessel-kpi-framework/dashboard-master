# kpis/environment.py

from kpis.robustness import hours_by_mode


def calculate_acio(
    design,
    scenario,
    fuel_context,
    params,
    size_parameter,
    sfoc_by_mode_g_per_kwh: dict,
) -> float:

    # Calculates annual CO2 emissions per unit vessel size
    hours = hours_by_mode(design, scenario)
    power = design.power_levels_kw
    ef    = float(fuel_context.emission_factor_kgco2_per_kgfuel)

    acio = 0.0

    for mode, t_h in hours.items():
        # Shore power removes fuel use from port operation
        if mode == "Port" and getattr(params, "uses_shore_power", False):
            continue

        # Mode emissions are based on energy use, SFOC and fuel emission factor
        e_kwh           = float(power[mode]) * float(t_h)
        sfoc_kg_per_kwh = float(sfoc_by_mode_g_per_kwh[mode]) / 1000.0
        fuel_kg         = e_kwh * sfoc_kg_per_kwh
        co2_t           = (fuel_kg * ef) / 1000.0

        # Emissions are normalised by the vessel size parameter
        acio           += co2_t / float(size_parameter)

    return acio


def calculate_cio(
    design,
    scenario,
    fuel_context,
    params,
    size_parameter,
    sfoc_by_mode_g_per_kwh: dict,
) -> float:

    # Calculates time-normalised carbon intensity for contract checks
    hours = hours_by_mode(design, scenario)
    power = design.power_levels_kw
    ef    = float(fuel_context.emission_factor_kgco2_per_kgfuel)
    SP    = float(size_parameter)

    cio = 0.0

    for mode, t_h in hours.items():
        t_h = float(t_h)

        # Modes without operating time do not affect the intensity
        if t_h <= 0.0:
            continue

        # Shore power removes port emissions from the CIO estimate
        if mode == "Port" and getattr(params, "uses_shore_power", False):
            continue

        # Mode intensity is based on emissions per size and operating hour
        e_kwh           = float(power[mode]) * t_h
        sfoc_kg_per_kwh = float(sfoc_by_mode_g_per_kwh[mode]) / 1000.0
        fuel_kg         = e_kwh * sfoc_kg_per_kwh
        co2_t           = (fuel_kg * ef) / 1000.0
        cio            += co2_t / (SP * t_h)

    return cio


def calculate_acio_index(design, scenario, fuel_context, params,
                         size_parameter, sfoc_by_mode_g_per_kwh,
                         baseline_design, baseline_fuel_context,
                         baseline_params, baseline_sfoc) -> float:

    # Compares the design ACIO to the baseline ACIO
    acio_design   = calculate_acio(
        design, scenario, fuel_context, params,
        size_parameter, sfoc_by_mode_g_per_kwh
    )
    acio_baseline = calculate_acio(
        baseline_design, scenario, baseline_fuel_context, baseline_params,
        baseline_design.gt_t, baseline_sfoc
    )

    if acio_design <= 0:
        raise ValueError("Design ACIO must be positive")

    # A higher index means lower emissions than the baseline
    return acio_baseline / acio_design