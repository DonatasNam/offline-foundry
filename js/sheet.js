import { put } from "./db.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Descriptions arrive as HTML written inside the group's own Foundry world.
 * Strip active content and Foundry enricher syntax; keep basic formatting.
 */
function sanitizeDescription(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta, form").forEach(el => el.remove());
  for (const el of doc.body.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || (name === "href" && attr.value.trim().toLowerCase().startsWith("javascript:"))) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[[^\]]*\]/g, "")
    .replace(/\[\[\/?[^\]]*\]\]/g, "");
}

const fmtMod = n => (typeof n !== "number" ? "?" : n >= 0 ? `+${n}` : `${n}`);
const damageLine = item => (item.damage ?? []).map(d => d.label).join(", ");

function itemMeta(item) {
  const bits = [];
  if (item.attack) bits.push(`${item.attack} to hit`);
  const dmg = damageLine(item);
  if (dmg) bits.push(dmg);
  if (item.save) bits.push(item.save);
  if (item.quantity) bits.push(`x${item.quantity}`);
  return bits.join(" · ");
}

function usesControl(index, item, state) {
  if (!item.uses) return "";
  const value = state.uses[index] ?? 0;
  return `<span class="stepper" data-uses="${index}">
    <button type="button" data-step="-1">&minus;</button>
    <b>${value}</b>/<span>${item.uses.max}</span>
    <button type="button" data-step="1">+</button>
  </span>`;
}

const SPELL_LEVEL_LABEL = level =>
  level === 0 ? "Cantrips" : `Level ${level}`;

function spellSection(payload, state) {
  const spells = (payload.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === "spell")
    .sort((a, b) => (a.item.level ?? 0) - (b.item.level ?? 0) || a.item.name.localeCompare(b.item.name));
  if (!spells.length) return "";

  const groups = new Map();
  for (const entry of spells) {
    const level = entry.item.level ?? 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(entry);
  }

  let html = `<section class="card"><h2>Spells</h2>`;
  if (payload.spellcasting) {
    html += `<p class="muted">Spell DC ${payload.spellcasting.dc} · Attack ${fmtMod(payload.spellcasting.attack)} (${esc(payload.spellcasting.ability)})</p>`;
  }
  for (const [level, entries] of groups) {
    const slot = state.slots[String(level)] !== undefined && payload.slots?.[String(level)]
      ? `<span class="stepper" data-slot="${level}">
          <button type="button" data-step="-1">&minus;</button>
          <b>${state.slots[String(level)]}</b>/<span>${payload.slots[String(level)].max}</span>
          <button type="button" data-step="1">+</button>
        </span>`
      : "";
    html += `<h3 class="row">${SPELL_LEVEL_LABEL(level)} ${slot}</h3>`;
    for (const { item } of entries) {
      const badges = [
        item.concentration ? `<span class="badge">C</span>` : "",
        item.ritual ? `<span class="badge">R</span>` : "",
        item.prepared === false && item.mode === "prepared" ? `<span class="badge dim">unprepared</span>` : ""
      ].join("");
      const meta = [item.castTime, item.range, item.duration, item.components]
        .filter(Boolean).map(esc).join(" · ");
      html += `<details class="spell">
        <summary>${esc(item.name)} ${badges}<span class="dmg">${esc(damageLine(item))}</span></summary>
        <p class="muted">${meta}${item.school ? " · " + esc(item.school) : ""}${item.target ? " · " + esc(item.target) : ""}</p>
        <div class="desc">${sanitizeDescription(item.description)}</div>
      </details>`;
    }
  }
  return html + `</section>`;
}

function inventorySection(payload, state) {
  const order = ["weapon", "equipment", "consumable", "tool", "container", "loot", "feat"];
  const rest = (payload.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type !== "spell" && !["class", "subclass", "background", "race"].includes(item.type))
    .sort((a, b) =>
      (order.indexOf(a.item.type) + 99) - (order.indexOf(b.item.type) + 99) ||
      a.item.name.localeCompare(b.item.name));
  if (!rest.length) return "";

  let html = `<section class="card"><h2>Inventory &amp; Features</h2>`;
  for (const { item, index } of rest) {
    const meta = itemMeta(item);
    html += `<div class="row item ${item.equipped === false ? "dim" : ""}">
      <span class="grow">${esc(item.name)}${meta ? `<small class="muted"> ${esc(meta)}</small>` : ""}</span>
      ${usesControl(index, item, state)}
    </div>`;
  }
  return html + `</section>`;
}

