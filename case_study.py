# case_study.py

from config import (
    SCENARIOS,
    DESIGNS,
    FUELS,
    BASELINE_SFOC_G_PER_KWH_BY_MODE,
    DEFAULT_SFOC_G_PER_KWH_BY_MODE,
    DEFAULT_FUEL_KEY,
)

from kpis.environment import calculate_acio_index, calculate_cio
from kpis.efficiency import calculate_mee_index
from kpis.robustness import (
    operational_robustness,
    operational_robustness_index,
    calculate_h_lim,
    calculate_pex,
    environmental_operability,
    technical_robustness,
    hours_by_mode,
    or_breakdown,
)
from kpis.economy import calculate_capex_index
from contracts.generator import generate_contracts
from kpis.flexibility import calculate_flexibility, calculate_flexibility_index


class FuelContext:
    def __init__(self, fuel_key):
        self.key = fuel_key
        self.emission_factor_kgco2_per_kgfuel = FUELS[fuel_key]["emission_factor"]
        self.label = FUELS[fuel_key]["label"]


class Params:
    def __init__(self, uses_shore_power=False):
        self.uses_shore_power = uses_shore_power


# Baseline setup used for KPI normalisation
BASE = DESIGNS["BASE"]
BASE_FUEL = FuelContext(DEFAULT_FUEL_KEY)
BASE_PARAMS = Params(uses_shore_power=BASE.supports_shore_power)
BASE_SFOC = BASELINE_SFOC_G_PER_KWH_BY_MODE


# Designs included in the case study comparison
EVAL_KEYS = ["D1", "D2", "D3"]
ALL_KEYS = ["BASE"] + EVAL_KEYS


# Default design assumptions used for the alternatives
DESIGN_FUEL = FuelContext(DEFAULT_FUEL_KEY)
DESIGN_SFOC = DEFAULT_SFOC_G_PER_KWH_BY_MODE
CONTRACTS = generate_contracts()


W = 100


def params_for(k) -> Params:
    # Uses the shore power setting defined for each design
    if k == "BASE":
        return BASE_PARAMS

    return Params(uses_shore_power=DESIGNS[k].supports_shore_power)


def sep(char="-", width=W):
    # Prints a table separator with fixed width
    print("  " + char * width)


