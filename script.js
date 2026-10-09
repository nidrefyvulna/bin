/* =========================================================
   Panel IoT — versi dinamis (bisa tambah/hapus perangkat)

   Dua jenis perangkat:
   - "sensor" : kartu gauge (mis. suhu, kelembapan, level air, dst)
   - "switch" : kartu saklar ON/OFF (mis. lampu, pompa, kipas, dst)

   Semua perangkat + pengaturan broker disimpan di localStorage,
   jadi tetap ada walau halaman ditutup/dibuka lagi.
   ========================================================= */

const DEVICES_KEY = "iot-panel-devices-v2";
const CONFIG_KEY = "iot-panel-config-v2";

const DEFAULT_CONFIG = {
  brokerUrl: "wss://broker.hivemq.com:8884/mqtt",
  clientId: "web-panel-" + Math.random().toString(16).slice(2, 8),
  mqttUser: "",
  mqttPass: "",
};

const DEFAULT_DEVICES = [
  { id: "dev-suhu", type: "sensor", name: "Suhu Kamar 1", icon: "🌡️",
    topic: "rumah/kamar1/suhu", unit: "°C", min: 0, max: 50, color: "var(--amber)" },
  { id: "dev-lembap", type: "sensor", name: "Kelembapan Kamar 1", icon: "💧",
    topic: "rumah/kamar1/kelembapan", unit: "%", min: 0, max: 100, color: "var(--teal)" },
  { id: "dev-lampu-kamar", type: "switch", name: "Lampu Kamar", icon: "💡",
    topicState: "rumah/kamar1/lampu_kamar", topicSet: "rumah/kamar1/lampu_kamar/set" },
  { id: "dev-lampu-tidur", type: "switch", name: "Lampu Tidur", icon: "🌙",
    topicState: "rumah/kamar1/lampu_tidur", topicSet: "rumah/kamar1/lampu_tidur/set" },
];

const GAUGE_COLORS = ["var(--amber)", "var(--teal)", "var(--violet)", "var(--rose)", "var(--leaf)"];

let devices = [];
let client = null;
let simTimer = null;
const simValues = {};     // id -> nilai simulasi saat ini
const switchStates = {};  // id -> boolean ON/OFF
const cardRefs = {};      // id -> { valueEl, arcEl } atau { toggleEl, stateEl }

/* ---------- helpers ---------- */
const el = (id) => document.getElementById(id);
const uid = () => "dev-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- storage ---------- */
function loadDevices() {
  try {
    const raw = localStorage.getItem(DEVICES_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupted storage */ }
  return DEFAULT_DEVICES.map((d) => ({ ...d }));
}
function saveDevices() { localStorage.setItem(DEVICES_KEY, JSON.stringify(devices)); }

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) { /* ignore corrupted storage */ }
  return { ...DEFAULT_CONFIG };
}
function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }

/* ---------- rendering device grid ---------- */
function renderDevices() {
  const grid = el("deviceGrid");
  grid.innerHTML = "";

  if (devices.length === 0) {
    grid.innerHTML = '<div class="device-empty">Belum ada perangkat. Klik "+ Tambah Perangkat" untuk mulai.</div>';
    return;
  }

  devices.forEach((d) => {
    const card = d.type === "sensor" ? buildSensorCard(d) : buildSwitchCard(d);
    grid.appendChild(card);
  });
}

function buildSensorCard(d) {
  const card = document.createElement("article");
  card.className = "device-card gauge-card";
  card.innerHTML = `
    <button class="device-remove" type="button" aria-label="Hapus ${d.name}">×</button>
    <div class="gauge-card-head">
      <span class="gauge-icon">${d.icon || "🌡️"}</span>
      <span class="gauge-title">${d.name}</span>
    </div>
    <svg class="gauge" viewBox="0 0 160 100" aria-hidden="true">
      <path class="gauge-track" d="M 15 90 A 65 65 0 0 1 145 90" />
      <path class="gauge-fill" style="stroke:${d.color || "var(--amber)"}" d="M 15 90 A 65 65 0 0 1 145 90" />
    </svg>
    <div class="gauge-value"><span class="value-num">--</span><span class="gauge-unit">${d.unit || ""}</span></div>
    <div class="gauge-range"><span>${d.min}${d.unit || ""}</span><span>${d.max}${d.unit || ""}</span></div>
    <span class="topic-tag">${d.topic}</span>
  `;
  card.querySelector(".device-remove").addEventListener("click", () => removeDevice(d.id));

  const arcEl = card.querySelector(".gauge-fill");
  const valueEl = card.querySelector(".value-num");
  cardRefs[d.id] = { arcEl, valueEl };

  // set gauge ke posisi minimum saat pertama dibuat
  requestAnimationFrame(() => setGauge(arcEl, Number(d.min), d));

  return card;
}

