// @ts-check
/** @typedef {import('../src/types').ShipwrightManifest} Manifest */
/** @typedef {import('../src/types').Component} Component */

const vscode = acquireVsCodeApi();
const root = /** @type {HTMLElement} */ (document.getElementById("root"));

const ALL_PLATFORMS = [
  "darwin-arm64","darwin-x64","linux-x64","linux-arm64",
  "win32-x64","win32-arm64","all",
];
const ALL_KINDS = [
  "cli","lsp","mcp","sidecar","dap","tool",
  "extension-vscode","extension-jetbrains","extension-zed","asset",
];
const ALL_LANGUAGES = ["rust","dotnet","dart","typescript","kotlin","javascript"];
const ALL_SOURCES = [
  "user-setting","env","path","bundled","pkgmgr",
  "dotnet-tool","npm-global","cargo-bin","github-release","lsp-initialize",
];

/** @type {Manifest|null} */
let currentManifest = null;

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "update") {
    currentManifest = msg.manifest ?? null;
    render();
  }
});

function render() {
  if (!currentManifest) {
    root.innerHTML = '<div class="error-banner">Could not parse manifest. Check JSON syntax.</div>';
    return;
  }
  const m = currentManifest;
  root.innerHTML = [
    renderHeader(m),
    renderComponents(m),
    renderPlatformMatrix(m),
    renderHosts(m),
  ].join("");
  bindEvents();
}

function renderHeader(m) {
  const repo = m.product.repository
    ? `<a href="${esc(m.product.repository)}">${esc(m.product.repository)}</a>`
    : "";
  return `
    <div class="manifest-header">
      <h1>${esc(m.product.displayName || m.product.id)}</h1>
      <span class="version-tag">v${esc(m.product.version)}</span>
    </div>
    <div class="product-meta">
      <span>${esc(m.product.id)}</span>${repo ? " &middot; " + repo : ""}
    </div>`;
}

function renderComponents(m) {
  const cards = m.components.map((c, i) => renderComponentCard(c, i)).join("");
  return `
    <div class="section">
      <div class="section-header">
        <h2>Components <span class="section-count">(${m.components.length})</span></h2>
        <button class="btn btn-sm" id="btn-add-component">+ Add</button>
      </div>
      ${cards}
      <div id="add-component-form" style="display:none">${renderAddForm()}</div>
    </div>`;
}

function renderComponentCard(c, idx) {
  const bundledBadge = c.bundled ? ' <span class="badge badge-bundled">bundled</span>' : "";
  const requiredBadge = c.required === false ? ' <span class="badge">optional</span>' : "";
  return `
    <div class="card" data-idx="${idx}">
      <div class="card-head" data-toggle="${idx}">
        <span class="card-chevron">&#9654;</span>
        <span class="card-title">${esc(c.id)}</span>
        <span class="badge badge-${c.kind}">${c.kind}</span>
        ${c.language ? `<span class="badge">${c.language}</span>` : ""}
        ${bundledBadge}${requiredBadge}
      </div>
      <div class="card-body">
        ${renderComponentFields(c, idx)}
        <div class="btn-row">
          <button class="btn btn-sm btn-danger" data-remove="${c.id}">Remove</button>
        </div>
      </div>
    </div>`;
}

function renderComponentFields(c, idx) {
  const rows = [];
  rows.push(editableRow("ID", c.id, `components.${idx}.id`));
  rows.push(selectRow("Kind", c.kind, ALL_KINDS, `components.${idx}.kind`));
  if (c.language) { rows.push(selectRow("Language", c.language, ALL_LANGUAGES, `components.${idx}.language`)); }
  if (c.binaryName) { rows.push(editableRow("Binary Name", c.binaryName, `components.${idx}.binaryName`)); }
  if (c.expectedVersion) { rows.push(editableRow("Expected Version", c.expectedVersion, `components.${idx}.expectedVersion`)); }
  if (c.userSetting) { rows.push(editableRow("User Setting", c.userSetting, `components.${idx}.userSetting`)); }
  if (c.platforms) { rows.push(platformRow(c.platforms)); }
  if (c.sources) { rows.push(sourceChainRow(c.sources)); }
  if (c.bundled) { rows.push(bundledRow(c.bundled)); }
  if (c.env) { rows.push(envRow(c.env)); }
  if (c.pkgmgr) { rows.push(pkgmgrRow(c.pkgmgr)); }
  if (c.githubRelease) { rows.push(githubRow(c.githubRelease)); }
  if (c.npm) { rows.push(npmRow(c.npm)); }
  if (c.versionCheckStrategy) {
    rows.push(fieldRow("Version Check", c.versionCheckStrategy));
  }
  return rows.join("");
}

function editableRow(label, value, path) {
  return `<div class="field-row">
    <span class="field-label">${label}</span>
    <span class="field-value editable" data-path="${path}" data-current="${esc(value)}">${esc(value)}</span>
  </div>`;
}

