"use strict";

/** ABO式血液型の基本的なメンデル遺伝モデル（まれな例外は対象外） */
const TYPES = ["A", "B", "AB", "O"];
const GENOTYPES = {
  A: ["AA", "AO"],
  B: ["BB", "BO"],
  AB: ["AB"],
  O: ["OO"]
};
const ALLELES = {
  AA: ["A", "A"], AO: ["A", "O"],
  BB: ["B", "B"], BO: ["B", "O"],
  AB: ["A", "B"], OO: ["O", "O"]
};
const GENOTYPE_ORDER = ["AA", "AO", "BB", "BO", "AB", "OO"];
const state = {
  parents: [{ type: "A", genotype: null }, { type: "B", genotype: null }],
  filtered: false
};

function typeFromGenotype(genotype) {
  if (genotype === "AA" || genotype === "AO") return "A";
  if (genotype === "BB" || genotype === "BO") return "B";
  return genotype === "AB" ? "AB" : "O";
}
function offspringType(a, b) {
  if (a === "O") return b;
  if (b === "O") return a;
  if (a !== b) return "AB";
  return a;
}
function offspringGenotype(a, b) {
  return [a, b].sort((x, y) => "ABO".indexOf(x) - "ABO".indexOf(y)).join("");
}
function outcome(genotype1, genotype2) {
  const outcomes = ALLELES[genotype1].flatMap(a => ALLELES[genotype2].map(b => ({ a, b, genotype: offspringGenotype(a, b), type: offspringType(a, b) })));
  const counts = Object.fromEntries(TYPES.map(type => [type, outcomes.filter(item => item.type === type).length]));
  return { outcomes, counts };
}
function possibilities(parent1, parent2) {
  const gs1 = parent1.genotype ? [parent1.genotype] : GENOTYPES[parent1.type];
  const gs2 = parent2.genotype ? [parent2.genotype] : GENOTYPES[parent2.type];
  const set = new Set();
  gs1.forEach(g1 => gs2.forEach(g2 => {
    const { counts } = outcome(g1, g2);
    TYPES.forEach(type => { if (counts[type] > 0) set.add(type); });
  }));
  return set;
}
function genotypeChoices(type) {
  return GENOTYPES[type];
}
function setParentType(index, type) {
  const choices = genotypeChoices(type);
  state.parents[index] = { type, genotype: choices.length === 1 ? choices[0] : null };
  render();
}
function setParentGenotype(index, genotype) {
  if (genotype !== null && !GENOTYPES[state.parents[index].type].includes(genotype)) return;
  state.parents[index].genotype = genotype;
  render();
}
function setPair(genotype1, genotype2, scroll = false) {
  state.parents = [genotype1, genotype2].map(g => ({ type: typeFromGenotype(g), genotype: g }));
  render();
  if (scroll) document.getElementById("simulator").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
}
function typeToken(type, small = false) {
  return `<span class="${small ? "little-token" : "type-token"} type-${type}" aria-hidden="true">${type}</span>`;
}
function renderParents() {
  state.parents.forEach((parent, index) => {
    const typeChoices = document.querySelector(`[data-type-choices="${index}"]`);
    const genotypeChoicesContainer = document.querySelector(`[data-genotype-choices="${index}"]`);
    typeChoices.innerHTML = TYPES.map(type => `<button type="button" class="type-choice" data-parent="${index}" data-type="${type}" aria-pressed="${parent.type === type}">${type}</button>`).join("");
    const choices = GENOTYPES[parent.type];
    if (choices.length === 1) {
      genotypeChoicesContainer.innerHTML = `<button type="button" class="genotype-choice" aria-pressed="true" disabled>${choices[0]}（確定）</button>`;
    } else {
      genotypeChoicesContainer.innerHTML = `<button type="button" class="genotype-choice" data-parent="${index}" data-genotype="unknown" aria-pressed="${parent.genotype === null}">不明</button>` +
        choices.map(g => `<button type="button" class="genotype-choice" data-parent="${index}" data-genotype="${g}" aria-pressed="${parent.genotype === g}">${g}</button>`).join("");
    }
  });
}
function renderResult() {
  const [p1, p2] = state.parents;
  const content = document.getElementById("result-content");
  const panel = document.getElementById("punnett-panel");
  if (!p1.genotype || !p2.genotype) {
    const possible = possibilities(p1, p2);
    content.innerHTML = `
      <p class="result-emphasis">生まれる可能性がある血液型</p>
      <div class="possible-list">${TYPES.map(type => `<div class="possible-item ${possible.has(type) ? "" : "muted"}">${typeToken(type)}<strong>${type}型${possible.has(type) ? " ○" : " —"}</strong></div>`).join("")}</div>
      <p class="result-note">A型・B型の遺伝子型が未確定のため、<strong>正確な確率は計算できません。</strong>「AA」「AO」「BB」「BO」を指定すると確率が表示されます。</p>`;
    panel.hidden = true;
    return;
  }
  const { outcomes, counts } = outcome(p1.genotype, p2.genotype);
  content.innerHTML = `
    <p class="result-emphasis">${p1.genotype} × ${p2.genotype} の場合</p>
    ${TYPES.map(type => `<div class="prob-row"><div class="prob-info"><strong>${typeToken(type,true)}${type}型</strong><span>${counts[type] * 25}%</span></div><div class="prob-track" role="img" aria-label="${type}型 ${counts[type] * 25}パーセント"><span class="prob-fill type-${type}" style="width:${counts[type] * 25}%"></span></div></div>`).join("")}
    <p class="result-note">各親から1つずつ遺伝子を受け取る4通りを、同じ確率として計算しています。</p>`;
  panel.hidden = false;
  const [a1, a2] = ALLELES[p1.genotype];
  const [b1, b2] = ALLELES[p2.genotype];
  document.getElementById("punnett-content").innerHTML = `
    <div class="punnett-grid-wrap">
      <div class="punnett-grid" role="img" aria-label="親1 ${p1.genotype}、親2 ${p2.genotype} の組み合わせ。${outcomes.map(o=>o.genotype + '型遺伝子').join('、')}">
        <div class="punnett-corner">親1 →<br>親2 ↓</div>
        <div class="punnett-head">${a1}</div><div class="punnett-head">${a2}</div>
        ${[b1, b2].map(b => `<div class="punnett-head parent-2">${b}</div>${[a1, a2].map(a => `<div class="punnett-cell"><strong>${offspringGenotype(a,b)}</strong><small>${offspringType(a,b)}型</small></div>`).join("")}`).join("")}
      </div>
      <div class="punnett-description"><strong>1マスあたり25%</strong>縦と横から1つずつ選ぶと、子どもの遺伝子型になります。同じ血液型のマスが複数ある場合は、その分だけ確率が高くなります。</div>
    </div>`;
}
function tablePercent(count) {
  return count ? `<span class="table-percent">${count * 25}%</span>` : `<span class="table-dash">—</span>`;
}
function renderPhenotypeTable() {
  const rows = [];
  for (let i = 0; i < TYPES.length; i++) {
    for (let j = i; j < TYPES.length; j++) {
      const type1 = TYPES[i], type2 = TYPES[j];
      const possible = possibilities({ type: type1, genotype: null }, { type: type2, genotype: null });
      rows.push(`<tr><td>${type1} × ${type2}</td>${TYPES.map(type => `<td>${possible.has(type) ? '<span class="table-check" aria-label="可能性あり">○</span>' : '<span class="table-dash" aria-label="通常はなし">—</span>'}</td>`).join("")}</tr>`);
    }
  }
  document.querySelector("#phenotype-table tbody").innerHTML = rows.join("");
}
const genotypePairs = [];
for (let i = 0; i < GENOTYPE_ORDER.length; i++) {
  for (let j = i; j < GENOTYPE_ORDER.length; j++) {
    genotypePairs.push([GENOTYPE_ORDER[i], GENOTYPE_ORDER[j]]);
  }
}
function renderGenotypeTable() {
  const tbody = document.querySelector("#genotype-table tbody");
  let rows = genotypePairs;
  if (state.filtered) {
    const wanted = state.parents.map(p => p.type).sort().join("/");
    rows = rows.filter(([a, b]) => [typeFromGenotype(a), typeFromGenotype(b)].sort().join("/") === wanted);
  }
  tbody.innerHTML = rows.map(([g1, g2]) => {
    const { counts } = outcome(g1, g2);
    return `<tr><td class="table-genotype">${g1}<small>（${typeFromGenotype(g1)}）</small> × ${g2}<small>（${typeFromGenotype(g2)}）</small></td>${TYPES.map(type => `<td>${tablePercent(counts[type])}</td>`).join("")}<td><button type="button" class="try-button" data-try-a="${g1}" data-try-b="${g2}" aria-label="${g1} と ${g2} をシミュレーターで試す">試す</button></td></tr>`;
  }).join("");
  document.getElementById("pattern-count").textContent = `${rows.length}パターンを表示中（全21パターン）`;
}
function render() {
  renderParents();
  renderResult();
  if (state.filtered) renderGenotypeTable();
}

document.getElementById("parents-grid").addEventListener("click", event => {
  const button = event.target.closest("button[data-parent]");
  if (!button) return;
  const index = Number(button.dataset.parent);
  if (button.dataset.type) setParentType(index, button.dataset.type);
  else if (button.dataset.genotype) setParentGenotype(index, button.dataset.genotype === "unknown" ? null : button.dataset.genotype);
});
document.getElementById("reset-button").addEventListener("click", () => {
  state.parents = [{ type: "A", genotype: null }, { type: "B", genotype: null }];
  state.filtered = false;
  document.getElementById("filter-current").checked = false;
  render(); renderGenotypeTable();
});
document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
  if (button.dataset.preset === "quarter") setPair("AO", "BO");
  else setPair("AA", "BB");
}));
document.getElementById("filter-current").addEventListener("change", event => {
  state.filtered = event.target.checked;
  renderGenotypeTable();
});
document.querySelector("#genotype-table tbody").addEventListener("click", event => {
  const button = event.target.closest("[data-try-a]");
  if (button) setPair(button.dataset.tryA, button.dataset.tryB, true);
});
renderPhenotypeTable();
renderGenotypeTable();
render();
