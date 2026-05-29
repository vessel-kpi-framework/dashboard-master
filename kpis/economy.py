# kpis/economy.py

# Design CAPEX model used for relative cost comparison

# Cost coefficients used in the simplified CAPEX estimate
# The values are only used for relative scoring, not as real NOK estimates
C_STEEL       =     40.0   # Cost per tonne structural steel
C_KW          =      8.0   # Cost per kW installed power
C_GEN         = 15_000.0   # Cost per genset
C_THR         =  8_000.0   # Cost per thruster
C_BAT_PER_KWH =      5.0   # Cost per kWh battery capacity

# DP class factor captures the added cost of redundancy and separation
DP_CLASS_FACTOR = {
    1: 1.00,   # No added DP cost
    2: 1.08,   # Higher cost due to redundancy
    3: 1.20,   # Highest cost due to redundancy and separation
}


def calculate_capex(design) -> float:
    # Calculates the design CAPEX from main early-stage design parameters

    if not design.total_generator_kw:
        raise ValueError(
            f"Design '{design.key}' has total_generator_kw = 0 or unset. "
            "Set this field in config.py before running CAPEX calculations."
        )

    W_steel     = design.steel_weight_t
    P_installed = design.total_generator_kw
    N_gen       = design.n_gensets
    N_thr       = design.n_thrusters

    # Battery cost is only included when the design has a battery system
    E_bat = design.battery_capacity_kwh if design.battery_included else 0.0

    # Combines the main cost-driving components into one unscaled estimate
    capex_unscaled = (
        C_STEEL       * W_steel
        + C_KW          * P_installed
        + C_GEN         * N_gen
        + C_THR         * N_thr
        + C_BAT_PER_KWH * E_bat
    )

    # Applies a cost factor for the selected DP class
    f_dp = DP_CLASS_FACTOR.get(design.dp_class, 1.0)

    return capex_unscaled * f_dp


def calculate_capex_index(design, baseline_design) -> float:
    # Compares the design CAPEX to the baseline CAPEX

    capex_design   = calculate_capex(design)
    capex_baseline = calculate_capex(baseline_design)

    if capex_baseline <= 0:
        raise ValueError("Baseline CAPEX must be positive")

    # A higher index means lower estimated CAPEX than the baseline
    return capex_baseline / capex_design