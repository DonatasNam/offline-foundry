import { getAll, get, remove } from "./db.js";
import { importFromText, importPayload, refresh } from "./sync.js";
import { startScanner } from "./scanner.js";
import { renderSheet } from "./sheet.js";

const main = document.getElementById("main");
const titleEl = document.getElementById("title");
const backBtn = document.getElementById("back-btn");
const scanBtn = document.getElementById("scan-btn");
const installBtn = document.getElementById("install-btn");
const toastEl = document.getElementById("toast");

/** Installed to a home screen vs running as a browser page. */
function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer = null;
export function toast(message, sticky = false) {
  toastEl.textContent = "";
  toastEl.append(message instanceof Node ? message : document.createTextNode(message));
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

let stopScanner = null;
function leaveScanner() {
  if (stopScanner) { stopScanner(); stopScanner = null; }
}

/* ------------------------- views ------------------------- */

async function showRoster() {
  const records = (await getAll()).sort((a, b) => a.payload.name.localeCompare(b.payload.name));
  titleEl.textContent = "Offline Foundry";
  backBtn.hidden = true;

  const modeLine = `<p class="muted center">${isInstalled()
    ? "Running as the installed app."
    : "Running as a browser page. Install it for offline use."}</p>`;

  if (!records.length) {
    main.innerHTML = `<div class="empty">
      <p>No characters yet.</p>
      <p class="muted">In Foundry, open a character sheet, press the QR button, then tap Scan up top and point the camera at it.</p>
    </div>` + modeLine;
    return;
  }
  main.innerHTML = `<div class="roster">` + records.map(r => `
    <div class="card row roster-item" data-uuid="${esc(r.uuid)}">
      ${r.payload.img ? `<img class="thumb" src="${esc(r.payload.img)}" alt="" onerror="this.remove()">` : ""}
      <span class="grow">
        <b>${esc(r.payload.name)}</b><br>
        <small class="muted">${esc(r.payload.type === "character"
          ? (r.payload.classes ?? []).map(c => `${c.name} ${c.levels}`).join(" / ")
          : `CR ${r.payload.cr ?? "?"}`)} · synced ${new Date(r.savedAt).toLocaleDateString()}</small>
      </span>
      <button type="button" class="icon-btn" data-refresh title="Re-fetch from the last link">&#8635;</button>
      <button type="button" class="icon-btn" data-delete title="Remove">&#10005;</button>
    </div>`).join("") + `</div>` + modeLine;

  main.onclick = async event => {
    const item = event.target.closest(".roster-item");
    if (!item) return;
    const uuid = item.dataset.uuid;
    if (event.target.closest("[data-delete]")) {
      if (confirm("Remove this character from the app?")) {
        await remove(uuid);
        showRoster();
      }
      return;
    }
    if (event.target.closest("[data-refresh]")) {
      try {
        const record = await get(uuid);
        await refresh(record);
        toast("Updated from Foundry.");
        showRoster();
      } catch (err) {
        toast(`Refresh failed: ${err.message}`);
      }
      return;
    }
    location.hash = `#/c/${uuid}`;
  };
}

async function showSheet(uuid) {
  const record = await get(uuid);
  if (!record) { location.hash = "#/"; return; }
  titleEl.textContent = record.payload.name;
  backBtn.hidden = false;
  renderSheet(main, record);
}

function showScan() {
  titleEl.textContent = "Scan";
  backBtn.hidden = false;
  main.innerHTML = `
    <div class="scan">
      <video id="scan-video" playsinline muted autoplay></video>
      <p id="scan-status" class="muted center">Starting camera&hellip;</p>
      <div class="card">
        <p class="muted">No camera? Paste the share link instead:</p>
        <div class="row">
          <input id="paste-url" class="grow" type="url" placeholder="https://&hellip;">
          <button type="button" id="paste-go" class="text-btn">Fetch</button>
        </div>
        <p class="muted">Or import a downloaded payload file:</p>
        <input id="file-import" type="file" accept=".json,application/json">
      </div>
    </div>`;

  const status = document.getElementById("scan-status");
  const video = document.getElementById("scan-video");

  const finish = async promise => {
    try {
      const { record, updated } = await promise;
      leaveScanner();
      toast(updated ? `${record.payload.name} updated.` : `${record.payload.name} added.`);
      location.hash = `#/c/${record.uuid}`;
    } catch (err) {
      status.textContent = err.message;
      toast(err.message);
    }
  };

  startScanner(video, text => {
    status.textContent = "Fetching…";
    finish(importFromText(text));
  }).then(stop => { stopScanner = stop; status.textContent = "Point the camera at the QR code."; })
    .catch(err => { status.textContent = `Camera unavailable: ${err.message}. Paste the link below instead.`; });

  document.getElementById("paste-go").onclick = () =>
    finish(importFromText(document.getElementById("paste-url").value));
  document.getElementById("file-import").onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      finish(importPayload(payload));
    } catch {
      toast("That file is not valid JSON.");
    }
  };
}

/* ------------------------- router ------------------------- */

function route() {
  leaveScanner();
  main.onclick = null;
  const hash = location.hash || "#/";
  if (hash.startsWith("#/c/")) return showSheet(hash.slice(3 + 1));
  if (hash === "#/scan") return showScan();
  return showRoster();
}
window.addEventListener("hashchange", route);
backBtn.onclick = () => { location.hash = "#/"; };
scanBtn.onclick = () => { location.hash = "#/scan"; };

/* -------------------- install button -------------------- */
/* Chromium fires beforeinstallprompt when the app is installable; the
   automatic banner is heuristic and unreliable, so capture the event and
   offer a deterministic Install button in the top bar instead. */

let deferredInstall = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstall = event;
  if (!isInstalled()) installBtn.hidden = false;
});

installBtn.onclick = async () => {
  if (!deferredInstall) return;
  const prompt = deferredInstall;
  deferredInstall = null;
  installBtn.hidden = true; // the stashed event is single use
  prompt.prompt();
  const choice = await prompt.userChoice.catch(() => null);
  if (choice?.outcome !== "accepted") {
    toast("Install dismissed. The button returns when Chrome offers again.");
  }
};

window.addEventListener("appinstalled", () => {
  installBtn.hidden = true;
  toast("Installed. Open it from your home screen.");
});

/* ------------------- install hint (iOS) ------------------- */

function iosInstallHint() {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (isIos && !isInstalled() && !localStorage.getItem("of-install-hint")) {
    const node = document.createElement("span");
    node.innerHTML = `Install: tap <b>Share</b>, then <b>Add to Home Screen</b>. `;
    const dismiss = document.createElement("button");
    dismiss.className = "text-btn";
    dismiss.textContent = "Got it";
    dismiss.onclick = () => { toastEl.hidden = true; localStorage.setItem("of-install-hint", "1"); };
    node.append(dismiss);
    toast(node, true);
  }
}

/* ------------------- service worker ------------------- */

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("sw.js");
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          const node = document.createElement("span");
          node.textContent = "Update ready. ";
          const reload = document.createElement("button");
          reload.className = "text-btn";
          reload.textContent = "Reload";
          reload.onclick = () => worker.postMessage({ type: "SKIP_WAITING" });
          node.append(reload);
          toast(node, true);
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  } catch (err) {
    console.warn("offline-foundry | service worker registration failed", err);
  }
}

route();
iosInstallHint();
registerSw();
