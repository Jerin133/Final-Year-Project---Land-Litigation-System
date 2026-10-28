/* Risk analysis & prediction panel for the Module 2 dashboard.
 * Needs: the page's global `currentLang` and `lastCases`, and the
 * <div id="risk-<case_id>"> placeholder inside each case card.
 * Entry point: loadRisk(cases)  (called at the end of render()). */
(function () {
  const API = "";
  const riskCache = {};      // case_id -> prediction
  const explainCache = {};   // case_id -> {english, tamil, model}
  let modelMeta = null;

  const T = {
    english: {
      title: "Risk analysis & prediction", prolonged: "Probability of prolonged litigation",
      appeal: "Probability of appeal", score: "Risk score", completion: "Expected completion",
      low: "Low", medium: "Medium", high: "High", closed: "Closed",
      already: "Already exceeded the long-case threshold", appealFiled: "Appeal already filed",
      months: "months", range: "80% range", why: "Why this estimate", lengthens: "lengthens duration",
      shortens: "shortens duration", raises: "raises appeal odds", lowers: "lowers appeal odds",
      higher: "higher than typical", lower: "lower than typical", ofOpen: "riskier than {n}% of open cases",
      actual: "Actual outcome", disposed: "Disposed on", took: "took", days: "days",
      prolongedActual: "Prolonged litigation", appealActual: "Appeal", yes: "Yes", no: "No",
      unknown: "Not enough data to estimate", explain: "Explain with AI (Ollama)",
      explaining: "Explaining… (can take up to a minute)", failed: "AI explanation failed",
      aiLabel: "AI explanation — written locally by Ollama from the model's numbers",
      reliability: "Model reliability", dur: "duration", app: "appeal", rough: "rough extrapolation",
      loading: "Calculating risk…", unavailable: "Risk model unavailable", weak: "weak", moderate: "moderate",
      good: "good", unk: "unknown"
    },
    tamil: {
      title: "அபாய பகுப்பாய்வு மற்றும் கணிப்பு", prolonged: "வழக்கு நீடிக்கும் நிகழ்தகவு",
      appeal: "மேல்முறையீட்டு நிகழ்தகவு", score: "அபாய மதிப்பெண்", completion: "எதிர்பார்க்கப்படும் முடிவு",
      low: "குறைவு", medium: "நடுத்தரம்", high: "அதிகம்", closed: "முடிந்தது",
      already: "நீண்ட வழக்கு வரம்பை ஏற்கனவே கடந்துவிட்டது", appealFiled: "மேல்முறையீடு ஏற்கனவே தாக்கல் செய்யப்பட்டுள்ளது",
      months: "மாதங்கள்", range: "80% வரம்பு", why: "இந்த மதிப்பீட்டிற்கான காரணங்கள்", lengthens: "காலத்தை நீட்டுகிறது",
      shortens: "காலத்தைக் குறைக்கிறது", raises: "மேல்முறையீட்டு வாய்ப்பை உயர்த்துகிறது", lowers: "மேல்முறையீட்டு வாய்ப்பைக் குறைக்கிறது",
      higher: "வழக்கத்தை விட அதிகம்", lower: "வழக்கத்தை விடக் குறைவு", ofOpen: "நிலுவையிலுள்ள {n}% வழக்குகளை விட அபாயம் அதிகம்",
      actual: "உண்மையான முடிவு", disposed: "முடிவுற்ற தேதி", took: "எடுத்த காலம்", days: "நாட்கள்",
      prolongedActual: "நீண்ட வழக்கு", appealActual: "மேல்முறையீடு", yes: "ஆம்", no: "இல்லை",
      unknown: "மதிப்பிட போதிய தரவு இல்லை", explain: "AI மூலம் விளக்கு (Ollama)",
      explaining: "விளக்குகிறது… (ஒரு நிமிடம் வரை ஆகலாம்)", failed: "AI விளக்கம் தோல்வியடைந்தது",
      aiLabel: "AI விளக்கம் — மாதிரியின் எண்களிலிருந்து Ollama மூலம் உள்ளூரில் எழுதப்பட்டது",
      reliability: "மாதிரி நம்பகத்தன்மை", dur: "கால அளவு", app: "மேல்முறையீடு", rough: "தோராயமான நீட்டிப்பு",
      loading: "அபாயம் கணக்கிடப்படுகிறது…", unavailable: "அபாய மாதிரி கிடைக்கவில்லை", weak: "குறைவு", moderate: "நடுத்தரம்",
      good: "நல்லது", unk: "தெரியவில்லை"
    }
  };
  const tr = () => T[(typeof currentLang !== "undefined" && currentLang === "tamil") ? "tamil" : "english"];
  const locale = () => (typeof currentLang !== "undefined" && currentLang === "tamil") ? "ta-IN" : "en-IN";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = x => (x === null || x === undefined) ? "—" : Math.round(x * 100) + "%";
  const mon = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString(locale(), { month: "short", year: "numeric" }) : "—";
  const day = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const css = document.createElement("style");
  css.textContent = `
    .risk{margin:14px 0;padding:14px;border:1px solid #D8D2C4;border-radius:6px;background:#FBF8F1}
    .risk h3{font-family:var(--serif);font-weight:400;font-size:.98rem;margin:0 0 10px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .risk-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
    .risk-tile{background:#fff;border:1px solid #E4DECF;border-radius:4px;padding:10px 12px}
    .risk-tile span.k{display:block;font-size:.72rem;color:#4A5568;margin-bottom:2px}
    .risk-tile b{font-size:1.25rem;font-weight:600}
    .risk-tile small{display:block;font-size:.72rem;color:#4A5568;margin-top:2px}
    .risk-bar{height:6px;background:#E9E4D6;border-radius:3px;margin-top:6px;overflow:hidden}
    .risk-bar i{display:block;height:100%}
    .band-Low{color:#2F6B4F}.band-Medium{color:#B7791F}.band-High{color:#8B3A3A}
    .fill-Low{background:#2F6B4F}.fill-Medium{background:#B7791F}.fill-High{background:#8B3A3A}
    .risk-why{margin-top:10px;font-size:.82rem;color:#1E2A38}
    .risk-why ul{margin:4px 0 0 18px;padding:0}
    .risk-meta{margin-top:8px;font-size:.74rem;color:#4A5568}
    .risk-note{margin-top:6px;font-size:.76rem;color:#6B4E16}
    .risk-ai{background:#EFEAF5;border:1px solid #C9BEE0;border-radius:4px;padding:10px 12px;margin-top:10px;font-size:.88rem}
    .risk-ai .lbl{display:block;font-size:.72rem;color:#5B4E7A;margin-bottom:5px}
    .risk-btn{background:#5B4E7A;font-size:.8rem;padding:6px 12px;margin-top:10px}
    .risk-btn:disabled{background:#A79FBD;cursor:wait}`;
  document.head.appendChild(css);

  function tile(k, big, small, extra) {
    return `<div class="risk-tile"><span class="k">${esc(k)}</span>${big}${small ? `<small>${small}</small>` : ""}${extra || ""}</div>`;
  }

  function relLabel(q) { const t = tr(); return t[q] || q; }

  function renderOne(p) {
    const t = tr();
    if (!p) return `<div class="risk"><h3>${esc(t.title)}</h3><small>${esc(t.unavailable)}</small></div>`;

    if (p.mode === "closed_actual") {
      const ec = p.expected_completion || {};
      const prolonged = p.prolonged_probability === null ? "—" : (p.prolonged_probability ? t.yes : t.no);
      const appealed = p.appeal_probability === null ? "—" : (p.appeal_probability ? t.yes : t.no);
      const flag = (p.data_quality_flags || []).map(f => `<div class="risk-note">⚠ ${esc(f)}</div>`).join("");
      return `<div class="risk"><h3><span>${esc(t.title)}</span><span>${esc(t.closed)}</span></h3>
        <div class="risk-tiles">
          ${tile(t.actual, `<b>${esc(t.closed)}</b>`, `${esc(t.disposed)} ${esc(day(ec.actual_disposal_date))}` +
            (ec.actual_duration_days != null ? ` · ${esc(t.took)} ${ec.actual_duration_days} ${esc(t.days)}` : ""))}
          ${tile(t.prolongedActual, `<b>${esc(prolonged)}</b>`)}
          ${tile(t.appealActual, `<b>${esc(appealed)}</b>`)}
        </div>${flag}</div>`;
    }

    if (p.mode !== "predicted") {
      return `<div class="risk"><h3>${esc(t.title)}</h3><small>${esc(t.unknown)}</small>` +
        (p.data_quality_flags || []).map(f => `<div class="risk-note">⚠ ${esc(f)}</div>`).join("") + `</div>`;
    }

    const ec = p.expected_completion, band = p.risk_band;
    const bandLabel = t[band.toLowerCase()] || band;
    const pr = p.already_prolonged
      ? tile(t.prolonged, `<b class="band-High">100%</b>`, esc(t.already))
      : tile(t.prolonged, `<b>${pct(p.prolonged_probability)}</b>`);
    const ap = p.appeal_already_filed
      ? tile(t.appeal, `<b class="band-High">100%</b>`, esc(t.appealFiled))
      : tile(t.appeal, `<b>${pct(p.appeal_probability)}</b>`);
    const sc = tile(t.score, `<b class="band-${band}">${p.risk_score.toFixed(0)}/100 · ${esc(bandLabel)}</b>`,
      p.risk_percentile_among_open_cases != null ? esc(t.ofOpen.replace("{n}", p.risk_percentile_among_open_cases)) : "",
      `<div class="risk-bar"><i class="fill-${band}" style="width:${Math.min(100, p.risk_score)}%"></i></div>`);
    const months = ec.median_remaining_months;
    const comp = tile(t.completion, `<b>${esc(mon(ec.expected_date))}</b>`,
      `≈ ${months} ${esc(t.months)} · ${esc(t.range)}: ${esc(mon(ec.range_80pct.earliest_date))} – ${esc(mon(ec.range_80pct.latest_date))}` +
      (ec.beyond_observed_range ? ` · <i>${esc(t.rough)}</i>` : ""));

    const d = p.drivers || {};
    const li = [];
    (d.duration || []).forEach(x => li.push(`${esc(x.factor)}${x.case_vs_typical ? " (" + esc(relLabel(x.case_vs_typical)) + ")" : ""} — ${esc(relLabel(x.effect))} (${x.change_in_expected_duration_pct > 0 ? "+" : ""}${x.change_in_expected_duration_pct}%)`));
    (d.appeal || []).forEach(x => li.push(`${esc(x.factor)}${x.case_vs_typical ? " (" + esc(relLabel(x.case_vs_typical)) + ")" : ""} — ${esc(relLabel(x.effect))} (×${x.odds_multiplier})`));
    const why = li.length ? `<div class="risk-why"><b>${esc(t.why)}</b><ul>${li.map(x => `<li>${x}</li>`).join("")}</ul></div>` : "";

    const rel = modelMeta ? `<div class="risk-meta">${esc(t.reliability)}: ${esc(t.dur)} ${esc(t[modelMeta.duration_reliability] || t.unk)}, ${esc(t.app)} ${esc(t[modelMeta.appeal_reliability] || t.unk)}</div>` : "";
    const note = (ec.note ? `<div class="risk-note">ⓘ ${esc(ec.note)}</div>` : "") +
      (p.data_quality_flags || []).map(f => `<div class="risk-note">⚠ ${esc(f)}</div>`).join("");

    return `<div class="risk"><h3><span>${esc(t.title)}</span></h3>
      <div class="risk-tiles">${pr}${ap}${sc}${comp}</div>${why}${note}${rel}
      <div id="risk-ai-${esc(p.case_id)}"></div>
      <button class="risk-btn" data-case="${esc(p.case_id)}">${esc(t.explain)}</button></div>`;
  }

  function showExplanation(caseId, r) {
    const t = tr(), el = document.getElementById("risk-ai-" + caseId);
    if (!el) return;
    el.innerHTML = "";
    const box = document.createElement("div");
    box.className = "risk-ai";
    const lbl = document.createElement("span");
    lbl.className = "lbl"; lbl.textContent = `${t.aiLabel} (${r.model})`;
    const en = document.createElement("p"); en.textContent = r.english;
    const ta = document.createElement("p"); ta.textContent = r.tamil;
    box.append(lbl, en, ta);
    el.appendChild(box);
  }

  async function explain(caseId, btn) {
    const t = tr();
    if (explainCache[caseId]) { showExplanation(caseId, explainCache[caseId]); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = t.explaining;
    const el = document.getElementById("risk-ai-" + caseId);
    el.innerHTML = "";
    try {
      const sel = document.getElementById("modelSelect");
      let url = `${API}/risk/cases/${encodeURIComponent(caseId)}/explain`;
      if (sel && sel.value) url += "?model=" + encodeURIComponent(sel.value);
      const r = await fetch(url), d = await r.json();
      if (!r.ok) throw new Error(d.detail || "error");
      explainCache[caseId] = { english: d.explanation.english, tamil: d.explanation.tamil, model: d.model };
      showExplanation(caseId, explainCache[caseId]);
    } catch (e) {
      const box = document.createElement("div");
      box.className = "risk-ai"; box.style.background = "#F5E9E9"; box.style.borderColor = "#D8A0A0";
      box.textContent = `${t.failed}: ${e.message}`;
      el.appendChild(box);
    }
    btn.disabled = false; btn.textContent = old;
  }

  function paint(c) {
    const slot = document.getElementById("risk-" + c.case_id);
    if (!slot) return;
    slot.innerHTML = renderOne(riskCache[c.case_id]);
    const btn = slot.querySelector(".risk-btn");
    if (btn) btn.addEventListener("click", () => explain(c.case_id, btn));
    if (explainCache[c.case_id]) showExplanation(c.case_id, explainCache[c.case_id]);
  }

  window.loadRisk = async function (cases) {
    if (!cases || !cases.length) return;
    const t = tr();
    const missing = cases.filter(c => !(c.case_id in riskCache)).map(c => c.case_id);
    cases.forEach(c => {
      const slot = document.getElementById("risk-" + c.case_id);
      if (slot && !(c.case_id in riskCache)) slot.innerHTML = `<div class="risk"><small>${esc(t.loading)}</small></div>`;
    });
    if (missing.length) {
      try {
        // chunk to keep the URL short
        for (let i = 0; i < missing.length; i += 40) {
          const ids = missing.slice(i, i + 40).join(",");
          const r = await fetch(`${API}/risk/batch?case_ids=${encodeURIComponent(ids)}`);
          const d = await r.json();
          if (!r.ok) throw new Error(d.detail || "risk request failed");
          Object.assign(riskCache, d.predictions);
          modelMeta = d.model;
          missing.slice(i, i + 40).forEach(id => { if (!(id in riskCache)) riskCache[id] = null; });
        }
      } catch (e) {
        cases.forEach(c => {
          const slot = document.getElementById("risk-" + c.case_id);
          if (slot) slot.innerHTML = `<div class="risk"><small>${esc(t.unavailable)}: ${esc(e.message)}</small></div>`;
        });
        return;
      }
    }
    cases.forEach(paint);
  };

  // after /risk/retrain or a page refresh the cache must not outlive the models
  window.clearRiskCache = function () { Object.keys(riskCache).forEach(k => delete riskCache[k]); Object.keys(explainCache).forEach(k => delete explainCache[k]); };
})();