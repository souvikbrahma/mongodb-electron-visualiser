const state = { databases: [], activeDatabase: null, activeCollection: null };
const $ = (selector) => document.querySelector(selector);

const connectionString = $("#connectionString");
const connectionName = $("#connectionName");
const connectButton = $("#connectButton");
const connectLabel = $("#connectLabel");
const errorMessage = $("#errorMessage");
const databaseTree = $("#databaseTree");
const savedConnections = $("#savedConnections");
let savedConnectionList = [];
let savedQueryList = [];
let queryMode = "builder";
let editingQueryId = null;
let collectionViewer = "tree";
let loadedDocuments = null;

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.toggle("visible", Boolean(message));
}

function showQueryError(message) {
  $("#queryError").textContent = message;
  $("#queryError").classList.toggle("visible", Boolean(message));
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

function renderSavedQueries() {
  const container = $("#savedQueries");
  if (!savedQueryList.length) {
    container.innerHTML = '<span class="tree-empty">No saved queries yet.</span>';
    return;
  }
  container.innerHTML = savedQueryList.map((query) => `
    <div class="saved-query-item${query.id === editingQueryId ? " editing" : ""}">
      <button class="saved-query-main" data-id="${query.id}" type="button">
        <strong>${escapeHtml(query.name)}</strong>
        <span>${escapeHtml(`${query.databaseName}.${query.collectionName}`)}</span>
      </button>
      <button class="saved-query-edit" data-id="${query.id}" type="button" aria-label="Edit ${escapeHtml(query.name)}">Edit</button>
      <button class="saved-query-delete" data-id="${query.id}" type="button" aria-label="Delete ${escapeHtml(query.name)}">x</button>
    </div>
  `).join("");
  container.querySelectorAll(".saved-query-main").forEach((button) => {
    button.addEventListener("click", () => loadSavedQuery(button.dataset.id));
  });
  container.querySelectorAll(".saved-query-edit").forEach((button) => {
    button.addEventListener("click", () => loadSavedQuery(button.dataset.id, true));
  });
  container.querySelectorAll(".saved-query-delete").forEach((button) => {
    button.addEventListener("click", () => deleteSavedQuery(button.dataset.id));
  });
}

async function loadSavedQueries() {
  try {
    savedQueryList = await window.mongoApi.listQueries();
    renderSavedQueries();
  } catch (error) {
    showQueryError(error.message || "Could not load saved queries.");
  }
}

function parseQueryJson(value, label) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function currentQuery() {
  if (!state.activeDatabase || !state.activeCollection) {
    throw new Error("Choose a collection before building a query.");
  }
  if (queryMode === "flat") {
    const command = $("#flatQuery").value.trim();
    if (!command) throw new Error("Enter a collection command, such as .find({}).");
    return { databaseName: state.activeDatabase, collectionName: state.activeCollection, mode: "flat", command };
  }
  const filter = parseQueryJson($("#queryFilter").value, "Filter");
  return {
    databaseName: state.activeDatabase,
    collectionName: state.activeCollection,
    filter,
    sort: parseQueryJson($("#querySort").value, "Sort"),
    limit: Math.min(Math.max(Number($("#queryLimit").value) || 100, 1), 500),
  };
}

async function runQuery() {
  showQueryError("");
  try {
    const query = currentQuery();
    $("#runQueryButton").disabled = true;
    $("#runQueryButton").classList.add("loading");
    const result = await window.mongoApi.runQuery(query);
    renderTable(result.documents);
    $("#recordCount").textContent = `${result.documents.length} ${result.resultType || "documents"}`;
    $("#headerStat").innerHTML = `<strong>${result.documents.length}</strong><span>${result.resultType === "results" ? "results returned" : "documents loaded"}</span>`;
  } catch (error) {
    showQueryError(error.message || "Could not run this query.");
  } finally {
    $("#runQueryButton").disabled = false;
    $("#runQueryButton").classList.remove("loading");
  }
}

async function saveCurrentQuery() {
  if ($("#saveQueryButton").disabled) return;
  showQueryError("");
  try {
    const query = currentQuery();
    const name = $("#queryName").value.trim();
    if (!name) throw new Error("Enter a name before saving this query.");
    const id = editingQueryId;
    $("#saveQueryButton").disabled = true;
    const saved = await window.mongoApi.saveQuery({ ...query, id: id || undefined, name, mode: queryMode });
    savedQueryList = [saved, ...savedQueryList.filter((item) => item.id !== saved.id)];
    if (editingQueryId === id) setEditingQuery(null);
    renderSavedQueries();
  } catch (error) {
    showQueryError(error.message || "Could not save this query.");
  } finally {
    $("#saveQueryButton").disabled = false;
  }
}

function setEditingQuery(query) {
  editingQueryId = query?.id || null;
  $("#queryName").value = query?.name || "";
  $("#saveQueryButton").textContent = query ? "Update query" : "Save query";
  $("#cancelQueryEditButton").hidden = !query;
  $("#queryEditStatus").textContent = query ? `Editing “${query.name}”` : "";
  $("#queryEditStatus").hidden = !query;
  renderSavedQueries();
}

function cancelQueryEdit() {
  if (editingQueryId) loadSavedQuery(editingQueryId, true);
  setEditingQuery(null);
  showQueryError("");
}

function loadSavedQuery(id, edit = false) {
  const query = savedQueryList.find((item) => item.id === id);
  if (!query) return;
  showQueryError("");
  setEditingQuery(edit ? query : null);
  state.activeDatabase = query.databaseName;
  state.activeCollection = query.collectionName;
  window.queryEditors.setValue("queryFilter", JSON.stringify(query.filter || {}, null, 2));
  window.queryEditors.setValue("flatQuery", query.command || `.find(${JSON.stringify(query.filter || {})}).sort(${JSON.stringify(query.sort || {})}).limit(${query.limit || 100})`);
  window.queryEditors.setValue("querySort", JSON.stringify(query.sort || {}, null, 2));
  $("#queryLimit").value = query.limit;
  $("#queryTarget").textContent = `${query.databaseName}.${query.collectionName}`;
  $("#collectionTitle").textContent = query.collectionName;
  setQueryMode(query.mode || "builder");
  if (edit) {
    $(".query-card").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#queryName").focus({ preventScroll: true });
  } else if (query.mode !== "flat") runQuery();
}

function setQueryMode(mode) {
  queryMode = mode === "flat" ? "flat" : "builder";
  const builderMode = queryMode === "builder";
  $("#builderModeButton").classList.toggle("active", builderMode);
  $("#flatModeButton").classList.toggle("active", !builderMode);
  $("#builderModeButton").setAttribute("aria-selected", String(builderMode));
  $("#flatModeButton").setAttribute("aria-selected", String(!builderMode));
  $(".query-grid").classList.toggle("hidden", !builderMode);
  $("#flatQueryField").classList.toggle("visible", !builderMode);
  window.queryEditors.refresh();
}

async function deleteSavedQuery(id) {
  try {
    await window.mongoApi.deleteQuery(id);
    savedQueryList = savedQueryList.filter((query) => query.id !== id);
    if (editingQueryId === id) setEditingQuery(null);
    renderSavedQueries();
  } catch (error) {
    showQueryError(error.message || "Could not delete this query.");
  }
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
  const name = connectionName.value.trim();
  if (!name) {
    showError("Enter a name for this connection before saving it.");
    connectionName.focus();
    return;
  }
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
  loadedDocuments = null;
  $("#tableWrap").innerHTML =
    '<div class="table-empty"><div class="spinner" style="display:block;border-color:rgba(169,235,197,.2);border-top-color:var(--mint)"></div><p style="margin-top:16px">Fetching documents...</p></div>';
  try {
    const result = await window.mongoApi.openCollection(
      databaseName,
      collectionName,
    );
    setEditingQuery(null);
    state.activeDatabase = databaseName;
    state.activeCollection = collectionName;
    $("#queryTarget").textContent = `${databaseName}.${collectionName}`;
    renderTable(result.documents);
    $("#recordCount").textContent =
      `${result.count.toLocaleString()} documents`;
    $("#headerStat").innerHTML =
      `<strong>${result.documents.length}</strong><span>${result.resultType === "results" ? "results returned" : "documents loaded"}</span>`;
  } catch (error) {
    showError(error.message || "Could not load this collection.");
    $("#recordCount").textContent = "";
  }
}

function renderTable(documents) {
  loadedDocuments = documents;
  if (!documents.length) {
    $("#tableWrap").innerHTML =
      '<div class="table-empty"><div class="empty-glyph">[ ]</div><h3>This collection is empty</h3><p>No documents were returned from this collection.</p></div>';
    return;
  }
  if (collectionViewer === "tree") {
    $("#tableWrap").innerHTML = `<div class="document-tree">${documents.map((document, index) => renderTreeNode(`Document ${index + 1}`, document, true)).join("")}</div>`;
    return;
  }
  if (collectionViewer === "json") {
    $("#tableWrap").innerHTML = `<pre class="document-json">${escapeHtml(JSON.stringify(documents, null, 2))}</pre>`;
    return;
  }
  const keys = [
    ...new Set(documents.flatMap((document) => Object.keys(document))),
  ];
  $("#tableWrap").innerHTML =
    `<table class="data-table"><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>${documents.map((document) => `<tr>${keys.map((key) => `<td title="${escapeHtml(JSON.stringify(document[key] ?? ""))}">${renderValue(document[key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderTreeNode(key, value, open = false) {
  const label = `<span class="document-key">${escapeHtml(key)}</span>`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    const summary = Array.isArray(value) ? `[${entries.length} items]` : `{${entries.length} fields}`;
    return `<details class="document-node"${open ? " open" : ""}><summary>${label} <span class="json-value">${summary}</span></summary><div class="document-children">${entries.map(([childKey, childValue]) => renderTreeNode(childKey, childValue)).join("")}</div></details>`;
  }
  return `<div class="document-leaf">${label}: <span class="json-value">${escapeHtml(JSON.stringify(value) ?? "undefined")}</span></div>`;
}

document.querySelectorAll("[data-viewer]").forEach((button) => {
  button.addEventListener("click", () => {
    collectionViewer = button.dataset.viewer;
    document.querySelectorAll("[data-viewer]").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === button));
    });
    if (loadedDocuments !== null) renderTable(loadedDocuments);
  });
});

$("#toggleVisibility").addEventListener("click", () => {
  const isPassword = connectionString.type === "password";
  connectionString.type = isPassword ? "text" : "password";
  $("#toggleVisibility").textContent = isPassword ? "Hide" : "Show";
});
connectButton.addEventListener("click", connect);
$("#saveConnectionButton").addEventListener("click", saveCurrentConnection);
$("#runQueryButton").addEventListener("click", runQuery);
$("#saveQueryButton").addEventListener("click", saveCurrentQuery);
$("#cancelQueryEditButton").addEventListener("click", cancelQueryEdit);
$("#builderModeButton").addEventListener("click", () => setQueryMode("builder"));
$("#flatModeButton").addEventListener("click", () => setQueryMode("flat"));
connectionString.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});

loadSavedConnections();
loadSavedQueries();
