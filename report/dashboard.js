// report/dashboard.js
//
// Dashboard logic and KPI calculations for the vessel design evaluation.
// Reads the global `DATA` object injected by dashboard_template.html.
/* global DATA */

const MODES = ["Transit", "DP", "Standby", "Port"];
const LOCKED_DESIGNS = new Set(
  (DATA.defaults && DATA.defaults.locked_design_keys) ? DATA.defaults.locked_design_keys : []
);
// Power fractions for DP, Standby, Port — mirrors POWER_FRACTIONS_BY_MODE in design.py.
// Transit is handled separately via transit_propulsion_kw + hotel fraction.
const POWER_FRACTIONS = DATA.defaults.power_fractions_by_mode || {
  DP: 0.1549, Standby: 0.1025, Port: 0.0464
};
// Transit decomposition constants — mirror design.py
const TRANSIT_HOTEL_FRACTION = DATA.defaults.transit_hotel_fraction;
const TRANSIT_PROPULSION_KW_DEFAULT = DATA.defaults.transit_propulsion_kw_default;

const DESIGN_COLOURS = {
  "BASE": "#444444", "D1": "#7b8fc9", "D2": "#d08a2e", "D3": "#b07aa1",
};
const el = (id) => document.getElementById(id);
const mk = (tag, cls) => { const x = document.createElement(tag); if (cls) x.className = cls; return x; };


// ─── OR model constants — must match robustness.py ───────────────────────────

const DP_CLASS_SCREENING_SCORE = DATA.defaults.dp_class_screening_score || {
  "1": 0.70,
  "2": 1.00,
  "3": 1.10
};

function calculateHLim(design) {
  // Design-specific DP Hs limit. Defaults to VARD input if not set.
  const hLim = Number(design.h_lim_dp || DATA.defaults.h_lim_dp || 2.5);
  return hLim > 0 ? hLim : Number(DATA.defaults.h_lim_dp || 2.5);
}

function dpCapacityKw(design) {
  const totalGenKw = Number(design.total_generator_kw || 0.0);
  const fraction = Number(design.thruster_power_fraction || 0.65);
  return totalGenKw * fraction;
}

// Lanczos approximation for Gamma function.
// Needed for Weibull moment fitting in the browser.
function gamma(z) {
  const p = [
    676.5203681218851,
   -1259.1392167224028,
    771.32342877765313,
   -176.61502916214059,
     12.507343278686905,
     -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7
  ];

  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  }

  z -= 1;
  let x = 0.99999999999980993;

  for (let i = 0; i < p.length; i++) {
    x += p[i] / (z + i + 1);
  }

  const t = z + p.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

// ─── KPI helpers ─────────────────────────────────────────────────────────────

function weibullShapeFromCV(cv) {
  function cvForK(k) {
    const g1 = gamma(1.0 + 1.0 / k);
    const g2 = gamma(1.0 + 2.0 / k);
    return Math.sqrt(g2 / (g1 * g1) - 1.0);
  }

  let low = 0.2;
  let high = 20.0;

  // CV decreases with increasing k.
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (low + high);
    if (cvForK(mid) > cv) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return 0.5 * (low + high);
}

function weibullParamsFromMeanStd(mean, std) {
  const mu = Math.max(Number(mean), 1e-9);
  const sigma = Math.max(Number(std), 1e-9);

  const cv = sigma / mu;
  const k = weibullShapeFromCV(cv);
  const lambda = mu / gamma(1.0 + 1.0 / k);

  return { k, lambda };
}

function computePex(design, scenario) {
  const H_lim = calculateHLim(design);
  const params = weibullParamsFromMeanStd(scenario.hs_mean, scenario.hs_std);

  const p_ex = Math.exp(-Math.pow(H_lim / params.lambda, params.k));
  return Math.max(0.0, Math.min(1.0, p_ex));
}

function dpClassIndex(design, baseline) {
  const sDesign = DP_CLASS_SCREENING_SCORE[String(design.dp_class)];
  const sBase = DP_CLASS_SCREENING_SCORE[String(baseline.dp_class)];

  const designScore = sDesign !== undefined ? Number(sDesign) : 1.0;
  const baseScore = sBase !== undefined ? Number(sBase) : 1.0;

  if (baseScore <= 0.0) return 1.0;
  return designScore / baseScore;
}

function redundancyIndex(design, baseline) {
  const thrBase = Number(baseline.n_thrusters || 0);
  const genBase = Number(baseline.n_gensets || 0);

  if (thrBase <= 0 || genBase <= 0) return 1.0;

  const thrRatio = Number(design.n_thrusters || 0) / thrBase;
  const genRatio = Number(design.n_gensets || 0) / genBase;

  return Math.sqrt(Math.max(0.0, thrRatio * genRatio));
}

function powerIndex(design, baseline) {
  const baseDp = dpCapacityKw(baseline);
  if (baseDp <= 0.0) return 1.0;
  return dpCapacityKw(design) / baseDp;
}

function computeTechnicalRobustness(design) {
  const baseline = state.designs["BASE"];

  const rDp  = dpClassIndex(design, baseline);
  const rRed = redundancyIndex(design, baseline);
  const rPow = powerIndex(design, baseline);

  const wDp  = 0.4;
  const wRed = 0.3;
  const wPow = 0.3;

  return (
    Math.pow(rDp,  wDp)
    * Math.pow(rRed, wRed)
    * Math.pow(rPow, wPow)
  );
}

function computeEnvironmentalOperability(design, scenario) {
  return 1.0 - computePex(design, scenario);
}

function computeOperationalRobustness(design, scenario) {
  return computeEnvironmentalOperability(design, scenario) * computeTechnicalRobustness(design);
}

function computeRobustnessIndex(design, sc) {
  const baseRob   = computeOperationalRobustness(state.designs["BASE"], sc);
  const designRob = computeOperationalRobustness(design, sc);
  if (baseRob <= 0) return 0;
  return designRob / baseRob;
}

function hoursByMode(sc, design) {
  const pex     = computePex(design, sc);
  const total   = sc.total_hours;
  const dp_base = total * sc.share_dp;

  return {
    Transit: total   * sc.share_transit,
    DP:      dp_base * (1.0 - pex),
    Port:    total   * sc.share_port,
    Standby: dp_base * pex,
  };
}

function emissionFactor(fuelKey) {
  const f = DATA.fuels[fuelKey];
  return f ? Number(f.emission_factor) : 0.0;
}

function computeACIO(sc, design, params) {
  const h  = hoursByMode(sc, design);
  const ef = emissionFactor(params.fuel_key);
  const SP = Number(design.gt_t);
  let acio = 0.0;
  for (const m of MODES) {
    if (m === "Port" && params.uses_shore_power) continue;
    const sfoc_kg = Number(params.sfoc_by_mode_g_per_kwh[m]) / 1000.0;
    const co2_t   = (Number(design.power[m]) * Number(h[m]) * sfoc_kg * ef) / 1000.0;
    acio += co2_t / SP;
  }
  return acio;
}

function computeACIOIndex(sc, design, params) {
  const baseACIO   = computeACIO(sc, state.designs["BASE"], state.paramsByDesign["BASE"]);
  const designACIO = computeACIO(sc, design, params);
  if (designACIO <= 0) return 0;
  return baseACIO / designACIO;
}

function computeMEE(sc, design, params) {
  const h = hoursByMode(sc, design);
  let missionFuelKg = 0.0;
  for (const m of ["DP", "Transit"]) {
    const sfoc_kg = Number(params.sfoc_by_mode_g_per_kwh[m]) / 1000.0;
    missionFuelKg += Number(design.power[m]) * Number(h[m]) * sfoc_kg;
  }
  if (missionFuelKg <= 0) return 0;
  return Number(design.technician_capacity) * Number(h["DP"]) / missionFuelKg;
}

