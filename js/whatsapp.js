(() => {
  "use strict";

  const agent = navigator.userAgent;
  const android = /Android/i.test(agent) || navigator.userAgentData?.platform === "Android";
  const chromium = /\b(?:Chrome|Chromium)\//.test(agent) || navigator.userAgentData?.brands?.some(({ brand }) => /Chromium|Chrome|Brave/.test(brand));
  const useAndroidIntent = Boolean(android && chromium);

  function prepareLinks(appLink, webLink, message = "") {
    const encodedMessage = encodeURIComponent(message);
    const query = `phone=56964194547${message ? `&text=${encodedMessage}` : ""}`;
    const webURL = `https://wa.me/56964194547${message ? `?text=${encodedMessage}` : ""}`;

    if (useAndroidIntent) {
      // A separate context protects the CV tab and its in-memory reviewed draft.
      // The fallback is only for a failed app launch, not an app-return callback.
      appLink.href = `intent://send/?${query}#Intent;scheme=whatsapp;S.browser_fallback_url=${encodeURIComponent(webURL)};end`;
      appLink.setAttribute("target", "_blank");
      appLink.setAttribute("rel", "noopener noreferrer");
    } else {
      appLink.href = `whatsapp://send/?${query}`;
      appLink.removeAttribute("target");
      appLink.removeAttribute("rel");
    }
    webLink.href = webURL;
  }

  window.CV_WHATSAPP = Object.freeze({ prepareLinks });
  const contactApp = document.getElementById("contact-whatsapp");
  const contactWeb = document.getElementById("contact-whatsapp-web");
  if (contactApp && contactWeb) prepareLinks(contactApp, contactWeb);

  if (useAndroidIntent) {
    document.querySelectorAll("[data-android-i18n]").forEach((element) => {
      element.dataset.i18n = element.dataset.androidI18n;
    });
  }
})();
