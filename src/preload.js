const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mongoApi", {
  connect: (connectionString) =>
    ipcRenderer.invoke("mongo:connect", connectionString),
  openCollection: (databaseName, collectionName) =>
    ipcRenderer.invoke("mongo:collection", { databaseName, collectionName }),
  listConnections: () => ipcRenderer.invoke("connections:list"),
  saveConnection: (connection) => ipcRenderer.invoke("connections:save", connection),
  deleteConnection: (id) => ipcRenderer.invoke("connections:delete", id),
});
