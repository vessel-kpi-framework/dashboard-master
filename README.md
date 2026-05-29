# A KPI Framework for Early-Stage Vessel Design

The framework evaluates early-stage offshore and specialised vessel design
alternatives against a baseline using five design-oriented KPIs, and presents
the results in a self-contained, interactive HTML dashboard.

## KPIs

- Operational Robustness (OR)
- Annual Carbon Intensity Offshore (ACIO)
- Mission Energy Efficiency (MEE)
- Design CAPEX (CAPEX)
- Contract Flexibility (CF)

## Overview

The code has three parts:

- **Input and configuration** — `models/design.py` and `models/scenario.py`
  define the data structures for design alternatives and operational scenarios.
  `config.py` specifies the baseline vessel, design alternatives, scenarios,
  fuel assumptions and SFOC values.
- **KPI calculation and verification** — the five KPI models live in `kpis/`,
  and `contracts/` generates the synthetic contract set used by Contract
  Flexibility. `case_study.py` runs the full evaluation in tabular form to
  verify the calculations outside the dashboard.
- **Dashboard generation** — `main.py` passes the configuration to
  `report/html_dashboard.py`, which assembles a self-contained
  `report/dashboard.html`. This generates `report/dashboard.html`, starts a
   local web server, and opens the dashboard in your default browser at
  `http://localhost:8000/report/dashboard.html`. In the dashboard, the KPI
  logic is reimplemented in JavaScript so the results recalculate in real time as
  design parameters are edited in the browser.

## Repository structure

```
.
├── models/
│   ├── design.py        # design-alternative data structures
│   └── scenario.py      # operational-scenario data structures
├── config.py            # baseline vessel, designs, scenarios, fuels, SFOC
├── kpis/
│   ├── robustness.py    # Operational Robustness (OR)
│   ├── environment.py   # Annual Carbon Intensity Offshore (ACIO)
│   ├── efficiency.py    # Mission Energy Efficiency (MEE)
│   ├── economy.py       # Design CAPEX (CAPEX)
│   └── flexibility.py   # Contract Flexibility (CF)
├── contracts/           # synthetic contract set for the CF KPI
│   ├── contract_model.py
│   ├── distributions.py
│   └── generator.py
├── case_study.py        # tabular KPI evaluation (verification)
├── report/
│   ├── html_dashboard.py        # builds and assembles the dashboard
│   ├── dashboard_template.html  # HTML skeleton
│   ├── dashboard.css            # styling
│   ├── dashboard.js             # KPI logic, interactivity, charts
│   └── dashboard.html           # generated output
└── main.py              # entry point — generates the dashboard
```

## Requirements

Python 3.11 and the third-party packages imported by the code (notably numpy).

## Running

```
python main.py
```

This generates `report/dashboard.html`; open the file in a web browser to
explore the results.

## Note

Claude AI (Anthropic) was used as programming support for the HTML/JavaScript
dashboard implementation. The calculation logic, data structures and contract
model were developed by the authors and reviewed before implementation.
