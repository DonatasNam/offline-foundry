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

/** Active tab per character, session-scoped on purpose (fresh visit = Main). */
const activeTabs = new Map();

/** Mode of the green plus button per character: "heal" or "temp". */
const plusModes = new Map();

const INVENTORY_EXCLUDED = ["class", "subclass", "background", "race"];

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

  const hasSpells = (payload.items ?? []).some(i => i.type === "spell");
  const hasItems = (payload.items ?? []).some(i =>
    i.type !== "spell" && !INVENTORY_EXCLUDED.includes(i.type));
  let tab = activeTabs.get(record.uuid) ?? "main";
  if ((tab === "spells" && !hasSpells) || (tab === "items" && !hasItems)) tab = "main";
  const plusMode = plusModes.get(record.uuid) ?? "heal";

  const mainTab = `
      <section class="card header">
        ${payload.img ? `<img class="portrait" src="${esc(payload.img)}" alt="" onerror="this.remove()">` : ""}
        <div class="grow">
          <h2>${esc(payload.name)}</h2>
          <p class="muted">${esc(classLine)}</p>
        </div>
        <div class="header-stats">
          <div class="stat-box"><b>Prof</b><span>${fmtMod(payload.proficiency)}</span></div>
          <div class="stat-box"><b>Speed</b><span>${payload.speed ?? "?"} ft</span></div>
        </div>
      </section>

      <section class="card hp">
        <h2>Hit Points</h2>
        <div class="hp-value"><b>${state.hp.value}</b>/<span>${payload.hp?.max ?? "?"}</span></div>
        ${state.hp.temp ? `<p class="temp-badge">${state.hp.temp} temp HP</p>` : ""}
        <div class="row hp-apply">
          <button type="button" class="big damage" data-apply="damage" aria-label="Apply damage">&minus;</button>
          <input class="hp-amount" type="number" inputmode="numeric" min="0" placeholder="0" aria-label="Amount">
          <button type="button" class="big heal" data-apply="plus" aria-label="Apply healing or temp HP">+</button>
        </div>
        <div class="row mode-row">
          <button type="button" class="chip mode-heal ${plusMode === "heal" ? "active" : ""}" data-plus-mode="heal">Heal</button>
          <button type="button" class="chip mode-temp ${plusMode === "temp" ? "active" : ""}" data-plus-mode="temp">Temp HP</button>
        </div>
      </section>

      <section class="card"><h2>Abilities</h2><div class="abilities">${abilities}</div></section>
      <section class="card"><details><summary><h2>Skills</h2></summary>${skills}</details></section>`;

  const content = tab === "spells" ? spellSection(payload, state)
    : tab === "items" ? inventorySection(payload, state)
    : mainTab;

  const tabButton = (key, label) =>
    `<button type="button" data-tab="${key}" class="${tab === key ? "active" : ""}">${label}</button>`;

  container.innerHTML = `
    <div class="sheet">
      ${content}
      <p class="muted center">Synced ${new Date(record.savedAt).toLocaleString()}</p>
    </div>
    <nav class="tabbar">
      ${tabButton("main", "Main")}
      ${hasSpells ? tabButton("spells", "Spells") : ""}
      ${hasItems ? tabButton("items", "Items") : ""}
    </nav>`;

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => put(record).catch(console.error), 300);
  };
  const rerender = () => renderSheet(container, record);

  container.onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.tab) {
      activeTabs.set(record.uuid, button.dataset.tab);
      rerender();
      window.scrollTo(0, 0);
      return;
    }
    if (button.dataset.plusMode) {
      // Pure DOM toggle so a typed amount survives the mode switch.
      plusModes.set(record.uuid, button.dataset.plusMode);
      container.querySelectorAll("[data-plus-mode]").forEach(chip =>
        chip.classList.toggle("active", chip === button));
      return;
    }
    if (button.dataset.apply) {
      const input = container.querySelector(".hp-amount");
      const raw = (input?.value ?? "").trim();
      const amount = Math.floor(Math.abs(Number(raw)));
      const isTemp = button.dataset.apply === "plus" && plusModes.get(record.uuid) === "temp";
      // An explicit 0 is only meaningful in temp mode (clearing temp HP).
      if (raw === "" || Number.isNaN(amount) || (!amount && !isTemp)) return;
      if (button.dataset.apply === "damage") {
        // dnd rule: damage consumes temp HP first, the rest hits real HP.
        const fromTemp = Math.min(state.hp.temp, amount);
        state.hp.temp -= fromTemp;
        state.hp.value = Math.max(0, state.hp.value - (amount - fromTemp));
      } else if (isTemp) {
        // dnd rule: temp HP never stacks; a new amount replaces the old one.
        state.hp.temp = amount;
      } else {
        const max = payload.hp?.max ?? 999;
        state.hp.value = Math.min(max, state.hp.value + amount);
      }
      save(); rerender(); return;
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
