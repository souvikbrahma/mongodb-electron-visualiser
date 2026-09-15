# Mongo Visualiser

A desktop MongoDB visualizer built with Electron and Node.js. Enter a MongoDB connection string to browse databases, collections, and the first 100 documents in each collection.

## Start with a double-click (macOS)

Double-click **Start Mongo Visualiser.command** in Finder. The launcher checks dependencies, installs missing packages, builds the editor, and opens the app. Node.js and npm must be installed; dependency installation needs an internet connection.

For quick access, make a Finder alias of the launcher and place it on your Desktop. Keep the original launcher in this project folder. Terminal stays open while the app runs; quit the app with **Cmd+Q** when finished.

From a terminal, you can also run:

```bash
./"Start Mongo Visualiser.command"
```

## Run locally

```bash
npm install
npm start
```

The app supports local MongoDB URIs such as `mongodb://localhost:27017` and hosted deployment URIs such as `mongodb+srv://...`. Use **Save connection** to store a named connection locally for future launches. Saved connections are kept in Electron's per-user application data directory and are never synced or uploaded.

After choosing a collection, use the Query workspace's **Builder** mode for separate filter, sort, and limit controls, or **Flat query** mode to run collection commands. For example:

```js
.find({ status: 'active' }).sort({ createdAt: -1 }).limit(100)
.aggregate([{ $group: { _id: '$status', total: { $sum: 1 } } }])
.insert({ name: 'Ada', status: 'active' })
.updateMany({ status: 'pending' }, { $set: { status: 'active' } })
.deleteOne({ _id: ObjectId('507f1f77bcf86cd799439011') })
.countDocuments({ status: 'active' })
```

Query fields use a locally bundled [CodeMirror](https://codemirror.net/) editor with syntax highlighting, line numbers, folding, automatic indentation, bracket pairing, and undo/redo. Builder fields show JSON errors; Flat query offers MongoDB command, operator, and BSON-helper completions. Use **Ctrl+Space** for suggestions, **Tab / Shift+Tab** to indent, **Esc then Tab** to leave the editor, and **Cmd/Ctrl+Enter** to run. `npm start` and `npm run dev` rebuild the editor bundle automatically.

Commands start with a dot and target the selected collection. Flat mode supports collection reads, aggregation, inserts, updates, deletes, bulk writes, and index operations; results and write acknowledgments appear in the table. Use `.limit()` to bound cursor results. Arguments accept quoted or unquoted field names, strings, arrays, regex literals, and BSON helpers (`ObjectId`, `ISODate`, `NumberInt`, `NumberLong`, `NumberDecimal`). Plain JSON filters remain supported. This is a collection-command editor, not a JavaScript shell: variables and arbitrary scripts are not supported.

Save named presets for later reuse. Loading a saved flat query fills the editor; click **Run query** to execute it. Write commands modify the database when run.

## Project layout

- `src/main.js`: Electron window and MongoDB IPC handlers
- `src/preload.js`: context-isolated API bridge
- `src/renderer/`: desktop interface and collection table
# mongodb-electron-visualiser