function selectRow(label, value, options, path) {
  return `<div class="field-row">
    <span class="field-label">${label}</span>
    <span class="field-value editable" data-path="${path}" data-current="${esc(value)}" data-options="${options.join(",")}">${esc(value)}</span>
  </div>`;
}

function fieldRow(label, value) {
  return `<div class="field-row">
    <span class="field-label">${label}</span>
    <span class="field-value">${esc(String(value))}</span>
  </div>`;
}

function platformRow(platforms) {
  const chips = platforms.map((p) => `<span class="platform-chip">${esc(p)}</span>`).join("");
  return `<div class="field-row">
    <span class="field-label">Platforms</span>
    <div class="platform-chips">${chips}</div>
  </div>`;
}

function sourceChainRow(sources) {
  const parts = sources.map((s) => `<span class="source-chip">${esc(s)}</span>`);
  const chain = parts.join('<span class="source-arrow">&rarr;</span>');
  return `<div class="field-row">
    <span class="field-label">Sources</span>
    <div class="source-chain">${chain}</div>
  </div>`;
}

function bundledRow(b) {
  return `<div class="field-row">
    <span class="field-label">Bundle Path</span>
    <span class="field-value"><code>${esc(b.bundlePath)}</code></span>
  </div>
  <div class="field-row">
    <span class="field-label">Per-Platform</span>
    <span class="field-value">${b.perPlatformArtifact !== false ? "Yes" : "No"}</span>
  </div>`;
}

function envRow(env) {
  const parts = [];
  if (env.pathVar) { parts.push(`pathVar: ${esc(env.pathVar)}`); }
  if (env.dirVar) { parts.push(`dirVar: ${esc(env.dirVar)}`); }
  return fieldRow("Environment", parts.join(", "));
}

function pkgmgrRow(p) {
  const parts = [];
  if (p.brew) { parts.push(`brew: ${p.brew}`); }
  if (p.scoop) { parts.push(`scoop: ${p.scoop}`); }
  if (p.apt) { parts.push(`apt: ${p.apt}`); }
  if (p.winget) { parts.push(`winget: ${p.winget}`); }
  return fieldRow("Pkg Managers", parts.join(", "));
}

function githubRow(gh) {
  return fieldRow("GitHub Release", `${gh.repo || ""} — ${gh.assetPattern || ""}`);
}

function npmRow(n) {
  return fieldRow("npm", `${n.package || ""} (bin: ${n.bin || "default"})`);
}

