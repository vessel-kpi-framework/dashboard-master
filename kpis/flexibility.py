# kpis/flexibility.py

from typing import List, Optional
from contracts.contract_model import Contract
from models.design import Design
from kpis.robustness import calculate_h_lim


def is_feasible(design: Design, contract: Contract,
                cio_value: Optional[float] = None) -> bool:

    # Checks if one design can satisfy one contract

    # The design must meet the required DP class
    if design.dp_class < contract.DP_class_req:
        return False

    # The design must have enough technician capacity
    if design.technician_capacity < contract.technician_capacity_req:
        return False

    # The limiting wave height must meet the contract requirement
    H_lim = calculate_h_lim(design)
    if H_lim < contract.Hs_req:
        return False

    # The crane must be able to cover the required lift
    if design.crane_capacity_t < contract.crane_capacity_req:
        return False

    # Gangway is only checked when required by the contract
    if contract.gangway_req and not design.has_gangway:
        return False

    # The design must stay within the contract draft limit
    if design.draft > contract.draft_max:
        return False

    # Shore power is only checked when required by the contract
    if contract.shore_power_req and not design.supports_shore_power:
        return False

    # CIO is only checked when both contract limit and design value exist
    if contract.CIO_index_max is not None and cio_value is not None:
        if cio_value > contract.CIO_index_max:
            return False

    return True


def calculate_flexibility(design: Design, contracts: List[Contract],
                          cio_value: Optional[float] = None) -> float:

    # Calculates the share of contracts the design can satisfy
    if not contracts:
        raise ValueError("Contract list cannot be empty")

    n_feasible = sum(
        1 for c in contracts if is_feasible(design, c, cio_value=cio_value)
    )

    return n_feasible / len(contracts)


def calculate_flexibility_index(
    design: Design,
    contracts: List[Contract],
    baseline_design: Design,
    cio_value: Optional[float] = None,
    baseline_cio_value: Optional[float] = None,
) -> float:

    # Compares design flexibility to the baseline flexibility
    F_design = calculate_flexibility(design,          contracts, cio_value=cio_value)
    F_base   = calculate_flexibility(baseline_design, contracts, cio_value=baseline_cio_value)

    if F_base <= 0:
        raise ValueError("Baseline flexibility must be positive")

    # A higher index means the design can satisfy more contracts than the baseline
    return F_design / F_base