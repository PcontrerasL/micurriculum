"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");

const url = process.env.CV_TEST_URL || "http://127.0.0.1:4173";
const screenshots = path.join(os.tmpdir(), "opencode", "cvpaulina-review");

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", colorScheme: "light" });
  const whatsappRequests = [];
  await context.route("https://wa.me/**", async (route) => {
    whatsappRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Intercepted WhatsApp draft</title><p>Test only. No message sent.</p>" });
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("a");
      if (link?.getAttribute("href")?.startsWith("whatsapp:")) event.preventDefault();
    }, true);
  });
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  const opener = page.locator('.footer-contact-link[data-open-dialog="opportunity-dialog"]');
  const dialog = page.locator("#opportunity-dialog");
  const company = page.locator("#opportunity-company");
  const role = page.locator("#opportunity-role");
  const description = page.locator("#opportunity-description");
  const output = page.locator("#opportunity-message");
  const continuation = page.locator("#opportunity-continue");
  const webFallback = page.locator("#opportunity-web-fallback");
  const review = page.locator('#opportunity-form button[type="submit"]');
  const sparkles = page.locator(".opportunity-form-sparkles");
  const mainSparkle = sparkles.locator(".opportunity-sparkle--main");

  async function closeDialog() {
    if (await dialog.evaluate((element) => element.open)) await page.keyboard.press("Escape");
  }

  async function verifyGreenAction(action) {
    const palette = await action.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundImage === "none" ? style.backgroundColor : style.backgroundImage };
    });
    assert.equal(palette.color, "rgb(255, 255, 255)");
    const colors = [...palette.background.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].map((match) => match.slice(1).map(Number));
    assert.ok(colors.length > 0, `Missing action background: ${palette.background}`);
    const luminance = (rgb) => {
      const channels = rgb.map((channel) => channel / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const rgb of colors) {
      assert.ok(rgb[1] > rgb[0] && rgb[1] > rgb[2], `The action must stay green in both themes: ${palette.background}`);
      const highlighted = rgb.map((channel, index) => channel * 0.84 + [190, 255, 215][index] * 0.16);
      assert.ok(1.05 / (luminance(highlighted) + 0.05) >= 4.5, `The brightest sheen must retain readable white text: ${palette.background}`);
    }
  }

  async function verifyActionMotion(action, enabled) {
    assert.equal(await action.evaluate((element) => getComputedStyle(element).animationName), enabled ? "opportunity-ready" : "none");
    assert.equal(await action.evaluate((element) => getComputedStyle(element, "::before").animationName), enabled ? "opportunity-sheen" : "none");
  }

  try {
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("#contact-whatsapp").getAttribute("href"), "whatsapp://send/?phone=56964194547");
    assert.equal(await page.locator("#contact-whatsapp").getAttribute("target"), null, "Native app opening must not create a blank tab");
    assert.equal(await page.locator("#contact-whatsapp-web").getAttribute("href"), "https://wa.me/56964194547");
    const originalURL = page.url();
    await opener.click();
    assert.equal(page.url(), originalURL);
    assert.equal(context.pages().length, 1);
    assert.ok(await dialog.evaluate((element) => element.open));
    assert.equal(await page.locator(".opportunity-draft-badge").count(), 0);
    assert.equal(await sparkles.getAttribute("aria-hidden"), "true");
    assert.equal(await sparkles.evaluate((element) => element.tabIndex), -1);
    assert.equal(await sparkles.evaluate((element) => getComputedStyle(element).pointerEvents), "none");
    assert.deepEqual(await Promise.all([company.inputValue(), role.inputValue(), description.inputValue()]), ["", "", ""]);
    assert.equal(await continuation.getAttribute("aria-disabled"), "true");
    assert.equal(await continuation.getAttribute("href"), null);
    assert.equal(await webFallback.getAttribute("href"), null);
    await continuation.dispatchEvent("click");
    assert.equal(whatsappRequests.length, 0);

    for (const language of ["es", "en"]) {
      await closeDialog();
      if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language-toggle").click();
      for (const theme of ["light", "dark"]) {
        await closeDialog();
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
        assert.equal(await opener.locator(".footer-contact-label").evaluate((element) => getComputedStyle(element, "::after").animationName), "none");
        assert.equal(await opener.locator(".footer-contact-arrow").evaluate((element) => getComputedStyle(element).animationName), "none");
        await opener.click();
        for (const width of [320, 390, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const layout = await page.locator(".opportunity-dialog").evaluate((article) => ({
            width: article.getBoundingClientRect().width,
            scroll: article.scrollWidth,
            client: article.clientWidth,
            document: document.documentElement.scrollWidth,
            viewport: innerWidth
          }));
          assert.ok(layout.document <= width && layout.width <= width - 30 && layout.scroll <= layout.client + 1, `Opportunity modal overflows: ${JSON.stringify(layout)}`);
          assert.ok(await sparkles.evaluate((element) => {
            const art = element.getBoundingClientRect();
            const title = element.previousElementSibling.getBoundingClientRect();
            const heading = element.parentElement.getBoundingClientRect();
            return art.right <= heading.right + 1 && (art.left >= title.right + 4 || art.top >= title.bottom);
          }), "Decorative sparkles must not overlap the heading or exceed the form");
        }
        for (const action of [review, continuation]) {
          await verifyGreenAction(action);
          await verifyActionMotion(action, false);
        }
        assert.equal(await mainSparkle.evaluate((element) => getComputedStyle(element).animationName), "none");
        assert.equal(await company.getAttribute("placeholder"), language === "es" ? "Nombre de la empresa" : "Company name");
        await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
        const audit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) })));
        assert.deepEqual(audit, [], `Opportunity accessibility: ${JSON.stringify(audit)}`);
        await closeDialog();
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    if (await page.locator("html").getAttribute("lang") !== "es") await page.locator("#language-toggle").click();
    if (await page.locator("html").getAttribute("data-theme") !== "light") await page.locator("#theme-toggle").click();
    await opener.click();
    await company.fill("   ");
    await role.fill("Jefatura");
    await description.fill("Breve");
    await review.click();
    assert.equal(await company.evaluate((input) => input.validity.valid), false);
    assert.equal(await continuation.getAttribute("href"), null);
    assert.equal(whatsappRequests.length, 0);

    await company.fill("Ágata & Hijos + I+D");
    await role.fill("Jefatura / Proyecto #1");
    await description.fill("Propuesta de administración y liderazgo: A&B = 10% + seguimiento. Modalidad híbrida y colaboración profesional. 😊");
    await review.click();
    assert.ok(await review.evaluate((button) => {
      const style = getComputedStyle(button);
      return style.backgroundImage !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)";
    }), "The gradient-to-solid hover change must not flash white text on a transparent button");
    assert.equal(await continuation.getAttribute("aria-disabled"), "false");
    let target = new URL(await continuation.getAttribute("href"));
    assert.equal(target.protocol, "whatsapp:");
    assert.equal(target.hostname, "send");
    assert.equal(target.searchParams.get("phone"), "56964194547");
    assert.equal(target.searchParams.get("text"), await output.textContent());
    assert.match(target.searchParams.get("text"), /Ágata & Hijos \+ I\+D/);
    assert.match(target.searchParams.get("text"), /😊/);
    const webTarget = new URL(await webFallback.getAttribute("href"));
    assert.equal(webTarget.origin, "https://wa.me");
    assert.equal(webTarget.pathname, "/56964194547");
    assert.equal(webTarget.searchParams.get("text"), await output.textContent());
    assert.equal(await continuation.getAttribute("target"), null);
    await verifyActionMotion(review, false);
    await verifyActionMotion(continuation, false);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("opportunity-continue")).animationName === "opportunity-ready");
    assert.equal(await mainSparkle.evaluate((element) => getComputedStyle(element).animationName), "opportunity-sparkle-float");
    assert.equal(await sparkles.locator(".opportunity-sparkle--top").evaluate((element) => getComputedStyle(element).animationName), "opportunity-sparkle-twinkle");
    const decoration = await mainSparkle.evaluate((element) => {
      const animation = element.getAnimations().find((item) => item.animationName === "opportunity-sparkle-float");
      animation.pause();
      animation.currentTime = 0;
      const firstTransform = getComputedStyle(element).transform;
      const firstBox = element.parentElement.getBoundingClientRect();
      animation.currentTime = 1800;
      const secondTransform = getComputedStyle(element).transform;
      const secondBox = element.parentElement.getBoundingClientRect();
      animation.play();
      return { firstTransform, secondTransform, stable: firstBox.width === secondBox.width && firstBox.height === secondBox.height && firstBox.left === secondBox.left && firstBox.top === secondBox.top };
    });
    assert.notEqual(decoration.firstTransform, decoration.secondTransform);
    assert.ok(decoration.stable, "Sparkle motion must not move the form layout");
    for (const action of [review, continuation]) {
      await verifyActionMotion(action, true);
      await verifyGreenAction(action);
      const pulse = await action.evaluate((element) => {
        const animation = element.getAnimations().find((item) => item.animationName === "opportunity-ready");
        animation.pause();
        animation.currentTime = 0;
        const restingShadow = getComputedStyle(element).boxShadow;
        const restingRect = element.getBoundingClientRect();
        animation.currentTime = 1400;
        const glowingShadow = getComputedStyle(element).boxShadow;
        const glowingRect = element.getBoundingClientRect();
        animation.play();
        return { restingShadow, glowingShadow, stable: restingRect.width === glowingRect.width && restingRect.height === glowingRect.height };
      });
      assert.notEqual(pulse.restingShadow, pulse.glowingShadow, "The green pulse must change the rendered shadow");
      assert.match(pulse.glowingShadow, /rgba\(34, 197, 94,/);
      assert.ok(pulse.stable, "Decorative motion must not resize action targets");
    }
    assert.equal(await opener.locator(".footer-contact-label").evaluate((element) => getComputedStyle(element, "::after").animationName), "footer-invitation-line");
    assert.equal(await opener.locator(".footer-contact-arrow").evaluate((element) => getComputedStyle(element).animationName), "footer-invitation-glow");
    await review.evaluate((button) => { button.disabled = true; });
    await verifyActionMotion(review, false);
    await review.evaluate((button) => { button.disabled = false; });
    await verifyActionMotion(review, true);
    assert.equal(await continuation.locator(".sr-only").evaluate((element) => getComputedStyle(element).position), "absolute");
    const readyAudit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) })));
    assert.deepEqual(readyAudit, [], `Enabled opportunity accessibility: ${JSON.stringify(readyAudit)}`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("opportunity-continue")).animationName === "none");
    assert.equal(await mainSparkle.evaluate((element) => getComputedStyle(element).animationName), "none");
    assert.equal(await sparkles.evaluate((element) => getComputedStyle(element, "::before").animationName), "none");
    assert.ok(await sparkles.isVisible(), "Reduced motion must keep the static decoration visible");
    for (const action of [review, continuation]) await verifyActionMotion(action, false);
    assert.equal(await opener.locator(".footer-contact-arrow").evaluate((element) => getComputedStyle(element).animationName), "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("opportunity-continue")).animationName === "opportunity-ready");
    assert.equal(whatsappRequests.length, 0, "Review alone must not contact WhatsApp");

    await company.fill("Empresa actualizada");
    assert.equal(await continuation.getAttribute("href"), null, "Editing must invalidate the reviewed draft");
    assert.equal(await continuation.getAttribute("aria-disabled"), "true");
    assert.equal(await webFallback.getAttribute("href"), null);
    await verifyActionMotion(continuation, false);
    await verifyActionMotion(review, true);
    await review.click();
    await role.evaluate((input) => { input.value = "Cambio sin evento de entrada"; });
    await continuation.dispatchEvent("click");
    assert.equal(await continuation.getAttribute("href"), null, "A stale draft must not be shared even without an input event");
    assert.equal(whatsappRequests.length, 0);

    await role.fill("Jefatura comercial");
    await description.fill('<img src="invalid" onerror="alert(1)"> Oportunidad de liderazgo comercial.');
    assert.equal(await page.locator("#opportunity-message img").count(), 0);
    assert.match(await output.textContent(), /<img src=/);
    await description.fill("Oportunidad de liderazgo comercial con una modalidad de trabajo híbrida y un equipo colaborativo.");
    await review.click();
    const spanishMessage = await output.textContent();
    await closeDialog();
    await page.locator("#language-toggle").click();
    await opener.click();
    assert.equal(await company.inputValue(), "Empresa actualizada");
    assert.equal(await continuation.getAttribute("href"), null);
    assert.match(await output.textContent(), /^Hello, Paulina:/);
    assert.notEqual(await output.textContent(), spanishMessage);
    await review.click();
    const expectedMessage = await output.textContent();
    const expectedNativeURL = await continuation.getAttribute("href");
    const expectedWebURL = await webFallback.getAttribute("href");
    await continuation.evaluate((link) => {
      link.addEventListener("click", (event) => {
        // Verify the attempted native URI without launching the real OS app.
        event.preventDefault();
        window.attemptedNativeWhatsApp = link.href;
      }, { capture: true, once: true });
    });
    const pageCount = context.pages().length;
    await continuation.click();
    assert.equal(await page.evaluate(() => window.attemptedNativeWhatsApp), expectedNativeURL);
    assert.equal(context.pages().length, pageCount, "Native opening must not create an empty browser tab");
    assert.equal(whatsappRequests.length, 0, "Native opening must not automatically trigger the web fallback");
    assert.equal(new URL(expectedNativeURL).searchParams.get("text"), expectedMessage);
    const [popup] = await Promise.all([context.waitForEvent("page"), webFallback.click()]);
    await popup.waitForLoadState();
    assert.equal(whatsappRequests.length, 1);
    target = new URL(whatsappRequests[0]);
    assert.equal(target.pathname, "/56964194547");
    assert.equal(target.searchParams.get("text"), expectedMessage);
    assert.equal(new URL(popup.url()).href, new URL(expectedWebURL).href);
    assert.equal(await page.locator('[data-opportunity-step="3"]').getAttribute("aria-current"), "step");
    await popup.close();

    await page.locator("#reset-opportunity").click();
    assert.deepEqual(await Promise.all([company.inputValue(), role.inputValue(), description.inputValue()]), ["", "", ""]);
    assert.equal(await continuation.getAttribute("href"), null);
    assert.equal(await webFallback.getAttribute("href"), null);
    assert.ok(await page.evaluate(() => Object.keys(localStorage).every((key) => ["paulina-language", "paulina-theme"].includes(key))));
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);

    await closeDialog();
    await page.locator("#language-toggle").click();
    await opener.click();
    await company.fill("Empresa de prueba");
    await role.fill("Jefatura de Ventas");
    await description.fill("Buscamos una profesional para liderar un equipo comercial y desarrollar nuevas oportunidades de negocio.");
    await review.click();
    fs.mkdirSync(screenshots, { recursive: true });
    await page.mouse.move(0, 0);
    for (const [name, width, height] of [["opportunity-live-desktop", 1440, 1000], ["opportunity-live-mobile", 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.locator(".opportunity-dialog").evaluate((article) => { article.scrollTop = 0; });
      await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
    }
    await closeDialog();
    await page.waitForFunction(() => document.activeElement === document.querySelector(".footer-contact-link"));
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const theme of ["light", "dark"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
      await page.locator(".site-footer").screenshot({ path: path.join(screenshots, `opportunity-footer-${theme}.png`) });
      await opener.click();
      await review.click();
      for (const action of [review, continuation]) {
        await verifyGreenAction(action);
        await verifyActionMotion(action, true);
      }
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(screenshots, `opportunity-actions-${theme}.png`) });
      await closeDialog();
    }
    await page.reload();
    assert.deepEqual(await Promise.all([company.inputValue(), role.inputValue(), description.inputValue()]), ["", "", ""], "Drafts must not persist after reload");
    assert.deepEqual(errors, []);
    assert.deepEqual(failedRequests, []);
    console.log(JSON.stringify({ result: "PASS", configurations: 20, entry: "footer invitation has an animated underline and circular arrow accent; opens the production dialog", validation: "empty/short values and stale drafts blocked for native and web actions", safety: "safe text rendering, correct UTF-8 encoding, no draft storage", whatsapp: "native URI and explicit web fallback preserve the confirmed number and reviewed message; no real app launched or message sent", effect: "both green actions pulse/shine only when enabled; stable dimensions, readable peak sheen and live reduced-motion changes verified", accessibility: "no automated A/AA violations in both languages/themes or the enabled proposal; screen-reader text stays hidden", screenshots }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