function computeMEEIndex(sc, design, params) {
  const muiDesign   = computeMEE(sc, design, params);
  const muiBaseline = computeMEE(sc, state.designs["BASE"], state.paramsByDesign["BASE"]);
  if (muiBaseline <= 0) return 0;
  return muiDesign / muiBaseline;
}

const C_STEEL=DATA.constants.C_STEEL, C_KW=DATA.constants.C_KW, C_GEN=DATA.constants.C_GEN,
      C_THR=DATA.constants.C_THR,     C_BAT_PER_KWH=DATA.constants.C_BAT_PER_KWH;

const DP_CLASS_CAPEX_FACTOR = { "1": 1.00, "2": 1.08, "3": 1.20 };

function computeCapex(design) {
  const P_installed = Number(design.total_generator_kw || 0);
  const E_bat       = design.battery_included ? Number(design.battery_capacity_kwh || 0) : 0;
  const capex_unscaled = C_STEEL*design.steel_weight_t
                       + C_KW*P_installed
                       + C_GEN*design.n_gensets
                       + C_THR*design.n_thrusters
                       + C_BAT_PER_KWH*E_bat;
  const f_dp = DP_CLASS_CAPEX_FACTOR[String(design.dp_class)] ?? 1.0;
  return capex_unscaled * f_dp;
}

const BASELINE_CAPEX = computeCapex(DATA.designs["BASE"]);
function computeCapexIndex(design) { return BASELINE_CAPEX / computeCapex(design); }

function computeCIO(sc, design, params) {
  const h  = hoursByMode(sc, design);
  const ef = emissionFactor(params.fuel_key);
  const SP = Number(design.gt_t);
  let cio = 0.0;
  for (const m of MODES) {
    const t_h = Number(h[m]);
    if (t_h <= 0) continue;
    if (m === "Port" && params.uses_shore_power) continue;
    const sfoc_kg = Number(params.sfoc_by_mode_g_per_kwh[m]) / 1000.0;
    const co2_t   = (Number(design.power[m]) * t_h * sfoc_kg * ef) / 1000.0;
    cio += co2_t / (SP * t_h);
  }
  return cio;
}

function isFeasible(design, contract, cio_value) {
  if (design.dp_class < contract.DP_class_req) return false;
  if ((design.technician_capacity ?? 0) < contract.technician_capacity_req) return false;
  const H_lim = calculateHLim(design);
  if (H_lim < contract.Hs_req) return false;
  if ((design.crane_capacity_t ?? 0) < contract.crane_capacity_req) return false;
  if (contract.gangway_req && !design.has_gangway) return false;
  if (design.draft_m > contract.draft_max) return false;
  if (contract.shore_power_req && !design.supports_shore_power) return false;
  if (contract.CIO_index_max !== null && contract.CIO_index_max !== undefined && cio_value !== undefined) {
    if (cio_value > contract.CIO_index_max) return false;
  }
  return true;
}

function computeFlexibility(sc, design, params) {
  const contracts = DATA.contracts;
  if (!contracts || contracts.length === 0) return 0;
  const cio = computeCIO(sc, design, params);
  const n_feasible = contracts.filter(c => isFeasible(design, c, cio)).length;
  return n_feasible / contracts.length;
}

function computeCFIndex(sc, design, params) {
  const F_design = computeFlexibility(sc, design, params);
  const F_base   = computeFlexibility(sc, state.designs["BASE"], state.paramsByDesign["BASE"]);
  if (F_base <= 0) return 0;
  return F_design / F_base;
}

// ─── Transit power helpers ───────────────────────────────────────────────────

function computeTransitPower(design) {
  // Mirrors design.py :: power_levels_kw["Transit"]
  // Transit = propulsion (from S/P-curve) + hotel/aux.
  // Hotel/aux is scaled from the transit hotel/aux ratio derived from the baseline vessel.
  const propulsion = Number(design.transit_propulsion_kw || TRANSIT_PROPULSION_KW_DEFAULT);
  const hotel      = Number(design.total_generator_kw || 0) * TRANSIT_HOTEL_FRACTION;
  return Math.round(propulsion + hotel);
}

function computeTransitHotel(design) {
  return Math.round(Number(design.total_generator_kw || 0) * TRANSIT_HOTEL_FRACTION);
}

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  scenario: Object.keys(DATA.scenarios)[0],
  selected: new Set(Object.keys(DATA.designs)),
  paramsByDesign: {},
  designs: JSON.parse(JSON.stringify(DATA.designs))
};

for (const dKey of Object.keys(DATA.designs)) {
  state.paramsByDesign[dKey] = {
    fuel_key: DATA.defaults.fuel_key,
    uses_shore_power: Boolean(DATA.designs[dKey].supports_shore_power),
    sfoc_by_mode_g_per_kwh: Object.fromEntries(
      MODES.map(m => [m, Number(DATA.defaults.sfoc_by_mode_g_per_kwh[m])])
    ),
  };
}
for (const dKey of LOCKED_DESIGNS) {
  if (!state.paramsByDesign[dKey]) continue;
  state.paramsByDesign[dKey] = {
    fuel_key: DATA.defaults.fuel_key,
    uses_shore_power: Boolean(DATA.designs[dKey].supports_shore_power),
    sfoc_by_mode_g_per_kwh: Object.fromEntries(
      MODES.map(m => [m, Number(DATA.defaults.baseline_sfoc_by_mode_g_per_kwh[m])])
    ),
  };
}

// ─── UI builders ─────────────────────────────────────────────────────────────

function buildTopControls() {
  const left = el("topbarLeft");
  left.innerHTML = "";
  const wrapper = mk("div");
  wrapper.style.cssText = "display:grid; grid-template-columns:1fr minmax(900px,900px); gap:12px; align-items:stretch; margin-bottom:6px;";
  const leftCol = mk("div");
  leftCol.style.cssText = "display:flex; flex-direction:column; justify-content:space-between; gap:0px; max-width:500px; min-height:170px;";
  const title = mk("h1"); title.textContent = "Design Evaluation"; leftCol.appendChild(title);
  const controls = mk("div", "controls");
  const sel = mk("select");
  for (const s of Object.keys(DATA.scenarios)) {
    const o = mk("option"); o.value = s; o.textContent = DATA.scenarios[s].name; sel.appendChild(o);
  }
  sel.value = state.scenario;
  sel.onchange = () => { state.scenario = sel.value; updateAllViews(); };
  controls.appendChild(sel);

  const list = mk("div", "design-choices");
  for (const d of Object.keys(DATA.designs)) {
    const cb = mk("input"); cb.type = "checkbox"; cb.checked = state.selected.has(d);
    cb.onchange = () => { cb.checked ? state.selected.add(d) : state.selected.delete(d); updateAllViews(); };
    list.appendChild(cb);
    const label = mk("span"); label.textContent = d; list.appendChild(label);
  }
  controls.appendChild(list);
  leftCol.appendChild(controls);
  const tabsDiv = mk("div", "tabs"); tabsDiv.id = "tabs"; tabsDiv.style.marginTop = "6px";
  leftCol.appendChild(tabsDiv);
  const stackCol = mk("div"); stackCol.id = "stackColContainer";
  stackCol.style.cssText = "border:1px solid #ccc; background:#fff; padding:8px 12px; box-sizing:border-box; margin-top:10px;";
  const stackTitle = mk("p"); stackTitle.style.cssText = "font-size:20px; font-weight:600; margin:0 0 5px 0; display:flex; align-items:center; gap:8px;";
  stackTitle.innerHTML = "Operational profile <span id='standbyInfoBtn' style='display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:11px;font-weight:700;cursor:pointer;line-height:1;flex-shrink:0;'>i</span>";
  const stackCanvas = document.createElement("canvas"); stackCanvas.id = "stackCanvas"; stackCanvas.style.cssText = "display:block; width:100%;";
  stackCol.appendChild(stackTitle); stackCol.appendChild(stackCanvas);
  wrapper.appendChild(leftCol); wrapper.appendChild(stackCol); left.appendChild(wrapper);
}

