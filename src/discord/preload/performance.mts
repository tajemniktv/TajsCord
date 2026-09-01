const { ipcRenderer } = require("electron");

// Report the first observable point at which Discord has mounted content. A
// MutationObserver avoids arbitrary delays while adding no ongoing work after
// the milestone is reached.
let reported = false;
const reportWhenMounted = () => {
    if (reported) return;
    const appMount = document.querySelector("#app-mount");
    if (!appMount?.firstElementChild) return;
    reported = true;
    observer.disconnect();
    ipcRenderer.send("performance-milestone", "discord-renderer-ready");
};

const observer = new MutationObserver(reportWhenMounted);
if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("DOMContentLoaded", reportWhenMounted, { once: true });
reportWhenMounted();
