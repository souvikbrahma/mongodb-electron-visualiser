const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { MongoClient } = require("mongodb");

const { runFlatQuery } = require("./flat-query");

let mainWindow;
let client;

function connectionsPath() {
  return path.join(app.getPath("userData"), "connections.json");
}

async function readConnections() {
  try {
    const connections = JSON.parse(await fs.readFile(connectionsPath(), "utf8"));
    return Array.isArray(connections) ? connections : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Could not read saved connections.");
  }
}

async function writeConnections(connections) {
  await fs.mkdir(path.dirname(connectionsPath()), { recursive: true });
  await fs.writeFile(connectionsPath(), JSON.stringify(connections, null, 2), "utf8");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#101419",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function serialiseValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if (value._bsontype === "ObjectID" || value._bsontype === "ObjectId")
      return value.toString();
    if (Array.isArray(value)) return value.map(serialiseValue);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serialiseValue(item)]),
    );
  }
  return value;
}

function sanitiseDocument(document) {
  return serialiseValue(document);
}

ipcMain.handle("mongo:connect", async (_event, connectionString) => {
  if (!connectionString || typeof connectionString !== "string") {
    throw new Error("Enter a MongoDB connection string to continue.");
  }

  if (client) await client.close();
  client = new MongoClient(connectionString, {
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();

  const admin = client.db().admin();
  const databases = await admin.listDatabases();
  const defaultDatabase = client.db().databaseName;
  const databaseDetails = await Promise.all(
    databases.databases.map(async (database) => {
      const db = client.db(database.name);
      const collections = await db
        .listCollections({}, { nameOnly: true })
        .toArray();
      return {
        name: database.name,
        sizeOnDisk: database.sizeOnDisk || 0,
        collections: collections.map((collection) => collection.name),
      };
    }),
  );

  return { databaseName: defaultDatabase, databases: databaseDetails };
});

ipcMain.handle("connections:list", async () => readConnections());

ipcMain.handle("connections:save", async (_event, connection) => {
  if (!connection || typeof connection.name !== "string" || typeof connection.uri !== "string") {
    throw new Error("A connection name and URI are required.");
  }
  const name = connection.name.trim();
  const uri = connection.uri.trim();
  if (!name || !uri) throw new Error("A connection name and URI are required.");

  const connections = await readConnections();
  const savedConnection = { id: connection.id || crypto.randomUUID(), name, uri };
  const existingIndex = connections.findIndex((item) => item.id === savedConnection.id);
  if (existingIndex >= 0) connections[existingIndex] = savedConnection;
  else connections.unshift(savedConnection);
  await writeConnections(connections);
  return savedConnection;
});

ipcMain.handle("connections:delete", async (_event, id) => {
  const connections = await readConnections();
  await writeConnections(connections.filter((connection) => connection.id !== id));
  return true;
});

function queriesPath() {
  return path.join(app.getPath("userData"), "queries.json");
}

async function readQueries() {
  try {
    const queries = JSON.parse(await fs.readFile(queriesPath(), "utf8"));
    return Array.isArray(queries) ? queries : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Could not read saved queries.");
  }
}

async function writeQueries(queries) {
  await fs.mkdir(path.dirname(queriesPath()), { recursive: true });
  await fs.writeFile(queriesPath(), JSON.stringify(queries, null, 2), "utf8");
}

ipcMain.handle("queries:list", async () => readQueries());

ipcMain.handle("queries:save", async (_event, query) => {
  if (!query || typeof query.name !== "string") {
    throw new Error("A query name is required.");
  }
  const name = query.name.trim();
  if (!name || !query.databaseName || !query.collectionName) {
    throw new Error("Choose a collection and enter a query name.");
  }

  const queries = await readQueries();
  const savedQuery = {
    id: query.id || crypto.randomUUID(),
    name,
    databaseName: query.databaseName,
    collectionName: query.collectionName,
    filter: query.filter || {},
    sort: query.sort || {},
    limit: query.limit || 100,
    mode: query.mode === "flat" ? "flat" : "builder",
    command: typeof query.command === "string" ? query.command : undefined,
  };
  const existingIndex = queries.findIndex((item) => item.id === savedQuery.id);
  if (existingIndex >= 0) queries[existingIndex] = savedQuery;
  else queries.unshift(savedQuery);
  await writeQueries(queries);
  return savedQuery;
});

ipcMain.handle("queries:delete", async (_event, id) => {
  const queries = await readQueries();
  await writeQueries(queries.filter((query) => query.id !== id));
  return true;
});

ipcMain.handle(
  "mongo:collection",
  async (_event, { databaseName, collectionName }) => {
    if (!client)
      throw new Error("Connect to MongoDB before opening a collection.");
    const collection = client.db(databaseName).collection(collectionName);
    const [documents, count] = await Promise.all([
      collection.find({}).limit(100).toArray(),
      collection.estimatedDocumentCount(),
    ]);

    return {
      databaseName,
      collectionName,
      count,
      documents: documents.map(sanitiseDocument),
    };
  },
);

ipcMain.handle("mongo:query", async (_event, query) => {
  if (!client) throw new Error("Connect to MongoDB before running a query.");
  if (!query?.databaseName || !query?.collectionName) {
    throw new Error("Choose a collection before running a query.");
  }

  if (query.mode === "flat") {
    const result = await runFlatQuery(client.db(query.databaseName).collection(query.collectionName), query.command);
    return { ...result, documents: result.documents.map(sanitiseDocument) };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const cursor = client
    .db(query.databaseName)
    .collection(query.collectionName)
    .find(query.filter && typeof query.filter === "object" ? query.filter : {});
  if (query.sort && typeof query.sort === "object" && Object.keys(query.sort).length) {
    cursor.sort(query.sort);
  }
  const documents = await cursor.limit(limit).toArray();
  return { documents: documents.map(sanitiseDocument), limit };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  if (client) await client.close();
  if (process.platform !== "darwin") app.quit();
});