function buildTabs() {
  const tabs = document.getElementById("tabs"); tabs.innerHTML = "";
  function makeButton(label, tabId) {
    const b = document.createElement("button"); b.textContent = label; b.className = "tab-btn";
    b.onclick = () => { activate(tabId); document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active")); b.classList.add("active"); };
    tabs.appendChild(b);
  }
  makeButton("Dashboard", "tab_dashboard");
  for (const d of Object.keys(DATA.designs)) makeButton(d, "tab_" + d);
}

function activate(id) {
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  const x = el(id); if (x) x.classList.add("active");
  const stackCol = el("stackColContainer");
  if (stackCol) stackCol.style.display = (id === "tab_dashboard") ? "" : "none";
  if (id === "tab_dashboard") {
    renderDashboardOutputs();
    requestAnimationFrame(() => { renderStackedBar(); renderDotPlot(); renderSlopeChart(); });
  }
}

function buildDashboard() {
  const div = el("tab_dashboard"); div.innerHTML = "";
  const topRow = mk("div");
  topRow.style.cssText = "display:grid; grid-template-columns:1fr auto; gap:12px; align-items:start; margin-top:14px;";
  const tableWrap = mk("div"); tableWrap.style.cssText = "display:flex; flex-direction:column;";
  const table = mk("table");
  table.innerHTML = "<thead><tr><th>Design</th><th>OR Index [-]</th><th>ACIO Index [-]</th><th>MEE Index [-]</th><th>CAPEX Index [-]</th><th>CF [-]</th></tr></thead><tbody id='dashBody'></tbody>";
  tableWrap.appendChild(table);
  const legend = mk("div"); legend.id = "abbrevLegend";
  legend.style.cssText = "border:1px solid #ccc; background:#fff; padding:10px 14px; font-size:18px; line-height:2.0; white-space:nowrap;";
  legend.innerHTML = "<div style='font-weight:700; font-size:19px; margin-bottom:6px;'>Abbreviations</div>"
+ "<div style='display:flex; align-items:baseline; gap:6px;'><span style='background:#fff3e0; color:#b45309; font-size:12px; font-weight:700; padding:1px 5px; border-radius:3px; flex-shrink:0;'>IDX</span><span><b>OR</b> – Operational Robustness Index</span><span id='orInfoBtn' style='display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:#fde8c8;color:#b45309;font-size:11px;font-weight:700;cursor:pointer;margin-left:5px;line-height:1;flex-shrink:0;'>i</span></div>"
+ "<div style='display:flex; align-items:baseline; gap:6px;'><span style='background:#fff3e0; color:#b45309; font-size:12px; font-weight:700; padding:1px 5px; border-radius:3px; flex-shrink:0;'>IDX</span><span><b>ACIO</b> – Annual Carbon Intensity Offshore</span><span id='acioInfoBtn' style='display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:#fde8c8;color:#b45309;font-size:11px;font-weight:700;cursor:pointer;margin-left:5px;line-height:1;flex-shrink:0;'>i</span></div>"
+ "<div style='display:flex; align-items:baseline; gap:6px;'><span style='background:#fff3e0; color:#b45309; font-size:12px; font-weight:700; padding:1px 5px; border-radius:3px; flex-shrink:0;'>IDX</span><span><b>MEE</b> – Mission Energy Efficiency</span><span id='meeInfoBtn' style='display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:#fde8c8;color:#b45309;font-size:11px;font-weight:700;cursor:pointer;margin-left:5px;line-height:1;flex-shrink:0;'>i</span></div>"
+ "<div style='display:flex; align-items:baseline; gap:6px;'><span style='background:#fff3e0; color:#b45309; font-size:12px; font-weight:700; padding:1px 5px; border-radius:3px; flex-shrink:0;'>IDX</span><span><b>CAPEX</b> – Capital Expenditure</span><span id='capexInfoBtn' style='display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:#fde8c8;color:#b45309;font-size:11px;font-weight:700;cursor:pointer;margin-left:5px;line-height:1;flex-shrink:0;'>i</span></div>"
+ "<div style='display:flex; align-items:baseline; gap:6px;'><span style='background:#e8f0ff; color:#2d5cc7; font-size:12px; font-weight:700; padding:1px 5px; border-radius:3px; flex-shrink:0;'>ABS</span><span><b>CF</b> – Contract Flexibility</span><span id='cfInfoBtn' style='display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:11px;font-weight:700;cursor:pointer;margin-left:5px;line-height:1;flex-shrink:0;'>i</span></div>"
+ "<div style='margin-top:7px; padding-top:6px; border-top:1px solid #e0e0e0; font-size:15px; color:#888;'>ABS = absolute value [-] &nbsp;·&nbsp; IDX = index, BASE = 1.00</div>";
  topRow.appendChild(tableWrap); topRow.appendChild(legend); div.appendChild(topRow);

  const bottom = mk("div");
  bottom.style.cssText = "display:flex; flex-direction:column; gap:10px; margin-top:8px;";

  const dotWrap = mk("div");
  dotWrap.style.cssText = "background:#fff; border:1px solid #ccc; padding:10px 14px;";
  const dotTitle = mk("p");
  dotTitle.style.cssText = "font-size:20px; font-weight:600; color:#333; margin:0 0 6px 0;";
  dotTitle.textContent = "Index values";
  const dotCanvas = document.createElement("canvas");
  dotCanvas.id = "dotCanvas";
  dotCanvas.style.cssText = "display:block; width:100%; height:350px;";
  dotWrap.appendChild(dotTitle);
  dotWrap.appendChild(dotCanvas);

  const row2 = mk("div");
  row2.style.cssText = "display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; width:100%;";

  const slopeWrap = mk("div");
  slopeWrap.style.cssText = "background:#fff; border:1px solid #ccc; padding:10px 14px; width:100%; box-sizing:border-box; min-width:0;";
  const slopeTitleRow = mk("div");
  slopeTitleRow.style.cssText = "display:flex; align-items:center; gap:10px; margin-bottom:6px;";
  const slopeTitleLabel = mk("p");
  slopeTitleLabel.style.cssText = "font-size:20px; font-weight:600; color:#333; margin:0;";
  slopeTitleLabel.textContent = "Scenario A vs B:";
  const slopeKpiSel = document.createElement("select");
  slopeKpiSel.id = "slopeKpiSel";
  slopeKpiSel.style.cssText = "padding:4px 8px; border:1px solid #ccc; font-size:16px; width:auto;";
  ["OR", "ACIO", "MEE"].forEach(k => {
    const o = document.createElement("option"); o.value = k; o.textContent = k + " Index"; slopeKpiSel.appendChild(o);
  });
  slopeKpiSel.onchange = () => renderSlopeChart();
  slopeTitleRow.appendChild(slopeTitleLabel);
  slopeTitleRow.appendChild(slopeKpiSel);
  const slopeCanvas = document.createElement("canvas");
  slopeCanvas.id = "slopeCanvas";
  slopeCanvas.style.cssText = "display:block; width:100%; height:330px;";
  slopeWrap.appendChild(slopeTitleRow);
  slopeWrap.appendChild(slopeCanvas);

  row2.appendChild(dotWrap);
  row2.appendChild(slopeWrap);
  bottom.appendChild(row2);
  div.appendChild(bottom);
}

function buildDesignTabs() {
  const container = el("designTabs"); container.innerHTML = "";
  const fuelOptions = Object.keys(DATA.fuels).map(fKey => `<option value="${fKey}">${DATA.fuels[fKey].label || fKey}</option>`).join("");

  for (const dKey of Object.keys(DATA.designs)) {
    const design   = state.designs[dKey];
    const isLocked = LOCKED_DESIGNS.has(dKey);
    const div = mk("div", "tab-content"); div.id = "tab_" + dKey;

    // Build power rows — Transit gets special decomposition treatment
    const powerRowsHTML = MODES.map((m, i) => {
      if (m === "Transit") {
        return `
        <div class="form-row">
          <label>Power Transit [kW]
            <span id='powerInfoBtn_${dKey}' style='display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:10px;font-weight:700;cursor:pointer;margin-left:4px;line-height:1;flex-shrink:0;'>i</span>
          </label>
          <span id="power_display_transit_${dKey}" style="font-weight:600;color:#444;">—</span>
        </div>
        <div class="transit-sub form-row">
          <label style="font-size:16px;color:#666;">
            Propulsion [kW]
            <span id='transitPropInfoBtn_${dKey}' style='display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:9px;font-weight:700;cursor:pointer;margin-left:3px;line-height:1;flex-shrink:0;'>i</span>
          </label>
          <input type="number" id="transit_prop_${dKey}" value="${design.transit_propulsion_kw}" min="0" step="10" ${isLocked ? "disabled" : ""}/>
        </div>
        <div class="transit-sub form-row">
          <label style="font-size:16px;color:#666;">
            Hotel &amp; aux [kW]
            <span id='transitHotelInfoBtn_${dKey}' style='display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:9px;font-weight:700;cursor:pointer;margin-left:3px;line-height:1;flex-shrink:0;'>i</span>
          </label>
          <span id="transit_hotel_display_${dKey}" style="font-weight:600;color:#888;font-size:16px;">—</span>
        </div>`;
      }
      return `<div class="form-row">
        <label>Power ${m} [kW]
          <span id='powerModeInfoBtn_${m}_${dKey}' style='display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:10px;font-weight:700;cursor:pointer;margin-left:4px;line-height:1;flex-shrink:0;'>i</span>
        </label>
        <span id="power_display_${m.toLowerCase()}_${dKey}" style="font-weight:600;color:#444;">—</span>
      </div>`;
    }).join("");

    div.innerHTML = `
      <h2>${dKey}: <input type="text" id="name_${dKey}" value="${design.name}"
        style="font-size:26px;font-weight:600;border:none;background:transparent;border-bottom:1px solid #ccc;width:480px;"/></h2>
      <div style="margin-bottom:10px; font-size:19px; color:#444; display:flex; gap:24px; flex-wrap:wrap; padding:10px 14px; background:#fff; border:1px solid #ccc;">
        <span>OR Index: <b id="rob_${dKey}">—</b></span>
        <span>ACIO Index: <b id="acio_${dKey}">—</b></span>
        <span>MEE Index: <b id="mee_${dKey}">—</b></span>
        <span>CAPEX Index: <b id="capex_${dKey}">—</b></span>
        <span>CF: <b id="cf_${dKey}">—</b></span>
      </div>
      <div class="design-grid">
        <div class="box">
          <h3>Hull &amp; Geometry</h3>
          <div class="form-row"><label>DWT [t] <span id='dwtInfoBtn_${dKey}' style='display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:10px;font-weight:700;cursor:pointer;margin-left:4px;line-height:1;flex-shrink:0;'>i</span></label><input type="number" id="dwt_${dKey}" value="${design.dwt_t}" min="0"/></div>
          <div class="form-row"><label>GT [-]</label><input type="number" id="gt_${dKey}" value="${design.gt_t}" min="0"/></div>
          <div class="form-row"><label>Steel weight [t]</label><input type="number" id="steel_${dKey}" value="${design.steel_weight_t}" min="0"/></div>
          <div class="form-row"><label>LOA [m]</label><input type="number" id="loa_${dKey}" value="${design.loa_m.toFixed(1)}" min="0" step="0.1"/></div>
          <div class="form-row"><label>Beam [m]</label><input type="number" id="beam_${dKey}" value="${design.beam_m.toFixed(1)}" min="0" step="0.1"/></div>
          <div class="form-row"><label>Draft [m]</label><input type="number" id="draft_${dKey}" value="${design.draft_m.toFixed(2)}" min="0" step="0.01"/></div>
        </div>
        <div class="box">
          <h3>Propulsion, Power &amp; DP</h3>
          <div class="form-row"><label>Generators</label><input type="number" id="gen_${dKey}" value="${design.n_gensets}" min="0"/></div>
          <div class="form-row"><label>Thrusters</label><input type="number" id="thr_${dKey}" value="${design.n_thrusters}" min="0"/></div>
          <div class="form-row"><label>DP class</label><input type="number" id="dp_${dKey}" value="${design.dp_class}" min="1" max="3" step="1"/></div>
          <div class="form-row"><label>Generator capacity [kW]</label><input type="number" id="gen_kw_${dKey}" value="${design.total_generator_kw}" min="0"/></div>
          <div class="form-row">
            <label>DP available [kW] (×0.65)
              <span id='dpAvailInfoBtn_${dKey}' style='display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:10px;font-weight:700;cursor:pointer;margin-left:4px;line-height:1;flex-shrink:0;'>i</span>
            </label>
            <span id="dp_avail_display_${dKey}" style="font-weight:600;color:#444;">—</span>
          </div>
          <div class="form-row">
            <label>DP Hs limit [m]
              <span id='hlimInfoBtn_${dKey}' style='display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:10px;font-weight:700;cursor:pointer;margin-left:4px;line-height:1;flex-shrink:0;'>i</span>
            </label>
            <input type="number" id="hlim_${dKey}" value="${Number(design.h_lim_dp || DATA.defaults.h_lim_dp || 2.5).toFixed(1)}" min="0" step="0.1" ${isLocked ? "disabled" : ""}/>
          </div>
          <div class="battery-row">
            <label>Battery</label>
            <div class="battery-controls">
              <input type="checkbox" id="bat_${dKey}" ${design.battery_included ? "checked" : ""}/>
              <input type="number" id="bat_kwh_${dKey}" value="${design.battery_capacity_kwh ?? 0}" min="0" step="50"/>
              <span style="color:#666; font-size:14px;">kWh</span>
            </div>
          </div>
          ${powerRowsHTML}
        </div>
        <div class="box">
          <h3>Fuel, Emissions &amp; Crew</h3>
          <div class="form-row"><label>Fuel</label><select class="fuel-select" id="fuel_${dKey}">${fuelOptions}</select></div>
          ${MODES.map(m => `<div class="form-row"><label>SFOC ${m} [g/kWh]</label><input type="number" id="sfoc_${m.toLowerCase()}_${dKey}" min="0" step="1"/></div>`).join("")}
          <div class="form-row"><label>Technician capacity</label><input type="number" id="technician_capacity_${dKey}" value="${design.technician_capacity}" min="0" step="1"/></div>
          <div class="form-row"><label>CIO [tCO&#x2082;/GT·h] <span id='cioInfoBtn_${dKey}' style='display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#c8d8f0;color:#2d5cc7;font-size:10px;font-weight:700;cursor:pointer;margin-left:4px;line-height:1;flex-shrink:0;'>i</span></label><span id="cio_display_${dKey}" style="font-weight:600;color:#444;">—</span></div>
        </div>
        <div class="box">
          <h3>Mission Equipment</h3>
          <div class="form-row"><label>Crane capacity [t]</label><input type="number" id="crane_${dKey}" value="${design.crane_capacity_t ?? 0}" min="0" step="1"/></div>
          <div class="form-row-inline"><label>Gangway (W2W)</label><input type="checkbox" id="gangway_${dKey}" ${design.has_gangway ? "checked" : ""}/></div>
          <div class="form-row-inline"><label>Shore power in port</label><input type="checkbox" id="shore_${dKey}" ${design.supports_shore_power ? "checked" : ""}/></div>
        </div>
      </div>`;

    container.appendChild(div);

    const p = state.paramsByDesign[dKey];
    const d = state.designs[dKey];

    // SFOC inputs
    for (const m of MODES) {
      const inp = div.querySelector(`#sfoc_${m.toLowerCase()}_${dKey}`);
      inp.value = p.sfoc_by_mode_g_per_kwh[m]; inp.disabled = isLocked;
      const sfocHandler = () => {
        if (isLocked) return;
        const v = Number(inp.value);
        if (!Number.isNaN(v) && v >= 0) { p.sfoc_by_mode_g_per_kwh[m] = v; updateAllViews(); }
      };
      inp.addEventListener("input", sfocHandler);
      inp.addEventListener("change", sfocHandler);
    }

    // Name
    const nameInput = div.querySelector(`#name_${dKey}`);
    nameInput.disabled = isLocked;
    nameInput.addEventListener("input", () => { if (!isLocked) { d.name = nameInput.value; updateAllViews(); } });

    // Numeric bindings
    const bindNum = (inputId, field) => {
      const inp = div.querySelector(`#${inputId}_${dKey}`);
      if (!inp) return;
      inp.disabled = isLocked;
      const handler = () => {
        if (isLocked) return;
        const v = Number(String(inp.value).replace(",", "."));
        if (!Number.isNaN(v) && v >= 0) { d[field] = v; updateAllViews(); }
      };
      inp.addEventListener("input", handler);
      inp.addEventListener("change", handler);
    };
    bindNum("dwt",   "dwt_t");
    bindNum("gt",    "gt_t");
    bindNum("dp",    "dp_class");
    bindNum("steel", "steel_weight_t");
    bindNum("gen",   "n_gensets");
    bindNum("thr",   "n_thrusters");
    bindNum("technician_capacity", "technician_capacity");
    bindNum("gen_kw", "total_generator_kw");
    bindNum("hlim", "h_lim_dp");
    bindNum("crane", "crane_capacity_t");
    bindNum("loa",   "loa_m");
    bindNum("beam",  "beam_m");
    bindNum("draft", "draft_m");

    // Transit propulsion input — redigerbar for ikke-låste design
    if (!isLocked) {
      const transitPropInp = div.querySelector(`#transit_prop_${dKey}`);
      if (transitPropInp) {
        const handler = () => {
          const v = Number(transitPropInp.value);
          if (!Number.isNaN(v) && v >= 0) { d.transit_propulsion_kw = v; updateAllViews(); }
        };
        transitPropInp.addEventListener("input", handler);
        transitPropInp.addEventListener("change", handler);
      }
    }

    const gangwayCb = div.querySelector(`#gangway_${dKey}`);
    gangwayCb.disabled = isLocked;
    gangwayCb.addEventListener("change", () => { if (!isLocked) { d.has_gangway = gangwayCb.checked; updateAllViews(); } });

    const bat = div.querySelector(`#bat_${dKey}`);
    bat.disabled = isLocked; bat.checked = d.battery_included;
    bat.addEventListener("change", () => { if (!isLocked) { d.battery_included = bat.checked; updateAllViews(); } });

    const batKwh = div.querySelector(`#bat_kwh_${dKey}`);
    batKwh.disabled = isLocked;
    batKwh.value = d.battery_capacity_kwh ?? 0;
    batKwh.addEventListener("input", () => {
      if (isLocked) return;
      const v = Number(batKwh.value);
      d.battery_capacity_kwh = Number.isFinite(v) && v >= 0 ? v : 0;
      updateAllViews();
    });

    const shoreCb = div.querySelector(`#shore_${dKey}`);
    shoreCb.disabled = isLocked;
    shoreCb.checked = d.supports_shore_power;
    let batBeforeShore = d.battery_included;
    shoreCb.addEventListener("change", () => {
      if (isLocked) return;
      d.supports_shore_power = shoreCb.checked;
      p.uses_shore_power     = shoreCb.checked;
      if (shoreCb.checked) {
        batBeforeShore = d.battery_included;
        d.battery_included = true;
        bat.checked = true;
        bat.disabled = true;
      } else {
        d.battery_included = batBeforeShore;
        bat.checked = batBeforeShore;
        bat.disabled = false;
      }
      updateAllViews();
    });
    if (d.supports_shore_power && !isLocked) {
      bat.checked = true;
      bat.disabled = true;
    }

    const fuelSel = div.querySelector(`#fuel_${dKey}`);
    fuelSel.value = p.fuel_key; fuelSel.disabled = isLocked;
    fuelSel.addEventListener("change", () => { if (!isLocked) { p.fuel_key = fuelSel.value; updateAllViews(); } });

    // Info buttons
    const designInfoDefs = [
      {
        id: `dwtInfoBtn_${dKey}`,
        title: "DWT [t]",
        text: "Deadweight tonnage. Shown here only to give a sense of the vessel size. It does not feed into any KPI or index calculation and changing it does not affect any computed values."
      },
      {
        id: `dpAvailInfoBtn_${dKey}`,
        title: "DP Available Power",
        text: "65% of generator capacity used as a DP power proxy in the technical robustness score. It is not a verified DP capability calculation."
      },
      {
        id: `powerInfoBtn_${dKey}`,
        title: "Power Transit [kW]",
        text: "Total transit power demand = propulsion + hotel/aux. Set the propulsion component below."
      },
      {
        id: `transitPropInfoBtn_${dKey}`,
        title: "Transit Propulsion Power",
        text: "Propulsion power at service speed, derived from the design-specific S/P-curve. Enter the value from the S/P-curve at the intended service speed. Default: 1 314 kW, calibrated against baseline vessel sensor data at 10 knots."
      },
      {
        id: `transitHotelInfoBtn_${dKey}`,
        title: "Transit Hotel and Auxiliary Power",
        text: "Non-propulsion transit load covering HVAC, lighting and auxiliary systems. Calculated automatically as a fixed fraction of generator capacity (7.5%), calibrated against baseline vessel at design speed."
      },
      ...[
        { mode:"DP",      basis:"861 / 5560 = 15.5%", note:"Representative station-keeping load, not maximum thrust capacity. Maximum DP capacity is shown separately above." },
        { mode:"Standby", basis:"570 / 5560 = 10.3%", note:"Operating load during periods when wave conditions exceed the vessel's operational limit. Lower than DP since thrusters are mostly idle." },
        { mode:"Port",    basis:"258 / 5560 = 4.6%",  note:"Hotel and auxiliary load only, no propulsion. Excluded from emission calculations when shore power is enabled." },
      ].map(cfg => ({
        id: `powerModeInfoBtn_${cfg.mode}_${dKey}`,
        title: `Power ${cfg.mode} [kW]`,
        text: `Power ${cfg.mode} = fixed share of total generator capacity (${cfg.basis}). Separate from transit propulsion and hotel/aux. ${cfg.note}`
      })),
      {
        id: `hlimInfoBtn_${dKey}`,
        title: "DP Hs Limit",
        text: "Design-specific limiting significant wave height for the reference DP operation. Default is 2.5 m based on VARD input. Changing this value affects environmental operability, operational profile, contract flexibility and OR."
      },
      {
        id: `cioInfoBtn_${dKey}`,
        title: "Carbon Intensity Offshore (CIO)",
        text: "Emission intensity per unit vessel size and operating hour. Used as a contract constraint in the flexibility model. Green contracts specify a maximum CIO threshold, so a lower value improves contract flexibility."
      },
    ];
    for (const def of designInfoDefs) {
      const btn = div.querySelector(`#${def.id}`);
      if (!btn) continue;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const existing = document.getElementById("kpiTooltip");
        if (existing) {
          const alreadyOpen = existing.style.display !== "none" && existing.dataset.source === def.id;
          existing.style.display = "none";
          if (alreadyOpen) return;
          existing.dataset.source = def.id;
          existing.innerHTML = `<div style='font-weight:700;font-size:16px;margin-bottom:6px;color:#2d5cc7;'>${def.title}</div><p style='margin:0;'>${def.text}</p>`;
          existing.style.display = "block";
          const rect = btn.getBoundingClientRect();
          const tipW = 320, tipH = existing.offsetHeight || 100;
          let left = rect.right + 8;
          if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 8;
          let top = rect.top - 10;
          if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
          existing.style.left = left + "px";
          existing.style.top = Math.max(8, top) + "px";
        }
      });
    }
  }
}

