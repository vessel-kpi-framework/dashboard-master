# kpis/robustness.py

# Operational Robustness model used for concept-stage screening
# OR combines weather operability with design-based technical robustness

import math

from config import H_LIM_DP, DP_CLASS_SCREENING_SCORE


# Weibull parameters are estimated from scenario wave statistics
def _weibull_shape_from_cv(cv: float) -> float:
    # Finds the Weibull shape that matches the given coefficient of variation
    if cv <= 0.0:
        raise ValueError("Coefficient of variation must be positive.")

    def cv_for_k(k: float) -> float:
        g1 = math.gamma(1.0 + 1.0 / k)
        g2 = math.gamma(1.0 + 2.0 / k)
        return math.sqrt(g2 / (g1 * g1) - 1.0)

    low, high = 0.2, 20.0
    for _ in range(100):
        mid = 0.5 * (low + high)
        if cv_for_k(mid) > cv:
            low = mid
        else:
            high = mid

    return 0.5 * (low + high)


def _weibull_params_from_mean_std(mean: float, std: float) -> tuple[float, float]:
    # Converts mean and standard deviation into Weibull shape and scale
    if mean <= 0.0 or std <= 0.0:
        raise ValueError("Hs mean and std must be positive.")

    cv = std / mean
    k = _weibull_shape_from_cv(cv)
    lam = mean / math.gamma(1.0 + 1.0 / k)

    return k, lam


def calculate_h_lim(design=None, baseline_design=None) -> float:
    # Uses design-specific DP wave limit if available, otherwise the common limit
    if design is not None and hasattr(design, "h_lim_dp"):
        if design.h_lim_dp is not None and design.h_lim_dp > 0.0:
            return float(design.h_lim_dp)

    return H_LIM_DP


def calculate_pex(design, scenario, baseline_design=None) -> float:
    # Calculates the probability that the wave height exceeds the DP limit
    h_lim = calculate_h_lim(design, baseline_design)

    k, lam = _weibull_params_from_mean_std(
        scenario.hs_mean,
        scenario.hs_std,
    )

    p_ex = math.exp(-((h_lim / lam) ** k))

    return max(0.0, min(1.0, p_ex))


def environmental_operability(design, scenario, baseline_design=None) -> float:
    # Calculates the share of time where DP operation is weather-feasible
    return 1.0 - calculate_pex(design, scenario, baseline_design)


def _r_dp_class(design, baseline_design) -> float:
    # Compares the design DP class to the baseline DP class
    s_design = DP_CLASS_SCREENING_SCORE[design.dp_class]
    s_base = DP_CLASS_SCREENING_SCORE[baseline_design.dp_class]

    return s_design / s_base


def _r_redundancy(design, baseline_design) -> float:
    # Uses thruster and genset ratios as a simple redundancy proxy
    if baseline_design.n_thrusters <= 0 or baseline_design.n_gensets <= 0:
        raise ValueError("Baseline must have positive thruster and genset counts.")

    thr_ratio = design.n_thrusters / baseline_design.n_thrusters
    gen_ratio = design.n_gensets / baseline_design.n_gensets

    return math.sqrt(thr_ratio * gen_ratio)


def _r_power(design, baseline_design) -> float:
    # Uses installed DP power as a screening proxy for thrust margin
    if baseline_design.dp_capacity_kw <= 0:
        raise ValueError("Baseline must have positive DP capacity.")

    return design.dp_capacity_kw / baseline_design.dp_capacity_kw


def technical_robustness(design, baseline_design, downtime_multiplier: float = 1.0) -> float:
    # Combines DP class, redundancy and power into one technical robustness score
    if downtime_multiplier <= 0.0:
        raise ValueError("downtime_multiplier must be positive.")

    r_dp = _r_dp_class(design, baseline_design)
    r_red = _r_redundancy(design, baseline_design)
    r_pow = _r_power(design, baseline_design)

    # Used for sensitivity testing of the DP class contribution
    if downtime_multiplier != 1.0:
        r_dp = 1.0 + (r_dp - 1.0) / downtime_multiplier

    w_dp = 0.4
    w_red = 0.3
    w_pow = 0.3

    return (
        r_dp ** w_dp
        * r_red ** w_red
        * r_pow ** w_pow
    )


def operational_robustness(design, scenario, baseline_design, downtime_multiplier: float = 1.0) -> float:
    # Combines environmental operability and technical robustness
    a = environmental_operability(design, scenario, baseline_design)
    r = technical_robustness(design, baseline_design, downtime_multiplier)

    return a * r


def operational_robustness_index(design, scenario, baseline_design, downtime_multiplier: float = 1.0) -> float:
    # Compares the design robustness to the baseline robustness
    rob_design = operational_robustness(design, scenario, baseline_design, downtime_multiplier)
    rob_base = operational_robustness(baseline_design, scenario, baseline_design, downtime_multiplier)

    if rob_base <= 0.0:
        raise ValueError("Baseline robustness must be positive.")

    return rob_design / rob_base


def or_breakdown(design, scenario, baseline_design, downtime_multiplier: float = 1.0) -> dict:
    # Returns the intermediate OR values used for reporting and dashboard output
    h_lim = calculate_h_lim(design, baseline_design)
    k, lam = _weibull_params_from_mean_std(scenario.hs_mean, scenario.hs_std)
    p_ex = calculate_pex(design, scenario, baseline_design)
    a = 1.0 - p_ex

    r_dp = _r_dp_class(design, baseline_design)
    r_red = _r_redundancy(design, baseline_design)
    r_pow = _r_power(design, baseline_design)

    # Applies the same DP sensitivity adjustment as the main robustness function
    if downtime_multiplier != 1.0:
        r_dp_used = 1.0 + (r_dp - 1.0) / downtime_multiplier
    else:
        r_dp_used = r_dp

    w_dp = 0.4
    w_red = 0.3
    w_pow = 0.3

    r = (
        r_dp_used ** w_dp
        * r_red ** w_red
        * r_pow ** w_pow
    )

    return {
        "design": design.key,
        "scenario": scenario.key,
        "h_lim_dp_m": h_lim,
        "weibull_k": k,
        "weibull_lambda": lam,
        "p_exceedance": p_ex,
        "A_env_operability": a,
        "R_dp_class": r_dp,
        "R_redundancy": r_red,
        "R_power": r_pow,
        "R_technical": r,
        "OR": a * r,
    }


def hours_by_mode(design, scenario, baseline_design=None, downtime_multiplier: float = 1.0) -> dict:
    # Estimates annual hours by mode after weather-related DP downtime
    pex = calculate_pex(design, scenario, baseline_design)

    total = scenario.total_hours
    dp_base = total * scenario.share_dp

    return {
        "Transit": total * scenario.share_transit,
        "DP": dp_base * (1.0 - pex),
        "Port": total * scenario.share_port,
        "Standby": dp_base * pex,
    }