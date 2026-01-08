/*************************************************************
 * BOQ CSV + HIERARCHY + COLLAPSE + ROLLUP ENGINE
 * FINAL FIX:
 * - Rollups are VALUE-BASED, not STRUCTURE-BASED
 *************************************************************/

const COL = {
  CODE: 0,
  DESC: 1,
  QTY: 2,
  UNIT: 3,
  RATE: 4,
  SUBTOTAL: 5,
  MARKUP: 6,
  TOTAL: 7
};

const INDENT_PX = 14;
const AUTO_CSV_PATH = "./boq.csv";

/* ================= UTILITIES ================= */

function isRate(code) {
  return /\.R\d+$/.test(code || "");
}

function stripRate(code) {
  return (code || "").replace(/\.R\d+$/, "");
}

function tradePrefix(code) {
  const p = stripRate(code).split(".");
  return p.length >= 2 ? `${p[0]}.${p[1]}` : "";
}

function numericSlots(code) {
  return stripRate(code).split(".").slice(2).map(n => parseInt(n, 10));
}

function nonZeroCount(code) {
  return numericSlots(code).reduce((a, n) => a + (n !== 0 ? 1 : 0), 0);
}

function covers(parent, child) {
  if (!parent || !child) return false;
  if (tradePrefix(parent) !== tradePrefix(child)) return false;

  const p = numericSlots(parent);
  const c = numericSlots(child);
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== 0 && p[i] !== c[i]) return false;
  }
  return true;
}

function isDescendant(parent, child) {
  if (!parent || !child) return false;
  if (stripRate(parent) === stripRate(child)) return false;
  if (isRate(child)) return false;
  return covers(parent, child);
}

function rows() {
  return Array.from(document.querySelectorAll(".boq-row[data-code]"));
}

function num(v) {
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* ================= HIERARCHY ================= */

function buildHierarchy(all) {
  const nodes = all
    .map((r, i) => ({ code: r.dataset.code, idx: i }))
    .filter(n => n.code && !isRate(n.code));

  const parentOf = new Map();
  const childrenOf = new Map();
  const rateChildrenOf = new Map();
  const depthOf = new Map();

  nodes.forEach(n => {
    childrenOf.set(n.code, []);
    rateChildrenOf.set(n.code, []);
  });

  nodes.forEach(n => {
    let best = null, bestSpec = -1, bestIdx = -1;
    nodes.forEach(p => {
      if (p.idx >= n.idx) return;
      if (!covers(p.code, n.code)) return;
      const s = nonZeroCount(p.code);
      if (s > bestSpec || (s === bestSpec && p.idx > bestIdx)) {
        best = p.code; bestSpec = s; bestIdx = p.idx;
      }
    });
    parentOf.set(n.code, best);
    if (best) childrenOf.get(best).push(n.code);
  });

  all.forEach(r => {
    if (isRate(r.dataset.code)) {
      const base = stripRate(r.dataset.code);
      rateChildrenOf.get(base)?.push(r.dataset.code);
    }
  });

  function depth(c) {
    if (depthOf.has(c)) return depthOf.get(c);
    const d = parentOf.get(c) ? depth(parentOf.get(c)) + 1 : 0;
    depthOf.set(c, d);
    return d;
  }

  nodes.forEach(n => depth(n.code));

  return { parentOf, childrenOf, rateChildrenOf, depthOf };
}

/* ================= ROLLUPS (FIXED) ================= */

function recomputeAllRollups(all, hierarchy) {
  const parents = all.filter(r => !isRate(r.dataset.code));

  parents.forEach(p => {
    let q = 0, s = 0, t = 0;
    const pCode = p.dataset.code;

    all.forEach(r => {
      const rCode = r.dataset.code;
      if (!rCode) return;

      const hasValues =
        num(r.children[COL.QTY]?.textContent) !== 0 ||
        num(r.children[COL.SUBTOTAL]?.textContent) !== 0 ||
        num(r.children[COL.TOTAL]?.textContent) !== 0;

      if (!hasValues && !isRate(rCode)) return;

      const base = stripRate(rCode);
      if (base === pCode || isDescendant(pCode, base)) {
        q += num(r.children[COL.QTY]?.textContent);
        s += num(r.children[COL.SUBTOTAL]?.textContent);
        t += num(r.children[COL.TOTAL]?.textContent);
      }
    });

    p.children[COL.QTY].textContent = q || "";
    p.children[COL.SUBTOTAL].textContent = money(s);
    p.children[COL.TOTAL].textContent = money(t);
  });
}

/* ================= VISIBILITY ================= */

function hideSubtree(code, all, h) {
  h.rateChildrenOf.get(code)?.forEach(c =>
    all.find(r => r.dataset.code === c).style.display = "none"
  );
  h.childrenOf.get(code)?.forEach(c => {
    const el = all.find(r => r.dataset.code === c);
    el.style.display = "none";
    el.classList.add("collapsed");
    hideSubtree(c, all, h);
  });
}

function showChildren(code, all, h) {
  h.childrenOf.get(code)?.forEach(c =>
    all.find(r => r.dataset.code === c).style.display = "grid"
  );
  h.rateChildrenOf.get(code)?.forEach(c =>
    all.find(r => r.dataset.code === c).style.display = "grid"
  );
}

/* ================= INIT ================= */

document.addEventListener("DOMContentLoaded", async () => {
  const csv = await fetch(AUTO_CSV_PATH).then(r => r.text());
  const rowsData = csv.trim().split(/\r?\n/).slice(1).map(l => l.split(","));

  const container = document.getElementById("boqContainer");
  container.innerHTML = "";

  rowsData.forEach(r => {
    const el = document.createElement("div");
    el.className = "boq-row boq-grid px-3 py-2";
    el.dataset.code = r[0];
    if (isRate(r[0])) el.classList.add("bg-sky-100", "rounded-md", "mx-2");

    el.innerHTML = r.map((c, i) =>
      `<div class="${i > 1 ? "text-right" : ""}">${c || ""}</div>`
    ).join("");
    container.appendChild(el);
  });

  const all = rows();
  const h = buildHierarchy(all);

  all.forEach(r => {
    if (isRate(r.dataset.code)) r.style.display = "none";
    else if (!h.parentOf.get(r.dataset.code)) r.style.display = "grid";
    else r.style.display = "none";
  });

  all.forEach(r => {
    const code = r.dataset.code;
    const cell = r.children[COL.CODE];
    if (!isRate(code) && (h.childrenOf.get(code)?.length || h.rateChildrenOf.get(code)?.length)) {
      cell.onclick = () => {
        const open = r.classList.toggle("expanded");
        if (open) showChildren(code, all, h);
        else hideSubtree(code, all, h);
      };
    }
  });

  recomputeAllRollups(all, h);
});