// ─── Render functions ─────────────────────────────────────────────────────────

function renderDashboardOutputs() {
  const dashBody = el("dashBody"); if (!dashBody) return;
  const sc = DATA.scenarios[state.scenario]; dashBody.innerHTML = "";
  const selectedKeys = Object.keys(DATA.designs).filter(k => state.selected.has(k));
  const rows = selectedKeys.map(dKey => {
    const d = state.designs[dKey], p = state.paramsByDesign[dKey];
    return { dKey, capexIndex: computeCapexIndex(d), rob: computeRobustnessIndex(d,sc), acio: computeACIOIndex(sc,d,p), mee: computeMEEIndex(sc,d,p), cf: computeFlexibility(sc,d,p) };
  });
  function cellColour(value, allValues) {
    const max=Math.max(...allValues), min=Math.min(...allValues);
    if (max===min) return "";
    if (value===max) return "background:#c8f5c8;";
    if (value===min) return "background:#f5c8c8;";
    return "";
  }
  const nr = rows.filter(r => r.dKey !== "BASE");
  for (const row of rows) {
    const tr = mk("tr"); if (row.dKey==="BASE") tr.className = "base-row";
    const colour = DESIGN_COLOURS[row.dKey] || "#444";
    const nameStyle = row.dKey==="BASE" ? "" : `background:${colour};color:#fff;font-weight:700;`;
    tr.innerHTML = `<th style="${nameStyle}">${row.dKey}</th>`
      + `<td style="${cellColour(row.rob,        nr.map(r=>r.rob))}">${row.rob.toFixed(2)}</td>`
      + `<td style="${cellColour(row.acio,       nr.map(r=>r.acio))}">${row.acio.toFixed(2)}</td>`
      + `<td style="${cellColour(row.mee,        nr.map(r=>r.mee))}">${row.mee.toFixed(2)}</td>`
      + `<td style="${cellColour(row.capexIndex, nr.map(r=>r.capexIndex))}">${row.capexIndex.toFixed(2)}</td>`
      + `<td style="${cellColour(row.cf,         nr.map(r=>r.cf))}">${row.cf.toFixed(2)}</td>`;
    dashBody.appendChild(tr);
  }
}