function buildSwitchCard(d) {
  const isOn = !!switchStates[d.id];
  const card = document.createElement("article");
  card.className = "device-card switch-card";
  card.innerHTML = `
    <button class="device-remove" type="button" aria-label="Hapus ${d.name}">×</button>
    <div class="switch-info">
      <span class="switch-icon">${d.icon || "💡"}</span>
      <div>
        <span class="switch-title">${d.name}</span>
        <span class="topic-tag">${d.topicState}</span>
      </div>
    </div>
    <button class="toggle" type="button" role="switch" aria-checked="${isOn}" aria-label="Nyalakan atau matikan ${d.name}">
      <span class="toggle-track"><span class="toggle-thumb"></span></span>
      <span class="toggle-state">${isOn ? "ON" : "OFF"}</span>
    </button>
  `;
  card.querySelector(".device-remove").addEventListener("click", () => removeDevice(d.id));

  const toggleEl = card.querySelector(".toggle");
  const stateEl = card.querySelector(".toggle-state");
  cardRefs[d.id] = { toggleEl, stateEl };

  toggleEl.addEventListener("click", () => {
    const next = !switchStates[d.id];
    switchStates[d.id] = next;
    setToggleUI(d.id, next);
    publish(d.topicSet, next ? "ON" : "OFF");
  });

  return card;
}

/* ---------- gauge / toggle updates ---------- */
function setGauge(pathEl, value, device) {
  const len = pathEl.getTotalLength();
  pathEl.style.strokeDasharray = len;
  const pct = Math.min(1, Math.max(0, (value - device.min) / (device.max - device.min)));
  pathEl.style.strokeDashoffset = String(len * (1 - pct));
}

function updateSensorValue(id, numericValue) {
  const device = devices.find((d) => d.id === id);
  const refs = cardRefs[id];
  if (!device || !refs) return;
  const num = Number(numericValue);
  if (Number.isNaN(num)) return;
  refs.valueEl.textContent = Number.isInteger(num) ? num : num.toFixed(1);
  setGauge(refs.arcEl, num, device);
}

function setToggleUI(id, isOn) {
  const refs = cardRefs[id];
  if (!refs) return;
  refs.toggleEl.setAttribute("aria-checked", String(isOn));
  refs.stateEl.textContent = isOn ? "ON" : "OFF";
}

/* ---------- add / remove device ---------- */
function removeDevice(id) {
  const device = devices.find((d) => d.id === id);
  devices = devices.filter((d) => d.id !== id);
  delete cardRefs[id];
  delete simValues[id];
  delete switchStates[id];
  saveDevices();
  renderDevices();
  if (client && client.connected && device) {
    const topic = device.type === "sensor" ? device.topic : device.topicState;
    if (topic) client.unsubscribe(topic);
  }
  logMessage("system", `Perangkat "${device ? device.name : id}" dihapus.`);
}

