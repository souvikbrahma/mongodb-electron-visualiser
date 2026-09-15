# Project Notes

- Run `npm install` to install Electron and the MongoDB driver.
- Run `npm start` to launch the desktop app.
- Keep MongoDB access in the Electron main process and expose only narrow operations through the preload bridge.