def run():

    print("\n" + "=" * W)
    print("  DESIGN PARAMETERS")
    print("=" * W)

    print(
        f"\n  {'Design':<8} {'GT':>7} {'LOA [m]':>9} {'B [m]':>7} {'T [m]':>7}"
        f" {'Crane [t]':>10} {'GW':>4} {'Shore':>6} {'POB':>5} {'DP':>4}"
    )
    sep()

    # Prints the main design parameters used in the KPI calculations
    for k in ALL_KEYS:
        d = DESIGNS[k]
        print(
            f"  {k:<8}"
            f" {d.gt_t:>7.0f}"
            f" {d.loa:>9.1f}"
            f" {d.beam:>7.1f}"
            f" {d.draft:>7.2f}"
            f" {d.crane_capacity_t:>10.0f}"
            f" {'Y' if d.has_gangway else 'N':>4}"
            f" {'Y' if d.supports_shore_power else 'N':>6}"
            f" {d.technician_capacity:>5}"
            f" {d.dp_class:>4}"
        )

    print("\n\n" + "=" * W)
    print("  POWER BREAKDOWN AND DP LIMIT")
    print("=" * W)

    print(
        f"\n  {'Design':<8} {'Gen [kW]':>10} {'DP cap [kW]':>12}"
        f" {'Hlim DP [m]':>12}"
        f" {'Transit':>10} {'Prop':>10} {'H&aux':>10}"
        f" {'DP':>8} {'Standby':>10} {'Port':>8}"
    )
    sep()

    # Prints power assumptions and DP wave limit for each design
    for k in ALL_KEYS:
        d = DESIGNS[k]
        powers = d.power_levels_kw
        propulsion = d.transit_propulsion_kw
        hotel_aux = powers["Transit"] - propulsion
        hlim = calculate_h_lim(d)

        print(
            f"  {k:<8}"
            f" {d.total_generator_kw:>10.0f}"
            f" {d.dp_capacity_kw:>12.0f}"
            f" {hlim:>12.2f}"
            f" {powers['Transit']:>10.0f}"
            f" {propulsion:>10.0f}"
            f" {hotel_aux:>10.0f}"
            f" {powers['DP']:>8.0f}"
            f" {powers['Standby']:>10.0f}"
            f" {powers['Port']:>8.0f}"
        )

    # Runs the full KPI calculation for each scenario
    for sc_key, scenario in SCENARIOS.items():

        print(f"\n\n{'=' * W}")
        print(f"  {scenario.name.upper()}")
        print(f"{'=' * W}")

        def cio_for(k):
            # Calculates CIO with design-specific fuel and shore power settings
            d = DESIGNS[k]
            sfoc = BASE_SFOC if k == "BASE" else DESIGN_SFOC
            fuel = BASE_FUEL if k == "BASE" else DESIGN_FUEL

            return calculate_cio(d, scenario, fuel, params_for(k), d.gt_t, sfoc)

        cio_vals = {k: cio_for(k) for k in ALL_KEYS}

        print("\n  Operational profile  [% of total annual hours]\n")
        print(
            f"  {'Design':<8} {'Transit':>12} {'DP':>12} {'Port':>12} {'Standby':>12}"
        )
        sep()

        # Shows how weather downtime shifts DP hours into standby
        for k in ALL_KEYS:
            h = hours_by_mode(DESIGNS[k], scenario)
            t = scenario.total_hours

            print(
                f"  {k:<8}"
                f" {100 * h['Transit'] / t:>11.0f}%"
                f" {100 * h['DP'] / t:>11.0f}%"
                f" {100 * h['Port'] / t:>11.0f}%"
                f" {100 * h['Standby'] / t:>11.0f}%"
            )

        print("\n  Weibull fit and wave-height exceedance\n")
        print(
            f"  {'Design':<8} {'Hlim [m]':>9} {'k':>8} {'lambda':>9}"
            f" {'p_ex':>9} {'A':>9}"
        )
        sep()

        # Reports the wave exceedance values behind environmental operability
        for k in ALL_KEYS:
            b = or_breakdown(DESIGNS[k], scenario, BASE)
            print(
                f"  {k:<8}"
                f" {b['h_lim_dp_m']:>9.2f}"
                f" {b['weibull_k']:>8.3f}"
                f" {b['weibull_lambda']:>9.3f}"
                f" {b['p_exceedance']:>9.3f}"
                f" {b['A_env_operability']:>9.3f}"
            )

        print("\n  Operational Robustness components\n")
        print(
            f"  {'Design':<8} {'p_ex':>8} {'A':>8} {'R_tech':>10}"
            f" {'OR-score':>10} {'OR-idx':>9}"
        )
        sep()

        # Splits OR into environmental and technical components
        for k in ALL_KEYS:
            d = DESIGNS[k]

            p_ex = calculate_pex(d, scenario)
            a_env = environmental_operability(d, scenario)
            r_tech = technical_robustness(d, BASE)
            or_score = operational_robustness(d, scenario, BASE)

            if k == "BASE":
                or_idx = 1.000
            else:
                or_idx = operational_robustness_index(d, scenario, BASE)

            print(
                f"  {k:<8}"
                f" {p_ex:>8.3f}"
                f" {a_env:>8.2f}"
                f" {r_tech:>10.2f}"
                f" {or_score:>10.2f}"
                f" {or_idx:>9.2f}"
            )

        print("\n  KPI results\n")
        print(
            f"  {'Design':<8} {'OR-idx':>9} {'ACIO-idx':>10} {'MEE-idx':>10}"
            f" {'CAPEX-idx':>11} {'CF [-]':>9}"
        )
        sep()

        # Prints the main KPI values used for comparing the designs
        for k in ALL_KEYS:
            d = DESIGNS[k]
            pob = d.technician_capacity
            sfoc = BASE_SFOC if k == "BASE" else DESIGN_SFOC

            cf_abs = calculate_flexibility(d, CONTRACTS, cio_value=cio_vals[k])

            if k == "BASE":
                or_idx = 1.000
                acio_idx = 1.000
                mee_idx = 1.000
                capex_idx = 1.000
            else:
                or_idx = operational_robustness_index(d, scenario, BASE)
                acio_idx = calculate_acio_index(
                    d,
                    scenario,
                    DESIGN_FUEL,
                    params_for(k),
                    d.gt_t,
                    DESIGN_SFOC,
                    BASE,
                    BASE_FUEL,
                    BASE_PARAMS,
                    BASE_SFOC,
                )
                mee_idx = calculate_mee_index(
                    d,
                    scenario,
                    DESIGN_SFOC,
                    pob,
                    BASE,
                    BASE_SFOC,
                    BASE.technician_capacity,
                )
                capex_idx = calculate_capex_index(d, BASE)

            print(
                f"  {k:<8}"
                f" {or_idx:>9.2f}"
                f" {acio_idx:>10.2f}"
                f" {mee_idx:>10.2f}"
                f" {capex_idx:>11.2f}"
                f" {cf_abs:>9.2f}"
            )

        print("\n  Supporting technical values\n")
        print(f"  {'Design':<8} {'CIO':>12} {'CF-idx':>9}")
        sep()

        # Prints values used to support the flexibility interpretation
        for k in ALL_KEYS:
            d = DESIGNS[k]
            cio = cio_vals[k]

            if k == "BASE":
                cf_idx = 1.000
            else:
                cf_idx = calculate_flexibility_index(
                    d,
                    CONTRACTS,
                    BASE,
                    cio_value=cio_vals[k],
                    baseline_cio_value=cio_vals["BASE"],
                )

            print(
                f"  {k:<8}"
                f" {cio:>12.6f}"
                f" {cf_idx:>9.2f}"
            )

        run_or_weight_sensitivity(sc_key, scenario)

    print()


