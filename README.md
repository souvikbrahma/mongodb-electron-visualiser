# Mongo Visualiser

A desktop MongoDB visualizer built with Electron and Node.js. Enter a MongoDB connection string to browse databases, collections, and the first 100 documents in each collection.

## Run locally

```bash
npm install
npm start
```

The app supports local MongoDB URIs such as `mongodb://localhost:27017` and hosted deployment URIs such as `mongodb+srv://...`. Use **Save connection** to store a named connection locally for future launches. Saved connections are kept in Electron's per-user application data directory and are never synced or uploaded.

## Project layout

- `src/main.js`: Electron window and MongoDB IPC handlers
- `src/preload.js`: context-isolated API bridge
- `src/renderer/`: desktop interface and collection table
# mongodb-electron-visualiser
