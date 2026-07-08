const { invoke } = window.__TAURI__.core;

const workerUrlInput = document.getElementById("workerUrl");
const roomCodeInput = document.getElementById("roomCode");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");

async function loadConfig() {
  const config = await invoke("get_config");
  workerUrlInput.value = config.workerUrl || "";
  roomCodeInput.value = config.roomCode || "";
}

saveButton.addEventListener("click", async () => {
  await invoke("save_config", {
    workerUrl: workerUrlInput.value.trim(),
    roomCode: roomCodeInput.value.trim(),
  });
  statusEl.textContent = "Salvo.";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
});

loadConfig();
