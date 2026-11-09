"use strict";

// Development-only packages: playwright, axe-core, jsqr and pngjs.
// Start a static server on port 4173 before running this file.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");

const root = path.resolve(__dirname, "..");
const baseURL = process.env.CV_TEST_URL || "http://127.0.0.1:4173";
const screenshots = path.join(os.tmpdir(), "opencode", "cvpaulina-review");
const chromePaths = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

async function serveProjectSubpath() {
  const prefix = "/cv-preview/";
  const mimeTypes = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf" };
  const server = http.createServer((request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (!pathname.startsWith(prefix)) {
        response.writeHead(404).end();
        return;
      }
      const filename = path.resolve(root, decodeURIComponent(pathname.slice(prefix.length)) || "index.html");
      if (!filename.startsWith(`${root}${path.sep}`) || !fs.statSync(filename).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filename)] || "application/octet-stream", "Content-Length": fs.statSync(filename).size });
      fs.createReadStream(filename).on("error", () => response.destroy()).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}${prefix}` };
}

async function main() {
  const qr = PNG.sync.read(fs.readFileSync(path.join(root, "img/contact-details.png")));
  const decoded = jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height);
  assert.ok(decoded, "The contact QR must be machine-readable");
  assert.equal(decoded.data.replace(/\r\n/g, "\n"), fs.readFileSync(path.join(root, "assets/paulina-contact.txt"), "utf8").trimEnd());
  assert.match(decoded.data, /^Nombre: Paulina Angélica Contreras Levio$/m);
  assert.match(decoded.data, /^Teléfono: \+56 9 6419 4547$/m);
  assert.match(decoded.data, /^Correo: paucontrerasl@gmail\.com$/m);
  assert.match(decoded.data, /^Título: Ingeniero en Administración de Empresas \(en curso\)$/m);
  assert.doesNotMatch(decoded.data, /BEGIN:VCARD/);

  const executablePath = chromePaths.find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", reducedMotion: "no-preference" });
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  const externalRequests = [];
  let deploymentServer;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL)) externalRequests.push(request.url());
  });

  async function settleTransitions() {
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      // Decorative loops never finish; wait only for finite layout transitions.
      await Promise.allSettled(document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map((animation) => animation.finished));
    });
  }

  async function verifyPDFDownload(targetPage) {
    const filename = "CVPaulina Angélica Contreras Levio.pdf";
    const [download] = await Promise.all([
      targetPage.waitForEvent("download"),
      targetPage.locator(".hero-actions a[download]").click()
    ]);
    assert.equal(download.suggestedFilename(), filename);
    assert.equal(await download.failure(), null);
    assert.ok(fs.readFileSync(await download.path()).equals(fs.readFileSync(path.join(root, filename))), "Downloaded PDF bytes do not match the supplied CV");
  }

  async function verifyCounterCycle(targetPage, label) {
    await targetPage.evaluate(() => {
      window.counterReplayTrace = [];
      window.counterReplayObserver = new MutationObserver(() => {
        window.counterReplayTrace.push([...document.querySelectorAll("[data-count]")].map((node) => Number(node.textContent)));
      });
      window.counterReplayObserver.observe(document.querySelector(".stats-grid"), { childList: true, subtree: true });
    });
    await targetPage.locator(".stats-grid").evaluate((grid) => grid.scrollIntoView({ behavior: "instant", block: "center" }));
    await targetPage.waitForFunction(() => window.counterReplayTrace.some((frame) => frame[1] > 0 && frame[1] < 6) && [...document.querySelectorAll("[data-count]")].every((node) => node.textContent === node.dataset.count));
    const trace = await targetPage.evaluate(() => {
      window.counterReplayObserver.disconnect();
      return window.counterReplayTrace;
    });
    for (const [index, target] of [3, 6, 6].entries()) {
      assert.ok(trace.some((frame) => frame[index] > 0 && frame[index] < target), `${label}: counter ${index} did not visibly count up`);
      assert.equal(trace.at(-1)[index], target);
      assert.ok(trace.every((frame, position) => position === 0 || frame[index] >= trace[position - 1][index]), `${label}: overlapping animation restarted counter ${index}`);
    }
  }

  async function leaveCounters(targetPage) {
    await targetPage.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await targetPage.waitForFunction(() => [...document.querySelectorAll("[data-count]")].every((node) => node.textContent === "0"));
  }

  try {
    fs.mkdirSync(screenshots, { recursive: true });
    await page.goto(baseURL);
    await page.evaluate(() => document.fonts.ready);
    assert.equal((await page.locator(".brand-monogram").textContent()).trim(), "PC.");
    assert.ok(await page.locator(".hero-portrait").evaluate((image) => {
      const rect = image.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === image;
    }), "The decorative portrait ring must not overlay or wash out the photograph");
    assert.deepEqual(await page.locator("main > section").evaluateAll((sections) => sections.map((section) => section.id || section.classList[0])), ["inicio", "perfil", "social-section"]);
    assert.equal(await page.locator(".gallery-section, #photo-dialog").count(), 0);
    assert.equal(await page.locator("#gallery-dialog img").count(), 0);
    assert.ok(await page.locator(".profile-section").evaluate((section) => section.contains(document.querySelector(".stats-grid")) && section.contains(document.querySelector(".profile-grid"))));
    assert.equal(await page.locator(".stats-heading, .section-next").count(), 0);
    assert.deepEqual(await page.locator("[data-count]").allTextContents(), ["0", "0", "0"]);
    await page.evaluate(() => {
      window.counterTrace = [];
      window.counterTestObserver = new MutationObserver(() => {
        window.counterTrace.push([...document.querySelectorAll("[data-count]")].map((node) => Number(node.textContent)));
      });
      window.counterTestObserver.observe(document.querySelector(".stats-grid"), { childList: true, characterData: true, subtree: true });
    });
    await page.locator(".stats-grid").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll("[data-count]")].every((node) => node.textContent === node.dataset.count));
    const counterTrace = await page.evaluate(() => {
      window.counterTestObserver.disconnect();
      return window.counterTrace;
    });
    assert.ok(counterTrace.length > 2, "Counters must animate across multiple visible frames");
    for (const [index, target] of [3, 6, 6].entries()) {
      assert.ok(counterTrace.some((frame) => frame[index] > 0 && frame[index] < target), `Counter ${index} skipped its intermediate values`);
      assert.equal(counterTrace.at(-1)[index], target);
      assert.ok(counterTrace.every((frame, position) => position === 0 || frame[index] >= counterTrace[position - 1][index]), `Counter ${index} should increase monotonically`);
    }

    for (const visit of ["second visit", "third visit"]) {
      await leaveCounters(page);
      await verifyCounterCycle(page, visit);
    }

    await page.evaluate(() => {
      window.counterJitterChanges = 0;
      window.counterJitterObserver = new MutationObserver(() => { window.counterJitterChanges += 1; });
      window.counterJitterObserver.observe(document.querySelector(".stats-grid"), { childList: true, subtree: true });
    });
    for (const fraction of [0.45, 0.25, 0.45]) {
      await page.evaluate(async (visibleFraction) => {
        const rect = document.querySelector(".stats-grid").getBoundingClientRect();
        scrollTo({ top: rect.top + scrollY - innerHeight + rect.height * visibleFraction, behavior: "instant" });
        for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
      }, fraction);
    }
    assert.equal(await page.evaluate(() => {
      window.counterJitterObserver.disconnect();
      return window.counterJitterChanges;
    }), 0, "Crossing the 35% threshold without leaving must not restart the animation");

    await page.evaluate(() => {
      const grid = document.querySelector(".stats-grid").getBoundingClientRect();
      const headerHeight = document.querySelector(".site-header").getBoundingClientRect().height;
      scrollTo({ top: grid.top + scrollY + grid.height - headerHeight + 1, behavior: "instant" });
    });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-count]")].every((node) => node.textContent === "0"));
    await verifyCounterCycle(page, "return from behind sticky header");

    await leaveCounters(page);
    await page.locator(".stats-grid").evaluate((grid) => grid.scrollIntoView({ behavior: "instant", block: "center" }));
    await page.waitForFunction(() => {
      const value = Number(document.querySelector('[data-count="6"]').textContent);
      return value > 0 && value < 6;
    });
    await leaveCounters(page);
    await page.evaluate(async () => { for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame); });
    assert.deepEqual(await page.locator("[data-count]").allTextContents(), ["0", "0", "0"], "An interrupted animation must stay canceled off screen");
    await verifyCounterCycle(page, "return after an interrupted animation");

    const widths = [320, 360, 390, 600, 768, 800, 1024, 1080, 1280, 1440, 1920, 2560];
    for (const language of ["es", "en"]) {
      if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language-toggle").click();
      assert.equal(await page.locator('.expertise-line [data-i18n="tools.agileMethods"]').textContent(), language === "es" ? "Metodologías ágiles: Kanban y Scrum" : "Agile methods: Kanban and Scrum");
      for (const theme of ["light", "dark"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          const layout = await page.evaluate(() => ({
            viewport: innerWidth,
            viewportHeight: innerHeight,
            headerHeight: document.querySelector(".site-header").getBoundingClientRect().height,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
            nameSize: parseFloat(getComputedStyle(document.querySelector(".hero h1")).fontSize),
            sectionTitleSizes: [...document.querySelectorAll(".section-heading h2, .social-inner h2")].map((node) => parseFloat(getComputedStyle(node).fontSize)),
            counterSizes: [...document.querySelectorAll(".stat-number")].map((node) => parseFloat(getComputedStyle(node).fontSize)),
            cardTitleSizes: [...document.querySelectorAll(".profile-card h3")].map((node) => parseFloat(getComputedStyle(node).fontSize)),
            portraitWidth: document.querySelector(".hero-visual").getBoundingClientRect().width,
            heroPadding: parseFloat(getComputedStyle(document.querySelector(".hero")).paddingTop),
            sectionHeights: [...document.querySelectorAll("main > .screen-section")].map((node) => node.getBoundingClientRect().height),
            countersTop: document.querySelector(".stats-section").getBoundingClientRect().top + scrollY,
            counterRowHeight: document.querySelector(".stats-section").getBoundingClientRect().height,
            socialHeight: document.querySelector(".social-section").getBoundingClientRect().height,
            footerHeight: document.querySelector(".site-footer").getBoundingClientRect().height,
            rootBackground: getComputedStyle(document.documentElement).backgroundColor,
            cardBackground: getComputedStyle(document.querySelector(".profile-card")).backgroundColor,
            cardBackgroundImage: getComputedStyle(document.querySelector(".profile-card")).backgroundImage,
            statsBackgroundImage: getComputedStyle(document.querySelector(".stats-section")).backgroundImage,
            themeColor: document.querySelector('meta[name="theme-color"]').content,
            overviewHeight: document.querySelector(".profile-section").getBoundingClientRect().height,
            introAlignedRight: getComputedStyle(document.querySelector(".section-intro")).textAlign === "right" && Math.abs(document.querySelector(".section-intro").getBoundingClientRect().right - document.querySelector(".section-heading").getBoundingClientRect().right) < 1,
            heroContentFits: [...document.querySelectorAll(".hero-copy, .hero-focus, .hero-visual")].every((node) => {
              const rect = node.getBoundingClientRect();
              const hero = document.querySelector(".hero").getBoundingClientRect();
              return rect.top >= hero.top && rect.bottom <= hero.bottom;
            }),
            offenders: [...document.querySelectorAll("body *")].filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.right > innerWidth + 1;
            }).map((node) => node.className || node.tagName).slice(0, 8)
          }));
          assert.ok(layout.document <= width && layout.body <= width, `${language}/${theme}/${width}: ${JSON.stringify(layout)}`);
          assert.ok(layout.nameSize <= 56, `Oversized name at ${width}px: ${layout.nameSize}`);
          assert.ok(layout.sectionTitleSizes.every((size) => size <= 30), `Oversized section heading at ${width}px`);
          assert.ok(layout.cardTitleSizes.every((size) => size <= 24), `Oversized card heading at ${width}px`);
          assert.ok(layout.portraitWidth <= 300 && layout.heroPadding <= 44, `Oversized hero at ${width}px`);
          assert.equal(layout.sectionHeights.length, 2);
          assert.ok(layout.sectionHeights.every((height) => height >= layout.viewportHeight - layout.headerHeight - 1), `Section shorter than the available screen at ${width}px`);
          assert.ok(layout.countersTop >= layout.viewportHeight, `Counter divider is visible on the first screen at ${width}px`);
          assert.ok(layout.heroContentFits, `Hero content is clipped at ${width}px`);
          assert.ok(layout.counterRowHeight < 150, `Counter row is unnecessarily tall at ${width}px`);
          const expectedCounterSize = width >= 1080 ? 40 : width >= 800 ? 37.6 : width >= 600 ? 36 : 30.4;
          assert.ok(layout.counterSizes.every((size) => Math.abs(size - expectedCounterSize) < 0.05), `Counter sizes must remain unchanged at ${width}px`);
          assert.ok(Math.abs(layout.socialHeight - layout.counterRowHeight) <= 30, `Social row must be as compact as the counters at ${width}px: ${JSON.stringify(layout)}`);
          const footerLimit = width >= 800 ? 280 : width >= 600 ? 480 : 650;
          assert.ok(layout.footerHeight <= footerLimit, `Footer remains too tall at ${width}px: ${layout.footerHeight}`);
          if (theme === "light") {
            assert.equal(layout.rootBackground, "rgb(244, 238, 233)", "The light canvas must use the warm palette, not Pico's white fallback");
            assert.match(layout.cardBackgroundImage, /linear-gradient/);
            assert.match(layout.statsBackgroundImage, /linear-gradient/);
            assert.equal(layout.themeColor, "#f4eee9");
          } else {
            assert.equal(layout.rootBackground, "rgb(32, 29, 34)");
            assert.equal(layout.cardBackground, "rgb(40, 36, 42)");
            assert.equal(layout.cardBackgroundImage, "none", "Light-theme effects must not leak into dark mode");
            assert.equal(layout.themeColor, "#201d22");
          }
          assert.ok(layout.introAlignedRight, `Profile introduction is not right-aligned at ${width}px`);
          if (width >= 800) assert.ok(layout.overviewHeight <= layout.viewportHeight - layout.headerHeight + 1, `Counters and cards do not share one screen at ${width}px: ${layout.overviewHeight}px`);
        }
      }
    }

    for (const viewport of [{ width: 390, height: 568 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      const screenLayout = await page.evaluate(() => ({
        statsTop: document.querySelector(".stats-section").getBoundingClientRect().top + scrollY,
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        viewportHeight: innerHeight,
        heroHeight: document.querySelector(".hero").getBoundingClientRect().height,
        overviewHeight: document.querySelector(".profile-section").getBoundingClientRect().height,
        headerHeight: document.querySelector(".site-header").getBoundingClientRect().height
      }));
      assert.ok(screenLayout.statsTop >= viewport.height && screenLayout.width <= viewport.width, `Viewport separation failed: ${JSON.stringify(screenLayout)}`);
      if (viewport.width >= 1080) assert.ok(Math.abs(screenLayout.heroHeight + screenLayout.headerHeight - viewport.height) < 1, `Desktop hero should occupy exactly one initial screen: ${JSON.stringify(screenLayout)}`);
      if (viewport.width >= 1024 && viewport.height >= 720) assert.ok(screenLayout.overviewHeight <= viewport.height - screenLayout.headerHeight + 1, `Combined overview exceeds one laptop screen: ${JSON.stringify(screenLayout)}`);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator("#trayectoria").evaluate((section) => section.scrollIntoView({ behavior: "instant", block: "start" }));
    assert.ok(await page.locator("#trayectoria").evaluate((section) => Math.abs(section.getBoundingClientRect().top - document.querySelector(".site-header").getBoundingClientRect().height) < 2));
    assert.ok(await page.locator(".profile-grid").evaluate((cards) => cards.getBoundingClientRect().bottom <= innerHeight), "Cards must be visible with the counters on the same laptop screen");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#menu-toggle").click();
    assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "true");
    await page.locator('.main-navigation a[href="#estudios"]').click();
    assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(new URL(page.url()).hash, "#estudios");
    await page.locator("#menu-toggle").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "false");

    const linkedInURL = "https://www.linkedin.com/in/paulina-angelica-contreras-levio-46616969/";
    const linkedIn = page.locator('.social-links a:has(.icon--linkedin)');
    assert.equal(await linkedIn.getAttribute("href"), linkedInURL);
    assert.equal(await linkedIn.getAttribute("target"), "_blank");
    assert.equal(await linkedIn.getAttribute("rel"), "noopener noreferrer");
    assert.equal(await page.locator("#linkedin-dialog").count(), 0);
    await context.route(linkedInURL, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Intercepted LinkedIn profile</title><p>Navigation test only.</p>" }));
    const originalSocialURL = page.url();
    const [profileTab] = await Promise.all([context.waitForEvent("page"), linkedIn.click()]);
    await profileTab.waitForLoadState();
    assert.equal(profileTab.url(), linkedInURL);
    assert.equal(await profileTab.evaluate(() => window.opener), null);
    assert.equal(page.url(), originalSocialURL);
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await profileTab.close();
    await context.unroute(linkedInURL);

    for (const id of ["opportunity-dialog", "contact-dialog", "personal-dialog", "studies-dialog", "experience-dialog", "qr-dialog"]) {
      const trigger = page.locator(`[data-open-dialog="${id}"]`);
      const originalURL = page.url();
      const originalPageCount = context.pages().length;
      await trigger.click();
      assert.ok(await page.locator(`#${id}`).evaluate((dialog) => dialog.open));
      if (id === "personal-dialog") {
        assert.equal(await page.locator("#personal-dialog .personal-profile").evaluate((paragraph) => getComputedStyle(paragraph).textAlign), "justify");
        assert.match(await page.locator("#personal-dialog .personal-profile").textContent(), /Key Account Manager \(KAM\)/);
        assert.equal(await page.locator('#personal-dialog [data-i18n="skills.agile"]').count(), 1);
      }
      if (id === "studies-dialog") {
        assert.equal(await page.locator("#studies-dialog .education-item").count(), 3);
        assert.equal(await page.locator('#studies-dialog [data-i18n="studies.awarded"]').textContent(), "Degree awarded");
        assert.equal(await page.locator('#studies-dialog [data-i18n="studies.courseworkCompleted"]').textContent(), "Coursework completed");
        assert.ok(await page.locator("#studies-dialog > article").evaluate((article) => {
          const original = article.scrollTop;
          article.scrollTop = article.scrollHeight;
          const canScroll = getComputedStyle(article).overflowY === "auto" && article.scrollTop > 0 && !article.classList.contains("adaptive-dialog");
          article.scrollTop = original;
          return canScroll;
        }), "The studies modal must keep its original scrolling behavior");
      }
      if (id === "contact-dialog" || id === "opportunity-dialog") {
        assert.equal(page.url(), originalURL, "Contact and opportunity actions must open locally without navigating");
        assert.equal(context.pages().length, originalPageCount, "Opening a dialog must not create a blank tab");
      }
      assert.ok(await page.locator(`#${id}`).evaluate((dialog) => dialog.contains(document.activeElement)));
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(`#${id}`).evaluate((dialog) => dialog.open), false);
      assert.ok(await trigger.evaluate((button) => document.activeElement === button));
    }

    const personalViewports = [
      { width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 667 },
      { width: 390, height: 844 }, { width: 600, height: 800 }, { width: 768, height: 1024 },
      { width: 1366, height: 768 }, { width: 1366, height: 600 }, { width: 320, height: 844 },
      { width: 640, height: 540 }, { width: 844, height: 390 }, { width: 667, height: 375 },
      { width: 568, height: 320 }
    ];
    for (const language of ["es", "en"]) {
      if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language-toggle").click();
      for (const theme of ["light", "dark"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
        for (const viewport of personalViewports) {
          await page.setViewportSize(viewport);
          await page.locator('[data-open-dialog="personal-dialog"]').click();
          const layout = await page.locator("#personal-dialog > article").evaluate((article) => {
            const rect = article.getBoundingClientRect();
            const paragraph = article.querySelector(".personal-profile");
            return {
              top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
              scrollHeight: article.scrollHeight, clientHeight: article.clientHeight,
              scrollWidth: article.scrollWidth, clientWidth: article.clientWidth,
              overflow: getComputedStyle(article).overflowY,
              fontSize: parseFloat(getComputedStyle(paragraph).fontSize),
              justified: getComputedStyle(paragraph).textAlign === "justify",
              expectedCopy: paragraph.textContent === window.CV_TRANSLATIONS[document.documentElement.lang]["personal.profile"],
              contacts: article.querySelectorAll(".personal-details > div").length,
              competencies: article.querySelectorAll(".skill-tags li").length,
              allContentInside: [...article.querySelectorAll(".full-name, .personal-profile, .personal-details > div, .skill-tags li, footer button")].every((element) => {
                const bounds = element.getBoundingClientRect();
                return bounds.height > 0 && bounds.width > 0 && bounds.top >= rect.top && bounds.bottom <= rect.bottom + 1;
              })
            };
          });
          assert.ok(layout.scrollHeight <= layout.clientHeight + 1 && layout.scrollWidth <= layout.clientWidth + 1, `Personal modal requires scrolling at ${language}/${theme}/${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
          assert.ok(layout.top >= 0 && layout.bottom <= viewport.height && layout.width <= viewport.width - 30, "Personal modal exceeds the viewport");
          assert.ok(layout.allContentInside && layout.contacts === 4 && layout.competencies === 7, "Personal modal must preserve all visible information and close controls");
          assert.ok(layout.justified && layout.expectedCopy && layout.fontSize >= 12 && layout.overflow !== "hidden", "Compaction must preserve the profile and readable, unclipped content");
          if (viewport.width >= 1024 && viewport.height >= 600) assert.ok(layout.height >= 400, "The personal modal needs comfortable breathing room on desktop");
          if (viewport.width === 390 && viewport.height === 844) assert.ok(layout.height >= 580, "The taller mobile layout should not remain over-compressed");
          if (language === "es" && theme === "light" && ((viewport.width === 390 && viewport.height === 844) || viewport.width === 1366 || viewport.width === 844)) {
            await page.screenshot({ path: path.join(screenshots, `personal-modal-${viewport.width}x${viewport.height}.png`) });
          }
          await page.locator("#personal-dialog footer [data-close-dialog]").click();
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator('[data-open-dialog="contact-dialog"]').click();
    assert.equal(await page.locator("#contact-email").inputValue(), "paucontrerasl@gmail.com");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.testCopiedEmail = text; } } });
    });
    await page.locator("#copy-contact-email").click();
    await page.waitForFunction(() => window.testCopiedEmail === "paucontrerasl@gmail.com");
    assert.equal(await page.locator("#contact-copy-status").getAttribute("data-i18n"), "contact.copied");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } } });
    });
    await page.locator("#copy-contact-email").click();
    await page.waitForFunction(() => document.getElementById("contact-copy-status").dataset.i18n === "contact.copyManually");
    assert.ok(await page.locator("#contact-email").evaluate((input) => document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length));
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      document.getElementById("contact-copy-status").textContent = "";
    });
    await page.locator("#copy-contact-email").click();
    assert.ok(await page.locator("#contact-copy-status").textContent());
    assert.ok(await page.locator("#contact-email").evaluate((input) => document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length));
    await page.keyboard.press("Escape");

    await page.locator("#menu-toggle").click();
    await page.locator('.main-navigation [data-open-dialog="gallery-dialog"]').click();
    assert.ok(await page.locator("#gallery-dialog").evaluate((dialog) => dialog.open));
    assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#gallery-dialog img").count(), 0);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement === document.getElementById("menu-toggle"));
    assert.ok(await page.locator("#menu-toggle").evaluate((button) => document.activeElement === button));

    const footerGallery = page.locator('.footer-navigation [data-open-dialog="gallery-dialog"]');
    await footerGallery.click();
    assert.ok(await page.locator("#gallery-dialog").evaluate((dialog) => dialog.open));
    await page.locator("#gallery-dialog footer [data-close-dialog]").click();
    await page.waitForFunction(() => document.activeElement?.matches('.footer-navigation [data-open-dialog="gallery-dialog"]'));
    assert.ok(await footerGallery.evaluate((button) => document.activeElement === button));

    await page.setViewportSize({ width: 1366, height: 768 });
    const navbarGallery = page.locator('.main-navigation [data-open-dialog="gallery-dialog"]');
    await navbarGallery.focus();
    await page.keyboard.press("Enter");
    assert.ok(await page.locator("#gallery-dialog").evaluate((dialog) => dialog.open));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.matches('.main-navigation [data-open-dialog="gallery-dialog"]'));
    assert.ok(await navbarGallery.evaluate((button) => document.activeElement === button));
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator('[data-open-dialog="qr-dialog"]').click();
    await page.locator("#qr-dialog footer [data-close-dialog]").click();
    assert.equal(await page.locator("#qr-dialog").evaluate((dialog) => dialog.open), false);

    const qrViewports = [
      { width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 667 },
      { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 },
      { width: 844, height: 390 }, { width: 667, height: 375 }, { width: 390, height: 430 },
      { width: 320, height: 480 }, { width: 568, height: 320 }, { width: 320, height: 320 }
    ];
    fs.mkdirSync(screenshots, { recursive: true });
    for (const language of ["es", "en"]) {
      if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language-toggle").click();
      for (const viewport of qrViewports) {
        await page.setViewportSize(viewport);
        await page.locator('[data-open-dialog="qr-dialog"]').click();
        const dimensions = await page.locator("#qr-dialog > article").evaluate((article) => {
          const rect = article.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, scrollHeight: article.scrollHeight, clientHeight: article.clientHeight, scrollWidth: article.scrollWidth, clientWidth: article.clientWidth };
        });
        assert.ok(dimensions.scrollHeight <= dimensions.clientHeight + 1 && dimensions.scrollWidth <= dimensions.clientWidth + 1, `QR dialog requires scrolling at ${language}/${viewport.width}x${viewport.height}: ${JSON.stringify(dimensions)}`);
        assert.ok(dimensions.top >= 0 && dimensions.bottom <= viewport.height && dimensions.width <= viewport.width - 30, `QR dialog exceeds the viewport: ${JSON.stringify(dimensions)}`);
        assert.equal(await page.locator('#qr-dialog a[href^="mailto:"], #qr-dialog a[href^="tel:"], #qr-dialog .qr-role').count(), 0);
        const renderedImage = PNG.sync.read(await page.locator("#qr-dialog .qr-large").screenshot());
        const renderedContact = jsQR(new Uint8ClampedArray(renderedImage.data), renderedImage.width, renderedImage.height);
        assert.ok(renderedContact, `Rendered QR is not readable at ${viewport.width}x${viewport.height}`);
        assert.match(renderedContact.data, /^Correo: paucontrerasl@gmail\.com$/m);
        assert.equal(renderedContact.data.replace(/\r\n/g, "\n"), decoded.data.replace(/\r\n/g, "\n"), "The compact SVG QR must show all four explicit contact fields");
        if (language === "es" && ((viewport.width === 390 && viewport.height === 844) || (viewport.width === 844 && viewport.height === 390) || viewport.width === 1366)) {
          await page.screenshot({ path: path.join(screenshots, `qr-modal-${viewport.width}x${viewport.height}.png`) });
        }
        await page.locator("#qr-dialog footer [data-close-dialog]").click();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-open-dialog="qr-dialog"]').click();
    const [contactDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#qr-dialog .qr-save").click()
    ]);
    assert.equal(contactDownload.suggestedFilename(), "Paulina-Contreras.vcf");
    assert.equal(await contactDownload.failure(), null);
    assert.ok(fs.readFileSync(await contactDownload.path()).equals(fs.readFileSync(path.join(root, "assets/paulina-contreras.vcf"))));
    await page.locator("#qr-dialog footer [data-close-dialog]").click();

    if (await page.locator("html").getAttribute("lang") !== "en") await page.locator("#language-toggle").click();
    if (await page.locator("html").getAttribute("data-theme") !== "dark") await page.locator("#theme-toggle").click();
    await page.reload();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.equal(await page.locator("#theme-toggle").getAttribute("aria-label"), "Switch to light mode");

    await settleTransitions();
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const audit = await page.evaluate(async () => {
      const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
      return result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }));
    });
    assert.deepEqual(audit, [], `Accessibility issues: ${JSON.stringify(audit, null, 2)}`);
    await footerGallery.click();
    const galleryAudit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id }) => id));
    assert.deepEqual(galleryAudit, [], "The open gallery modal must pass the accessibility audit");
    await page.keyboard.press("Escape");
    await page.locator('[data-open-dialog="qr-dialog"]').click();
    const qrAudit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id }) => id));
    assert.deepEqual(qrAudit, [], "The compact QR dialog must pass the accessibility audit");
    await page.keyboard.press("Escape");
    await page.locator('[data-open-dialog="contact-dialog"]').click();
    const contactAudit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id }) => id));
    assert.deepEqual(contactAudit, [], "The contact dialog must pass the accessibility audit");
    await page.keyboard.press("Escape");
    await page.locator('[data-open-dialog="opportunity-dialog"]').click();
    const opportunityAudit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id }) => id));
    assert.deepEqual(opportunityAudit, [], "The opportunity dialog must pass the accessibility audit");
    await page.keyboard.press("Escape");
    await page.locator('[data-open-dialog="personal-dialog"]').click();
    const personalAudit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id }) => id));
    assert.deepEqual(personalAudit, [], "The compact personal modal must pass the accessibility audit");
    await page.keyboard.press("Escape");

    await page.locator("#language-toggle").click();
    await page.locator("#theme-toggle").click();
    await settleTransitions();
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const lightAudit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })));
    assert.deepEqual(lightAudit, [], `Light theme accessibility issues: ${JSON.stringify(lightAudit)}`);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    assert.ok(await page.locator(".profile-card").first().evaluate((element) => getComputedStyle(element).opacity === "1"));

    fs.mkdirSync(screenshots, { recursive: true });
    for (const [name, width, height] of [["desktop-light", 1440, 1000], ["mobile-light", 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
      await page.screenshot({ path: path.join(screenshots, `hero-${name}.png`) });
      await page.locator(".site-footer").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshots, `footer-${name}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("#theme-toggle").click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(screenshots, "desktop-dark.png"), fullPage: true });
    await page.locator("#trayectoria").evaluate((section) => section.scrollIntoView({ behavior: "instant", block: "start" }));
    await page.screenshot({ path: path.join(screenshots, "numbers-desktop-dark.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator("#perfil").evaluate((section) => section.scrollIntoView({ behavior: "instant", block: "start" }));
    await page.screenshot({ path: path.join(screenshots, "combined-overview-laptop.png") });
    await navbarGallery.click();
    await page.screenshot({ path: path.join(screenshots, "gallery-modal.png") });
    await page.keyboard.press("Escape");
    await page.locator('[data-open-dialog="contact-dialog"]').click();
    await page.screenshot({ path: path.join(screenshots, "contact-modal.png") });
    await page.keyboard.press("Escape");

    await verifyPDFDownload(page);

    const deployment = await serveProjectSubpath();
    deploymentServer = deployment.server;
    const deploymentURL = deployment.url;
    const deploymentContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
    const deploymentPage = await deploymentContext.newPage();
    const deploymentRequests = [];
    const deploymentErrors = [];
    deploymentPage.on("request", (request) => deploymentRequests.push(request.url()));
    deploymentPage.on("pageerror", (error) => deploymentErrors.push(error.message));
    await deploymentPage.goto(deploymentURL);
    await deploymentPage.evaluate(() => document.fonts.ready);
    await verifyPDFDownload(deploymentPage);
    assert.ok(deploymentRequests.length > 5 && deploymentRequests.every((url) => url.startsWith(deploymentURL)), "Static resources must remain inside the GitHub Pages repository subpath");
    assert.deepEqual(deploymentErrors, []);
    await deploymentContext.close();
    await new Promise((resolve) => deploymentServer.close(resolve));
    deploymentServer = null;

    assert.deepEqual(errors, []);
    assert.deepEqual(failedRequests, []);
    assert.deepEqual(externalRequests, []);

    const fileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const filePage = await fileContext.newPage();
    await filePage.goto(`file:///${path.join(root, "index.html").replaceAll("\\", "/")}`);
    assert.deepEqual(await filePage.locator("[data-count]").allTextContents(), ["3", "6", "6"]);
    await filePage.locator("#language-toggle").click();
    assert.equal(await filePage.locator("html").getAttribute("lang"), "en");
    await filePage.locator("#theme-toggle").click();
    await filePage.locator('[data-open-dialog="personal-dialog"]').click();
    assert.ok(await filePage.locator("#personal-dialog").evaluate((dialog) => dialog.open));
    await fileContext.close();

    const fallbackContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
    const printPage = await fallbackContext.newPage();
    await printPage.goto(baseURL);
    assert.deepEqual(await printPage.locator("[data-count]").allTextContents(), ["0", "0", "0"]);
    await printPage.evaluate(() => dispatchEvent(new Event("beforeprint")));
    assert.deepEqual(await printPage.locator("[data-count]").allTextContents(), ["3", "6", "6"]);
    await printPage.evaluate(() => dispatchEvent(new Event("afterprint")));
    await verifyCounterCycle(printPage, "return after printing");
    await printPage.emulateMedia({ reducedMotion: "reduce" });
    await printPage.waitForFunction(() => [...document.querySelectorAll("[data-count]")].every((node) => node.textContent === node.dataset.count));
    assert.deepEqual(await printPage.locator("[data-count]").allTextContents(), ["3", "6", "6"]);
    await printPage.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await printPage.locator(".stats-grid").evaluate((grid) => grid.scrollIntoView({ behavior: "instant", block: "center" }));
    assert.deepEqual(await printPage.locator("[data-count]").allTextContents(), ["3", "6", "6"], "Reduced motion must disable replay while preserving final values");
    await printPage.evaluate(() => {
      window.motionPreferenceSettled = false;
      matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
        requestAnimationFrame(() => { window.motionPreferenceSettled = true; });
      }, { once: true });
    });
    await printPage.emulateMedia({ reducedMotion: "no-preference" });
    await printPage.waitForFunction(() => window.motionPreferenceSettled);
    await leaveCounters(printPage);
    await verifyCounterCycle(printPage, "return after re-enabling motion");

    const noObserverPage = await fallbackContext.newPage();
    await noObserverPage.addInitScript(() => { delete window.IntersectionObserver; });
    await noObserverPage.goto(baseURL);
    assert.deepEqual(await noObserverPage.locator("[data-count]").allTextContents(), ["3", "6", "6"]);
    await fallbackContext.close();

    console.log(JSON.stringify({ result: "PASS", responsiveConfigurations: widths.length * 4, branding: "uppercase PC", lightTheme: "warm ivory canvas and richer card/counter surfaces verified; dark palette unchanged", compactScale: "heading sizes and counter typography unchanged", screenSections: "two screen groups; counters and cards still share one screen", socialRow: "compact like the counter row at every tested width", linkedin: "supplied HTTPS profile opens in a safe new tab without the placeholder modal; provider navigation intercepted", footer: "compact height limits verified on mobile, tablet and desktop", gallery: "photo-free modal from navbar and footer; mobile menu, keyboard operation and focus restoration verified", personal: `no scrolling or clipping in ${personalViewports.length * 4} viewport/language/theme combinations; full justified profile, four contact fields and seven skills preserved`, contact: "Conversemos opens an internal modal, not a blank page/tab; copy success, denied clipboard and unavailable clipboard paths verified without altering the OS clipboard", introAlignment: "right-aligned in both languages at every width", pdfDownload: "exact supplied PDF filename and bytes verified at the root and a GitHub Pages-style repository subpath", counterAnimation: "repeated visible count-up verified; no threshold jitter or overlapping frames; interrupted animation, sticky header, print and reduced-motion recovery covered", qr: `four explicitly labelled text fields verified in the original and rendered QR; no modal scrolling in ${qrViewports.length * 2} language/viewport combinations; separate vCard download retained`, dialogs: 7, themes: "persisted", languages: "persisted", accessibility: "no automated WCAG A/AA violations in light, dark or open gallery/QR/contact/opportunity/personal modals", runtimeErrors: errors.length, failedRequests: failedRequests.length, externalRuntimeRequests: externalRequests.length, fileURL: "verified", screenshots }, null, 2));
  } finally {
    await browser.close();
    if (deploymentServer) await new Promise((resolve) => deploymentServer.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