function renderPlatformMatrix(m) {
  const platforms = ALL_PLATFORMS.filter((p) => p !== "all");
  const showAll = m.components.some((c) => c.platforms?.includes("all"));
  const cols = showAll ? [...platforms, "all"] : platforms;
  const shortNames = {
    "darwin-arm64": "mac ARM", "darwin-x64": "mac x64",
    "linux-x64": "lin x64", "linux-arm64": "lin ARM",
    "win32-x64": "win x64", "win32-arm64": "win ARM", "all": "all",
  };
  const headers = cols.map((p) => `<th>${shortNames[p] || p}</th>`).join("");
  const rows = m.components.map((c) => {
    const cells = cols.map((p) => {
      const has = c.platforms?.includes(p);
      return `<td class="${has ? "matrix-yes" : "matrix-no"}">${has ? "&#10003;" : "&mdash;"}</td>`;
    }).join("");
    return `<tr><td class="comp-name">${esc(c.id)}</td>${cells}</tr>`;
  }).join("");

  return `
    <div class="section">
      <div class="section-header"><h2>Platform Matrix</h2></div>
      <div class="scroll-x">
        <table class="matrix-table">
          <thead><tr><th>Component</th>${headers}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderHosts(m) {
  if (!m.hosts || Object.keys(m.hosts).length === 0) { return ""; }
  const cards = Object.entries(m.hosts).map(([name, policy]) => {
    const verifies = policy.activationVerifies
      ? policy.activationVerifies.map((v) => `<span class="source-chip">${esc(v)}</span>`).join(" ")
      : "<em>none</em>";
    return `
      <div class="card host-card">
        <div class="card-head" data-toggle="host-${name}">
          <span class="card-chevron">&#9654;</span>
          <span class="card-title host-name">${esc(name)}</span>
          ${policy.artifact ? `<span class="badge">${policy.artifact}</span>` : ""}
        </div>
        <div class="card-body">
          ${fieldRow("Artifact", policy.artifact || "not set")}
          <div class="field-row">
            <span class="field-label">Verifies</span>
            <div class="source-chain">${verifies}</div>
          </div>
          ${fieldRow("On Mismatch", policy.onMismatch || "error")}
        </div>
      </div>`;
  }).join("");
  return `
    <div class="section">
      <div class="section-header">
        <h2>Hosts <span class="section-count">(${Object.keys(m.hosts).length})</span></h2>
      </div>
      ${cards}
    </div>`;
}

function renderAddForm() {
  return `
    <div class="add-form">
      <div class="form-row"><label>ID</label><input id="new-id" placeholder="my-component"></div>
      <div class="form-row"><label>Kind</label>
        <select id="new-kind">${ALL_KINDS.map((k) => `<option>${k}</option>`).join("")}</select>
      </div>
      <div class="form-row"><label>Language</label>
        <select id="new-lang">${ALL_LANGUAGES.map((l) => `<option>${l}</option>`).join("")}</select>
      </div>
      <div class="form-row"><label>Binary Name</label><input id="new-binary" placeholder="my-component"></div>
      <div class="form-row"><label>Version</label><input id="new-version" placeholder="0.1.0"></div>
      <div class="btn-row">
        <button class="btn" id="btn-confirm-add">Add Component</button>
        <button class="btn btn-sm" id="btn-cancel-add">Cancel</button>
      </div>
    </div>`;
}

function bindEvents() {
  root.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", () => {
      const card = el.closest(".card");
      if (card) { card.classList.toggle("expanded"); }
    });
  });

  root.querySelectorAll(".field-value.editable").forEach((el) => {
    el.addEventListener("dblclick", () => startInlineEdit(el));
  });

  root.querySelectorAll("[data-remove]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-remove");
      if (id) { vscode.postMessage({ type: "removeComponent", componentId: id }); }
    });
  });

  const addBtn = document.getElementById("btn-add-component");
  const addForm = document.getElementById("add-component-form");
  if (addBtn && addForm) {
    addBtn.addEventListener("click", () => {
      addForm.style.display = addForm.style.display === "none" ? "block" : "none";
    });
  }

  const cancelBtn = document.getElementById("btn-cancel-add");
  if (cancelBtn && addForm) {
    cancelBtn.addEventListener("click", () => { addForm.style.display = "none"; });
  }

  const confirmBtn = document.getElementById("btn-confirm-add");
  if (confirmBtn) { confirmBtn.addEventListener("click", submitAddComponent); }
}

function startInlineEdit(el) {
  const path = el.getAttribute("data-path");
  const current = el.getAttribute("data-current") || el.textContent;
  const options = el.getAttribute("data-options");

  if (options) {
    const select = document.createElement("select");
    for (const opt of options.split(",")) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === current) { o.selected = true; }
      select.appendChild(o);
    }
    const wrapper = document.createElement("span");
    wrapper.className = "inline-edit";
    wrapper.appendChild(select);
    el.replaceWith(wrapper);
    select.focus();
    select.addEventListener("change", () => {
      vscode.postMessage({ type: "edit", path, value: select.value });
    });
    select.addEventListener("blur", () => render());
    return;
  }

  const input = document.createElement("input");
  input.value = current || "";
  input.type = "text";
  const wrapper = document.createElement("span");
  wrapper.className = "inline-edit";
  wrapper.appendChild(input);
  el.replaceWith(wrapper);
  input.focus();
  input.select();

  const commit = () => {
    if (input.value !== current) {
      vscode.postMessage({ type: "edit", path, value: input.value });
    } else {
      render();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { commit(); }
    if (e.key === "Escape") { render(); }
  });
  input.addEventListener("blur", commit);
}

function submitAddComponent() {
  const id = /** @type {HTMLInputElement} */ (document.getElementById("new-id"))?.value?.trim();
  const kind = /** @type {HTMLSelectElement} */ (document.getElementById("new-kind"))?.value;
  const language = /** @type {HTMLSelectElement} */ (document.getElementById("new-lang"))?.value;
  const binaryName = /** @type {HTMLInputElement} */ (document.getElementById("new-binary"))?.value?.trim();
  const version = /** @type {HTMLInputElement} */ (document.getElementById("new-version"))?.value?.trim();
  if (!id || !kind) { return; }

  const isExec = ["cli","lsp","mcp","sidecar","dap","tool"].includes(kind);
  const component = { id, kind, language: language || undefined };
  if (isExec) {
    Object.assign(component, {
      binaryName: binaryName || id,
      expectedVersion: version || "0.1.0",
      platforms: ["darwin-arm64","darwin-x64","linux-x64","linux-arm64","win32-x64","win32-arm64"],
      sources: ["user-setting","env","bundled","path"],
      verifyStartup: true,
      versionCheckStrategy: kind === "lsp" ? "lsp-initialize" : "version-flag",
      required: true,
    });
  }
  vscode.postMessage({ type: "addComponent", component });
  const form = document.getElementById("add-component-form");
  if (form) { form.style.display = "none"; }
}

function esc(str) {
  if (!str) { return ""; }
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
