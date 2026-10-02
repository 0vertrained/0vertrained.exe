export function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let announced = false;
    const announce = () => {
      if (!hadController || announced) return;
      announced = true;
      window.dispatchEvent(new CustomEvent("ovt:service-worker-update"));
    };
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") announce();
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", announce);
      void registration.update();
    } catch {
      // The app remains fully usable without service-worker support.
    }
  }, { once: true });
}
