// No-flash theme bootstrap. Loaded as a tiny blocking <script src> in <head>
// (an external file, so the Content Security Policy needs no 'unsafe-inline').
// Applies the saved theme/scale to <html> before the body renders.
(function () {
  try {
    // Honor a saved choice; otherwise follow the OS so dark mode "just works".
    var t = localStorage.getItem("readbook-theme");
    if (!t) {
      t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", t);
    var s = localStorage.getItem("readbook-scale");
    if (s) document.documentElement.style.setProperty("--reading-scale", s);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
