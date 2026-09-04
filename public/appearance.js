(() => {
  const key = "betreuungskalender.appearance.v1";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const normalize = (value) => value === "light" || value === "dark" ? value : "system";
  let preference = "system";
  try {
    preference = normalize(window.localStorage.getItem(key));
  } catch {
    // A blocked preference store must not prevent the application from opening.
  }

  function apply() {
    const effective = preference === "system" ? (system.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.appearance = effective;
    document.documentElement.dataset.appearancePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", effective === "dark" ? "#191d20" : "#087f7b");
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute("content", effective === "dark" ? "black" : "default");
    window.dispatchEvent(new Event("appearance-change"));
  }

  window.addEventListener("appearance-preference-change", (event) => {
    preference = normalize(event.detail);
    try {
      window.localStorage.setItem(key, preference);
    } catch {
      // Keep the explicit choice for this page even when persistence is denied.
    }
    apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    preference = normalize(event.newValue);
    apply();
  });
  system.addEventListener("change", apply);
  apply();
})();
