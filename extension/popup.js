const browserAPI = typeof browser !== "undefined" ? browser : chrome;

const workerUrlInput = document.getElementById("workerUrl");
const roomCodeInput = document.getElementById("roomCode");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");

browserAPI.storage.local.get(["workerUrl", "roomCode"]).then((stored) => {
  workerUrlInput.value = stored.workerUrl || "";
  roomCodeInput.value = stored.roomCode || "";
});

saveButton.addEventListener("click", () => {
  browserAPI.storage.local
    .set({
      workerUrl: workerUrlInput.value.trim(),
      roomCode: roomCodeInput.value.trim(),
    })
    .then(() => {
      statusEl.textContent = "Salvo.";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 1500);
    });
});
