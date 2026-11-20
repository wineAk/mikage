const statusElement = document.querySelector("#status");
const targetsElement = document.querySelector("#targets");
const form = document.querySelector("#target-form");
const keyInput = document.querySelector("#key");
const nameInput = document.querySelector("#name");
const urlInput = document.querySelector("#url");
const headersInput = document.querySelector("#headers");
const formTitle = document.querySelector("#form-title");
const saveButton = document.querySelector("#save");
const cancelButton = document.querySelector("#cancel");
let editingKey = null;

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "HTTP " + response.status);
  return body;
}

function startEdit(target) {
  editingKey = target.key;
  keyInput.value = target.key;
  keyInput.disabled = true;
  nameInput.value = target.name;
  urlInput.value = target.url;
  headersInput.value = target.headers === null ? "{}" : JSON.stringify(target.headers, null, 2);
  formTitle.textContent = "対象を編集";
  saveButton.textContent = "保存";
  cancelButton.hidden = false;
  nameInput.focus();
}

function resetForm() {
  editingKey = null;
  form.reset();
  keyInput.disabled = false;
  headersInput.value = "{}";
  formTitle.textContent = "対象を追加";
  saveButton.textContent = "追加";
  cancelButton.hidden = true;
}

function createTargetElement(target) {
  const article = document.createElement("article");
  article.className = "target" + (target.is_enabled ? "" : " disabled");
  const heading = document.createElement("h3");
  const title = document.createElement("span");
  title.textContent = target.name + " (" + target.key + ")";
  const toggleButton = document.createElement("button");
  toggleButton.className = "toggle secondary";
  toggleButton.type = "button";
  toggleButton.textContent = target.is_enabled ? "無効化" : "有効化";
  toggleButton.addEventListener("click", async () => {
    try {
      await request("/v1/admin/targets/" + encodeURIComponent(target.key) + "/enabled", {
        method: "PATCH",
        body: JSON.stringify({ is_enabled: !target.is_enabled }),
      });
      showStatus("監視対象を更新しました。");
      await loadTargets();
    } catch (error) {
      showStatus(error.message, true);
    }
  });
  heading.append(title, toggleButton);
  const url = document.createElement("p");
  url.textContent = target.url;
  const actions = document.createElement("button");
  actions.className = "secondary";
  actions.type = "button";
  actions.textContent = "編集";
  actions.addEventListener("click", () => startEdit(target));
  article.append(heading, url, actions);
  return article;
}

async function loadTargets() {
  const { targets } = await request("/v1/admin/targets");
  targetsElement.replaceChildren(...targets.map(createTargetElement));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    let headers = null;
    const headersValue = headersInput.value.trim();
    if (headersValue) headers = JSON.parse(headersValue);
    const body = { name: nameInput.value, url: urlInput.value, headers };
    if (!editingKey) body.key = keyInput.value;
    const path = editingKey
      ? "/v1/admin/targets/" + encodeURIComponent(editingKey)
      : "/v1/admin/targets";
    await request(path, { method: editingKey ? "PUT" : "POST", body: JSON.stringify(body) });
    showStatus(editingKey ? "監視対象を保存しました。" : "監視対象を追加しました。");
    resetForm();
    await loadTargets();
  } catch (error) {
    showStatus(error instanceof SyntaxError ? "headersが有効なJSONではありません。" : error.message, true);
  }
});

cancelButton.addEventListener("click", resetForm);
headersInput.value = "{}";
loadTargets().catch((error) => showStatus(error.message, true));
