# report/html_dashboard.py
#
# Generates a self-contained HTML dashboard for comparing vessel design KPIs.
#
# Source is split into separate files for maintainability:
#   dashboard_template.html  – HTML structure with placeholders
#   dashboard.css            – styling
#   dashboard.js             – dashboard logic and calculations
# At build time the CSS, JS and the serialised DATA payload are inlined into
# the template, producing a single portable HTML file at `out_path`.

import sys
import json
import numpy as _np
from pathlib import Path

# Allow imports from the project root regardless of where this file is run from
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import (
    LOCKED_DESIGN_KEYS,
    BASELINE_SFOC_G_PER_KWH_BY_MODE,
    H_LIM_DP,
    DP_CLASS_SCREENING_SCORE,
)

from models.design import (
    POWER_FRACTIONS_BY_MODE,
    TRANSIT_HOTEL_FRACTION,
    TRANSIT_PROPULSION_KW_DEFAULT,
)


from contracts.generator import generate_contracts

C_STEEL       =     40.0
C_KW          =      8.0
C_GEN         = 15_000.0
C_THR         =  8_000.0
C_BAT_PER_KWH =      5.0

# Directory holding the template / css / js source files (same dir as this file)
_ASSET_DIR = Path(__file__).resolve().parent


class _NumpyEncoder(json.JSONEncoder):
    """Converts numpy scalars to native Python types before JSON serialisation."""
    def default(self, obj):
        if isinstance(obj, _np.bool_):
            return bool(obj)
        if isinstance(obj, _np.integer):
            return int(obj)
        if isinstance(obj, _np.floating):
            return float(obj)
        return super().default(obj)


def _render_html(payload):
    """Inline CSS, JS and the DATA payload into the HTML template."""
    template = (_ASSET_DIR / "dashboard_template.html").read_text(encoding="utf-8")
    css      = (_ASSET_DIR / "dashboard.css").read_text(encoding="utf-8")
    js       = (_ASSET_DIR / "dashboard.js").read_text(encoding="utf-8")
    data_json = json.dumps(payload, cls=_NumpyEncoder)

    # str.replace is literal (not regex), so braces / backslashes / $ in the
    # JSON or JS are inserted verbatim.
    html = template.replace("/*__DASHBOARD_CSS__*/", css)
    html = html.replace("__DASHBOARD_DATA__", data_json)
    html = html.replace("/*__DASHBOARD_JS__*/", js)
    return html


def write_environment_dashboard(out_path, scenarios, designs, fuels, default_sfoc_by_mode, default_fuel_key):
    scenarios_dict = {
        k: {
            "name": v.name,
            "total_hours": v.total_hours,
            "share_transit": v.share_transit,
            "share_dp": v.share_dp,
            "share_port": v.share_port,
            "hs_mean": v.hs_mean,
            "hs_std": v.hs_std,
        }
        for k, v in scenarios.items()
    }

    designs_dict = {
        k: {
            "name": v.name,
            "dwt_t": v.dwt_t,
            "gt_t": v.gt_t,
            "power": v.power_levels_kw,
            "steel_weight_t": v.steel_weight_t,
            "n_gensets": v.n_gensets,
            "n_thrusters": v.n_thrusters,
            "battery_included": v.battery_included,
            "battery_capacity_kwh": v.battery_capacity_kwh,
            "dp_class": v.dp_class,
            "loa_m":  v.loa,
            "beam_m": v.beam,
            "draft_m": v.draft,
            "dp_capacity_kw": v.dp_capacity_kw,
            "total_generator_kw": v.total_generator_kw,
            "thruster_power_fraction": v.thruster_power_fraction,
            "h_lim_dp": getattr(v, "h_lim_dp", H_LIM_DP),
            "technician_capacity": v.technician_capacity,
            "crane_capacity_t": v.crane_capacity_t,
            "has_gangway": v.has_gangway,
            "supports_shore_power": v.supports_shore_power,
            # Transit power decomposition
            "transit_propulsion_kw": getattr(v, "transit_propulsion_kw", TRANSIT_PROPULSION_KW_DEFAULT),
        }
        for k, v in designs.items()
    }

    # Serialise contracts
    _contracts = generate_contracts()
    contracts_list = [
        {
            "id":                       c.id,
            "category":                 c.category,
            "technician_capacity_req":  int(c.technician_capacity_req),
            "DP_class_req":             int(c.DP_class_req),
            "Hs_req":             float(c.Hs_req),
            "crane_capacity_req": float(c.crane_capacity_req),
            "gangway_req":        bool(c.gangway_req),
            "draft_max":          float(c.draft_max),
            "shore_power_req":    bool(c.shore_power_req),
            "CIO_index_max":      float(c.CIO_index_max) if c.CIO_index_max is not None else None,
        }
        for c in _contracts
    ]

    defaults_sfoc = dict(default_sfoc_by_mode)
    if "Standby" not in defaults_sfoc:
        defaults_sfoc["Standby"] = defaults_sfoc.get("Port", 0.0)

    baseline_sfoc = dict(BASELINE_SFOC_G_PER_KWH_BY_MODE)
    if "Standby" not in baseline_sfoc:
        baseline_sfoc["Standby"] = baseline_sfoc.get("Port", defaults_sfoc.get("Standby", 0.0))
    if "Port" not in baseline_sfoc:
        baseline_sfoc["Port"] = baseline_sfoc.get("Standby", defaults_sfoc.get("Port", 0.0))

    payload = {
        "scenarios": scenarios_dict,
        "designs": designs_dict,
        "fuels": fuels,
        "contracts": contracts_list,
        "constants": {
            "C_STEEL": C_STEEL,
            "C_KW":    C_KW,
            "C_GEN":   C_GEN,
            "C_THR":   C_THR,
            "C_BAT_PER_KWH": C_BAT_PER_KWH,
        },
        "defaults": {
            "sfoc_by_mode_g_per_kwh": defaults_sfoc,
            "fuel_key": default_fuel_key,
            "locked_design_keys": sorted(list(LOCKED_DESIGN_KEYS)),
            "baseline_sfoc_by_mode_g_per_kwh": baseline_sfoc,
            "power_fractions_by_mode": dict(POWER_FRACTIONS_BY_MODE),
            "transit_hotel_fraction": TRANSIT_HOTEL_FRACTION,
            "transit_propulsion_kw_default": TRANSIT_PROPULSION_KW_DEFAULT,
            "h_lim_dp": H_LIM_DP,
            "dp_class_screening_score": DP_CLASS_SCREENING_SCORE,
        },
    }

    html = _render_html(payload)
    Path(out_path).write_text(html, encoding="utf-8")
