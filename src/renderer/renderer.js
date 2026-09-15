const state = { databases: [], activeDatabase: null, activeCollection: null };
const $ = (selector) => document.querySelector(selector);

const connectionString = $("#connectionString");
const connectButton = $("#connectButton");
const connectLabel = $("#connectLabel");
const errorMessage = $("#errorMessage");
const databaseTree = $("#databaseTree");
const savedConnections = $("#savedConnections");
let savedConnectionList = [];

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.toggle("visible", Boolean(message));
}

function setLoading(loading) {
  connectButton.disabled = loading;
  connectButton.classList.toggle("loading", loading);
  connectLabel.textContent = loading ? "Connecting" : "Connect";
}

function renderSavedConnections() {
  $("#savedCount").textContent = savedConnectionList.length;
  if (!savedConnectionList.length) {
    savedConnections.innerHTML = '<div class="tree-empty">No saved connections yet.</div>';
    return;
  }
  savedConnections.innerHTML = savedConnectionList.map((connection) => `
    <div class="saved-connection">
      <button class="saved-connection-main" data-id="${connection.id}" type="button">
        <span class="saved-connection-name">${escapeHtml(connection.name)}</span>
        <span class="saved-connection-uri">${escapeHtml(maskUri(connection.uri))}</span>
      </button>
      <button class="saved-connection-delete" data-id="${connection.id}" type="button" aria-label="Delete ${escapeHtml(connection.name)}">x</button>
    </div>
  `).join("");

  savedConnections.querySelectorAll(".saved-connection-main").forEach((button) => {
    button.addEventListener("click", () => {
      const connection = savedConnectionList.find((item) => item.id === button.dataset.id);
      if (connection) {
        connectionString.value = connection.uri;
        connect();
      }
    });
  });
  savedConnections.querySelectorAll(".saved-connection-delete").forEach((button) => {
    button.addEventListener("click", () => deleteSavedConnection(button.dataset.id));
  });
}

function maskUri(uri) {
  try {
    const parsed = new URL(uri);
    if (parsed.password) parsed.password = "******";
    if (parsed.username) parsed.username = "****";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return uri.length > 28 ? `${uri.slice(0, 28)}...` : uri;
  }
}

async function loadSavedConnections() {
  try {
    savedConnectionList = await window.mongoApi.listConnections();
    renderSavedConnections();
  } catch (error) {
    showError(error.message || "Could not load saved connections.");
  }
}

async function saveCurrentConnection() {
  const uri = connectionString.value.trim();
  if (!uri) {
    showError("Enter a MongoDB URI before saving it.");
    return;
  }
  const name = window.prompt("Name this connection", "Local MongoDB");
  if (!name?.trim()) return;
  try {
    const saved = await window.mongoApi.saveConnection({ name, uri });
    savedConnectionList = [saved, ...savedConnectionList.filter((item) => item.id !== saved.id)];
    renderSavedConnections();
    showError("");
  } catch (error) {
    showError(error.message || "Could not save this connection.");
  }
}

async function deleteSavedConnection(id) {
  try {
    await window.mongoApi.deleteConnection(id);
    savedConnectionList = savedConnectionList.filter((connection) => connection.id !== id);
    renderSavedConnections();
  } catch (error) {
    showError(error.message || "Could not delete this connection.");
  }
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / Math.pow(1024, unit)).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function renderTree(databases) {
  if (!databases.length) {
    databaseTree.innerHTML =
      '<div class="tree-empty">No databases returned.</div>';
    return;
  }
  databaseTree.innerHTML = databases
    .map(
      (database) => `
    <div class="database-node">
      <div class="database-name" title="${database.name}">${database.name}</div>
      <div class="collection-list">
        ${database.collections.length ? database.collections.map((collection) => `<button class="collection-button" data-db="${database.name}" data-collection="${collection}">${collection}</button>`).join("") : '<div class="tree-empty">No collections</div>'}
      </div>
    </div>
  `,
    )
    .join("");

  document.querySelectorAll(".collection-button").forEach((button) => {
    button.addEventListener("click", () =>
      openCollection(button.dataset.db, button.dataset.collection, button),
    );
  });
}

function updateOverview(databases) {
  const collectionTotal = databases.reduce(
    (total, database) => total + database.collections.length,
    0,
  );
  $("#databaseCount").textContent = `${databases.length} db`;
  $("#databaseMetric").textContent = databases.length;
  $("#collectionMetric").textContent = collectionTotal;
  $("#statusMetric").textContent = "Live";
  $("#statusMetric").style.color = "var(--mint)";
  $("#viewTitle").textContent = "Your data, in focus.";
  $("#viewSubtitle").textContent =
    "Select a collection from the explorer to inspect its documents.";
  $(".connection-state").classList.add("is-connected");
  $(".connection-state").innerHTML =
    '<span class="status-dot"></span> Connected';
}

async function connect() {
  showError("");
  setLoading(true);
  try {
    const result = await window.mongoApi.connect(connectionString.value.trim());
    state.databases = result.databases;
    renderTree(state.databases);
    updateOverview(state.databases);
  } catch (error) {
    showError(error.message || "Could not connect to MongoDB.");
  } finally {
    setLoading(false);
  }
}

function renderValue(value) {
  if (value === null) return '<span class="json-value">null</span>';
  if (typeof value === "object")
    return `<span class="json-value">${escapeHtml(JSON.stringify(value))}</span>`;
  if (typeof value === "string") return escapeHtml(value);
  return `<span class="json-value">${escapeHtml(String(value))}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}

async function openCollection(databaseName, collectionName, button) {
  showError("");
  document
    .querySelectorAll(".collection-button")
    .forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  $("#collectionTitle").textContent = collectionName;
  $("#breadcrumb").innerHTML =
    `${databaseName} <span>/</span> ${collectionName}`;
  $("#recordCount").textContent = "Loading...";
  $("#tableWrap").innerHTML =
    '<div class="table-empty"><div class="spinner" style="display:block;border-color:rgba(169,235,197,.2);border-top-color:var(--mint)"></div><p style="margin-top:16px">Fetching documents...</p></div>';
  try {
    const result = await window.mongoApi.openCollection(
      databaseName,
      collectionName,
    );
    state.activeDatabase = databaseName;
    state.activeCollection = collectionName;
    renderTable(result.documents);
    $("#recordCount").textContent =
      `${result.count.toLocaleString()} documents`;
    $("#headerStat").innerHTML =
      `<strong>${result.documents.length}</strong><span>documents loaded</span>`;
  } catch (error) {
    showError(error.message || "Could not load this collection.");
    $("#recordCount").textContent = "";
  }
}

function renderTable(documents) {
  if (!documents.length) {
    $("#tableWrap").innerHTML =
      '<div class="table-empty"><div class="empty-glyph">[ ]</div><h3>This collection is empty</h3><p>No documents were returned from this collection.</p></div>';
    return;
  }
  const keys = [
    ...new Set(documents.flatMap((document) => Object.keys(document))),
  ].slice(0, 8);
  $("#tableWrap").innerHTML =
    `<table class="data-table"><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>${documents.map((document) => `<tr>${keys.map((key) => `<td title="${escapeHtml(JSON.stringify(document[key] ?? ""))}">${renderValue(document[key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

$("#toggleVisibility").addEventListener("click", () => {
  const isPassword = connectionString.type === "password";
  connectionString.type = isPassword ? "text" : "password";
  $("#toggleVisibility").textContent = isPassword ? "Hide" : "Show";
});
connectButton.addEventListener("click", connect);
$("#saveConnectionButton").addEventListener("click", saveCurrentConnection);
connectionString.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});

loadSavedConnections();
