# contracts/generator.py

import numpy as np
from typing import List
from contracts.contract_model import Contract
from contracts.distributions import latent_z, normal_clamped, sigmoid, clamp


# Defines how many contracts are generated in each market category
CATEGORY_DISTRIBUTION = {
    "standard": 45,
    "harsh": 25,
    "green": 20,
    "special": 10,
}

# Sets the typical requirement level and spread for each category
CATEGORY_CONFIG = {
    "standard": {"z_mean": 0.0,  "z_std": 0.7},
    "harsh":    {"z_mean": 1.2,  "z_std": 0.5},
    "green":    {"z_mean": -0.3, "z_std": 0.6},
    "special":  {"z_mean": 0.5,  "z_std": 1.0},
}


# Generates a fixed contract sample for repeatable KPI calculations
def generate_contracts(seed: int = 42) -> List[Contract]:

    rng = np.random.default_rng(seed)
    contracts: List[Contract] = []

    counter = 0

    for category, n in CATEGORY_DISTRIBUTION.items():

        cfg = CATEGORY_CONFIG[category]

        for _ in range(n):

            counter += 1
            cid = f"C{counter:03d}"

            # Links contract requirements through one shared demand level
            z = latent_z(rng, cfg["z_mean"], cfg["z_std"])

            # Higher demand contracts require operation in larger waves
            Hs_req = normal_clamped(rng, 1.8 + 0.6*z, 0.3, 0.5, 5.0)

            # Higher demand contracts require higher DP class
            if z < -1.0:
                DP_class_req = 1
            elif z < 1.0:
                DP_class_req = 2
            else:
                DP_class_req = 3

            # Technician demand increases with the contract demand level
            technician_capacity_req = int(clamp(
                rng.normal(50 + 18 * z, 8), 35, 100
            ))

            # Most contracts only require a light service crane
            crane_rand = rng.random()
            medium_crane_prob = clamp(0.07 + 0.05 * z, 0.02, 0.18)
            heavy_crane_prob  = clamp(0.005 + 0.02 * z, 0.0, 0.06)

            if crane_rand < heavy_crane_prob:
                crane_capacity_req = clamp(rng.normal(22, 3), 18, 30)
            elif crane_rand < heavy_crane_prob + medium_crane_prob:
                crane_capacity_req = clamp(rng.normal(11, 2), 8, 16)
            else:
                crane_capacity_req = clamp(rng.normal(5.2, 0.6), 3.5, 6.0)

            # Gangway demand becomes more likely for demanding contracts
            gangway_prob = sigmoid(z)
            gangway_req = rng.random() < gangway_prob

            # Lower draft limits represent more restrictive contract areas
            draft_max = clamp(rng.normal(6.2 - 0.4 * z, 0.4), 5.0, 8.0)

            # Green contracts are more likely to require shore power
            if category == "green":
                shore_power_req = rng.random() < 0.8
            else:
                shore_power_req = rng.random() < 0.1

            # Green contracts may include a maximum carbon intensity limit
            if category == "green":
                CIO_index_max = clamp(rng.normal(0.00040 - 0.00005 * z, 0.00003), 0.00025, 0.00055)
            else:
                CIO_index_max = None

            contract = Contract(
                id=cid,
                category=category,
                DP_class_req=DP_class_req,
                Hs_req=Hs_req,
                technician_capacity_req=technician_capacity_req,
                crane_capacity_req=crane_capacity_req,
                gangway_req=gangway_req,
                draft_max=draft_max,
                shore_power_req=shore_power_req,
                CIO_index_max=CIO_index_max,
            )

            contracts.append(contract)

    return contracts