function renderDesignTab(dKey) {
  const sc=DATA.scenarios[state.scenario], d=state.designs[dKey], p=state.paramsByDesign[dKey];
  const isLocked = LOCKED_DESIGNS.has(dKey);

  // Keep dp_capacity_kw in sync
  d.dp_capacity_kw = dpCapacityKw(d);

  // Recompute power levels:
  // Transit = transit_propulsion_kw + hotel_fraction × generator
  // DP, Standby, Port = fixed fractions of generator
  if (d.total_generator_kw) {
    d.power["Transit"] = computeTransitPower(d);
    for (const m of ["DP", "Standby", "Port"]) {
      d.power[m] = Math.round(Number(d.total_generator_kw) * (POWER_FRACTIONS[m] || 0));
    }
  }

  // Update power display spans
  for (const m of MODES) {
    const span = el(`power_display_${m.toLowerCase()}_${dKey}`);
    if (span) span.textContent = (d.power[m] || 0).toFixed(0) + " kW";
  }

  // Transit decomposition displays
  const hotelEl = el(`transit_hotel_display_${dKey}`);
  if (hotelEl) {
    hotelEl.textContent = computeTransitHotel(d).toFixed(0) + " kW";
  }
  // Keep locked baseline propulsion input shown as a disabled input field.
  if (isLocked) {
    const propInput = el(`transit_prop_${dKey}`);
    if (propInput) {
      propInput.value = (Number(d.transit_propulsion_kw) || TRANSIT_PROPULSION_KW_DEFAULT).toFixed(0);
    }
  }

  const dpAvailEl = el(`dp_avail_display_${dKey}`);
  if (dpAvailEl) dpAvailEl.textContent = d.dp_capacity_kw > 0 ? d.dp_capacity_kw.toFixed(0) + " kW" : "—";

  const set = (id, val) => { const e=el(id); if(e) e.textContent=val; };
  set(`capex_${dKey}`, computeCapexIndex(d).toFixed(2));
  set(`rob_${dKey}`,   computeRobustnessIndex(d,sc).toFixed(2));
  set(`acio_${dKey}`,  computeACIOIndex(sc,d,p).toFixed(2));
  set(`mee_${dKey}`,   computeMEEIndex(sc,d,p).toFixed(2));
  set(`cf_${dKey}`,    computeFlexibility(sc,d,p).toFixed(2));
  const cio = computeCIO(sc, d, p);
  set(`cio_display_${dKey}`, cio.toFixed(6));
}