function addDeviceFromForm() {
  const type = el("typePills").querySelector(".type-pill.is-active").dataset.type;
  const name = el("devName").value.trim();
  const icon = el("devIcon").value.trim();

  if (!name) { el("devName").focus(); return; }

  let device;
  if (type === "sensor") {
    const topic = el("devTopic").value.trim();
    if (!topic) { el("devTopic").focus(); return; }
    const colorIndex = devices.filter((d) => d.type === "sensor").length % GAUGE_COLORS.length;
    device = {
      id: uid(), type: "sensor", name, icon: icon || "🌡️",
      topic,
      unit: el("devUnit").value.trim(),
      min: Number(el("devMin").value) || 0,
      max: Number(el("devMax").value) || 100,
      color: GAUGE_COLORS[colorIndex],
    };
  } else {
    const topicState = el("devTopicState").value.trim();
    const topicSet = el("devTopicSet").value.trim();
    if (!topicState || !topicSet) { el(topicState ? "devTopicSet" : "devTopicState").focus(); return; }
    device = { id: uid(), type: "switch", name, icon: icon || "💡", topicState, topicSet };
  }

  devices.push(device);
  saveDevices();
  renderDevices();
  closeDevicePanel();
  clearDeviceForm();
  logMessage("system", `Perangkat "${device.name}" ditambahkan.`);

  // langsung subscribe / mulai simulasi kalau sedang aktif
  if (client && client.connected) {
    const topic = device.type === "sensor" ? device.topic : device.topicState;
    client.subscribe(topic);
  } else if (simTimer && device.type === "sensor") {
    simValues[device.id] = (device.min + device.max) / 2;
  }
}

function clearDeviceForm() {
  el("devName").value = "";
  el("devIcon").value = "";
  el("devTopic").value = "";
  el("devUnit").value = "°C";
  el("devMin").value = "0";
  el("devMax").value = "50";
  el("devTopicState").value = "";
  el("devTopicSet").value = "";
  resetTypePills();
}

function resetTypePills() {
  el("typePills").querySelectorAll(".type-pill").forEach((p) => p.classList.toggle("is-active", p.dataset.type === "sensor"));
  el("sensorFields").hidden = false;
  el("switchFields").hidden = true;
}

/* ---------- type pill switch (sensor / saklar) ---------- */
el("typePills").addEventListener("click", (e) => {
  const btn = e.target.closest(".type-pill");
  if (!btn) return;
  el("typePills").querySelectorAll(".type-pill").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  const isSensor = btn.dataset.type === "sensor";
  el("sensorFields").hidden = !isSensor;
  el("switchFields").hidden = isSensor;
});

/* ---------- panels open/close ---------- */
function openDevicePanel() { el("settingsPanel").classList.remove("is-open"); el("devicePanel").classList.add("is-open"); }
function closeDevicePanel() { el("devicePanel").classList.remove("is-open"); }
function openSettingsPanel() { el("devicePanel").classList.remove("is-open"); el("settingsPanel").classList.toggle("is-open"); }

el("addDeviceBtn").addEventListener("click", openDevicePanel);
el("closeDevicePanelBtn").addEventListener("click", closeDevicePanel);
el("cancelDeviceBtn").addEventListener("click", () => { closeDevicePanel(); clearDeviceForm(); });
el("saveDeviceBtn").addEventListener("click", addDeviceFromForm);

el("statusPill").addEventListener("click", openSettingsPanel);
el("closeSettingsBtn").addEventListener("click", () => el("settingsPanel").classList.remove("is-open"));

/* ---------- status ---------- */
function setStatus(mode, text) {
  const dot = el("statusDot");
  dot.classList.remove("is-connecting", "is-connected");
  if (mode === "connecting") dot.classList.add("is-connecting");
  if (mode === "connected") dot.classList.add("is-connected");
  el("statusText").textContent = text;
}

/* ---------- log ---------- */
function logMessage(topic, payload) {
  const logList = el("logList");
  if (logList.querySelector(".log-empty")) logList.innerHTML = "";
  const li = document.createElement("li");
  const time = new Date().toLocaleTimeString("id-ID", { hour12: false });
  li.innerHTML = `<span class="log-time">${time}</span><strong>${topic}</strong> → ${payload}`;
  logList.prepend(li);
  while (logList.children.length > 25) logList.removeChild(logList.lastChild);
}
el("clearLogBtn").addEventListener("click", () => {
  el("logList").innerHTML = '<li class="log-empty">Belum ada pesan.</li>';
});

/* ---------- MQTT ---------- */
function publish(topic, payload) {
  if (client && client.connected) {
    client.publish(topic, payload);
    logMessage(topic, payload + " (terkirim)");
  } else {
    logMessage(topic, payload + " (mode simulasi / tidak terhubung)");
  }
}

function disconnectAll() {
  if (client) { client.end(true); client = null; }
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
}