from kpis.robustness import _r_dp_class, _r_redundancy, _r_power


def _or_index_with_weights(design, baseline_design, scenario, w_dp, w_red, w_pow):
    # Recalculates OR index with alternative technical robustness weights
    a_design = environmental_operability(design, scenario)
    a_base = environmental_operability(baseline_design, scenario)

    r_dp = _r_dp_class(design, baseline_design)
    r_red = _r_redundancy(design, baseline_design)
    r_pow = _r_power(design, baseline_design)

    r_design = r_dp ** w_dp * r_red ** w_red * r_pow ** w_pow

    rb_dp = _r_dp_class(baseline_design, baseline_design)
    rb_red = _r_redundancy(baseline_design, baseline_design)
    rb_pow = _r_power(baseline_design, baseline_design)

    r_base = rb_dp ** w_dp * rb_red ** w_red * rb_pow ** w_pow

    return (a_design * r_design) / (a_base * r_base)


def _renorm_weights(target_idx, target_val):
    # Adjusts the other weights so the total weight remains one
    base_w = [0.4, 0.3, 0.3]
    others = [i for i in range(3) if i != target_idx]

    remaining = 1.0 - target_val
    other_sum = base_w[others[0]] + base_w[others[1]]

    w = base_w[:]
    w[target_idx] = target_val

    for i in others:
        w[i] = remaining * (base_w[i] / other_sum)

    return tuple(w)


def run_or_weight_sensitivity(sc_key, scenario):
    # Tests how OR ranking changes when robustness weights are varied
    print("\n\n" + "=" * W)
    print(f"  SENSITIVITY ANALYSIS: OR TECHNICAL-ROBUSTNESS WEIGHTS - SCENARIO {sc_key.upper()}")
    print("=" * W)

    settings = [
        ("Baseline weights", 0, 0.4),
        ("Low  w_dp", 0, 0.3),
        ("High w_dp", 0, 0.5),
        ("Low  w_red", 1, 0.2),
        ("High w_red", 1, 0.5),
        ("Low  w_pow", 2, 0.2),
        ("High w_pow", 2, 0.5),
    ]

    print("\n  OR-index under varied weights\n")
    print(
        f"  {'Setting':<18} {'(w_dp,w_red,w_pow)':>20}"
        f" {'D1':>8} {'D2':>8} {'D3':>8} {'ranking':>18}"
    )
    sep()

    # Prints OR index and ranking for each alternative weight setting
    for label, idx, val in settings:
        w = _renorm_weights(idx, val)

        vals = {
            k: _or_index_with_weights(DESIGNS[k], BASE, scenario, *w)
            for k in EVAL_KEYS
        }

        order = " > ".join(sorted(vals, key=vals.get, reverse=True))
        wtxt = f"({w[0]:.2f},{w[1]:.2f},{w[2]:.2f})"

        print(
            f"  {label:<18} {wtxt:>20}"
            f" {vals['D1']:>8.2f}"
            f" {vals['D2']:>8.2f}"
            f" {vals['D3']:>8.2f}"
            f"   {order:<18}"
        )

    print()


if __name__ == "__main__":
    run()