function renderAllDesignTabs() {
  for (const dKey of Object.keys(DATA.designs)) renderDesignTab(dKey);
}

// ─── Slope chart ─────────────────────────────────────────────────────────────

function renderSlopeChart() {
  const canvas = el("slopeCanvas"); if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(canvas.parentElement.offsetWidth || 600, 300) - 28, H = 330;
  canvas.style.width=W+"px"; canvas.style.height=H+"px"; canvas.width=W*dpr; canvas.height=H*dpr;
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  const scKeys = Object.keys(DATA.scenarios);
  if (scKeys.length < 2) { ctx.fillStyle="#999"; ctx.font="21px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("Need at least 2 scenarios",W/2,H/2); return; }
  const kpiSel = el("slopeKpiSel"), kpi = kpiSel ? kpiSel.value : "ACIO";
  function getKpiVal(scKey, dKey) {
    const sc=DATA.scenarios[scKey], d=state.designs[dKey], p=state.paramsByDesign[dKey];
    switch(kpi) {
      case "ACIO": return computeACIOIndex(sc,d,p);
      case "MEE":  return computeMEEIndex(sc,d,p);
      case "OR":   return computeRobustnessIndex(d,sc);
      default:     return 1;
    }
  }
  const selectedKeys = Object.keys(DATA.designs).filter(k => state.selected.has(k));
  if (!selectedKeys.length) return;
  const groups = selectedKeys.map(dKey => ({ key:dKey, valA:getKpiVal(scKeys[0],dKey), valB:getKpiVal(scKeys[1],dKey) }));
  const scaleVals = groups.flatMap(g=>[g.valA,g.valB,1.0]);
  const dataMin=Math.min(...scaleVals), dataMax=Math.max(...scaleVals);
  const spread=Math.max(dataMax-dataMin,0.02), pad=spread*0.25;
  const yMin=dataMin-pad, yMax=dataMax+pad;
  const padL=110,padR=110,padT=46,padB=52, plotW=W-padL-padR, plotH=H-padT-padB;
  const xA=padL, xB=padL+plotW;
  function valToY(v) { return padT+plotH*(1-(v-yMin)/(yMax-yMin)); }
  for (let i=0;i<=5;i++) {
    const v=yMin+(yMax-yMin)*(i/5), y=valToY(v);
    ctx.strokeStyle="#ececec"; ctx.lineWidth=0.8; ctx.beginPath(); ctx.moveTo(xA,y); ctx.lineTo(xB,y); ctx.stroke();
    ctx.fillStyle="#bbb"; ctx.font="17px Arial"; ctx.textAlign="right"; ctx.textBaseline="middle";
    ctx.fillText(v.toFixed(2),xA-6,y);
  }
  [xA,xB].forEach((x,i) => {
    ctx.strokeStyle="#ccc"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(x,padT); ctx.lineTo(x,padT+plotH); ctx.stroke();
    ctx.fillStyle="#333"; ctx.font="bold 19px Arial"; ctx.textAlign=i===0?"left":"right"; ctx.textBaseline="bottom";
    ctx.fillText(i===0?"Scenario A":"Scenario B", x+(i===0?4:-4), padT-22);
    ctx.fillStyle="#888"; ctx.font="16px Arial";
    ctx.fillText(DATA.scenarios[scKeys[i]].name.replace(/Scenario [AB]: /,""), x+(i===0?4:-4), padT-4);
  });
  if (1.0>=yMin && 1.0<=yMax) {
    const baseY=valToY(1.0); ctx.strokeStyle="#bbb"; ctx.lineWidth=1; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(xA,baseY); ctx.lineTo(xB,baseY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle="#bbb"; ctx.font="17px Arial"; ctx.textAlign="right"; ctx.textBaseline="middle";
    ctx.fillText("BASE 1.000",xA-6,baseY);
  }
  const drawOrder = groups.filter(g=>g.key!=="BASE");
  function nudgeLabels(positions) {
    const minGap=22;
    const sorted=positions.map((p,i)=>({orig:p,i})).sort((a,b)=>a.orig-b.orig);
    const out=sorted.map(s=>s.orig);
    for (let iter=0;iter<40;iter++) {
      let moved=false;
      for (let i=1;i<out.length;i++) { if(out[i]-out[i-1]<minGap) { const push=(minGap-(out[i]-out[i-1]))/2; out[i-1]-=push; out[i]+=push; moved=true; } }
      if(!moved) break;
    }
    const result=new Array(positions.length); sorted.forEach((s,si)=>{result[s.i]=out[si];});
    return result;
  }
  const baseY = (1.0>=yMin && 1.0<=yMax) ? valToY(1.0) : null;
  function nudgeWithBase(positions, baseY) {
    if (baseY===null) return nudgeLabels(positions);
    const withBase=[...positions, baseY];
    const nudged=nudgeLabels(withBase);
    return nudged.slice(0, positions.length);
  }
  const nudgedYA=nudgeWithBase(drawOrder.map(g=>valToY(g.valA)), baseY);
  const nudgedYB=nudgeWithBase(drawOrder.map(g=>valToY(g.valB)), baseY);
  drawOrder.forEach(g => {
    const colour=DESIGN_COLOURS[g.key]||"#888";
    ctx.beginPath(); ctx.moveTo(xA,valToY(g.valA)); ctx.lineTo(xB,valToY(g.valB));
    ctx.strokeStyle=colour; ctx.lineWidth=2.8; ctx.stroke();
    [{x:xA,y:valToY(g.valA)},{x:xB,y:valToY(g.valB)}].forEach(pt => {
      ctx.beginPath(); ctx.arc(pt.x,pt.y,6,0,2*Math.PI); ctx.fillStyle=colour; ctx.fill();
      ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.stroke();
    });
  });
  ctx.font="bold 19px Arial";
  drawOrder.forEach((g,i) => {
    const colour=DESIGN_COLOURS[g.key]||"#888"; ctx.fillStyle=colour;
    ctx.textAlign="right"; ctx.textBaseline="middle"; ctx.fillText(`${g.key}  ${g.valA.toFixed(2)}`,xA-6,nudgedYA[i]);
    ctx.textAlign="left"; ctx.fillText(`${g.valB.toFixed(2)}  ${g.key}`,xB+6,nudgedYB[i]);
  });
  let lx=padL; const legendY=H-20; ctx.font="19px Arial"; ctx.textBaseline="middle";
  selectedKeys.filter(k=>k!=="BASE").forEach(dKey => {
    const colour=DESIGN_COLOURS[dKey]||"#888"; ctx.fillStyle=colour; ctx.fillRect(lx,legendY-5,14,10);
    ctx.fillStyle="#333"; ctx.textAlign="left"; ctx.fillText(dKey,lx+18,legendY); lx+=46;
  });
  ctx.fillStyle="#aaa"; ctx.font="17px Arial"; ctx.textAlign="left"; ctx.fillText("BASE = 1.000 (reference)",lx+8,legendY);
}

// ─── Dot plot ─────────────────────────────────────────────────────────────────

function renderDotPlot() {
  const canvas = el("dotCanvas"); if (!canvas) return;
  const dpr=window.devicePixelRatio||1;
  const W=Math.max(canvas.parentElement.offsetWidth||600,320)-28, H=350;
  canvas.style.width=W+"px"; canvas.style.height=H+"px"; canvas.width=W*dpr; canvas.height=H*dpr;
  const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  const sc=DATA.scenarios[state.scenario], kpis=["OR","ACIO","MEE","CAPEX","CF"];
  const selectedKeys=Object.keys(DATA.designs).filter(k=>state.selected.has(k));
  if (!selectedKeys.length) return;
  const series=selectedKeys.map(dKey => {
    const d=state.designs[dKey], p=state.paramsByDesign[dKey];
    return { key:dKey, vals:[computeRobustnessIndex(d,sc),computeACIOIndex(sc,d,p),computeMEEIndex(sc,d,p),computeCapexIndex(d),computeCFIndex(sc,d,p)] };
  });
  const allVals=series.flatMap(s=>s.vals);
  const dataMin=Math.min(...allVals), dataMax=Math.max(...allVals);
  const pad=Math.max((dataMax-dataMin)*0.18,0.06);
  const axisMin=Math.max(0,dataMin-pad), axisMax=dataMax+pad;
  const padL=90,padR=16,padT=16,padB=52, plotW=W-padL-padR, plotH=H-padT-padB;
  const rowH=plotH/kpis.length, dotR=7;
  function valToX(v) { return padL+((v-axisMin)/(axisMax-axisMin))*plotW; }
  kpis.forEach((_,ki) => { ctx.fillStyle=ki%2===0?"#fafafa":"#f3f4f6"; ctx.fillRect(padL,padT+ki*rowH,plotW,rowH); });
  const baseX=valToX(1.0);
  ctx.strokeStyle="#888"; ctx.lineWidth=1.5; ctx.setLineDash([5,4]);
  ctx.beginPath(); ctx.moveTo(baseX,padT); ctx.lineTo(baseX,padT+plotH); ctx.stroke(); ctx.setLineDash([]);
  const tickStep=(axisMax-axisMin)<=0.6?0.1:0.2;
  const tickStart=Math.ceil(axisMin/tickStep)*tickStep;
  const tickXs=[];
  ctx.font="18px Arial"; ctx.fillStyle="#aaa"; ctx.textAlign="center";
  for (let t=tickStart;t<=axisMax+0.001;t=Math.round((t+tickStep)*100)/100) {
    const x=valToX(t); tickXs.push({x,label:t.toFixed(2)}); ctx.strokeStyle="#e8e8e8"; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(x,padT); ctx.lineTo(x,padT+plotH); ctx.stroke();
    if (Math.abs(x-baseX)>22) ctx.fillText(t.toFixed(2),x,padT+plotH+4);
  }
  ctx.fillStyle="#777"; ctx.font="bold 18px Arial"; ctx.textAlign="center"; ctx.textBaseline="top";
  ctx.fillText("BASE",baseX,padT+plotH+26);
  kpis.forEach((kpi,ki) => {
    const cy=padT+ki*rowH+rowH/2;
    ctx.fillStyle="#222"; ctx.font="bold 20px Arial"; ctx.textAlign="right"; ctx.textBaseline="middle";
    ctx.fillText(kpi,padL-8,cy);
    if (ki>0) { ctx.strokeStyle="#e0e0e0"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(padL,padT+ki*rowH); ctx.lineTo(W-padR,padT+ki*rowH); ctx.stroke(); }
    const rowSeries=series.map(s=>({key:s.key,val:s.vals[ki]})).sort((a,b)=>a.val-b.val);
    rowSeries.forEach((s,rank) => {
      const colour=DESIGN_COLOURS[s.key]||"#888", x=valToX(s.val), isBase=s.key==="BASE";
      if (!isBase) { ctx.strokeStyle=colour+"55"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(baseX,cy); ctx.lineTo(x,cy); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x,cy,isBase?dotR-1:dotR,0,2*Math.PI); ctx.fillStyle=colour; ctx.fill();
      ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.stroke();
      const above=rank%2===0;
      ctx.font=isBase?"bold 18px Arial":"18px Arial"; ctx.fillStyle=colour; ctx.textAlign="center";
      ctx.textBaseline=above?"bottom":"top";
      ctx.fillText(s.val.toFixed(2),x,cy+(above?-(dotR+5):(dotR+5)));
    });
  });
  let lx=8; const legendY=H-18; ctx.font="19px Arial"; ctx.textBaseline="middle";
  const legendOrder = [...selectedKeys.filter(k=>k!=="BASE"), ...selectedKeys.filter(k=>k==="BASE")];
  legendOrder.forEach(dKey => {
    const colour=DESIGN_COLOURS[dKey]||"#888"; ctx.beginPath(); ctx.arc(lx+6,legendY,5,0,2*Math.PI);
    ctx.fillStyle=colour; ctx.fill(); ctx.strokeStyle="#fff"; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle="#333"; ctx.textAlign="left"; ctx.fillText(dKey,lx+14,legendY); lx+=42;
  });
}

// ─── Stacked bar ─────────────────────────────────────────────────────────────

function renderStackedBar() {
  const canvas=el("stackCanvas"); if (!canvas) return;
  const sc=DATA.scenarios[state.scenario];
  const selectedKeys=Object.keys(DATA.designs).filter(k=>state.selected.has(k));
  if (!selectedKeys.length) return;
  const dpr=window.devicePixelRatio||1;
  const W=Math.max(canvas.parentElement.offsetWidth||700,200)-24;
  const rowH=20,gap=3,padL=52,padR=6,padT=4,padB=18;
  const H=padT+selectedKeys.length*(rowH+gap)-gap+padB+4;
  canvas.style.width=W+"px"; canvas.style.height=H+"px"; canvas.width=W*dpr; canvas.height=H*dpr;
  const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  const barW=W-padL-padR, total=sc.total_hours;
  const MODE_COLOURS={Transit:"#456c9d",DP:"#548e62",Port:"#cbbe93",Standby:"#959a9d"};
  const modeOrder=["Transit","DP","Port","Standby"];
  selectedKeys.forEach((dKey,ri) => {
    const design=state.designs[dKey], h=hoursByMode(sc,design), y=padT+ri*(rowH+gap);
    const colour=DESIGN_COLOURS[dKey]||"#444"; ctx.fillStyle=colour; ctx.font="bold 18px Arial";
    ctx.textAlign="right"; ctx.textBaseline="middle"; ctx.fillText(dKey,padL-4,y+rowH/2);
    let xCursor=padL;
    modeOrder.forEach(mode => {
      const hrs=h[mode]||0, frac=hrs/total, segW=frac*barW;
      if (segW<1) return;
      ctx.fillStyle=MODE_COLOURS[mode]; ctx.fillRect(xCursor,y,segW,rowH);
      if (segW>24) {
        ctx.fillStyle="#fff"; ctx.font="bold 17px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(Math.round(frac*100)+"%",xCursor+segW/2,y+rowH/2);
      }
      xCursor+=segW;
    });
    ctx.strokeStyle="#ccc"; ctx.lineWidth=0.5; ctx.strokeRect(padL,y,barW,rowH);
  });
  let lx=padL; const legendY=H-padB/2+2; ctx.font="17px Arial"; ctx.textBaseline="middle";
  modeOrder.forEach(mode => {
    ctx.fillStyle=MODE_COLOURS[mode]; ctx.fillRect(lx,legendY-4,9,9);
    ctx.fillStyle="#333"; ctx.textAlign="left"; ctx.fillText(mode,lx+12,legendY);
    lx+=ctx.measureText(mode).width+20;
  });
}

// ─── Master update ────────────────────────────────────────────────────────────

function updateAllViews() {
  renderDashboardOutputs();
  renderAllDesignTabs();
  if (el("tab_dashboard").classList.contains("active")) {
    requestAnimationFrame(() => { renderStackedBar(); renderDotPlot(); renderSlopeChart(); });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

buildTopControls();
buildTabs();
buildDashboard();
buildDesignTabs();
activate("tab_dashboard");
document.querySelector(".tab-btn")?.classList.add("active");
updateAllViews();

// ─── Tooltips ────────────────────────────────────────────────────────────────
(function() {
  const TOOLTIPS = {
    orInfoBtn:      "Operational Robustness Index combines environmental operability and technical robustness relative to the baseline vessel. Environmental operability uses a design-specific DP Hs limit, default 2.5 m from VARD input. Technical robustness is based on DP class, redundancy and DP power proxy.",
    acioInfoBtn:    "Annual CO2 emission intensity normalised by vessel size. Driven by fuel type, installed power and the assumed operating profile.",
    meeInfoBtn:     "Operative technician-hours delivered at the installation per kg of fuel consumed in DP and transit. Captures how efficiently mission energy translates into functional output.",
    capexInfoBtn:   "Capital cost relative to baseline. A value below 1.00 indicates a lower-cost design. Driven by structural weight, installed power, system configuration and DP class.",
    cfInfoBtn:      "Fraction of a synthetic contract set this design can satisfy. Reflects commercial reach across the SOV/CSOV market segment.",
    standbyInfoBtn: "Nominal DP hours are reduced by the Weibull exceedance fraction P(Hs > H_lim). These hours are reallocated to standby. H_lim is a design-specific DP criterion, default 2.5 m from VARD input, and can be adjusted on each design page.",
  };
  const TITLES = {
    orInfoBtn:       "Operational Robustness (OR)",
    acioInfoBtn:     "Annual Carbon Intensity Offshore (ACIO)",
    meeInfoBtn:      "Mission Energy Efficiency (MEE)",
    capexInfoBtn:    "Capital Expenditure (CAPEX)",
    cfInfoBtn:       "Contract Flexibility (CF)",
    standbyInfoBtn:  "Operational Profile",
  };

  const tooltip = document.createElement("div");
  tooltip.id = "kpiTooltip";
  tooltip.style.cssText = "display:none;position:fixed;z-index:9999;max-width:320px;background:#fff;border:1px solid #b0c4de;border-radius:6px;padding:13px 15px;font-size:15px;line-height:1.6;color:#333;box-shadow:0 4px 16px rgba(0,0,0,0.13);";
  document.body.appendChild(tooltip);

  let hideTimer;
  function showTooltip(btn, id) {
    clearTimeout(hideTimer);
    tooltip.innerHTML = `<div style='font-weight:700;font-size:16px;margin-bottom:6px;color:#2d5cc7;'>${TITLES[id]}</div><p style='margin:0;'>${TOOLTIPS[id]}</p>`;
    tooltip.style.display = "block";
    const rect = btn.getBoundingClientRect();
    const tipW = 320, tipH = tooltip.offsetHeight || 100;
    let left = rect.right + 8;
    if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 8;
    let top = rect.top - 10;
    if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
    tooltip.style.left = left + "px";
    tooltip.style.top = Math.max(8, top) + "px";
  }
  function hideTooltip() { hideTimer = setTimeout(() => { tooltip.style.display = "none"; }, 120); }

  document.addEventListener("click", function(e) {
    let handled = false;
    for (const id of Object.keys(TOOLTIPS)) {
      const btn = document.getElementById(id);
      if (btn && btn.contains(e.target)) {
        tooltip.style.display === "none" ? showTooltip(btn, id) : (tooltip.style.display = "none");
        handled = true;
        break;
      }
    }
    if (!handled && !tooltip.contains(e.target)) tooltip.style.display = "none";
  });
  tooltip.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  tooltip.addEventListener("mouseleave", hideTooltip);
})();
