# SmartHull experimental visualization

Static website updated to the 20 October 2026 Phase 1 report. Open `index.html` or serve this directory with any static server; there are no external JavaScript dependencies.

## Experiences

- Replay unloaded, bent and released summaries from five separate-channel plate trials, four historical single-channel plate trials and three direct-fiber bends.
- Explore the all-trial and supplementary filtered deflection fits across the sampled 10–30 mm range.
- Inspect complete result tables, conditional large-deflection strain estimates, graph legends, and the experimental report.
- Download the reference-channel JSON dataset or export all trial summaries as CSV.
- View a future hull concept, explicitly separate from measured bench results.

## Quantities and hardware

The current separate-channel configuration uses sensing C1 → ESP32 D35, reference C1 → D34, common D25 → both TX, 3.3 V and common GND. Historical single-channel results used D34 and are not pooled into the ratio fit. R is the median of sample-wise sensing/reference voltage ratios; q = 100(1 − R/R₀). These are normalized receiver-voltage decreases, not calibrated optical-power losses.

Polycarbonate: 297 × 210 × 2 mm; approximate support span 228.6 mm; initial centre height 60 mm. Strain is a conditional smooth-support central-point-load beam calculation, not an independent measurement of plate or fiber strain.

| Fit | n | q (%) against δ (mm) | R² | RMSE (percentage points) |
| --- | --- | --- | --- | --- |
| All trials | 5 | 0.1144663δ + 0.0323504 | 0.763957 | 0.476137 |
| Supplementary filtered | 3 | 0.0875926δ + 0.5714792 | 0.790787 | 0.367863 |

Filtering omits 20 mm Trial 1 (movement reported) and 30 mm Trial 2 (possible table shaking reported), evaluated after inspecting results. Both observations remain visible and in the primary fit. Metrics are in-sample fitting errors; no held-out prediction accuracy is established.

`model.js` holds the documented historical summaries, current trial ratios, fits and numerical elastica solver. `data/experimental-results.json` holds the current ratio dataset and fit metadata. `SmartHull-Experimental-Summary.pdf` is the complete six-page report. The interface is a replay of summaries and a separate calculated approximation, without fabricated live signals or a trained AI model. TinyML and marine validation are Phase 2 / future work.

## Numerical references

- Ohtsuki (1986), https://doi.org/10.1299/jsme1958.29.1988
- Batista (2014), https://arxiv.org/pdf/1408.3094

