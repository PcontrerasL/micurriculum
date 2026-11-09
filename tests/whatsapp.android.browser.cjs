"use strict";

// Android identities are emulated; actual OS app-switch/back-stack behavior is not.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const url = process.env.CV_TEST_URL || "http://127.0.0.1:4173/";
const userAgent = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/149.0.0.0 Mobile Safari/537.36";
const simulatedApp = "https://whatsapp-app.invalid/";

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  try {
    for (const identity of ["Chrome", "Brave"]) {
      const context = await browser.newContext({ userAgent, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce", colorScheme: "light" });
      await context.route(simulatedApp, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Simulated external app</title><p>App handoff test only.</p>" }));
      await context.addInitScript(({ simulatedApp, identity }) => {
        if (identity === "Brave") Object.defineProperty(navigator, "brave", { value: { isBrave: async () => true } });
        document.addEventListener("click", (event) => {
          const link = event.target.closest?.("a");
          if (!link || !/^(?:intent|whatsapp):/.test(link.href) || event.defaultPrevented) return;
          event.preventDefault();
          window.lastAttemptedWhatsApp = link.href;
          // Substitute only the external destination; honor the production target.
          window.open(simulatedApp, link.target || "_self", link.rel.includes("noopener") ? "noopener,noreferrer" : "");
        });
      }, { simulatedApp, identity });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      const originalURL = page.url();
      await page.evaluate(() => { window.cvReturnToken = "original-document"; });
      const contact = page.locator("#contact-whatsapp");
      const continuation = page.locator("#opportunity-continue");
      const company = page.locator("#opportunity-company");
      const role = page.locator("#opportunity-role");
      const description = page.locator("#opportunity-description");
      const review = page.locator('#opportunity-form button[type="submit"]');

      for (const language of ["es", "en"]) {
        if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language-toggle").click();
        for (const theme of ["light", "dark"]) {
          if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
          await page.locator('[data-open-dialog="contact-dialog"]').click();
          assert.equal(await page.locator('#contact-dialog [data-android-i18n]').getAttribute("data-i18n"), "contact.androidInstructions");
          for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          }
          await page.keyboard.press("Escape");
          await page.locator('[data-open-dialog="opportunity-dialog"]').click();
          assert.equal(await page.locator("#opportunity-disclaimer").getAttribute("data-i18n"), "opportunity.androidDisclaimer");
          assert.equal(await continuation.getAttribute("href"), null);
          await page.keyboard.press("Escape");
        }
      }

      async function returnFromApp(action) {
        const [app] = await Promise.all([context.waitForEvent("page"), action.click()]);
        await app.waitForLoadState();
        assert.equal(app.url(), simulatedApp);
        assert.equal(await app.evaluate(() => window.opener), null);
        await app.close();
        await page.bringToFront();
        assert.equal(page.url(), originalURL);
        assert.equal(await page.evaluate(() => window.cvReturnToken), "original-document");
      }

      await page.locator('[data-open-dialog="contact-dialog"]').click();
      assert.equal(await contact.getAttribute("target"), "_blank");
      await returnFromApp(contact);
      assert.ok(await page.locator("#contact-dialog").evaluate((dialog) => dialog.open));
      assert.match(await page.evaluate(() => window.lastAttemptedWhatsApp), /^intent:\/\/send\/\?phone=56964194547#Intent;/);
      await page.keyboard.press("Escape");

      await page.locator('[data-open-dialog="opportunity-dialog"]').click();
      await company.fill("Example Company");
      await role.fill("Sales Manager");
      await description.fill("An opportunity to lead a commercial team and develop new business.");
      assert.equal(await continuation.getAttribute("href"), null);
      await review.click();
      const message = await page.locator("#opportunity-message").textContent();
      const appURL = await continuation.getAttribute("href");
      assert.equal(new URL(appURL.split("#Intent;")[0]).searchParams.get("text"), message);
      assert.equal(new URL(decodeURIComponent(appURL.match(/S\.browser_fallback_url=([^;]+);end$/)[1])).searchParams.get("text"), message);
      await returnFromApp(continuation);
      assert.ok(await page.locator("#opportunity-dialog").evaluate((dialog) => dialog.open));
      assert.equal(await company.inputValue(), "Example Company");
      assert.equal(await page.locator("#opportunity-message").textContent(), message);
      assert.equal(await continuation.getAttribute("aria-disabled"), "false");
      await company.fill("Updated Company");
      assert.equal(await continuation.getAttribute("href"), null);
      await continuation.dispatchEvent("click");
      assert.equal(context.pages().length, 1);
      await review.click();
      await role.evaluate((input) => { input.value = "Unreviewed change"; });
      await continuation.dispatchEvent("click");
      assert.equal(context.pages().length, 1);
      assert.equal(await continuation.getAttribute("href"), null);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(JSON.stringify({ result: "PASS", identities: "Android Chrome/Brave user-agent emulation", layouts: 16, handoff: "protected separate context; original CV document, modal and reviewed draft preserved after simulated app return", safety: "invalid/stale drafts blocked; exact message in native intent and fallback", limitation: "external app destination substituted; physical Android app switching and automatic return were not tested" }, null, 2));
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
