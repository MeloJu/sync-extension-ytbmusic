const browserAPI = typeof browser !== "undefined" ? browser : chrome;

browserAPI.runtime.onInstalled.addListener(() => {
  browserAPI.storage.local.get(["workerUrl", "roomCode"]).then((stored) => {
    const defaults = {};
    if (stored.workerUrl === undefined) defaults.workerUrl = "";
    if (stored.roomCode === undefined) defaults.roomCode = "";
    if (Object.keys(defaults).length > 0) {
      browserAPI.storage.local.set(defaults);
    }
  });
});
