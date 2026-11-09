"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../js/whatsapp.js"), "utf8");
const androidAgent = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/149.0.0.0 Mobile Safari/537.36";

function anchor() {
  const attributes = new Map();
  return { href: "", setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name), getAttribute: (name) => attributes.get(name) ?? null };
}

function setup(userAgent, userAgentData) {
  const app = anchor();
  const web = anchor();
  const copy = { dataset: { i18n: "contact.instructions", androidI18n: "contact.androidInstructions" } };
  const context = {
    window: { open: () => assert.fail("Preparing a link must not launch an app") },
    navigator: { userAgent, userAgentData },
    document: { getElementById: (id) => id === "contact-whatsapp" ? app : id === "contact-whatsapp-web" ? web : null, querySelectorAll: () => [copy] }
  };
  vm.runInNewContext(source, context);
  return { app, web, copy, prepareLinks: context.window.CV_WHATSAPP.prepareLinks };
}

test("Android Chromium uses a protected separate context and browser-managed fallback", () => {
  for (const brands of [[{ brand: "Google Chrome" }], [{ brand: "Chromium" }, { brand: "Brave" }]]) {
    const { app, web, copy } = setup(androidAgent, { platform: "Android", brands });
    assert.match(app.href, /^intent:\/\/send\/\?phone=56964194547#Intent;scheme=whatsapp;/);
    assert.equal(app.getAttribute("target"), "_blank");
    assert.equal(app.getAttribute("rel"), "noopener noreferrer");
    assert.equal(copy.dataset.i18n, "contact.androidInstructions");
    const fallback = decodeURIComponent(app.href.match(/S\.browser_fallback_url=([^;]+);end$/)[1]);
    assert.equal(fallback, "https://wa.me/56964194547");
    assert.equal(web.href, fallback);
  }
});

test("Android client hints also work when the user-agent text is reduced", () => {
  const { app } = setup("Mozilla/5.0", { platform: "Android", brands: [{ brand: "Chromium" }] });
  assert.match(app.href, /^intent:/);
});

test("desktop, iOS and non-Chromium browsers retain native app links without new tabs", () => {
  for (const agent of ["Mozilla/5.0 (Windows NT 10.0) Chrome/149.0", "Mozilla/5.0 (iPhone) Version/18.0 Safari/605.1", "Mozilla/5.0 (Android 14; Mobile) Gecko/149.0 Firefox/149.0"]) {
    const { app, copy } = setup(agent);
    assert.equal(app.href, "whatsapp://send/?phone=56964194547");
    assert.equal(app.getAttribute("target"), null);
    assert.equal(copy.dataset.i18n, "contact.instructions");
  }
});

test("the app and fallback preserve the exact reviewed UTF-8 message and recipient", () => {
  const { app, web, prepareLinks } = setup(androidAgent);
  const message = "Company: Ágata & Hijos + I+D\nProposal: 50% growth; role #1 😊";
  app.setAttribute("aria-disabled", "true");
  prepareLinks(app, web, message);
  const native = new URL(app.href.split("#Intent;")[0]);
  const fallback = new URL(decodeURIComponent(app.href.match(/S\.browser_fallback_url=([^;]+);end$/)[1]));
  assert.equal(native.searchParams.get("phone"), "56964194547");
  assert.equal(native.searchParams.get("text"), message);
  assert.equal(fallback.href, new URL(web.href).href);
  assert.equal(fallback.searchParams.get("text"), message);
  assert.equal(app.getAttribute("aria-disabled"), "true", "The URL helper must not bypass the review gate");
  assert.doesNotMatch(source, /setTimeout|setInterval|localStorage|sessionStorage|location\s*=|\.focus\(/);
});
