// Things Alfred is allowed to DO, not just talk about — and a small
// plain-language parser so the common ones work instantly, offline and
// without a Gemini key ("drank 500ml", "weight 82.4", "slept 7.5h",
// "done meditate", "oats 450 kcal 20g protein", "note: call dentist").
//
// Every action is additive and bounded — Alfred can log, tick and note,
// but never delete or overwrite anything. Each one returns a short
// human line ("+500 ml water") or null if it couldn't be applied, so the
// reply can say exactly what changed.

(function () {
  const today = () => todayKey();

  function findHabit(name) {
    if (typeof habits === "undefined" || !name) return null;
    const q = String(name).toLowerCase().trim();
    return (
      habits.find((h) => h.name.toLowerCase() === q) ||
      habits.find((h) => h.name.toLowerCase().includes(q)) ||
      habits.find((h) => q.includes(h.name.toLowerCase())) ||
      // First significant word match, e.g. "meditated" -> "Meditate 10 min"
      habits.find((h) => {
        const first = h.name.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, "");
        return first.length >= 4 && q.includes(first.slice(0, Math.max(4, first.length - 1)));
      }) ||
      null
    );
  }

  function findGoal(name) {
    if (typeof goals === "undefined" || !name) return null;
    const q = String(name).toLowerCase().trim();
    return goals.find((g) => g.name.toLowerCase().includes(q)) || goals.find((g) => q.includes(g.name.toLowerCase())) || null;
  }

  const MEALS_OK = ["Breakfast", "Lunch", "Dinner", "Snacks"];

  const APPLY = {
    water(a) {
      const ml = Math.round(Number(a.ml));
      if (!(ml > 0 && ml <= 3000) || typeof addWater !== "function") return null;
      addWater(ml, today());
      return `+${ml} ml water`;
    },
    food(a) {
      const kcal = Math.round(Number(a.kcal));
      const name = String(a.name || "").trim().slice(0, 80);
      if (!name || !(kcal >= 0 && kcal <= 5000) || !window.addEntryOn) return null;
      const protein = Math.max(0, Math.min(300, Math.round(Number(a.protein) || 0)));
      const meal = MEALS_OK.find((m) => m.toLowerCase() === String(a.meal || "").toLowerCase());
      window.addEntryOn(today(), name, kcal, protein, meal);
      return `${name}: ${kcal} kcal${protein ? `, ${protein}g protein` : ""}`;
    },
    habit(a) {
      const h = findHabit(a.name);
      if (!h || typeof toggleDate !== "function") return null;
      if (h.history[today()]) return `${h.name} (already done)`;
      toggleDate(h.id, today());
      return `✓ ${h.name}`;
    },
    weight(a) {
      const kg = Number(a.kg);
      if (!window.logWeight || !window.logWeight(kg)) return null;
      return `Weight ${kg.toFixed(1)} kg`;
    },
    sleep(a) {
      if (!window.recoverySet) return null;
      const hours = Number(a.hours);
      const patch = {};
      if (hours > 0 && hours <= 16) patch.sleep = Math.round(hours * 60);
      for (const k of ["quality", "energy", "soreness"]) {
        const v = Math.round(Number(a[k]));
        if (v >= 1 && v <= 5) patch[k] = v;
      }
      if (!Object.keys(patch).length) return null;
      window.recoverySet(today(), patch);
      const bits = [];
      if (patch.sleep) bits.push(`slept ${+(patch.sleep / 60).toFixed(1)}h`);
      if (patch.quality) bits.push(`quality ${patch.quality}/5`);
      if (patch.energy) bits.push(`energy ${patch.energy}/5`);
      if (patch.soreness) bits.push(`soreness ${patch.soreness}/5`);
      return `Recovery: ${bits.join(", ")}`;
    },
    training() {
      // Ticks every exercise in today's planned session.
      if (typeof plan === "undefined" || typeof savePlan !== "function") return null;
      const idx = (new Date().getDay() + 6) % 7;
      const day = plan.days[idx];
      if (!day || !day.exercises.length) return null;
      plan.log[today()] = day.exercises.map((e) => e.id);
      savePlan();
      if (window.renderFitness) window.renderFitness();
      if (window.renderOverview) window.renderOverview();
      return `Training done: ${day.title || "today's session"}`;
    },
    note(a) {
      const text = String(a.text || "").trim().slice(0, 2000);
      if (!text || !window.addNote) return null;
      window.addNote(text);
      return `Note: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    },
    goal(a) {
      const g = findGoal(a.name);
      const delta = Number(a.delta);
      if (!g || !delta || Math.abs(delta) > 100000 || typeof adjustGoal !== "function") return null;
      adjustGoal(g.id, delta);
      return `${g.name}: ${delta > 0 ? "+" : ""}${delta} ${g.unit}`;
    },
  };

  function applyActions(actions) {
    const done = [];
    for (const a of Array.isArray(actions) ? actions.slice(0, 8) : []) {
      const fn = a && APPLY[a.type];
      if (!fn) continue;
      try {
        const line = fn(a);
        if (line) done.push(line);
      } catch {
        // One bad action shouldn't stop the rest.
      }
    }
    return done;
  }

  // ------------------------------------------------------------ Parser

  const num = (s) => parseFloat(String(s).replace(",", "."));

  // Splits "drank 500ml and weight 82.4" into separately parsed pieces.
  function parseLocal(text) {
    const whole = parseOne(String(text).trim());
    if (whole) return [whole];
    const parts = String(text)
      .split(/\s*(?:[;\n]|,\s+(?=[a-z])|\band\b|\balso\b|\+(?=\s*[a-z]))\s*/i)
      .map((p) => p.trim())
      .filter(Boolean);
    const actions = [];
    for (const p of parts) {
      const a = parseOne(p);
      if (!a) return null; // anything not understood -> let Gemini handle the whole message
      actions.push(a);
    }
    return actions.length ? actions : null;
  }

  function parseOne(p) {
    const s = p.toLowerCase().trim().replace(/[.!]+$/, "");
    let m;

    if ((m = s.match(/^note[:\s]+(.+)$/i))) return { type: "note", text: p.replace(/^note[:\s]+/i, "") };

    // Water: "500ml", "drank 0.5l water", "2 glasses of water", "glass of water"
    if ((m = s.match(/^(?:drank|had|drink|\+)?\s*(\d+(?:[.,]\d+)?)\s*(ml|l|liters?|litres?)\b(?:\s*(?:of\s+)?water)?$/))) {
      const v = num(m[1]);
      return { type: "water", ml: m[2] === "ml" ? v : v * 1000 };
    }
    if ((m = s.match(/^(?:drank|had)?\s*(?:a|one|(\d+))?\s*glass(?:es)?\s+of\s+water$/))) {
      return { type: "water", ml: 250 * (m[1] ? Number(m[1]) : 1) };
    }

    // Weight: "weight 82.4", "weighed 82.4kg", "82.4 kg"
    if ((m = s.match(/^(?:my\s+)?(?:weight|weigh(?:ed)?|weighing)(?:\s+(?:is|was|today))?\s*:?\s*(\d{2,3}(?:[.,]\d)?)\s*(?:kg)?$/))) {
      return { type: "weight", kg: num(m[1]) };
    }
    if ((m = s.match(/^(\d{2,3}(?:[.,]\d)?)\s*kg$/))) return { type: "weight", kg: num(m[1]) };

    // Sleep: "slept 7.5h", "slept 7 hours", "sleep 8h"
    if ((m = s.match(/^(?:i\s+)?(?:slept|sleep)\s+(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|hours?)?$/))) {
      return { type: "sleep", hours: num(m[1]) };
    }

    // Training: "trained", "did my workout", "workout done", "did push day"
    if (/^(?:i\s+)?(?:trained|worked out|gym done|workout done|training done|did (?:my )?(?:workout|training|session|the gym|[a-z]+ day))$/.test(s)) {
      return { type: "training" };
    }

    // Food: "oats 450 kcal", "chicken bowl 780kcal 55g protein", "ate pizza 900 kcal"
    if ((m = s.match(/^(?:ate|had|eaten)?\s*(.+?)\s+(\d{1,4})\s*(?:kcal|cal|calories)(?:\s*(?:,|with)?\s*(\d{1,3})\s*g?\s*(?:protein|p))?$/))) {
      const name = p.replace(/^(ate|had|eaten)\s+/i, "").replace(/\s+\d{1,4}\s*(kcal|cal|calories).*$/i, "").trim();
      return { type: "food", name: name.charAt(0).toUpperCase() + name.slice(1), kcal: Number(m[2]), protein: m[3] ? Number(m[3]) : 0 };
    }

    // Habits: "done meditate", "did stretch", "✓ read", "meditated"
    if ((m = s.match(/^(?:done|did|finished|completed|checked?|tick|✓|x)\s+(.+)$/))) {
      if (findHabit(m[1])) return { type: "habit", name: m[1] };
      return null;
    }
    if (findHabit(s) && s.split(/\s+/).length <= 4 && /(ed|done)$/.test(s)) return { type: "habit", name: s };

    return null;
  }

  window.appActions = { apply: applyActions, parseLocal, types: Object.keys(APPLY) };
})();