function subscribeAllDevices() {
  devices.forEach((d) => {
    const topic = d.type === "sensor" ? d.topic : d.topicState;
    if (topic) client.subscribe(topic);
  });
}

function connectMqtt(cfg) {
  disconnectAll();
  setStatus("connecting", "Menghubungkan…");

  try {
    client = mqtt.connect(cfg.brokerUrl, {
      clientId: cfg.clientId,
      username: cfg.mqttUser || undefined,
      password: cfg.mqttPass || undefined,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 4000,
    });
  } catch (err) {
    setStatus("", "Gagal: URL tidak valid");
    logMessage("system", "Gagal membuat koneksi — periksa Broker URL.");
    return;
  }

  client.on("connect", () => {
    setStatus("connected", "Terhubung");
    logMessage("system", "Terhubung ke broker.");
    subscribeAllDevices();
  });

  client.on("reconnect", () => setStatus("connecting", "Menyambung ulang…"));
  client.on("close", () => setStatus("", "Terputus"));
  client.on("error", (err) => {
    setStatus("", "Error koneksi");
    logMessage("system", "Error: " + (err && err.message ? err.message : "tidak diketahui"));
  });

  client.on("message", (topic, payloadBuf) => {
    let payload = payloadBuf.toString();
    let numericPayload = payload;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && "value" in parsed) numericPayload = parsed.value;
    } catch (e) { /* bukan JSON, pakai apa adanya */ }

    logMessage(topic, payload);

    const sensor = devices.find((d) => d.type === "sensor" && d.topic === topic);
    if (sensor) { updateSensorValue(sensor.id, numericPayload); return; }

    const sw = devices.find((d) => d.type === "switch" && d.topicState === topic);
    if (sw) {
      const isOn = ["on", "1", "true"].includes(String(payload).trim().toLowerCase());
      switchStates[sw.id] = isOn;
      setToggleUI(sw.id, isOn);
    }
  });
}

/* ---------- simulate mode ---------- */
function startSimulation() {
  disconnectAll();
  setStatus("connected", "Mode simulasi");
  logMessage("system", "Mode simulasi aktif — data acak untuk pratinjau tampilan.");

  devices.forEach((d) => {
    if (d.type === "sensor" && !(d.id in simValues)) simValues[d.id] = (Number(d.min) + Number(d.max)) / 2;
  });

  const tick = () => {
    devices.forEach((d) => {
      if (d.type !== "sensor") return;
      const range = Number(d.max) - Number(d.min);
      let v = (simValues[d.id] ?? (Number(d.min) + Number(d.max)) / 2) + (Math.random() - 0.5) * range * 0.06;
      v = Math.min(Number(d.max), Math.max(Number(d.min), v));
      simValues[d.id] = v;
      updateSensorValue(d.id, v);
      logMessage(d.topic, v.toFixed(1));
    });
  };

  tick();
  simTimer = setInterval(tick, 3000);
}

/* ---------- settings buttons ---------- */
function readConfigFromForm() {
  return {
    brokerUrl: el("brokerUrl").value.trim(),
    clientId: el("clientId").value.trim() || DEFAULT_CONFIG.clientId,
    mqttUser: el("mqttUser").value.trim(),
    mqttPass: el("mqttPass").value,
  };
}
function fillFormFromConfig(cfg) {
  el("brokerUrl").value = cfg.brokerUrl;
  el("clientId").value = cfg.clientId;
  el("mqttUser").value = cfg.mqttUser;
  el("mqttPass").value = cfg.mqttPass;
}

el("connectBtn").addEventListener("click", () => {
  const cfg = readConfigFromForm();
  saveConfig(cfg);
  connectMqtt(cfg);
  el("settingsPanel").classList.remove("is-open");
});
el("simulateBtn").addEventListener("click", () => {
  const cfg = readConfigFromForm();
  saveConfig(cfg);
  startSimulation();
  el("settingsPanel").classList.remove("is-open");
});

/* ---------- boot ---------- */
(function init() {
  devices = loadDevices();
  const cfg = loadConfig();
  fillFormFromConfig(cfg);
  renderDevices();
  setStatus("", "Terputus — atur koneksi");
})();