export function renderSheet(container, record) {
  const { payload, state } = record;
  const abilities = Object.entries(payload.abilities ?? {}).map(([key, a]) => `
    <div class="ability">
      <b>${esc(key.toUpperCase())}</b>
      <span class="score">${a.score ?? "?"}</span>
      <span>${fmtMod(a.mod)}</span>
      <small class="muted">save ${fmtMod(a.save)}</small>
    </div>`).join("");

  const skills = Object.entries(payload.skills ?? {}).map(([key, s]) => `
    <div class="row"><span class="grow">${esc(key)} <small class="muted">(${esc(s.ability ?? "")})</small></span>
    <span>${fmtMod(s.total)}</span><span class="muted">p${s.passive ?? "?"}</span></div>`).join("");

  const classLine = payload.type === "character"
    ? (payload.classes ?? []).map(c => `${c.name} ${c.levels}`).join(" / ")
    : `CR ${payload.cr ?? "?"}`;

  container.innerHTML = `
    <div class="sheet">
      <section class="card header">
        ${payload.img ? `<img class="portrait" src="${esc(payload.img)}" alt="" onerror="this.remove()">` : ""}
        <div>
          <h2>${esc(payload.name)}</h2>
          <p class="muted">${esc(classLine)}</p>
          <p class="muted">AC ${payload.ac ?? "?"} · Prof ${fmtMod(payload.proficiency)} · Speed ${payload.speed ?? "?"} ft</p>
        </div>
      </section>

      <section class="card hp">
        <h2>Hit Points</h2>
        <div class="row">
          <button type="button" class="big" data-hp="-5">&minus;5</button>
          <button type="button" class="big" data-hp="-1">&minus;1</button>
          <div class="hp-value"><b>${state.hp.value}</b>/<span>${payload.hp?.max ?? "?"}</span>
            ${state.hp.temp ? `<small class="temp">+${state.hp.temp} temp</small>` : ""}</div>
          <button type="button" class="big" data-hp="1">+1</button>
          <button type="button" class="big" data-hp="5">+5</button>
        </div>
        <div class="row muted"><button type="button" class="text-btn" data-temp>Set temp HP</button></div>
      </section>

      <section class="card"><h2>Abilities</h2><div class="abilities">${abilities}</div></section>
      ${spellSection(payload, state)}
      ${inventorySection(payload, state)}
      <section class="card"><details><summary><h2>Skills</h2></summary>${skills}</details></section>
      <p class="muted center">Synced ${new Date(record.savedAt).toLocaleString()}</p>
    </div>`;

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => put(record).catch(console.error), 300);
  };
  const rerender = () => renderSheet(container, record);

  container.onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.hp) {
      const max = payload.hp?.max ?? 999;
      state.hp.value = Math.min(max, Math.max(0, state.hp.value + Number(button.dataset.hp)));
      save(); rerender(); return;
    }
    if (button.hasAttribute("data-temp")) {
      const temp = Number(prompt("Temporary hit points:", state.hp.temp || 0));
      if (!Number.isNaN(temp)) { state.hp.temp = Math.max(0, temp); save(); rerender(); }
      return;
    }
    const slotBox = button.closest("[data-slot]");
    if (slotBox) {
      const level = slotBox.dataset.slot;
      const max = payload.slots?.[level]?.max ?? 0;
      state.slots[level] = Math.min(max, Math.max(0, (state.slots[level] ?? 0) + Number(button.dataset.step)));
      save(); rerender(); return;
    }
    const usesBox = button.closest("[data-uses]");
    if (usesBox) {
      const index = usesBox.dataset.uses;
      const max = payload.items?.[index]?.uses?.max ?? 0;
      state.uses[index] = Math.min(max, Math.max(0, (state.uses[index] ?? 0) + Number(button.dataset.step)));
      save(); rerender(); return;
    }
  };
}
