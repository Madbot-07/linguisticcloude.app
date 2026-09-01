/**
 * LinguaCloud dashboard
 * Upload -> AI detect -> translate -> download workflow.
 */

const el = (id) => document.getElementById(id);

const state = {
    filename: null,
    detected: null,
    targetName: "",
    targetCode: "",
};

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
    loadLanguages();
    bindUpload();
    bindTranslate();
    bindExport();
});

async function loadLanguages() {
    try {
        const res = await fetch("/api/languages");
        const data = await res.json();
        const source = el("sourceLang");
        const target = el("targetLang");

        // Popular targets pinned on top
        const popular = ["en", "hi", "ta", "te", "fr", "es", "de", "ja", "zh-CN", "ar"];
        const byCode = Object.fromEntries(data.languages.map((l) => [l.code, l]));
        const pinned = popular.filter((c) => byCode[c]).map((c) => byCode[c]);
        const rest = data.languages.filter((l) => !popular.includes(l.code));

        [...pinned, ...rest].forEach((lang) => {
            target.appendChild(new Option(lang.name, lang.code));
        });
        data.languages.forEach((lang) => {
            source.appendChild(new Option(lang.name, lang.code));
        });
        target.value = "en";
    } catch {
        setCloudStatus(false);
        toast("Could not load language catalogue.", "error");
    }
}

function setCloudStatus(online) {
    const pill = el("cloudStatus");
    pill.classList.toggle("offline", !online);
    pill.innerHTML = `<span class="dot"></span> ${online ? "Cloud Connected" : "Cloud Unreachable"}`;
}

/* ------------------------------------------------------------------ */
/* Step 1 — Upload                                                     */
/* ------------------------------------------------------------------ */
function bindUpload() {
    const dz = el("dropzone");
    const input = el("fileInput");

    el("browseBtn").addEventListener("click", (e) => { e.stopPropagation(); input.click(); });
    dz.addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && uploadFile(input.files[0]));

    ["dragover", "dragenter"].forEach((ev) =>
        dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) =>
        dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
    dz.addEventListener("drop", (e) => {
        const file = e.dataTransfer.files[0];
        if (file) uploadFile(file);
    });

    el("clearFileBtn").addEventListener("click", resetWorkflow);
}

async function uploadFile(file) {
    const form = new FormData();
    form.append("file", file);
    toast("Uploading & analysing document…");

    try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed.");

        state.filename = data.filename;
        state.detected = data.detected;

        // File chip
        el("fileChipName").textContent = data.filename;
        el("fileChipMeta").textContent = `${formatBytes(file.size)} · ${data.stats.words.toLocaleString()} words`;
        el("fileChip").classList.remove("hidden");

        // Detection card
        renderDetection(data.detected, data.stats);

        // Translate card
        el("originalText").value = data.text;
        el("originalMeta").textContent = `${data.stats.characters.toLocaleString()} chars`;
        el("translatedText").value = "";
        el("translatedMeta").textContent = "";
        el("translatedLangTag").textContent = "";

        el("detectCard").classList.remove("hidden");
        el("translateCard").classList.remove("hidden");
        el("downloadCard").classList.add("hidden");
        el("detectCard").scrollIntoView({ behavior: "smooth", block: "start" });

        setCloudStatus(true);
        toast(`Language detected: ${data.detected.name}`, "success");
    } catch (err) {
        toast(err.message, "error");
    } finally {
        el("fileInput").value = "";
    }
}

function renderDetection(detected, stats) {
    el("detectedLang").textContent = detected.name;
    el("confidenceFill").style.width = `${detected.confidence}%`;

    let confText = `${detected.confidence}% AI confidence`;
    if (detected.alternatives && detected.alternatives.length) {
        const alts = detected.alternatives.map((a) => `${a.name} ${a.confidence}%`).join(", ");
        confText += ` · also possible: ${alts}`;
    }
    el("detectedConf").textContent = confText;

    el("docStats").innerHTML = `
        <div class="stat-box"><b>${stats.words.toLocaleString()}</b><span>Words</span></div>
        <div class="stat-box"><b>${stats.characters.toLocaleString()}</b><span>Characters</span></div>
        <div class="stat-box"><b>${stats.lines.toLocaleString()}</b><span>Lines</span></div>`;

    // Pre-select detected language as source when supported
    const source = el("sourceLang");
    source.value = [...source.options].some((o) => o.value === detected.code)
        ? detected.code
        : "auto";
}

function resetWorkflow() {
    state.filename = null;
    state.detected = null;
    el("fileChip").classList.add("hidden");
    el("detectCard").classList.add("hidden");
    el("translateCard").classList.add("hidden");
    el("downloadCard").classList.add("hidden");
    el("originalText").value = "";
    el("translatedText").value = "";
}

/* ------------------------------------------------------------------ */
/* Step 3 — Translate                                                  */
/* ------------------------------------------------------------------ */
function bindTranslate() {
    el("translateBtn").addEventListener("click", translate);
}

async function translate() {
    const text = el("originalText").value;
    const target = el("targetLang").value;
    const source = el("sourceLang").value;

    if (!text.trim()) return toast("There is no text to translate.", "error");

    const btn = el("translateBtn");
    btn.disabled = true;
    el("translateBtnText").textContent = "Translating…";
    el("translateSpinner").classList.remove("hidden");

    try {
        const res = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, target, source }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Translation failed.");

        state.targetCode = data.target;
        state.targetName = data.target_name;

        el("translatedText").value = data.translated;
        el("translatedLangTag").textContent = `· ${data.target_name}`;
        el("translatedMeta").textContent =
            `${data.stats.characters.toLocaleString()} chars · ${data.elapsed}s in cloud`;

        el("downloadCard").classList.remove("hidden");
        setCloudStatus(true);
        toast(`Translated to ${data.target_name} in ${data.elapsed}s`, "success");
    } catch (err) {
        setCloudStatus(false);
        toast(err.message, "error");
    } finally {
        btn.disabled = false;
        el("translateBtnText").textContent = "Translate Document";
        el("translateSpinner").classList.add("hidden");
    }
}

/* ------------------------------------------------------------------ */
/* Step 4 — Export                                                     */
/* ------------------------------------------------------------------ */
function bindExport() {
    el("copyBtn").addEventListener("click", async () => {
        await navigator.clipboard.writeText(el("translatedText").value);
        toast("Translation copied to clipboard.", "success");
    });
    el("downloadTxtBtn").addEventListener("click", () => download("txt"));
    el("downloadDocxBtn").addEventListener("click", () => download("docx"));
}

async function download(format) {
    const text = el("translatedText").value;
    if (!text.trim()) return toast("Nothing to download yet.", "error");

    try {
        const res = await fetch("/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text,
                format,
                filename: state.filename,
                target: state.targetCode || "translated",
            }),
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Download failed.");
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = getFilenameFromResponse(res) ||
            `translated_${state.targetCode || "out"}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
        toast(`Downloading .${format.toUpperCase()} file…`, "success");
    } catch (err) {
        toast(err.message, "error");
    }
}

function getFilenameFromResponse(res) {
    const header = res.headers.get("Content-Disposition") || "";
    const match = header.match(/filename="?([^";]+)"?/);
    return match ? match[1] : null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

let toastTimer;
function toast(message, type = "") {
    const node = el("toast");
    node.textContent = message;
    node.className = `toast ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.add("hidden"), 3500);
}
