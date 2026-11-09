"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const baseURL = process.env.CV_TEST_URL || "http://127.0.0.1:4173";
const url = `${baseURL.replace(/\/$/, "")}/preview/oportunidad.html`;
const screenshots = path.join(os.tmpdir(), "opencode", "cvpaulina-review");

async function main() {
  const html = fs.readFileSync(path.join(root, "preview/oportunidad.html"), "utf8");
  const liveHTML = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.doesNotMatch(html, /<style\b|\sstyle\s*=|\son[a-z]+\s*=/i);
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(script[1], /src="/);
    assert.equal(script[2].trim(), "");
  }
  for (const asset of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    assert.ok(fs.existsSync(path.resolve(root, "preview", decodeURIComponent(asset[1]))), `Missing asset ${asset[1]}`);
  }
  assert.doesNotMatch(liveHTML, /preview\/oportunidad/);
  assert.match(liveHTML, /class="footer-contact-link"[^>]*data-open-dialog="opportunity-dialog"/);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("request", (request) => { if (!request.url().startsWith(baseURL)) externalRequests.push(request.url()); });
  try {
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.locator("#opportunity-dialog").evaluate((dialog) => dialog.open));
    assert.equal(await page.locator('input[type="search"]').count(), 0);
    assert.match(await page.locator("#preview-message").textContent(), /Empresa de ejemplo/);
    assert.equal(await page.locator("#preview-continue").isDisabled(), true);

    for (const language of ["es", "en"]) {
      if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#preview-language").click();
      for (const theme of ["light", "dark"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#preview-theme").click();
        for (const width of [320, 390, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const layout = await page.locator(".opportunity-preview").evaluate((article) => ({
            width: article.getBoundingClientRect().width,
            scroll: article.scrollWidth,
            client: article.clientWidth,
            page: document.documentElement.scrollWidth,
            viewport: innerWidth
          }));
          assert.ok(layout.page <= width && layout.width <= width - 30 && layout.scroll <= layout.client + 1, `Preview overflow: ${JSON.stringify(layout)}`);
        }
        await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
        const audit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) })));
        assert.deepEqual(audit, [], `Preview accessibility: ${JSON.stringify(audit)}`);
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    if (await page.locator("html").getAttribute("lang") !== "es") await page.locator("#preview-language").click();
    if (await page.locator("html").getAttribute("data-theme") !== "light") await page.locator("#preview-theme").click();
    await page.locator("#opportunity-company").fill("Organización de prueba");
    await page.locator("#opportunity-role").fill("Proyecto comercial");
    await page.locator("#opportunity-description").fill("Queremos presentar una oportunidad para liderar un proyecto comercial.");
    assert.match(await page.locator("#preview-message").textContent(), /Organización de prueba/);
    assert.equal(await page.locator("#preview-data-badge").textContent(), "Borrador local");
    await page.locator('#opportunity-form button[type="submit"]').click();
    assert.equal(await page.locator('[data-preview-step="2"]').getAttribute("aria-current"), "step");
    assert.equal(await page.locator("#preview-continue").isEnabled(), true);
    const pageCount = context.pages().length;
    await page.locator("#preview-continue").click();
    assert.equal(context.pages().length, pageCount);
    assert.equal(page.url(), url);
    assert.match(await page.locator("#preview-status").textContent(), /no se abrió WhatsApp ni se envió/);

    await page.locator("#opportunity-company").fill('<img src="invalid" onerror="alert(1)">');
    assert.equal(await page.locator("#preview-message img").count(), 0);
    assert.match(await page.locator("#preview-message").textContent(), /<img src=/);
    await page.locator("#opportunity-company").fill("   ");
    await page.locator('#opportunity-form button[type="submit"]').click();
    assert.equal(await page.locator("#preview-continue").isDisabled(), true);
    assert.equal(await page.locator("#opportunity-company").evaluate((input) => input.validity.valid), false);
    await page.locator("#reset-preview").click();
    assert.match(await page.locator("#preview-message").textContent(), /Empresa de ejemplo/);
    assert.equal(await page.evaluate(() => localStorage.getItem("paulina-language")), null);
    assert.equal(await page.evaluate(() => localStorage.getItem("paulina-theme")), null);

    fs.mkdirSync(screenshots, { recursive: true });
    for (const [name, width, height] of [["opportunity-preview-desktop", 1440, 1000], ["opportunity-preview-mobile", 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.locator(".opportunity-preview").evaluate((article) => { article.scrollTop = 0; });
      await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement === document.getElementById("open-preview"));
    await page.locator("#open-preview").click();
    assert.ok(await page.locator("#opportunity-dialog").evaluate((dialog) => dialog.open));
    assert.deepEqual(errors, []);
    assert.deepEqual(failedRequests, []);
    assert.deepEqual(externalRequests, []);
    console.log(JSON.stringify({ result: "PASS", url, configurations: 20, liveCV: "opportunity flow is separately integrated; demo remains isolated", form: "live message preview, validation and safe text rendering verified", demo: "no WhatsApp opened, no information sent, no global preferences overwritten", accessibility: "no automated A/AA violations in either language or theme", screenshots }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
