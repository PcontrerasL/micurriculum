"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const css = read("css/styles.css");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const context = { window: {} };
vm.runInNewContext(read("js/translations.js"), context);
const translations = context.window.CV_TRANSLATIONS;

test("all JavaScript and CSS is external, without inline event handlers", () => {
  assert.doesNotMatch(html, /<style\b|\sstyle\s*=|\son[a-z]+\s*=/i);
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(script[1], /\bsrc="js\/[^"]+"/);
    assert.equal(script[2].trim(), "");
  }
  assert.doesNotMatch(html, /javascript:/i);
});

test("every local HTML and CSS asset exists", () => {
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^(?:https?:|mailto:|tel:|whatsapp:)/.test(match[1])) continue;
    assert.ok(fs.existsSync(path.join(root, decodeURIComponent(match[1]))), `Missing ${match[1]}`);
  }
  for (const match of css.matchAll(/url\("([^"]+)"\)/g)) {
    assert.ok(fs.existsSync(path.resolve(root, "css", match[1])), `Missing ${match[1]}`);
  }
});

test("navigation anchors resolve and IDs are unique", () => {
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(match[1]), `Missing anchor ${match[1]}`);
  }
});

test("every detail and media control opens an existing accessible dialog", () => {
  for (const match of html.matchAll(/data-open-dialog="([^"]+)"/g)) {
    assert.match(html, new RegExp(`<dialog id="${match[1]}" aria-labelledby="[^"]+"`));
  }
  for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
    assert.ok(ids.includes(match[1]));
  }
  assert.equal((html.match(/<dialog /g) || []).length, 8);
});

test("English and Spanish have exactly the same translation keys", () => {
  assert.deepEqual(Object.keys(translations.es).sort(), Object.keys(translations.en).sort());
  for (const language of ["es", "en"]) {
    for (const [key, value] of Object.entries(translations[language])) {
      assert.ok(typeof value === "string" && value.trim(), `${language}.${key} is empty`);
    }
  }
});

test("every visible and accessible translation reference exists", () => {
  for (const match of html.matchAll(/data-i18n(?:-aria|-alt|-content|-placeholder)?="([^"]+)"/g)) {
    assert.ok(translations.es[match[1]], `Unknown Spanish key ${match[1]}`);
    assert.ok(translations.en[match[1]], `Unknown English key ${match[1]}`);
  }
});

test("confirmed phone and email are consistent across contact channels", () => {
  assert.match(html, /https:\/\/wa\.me\/56964194547/);
  for (const phone of html.matchAll(/tel:([^"\s]+)/g)) assert.equal(phone[1], "+56964194547");
  for (const email of html.matchAll(/mailto:([^"\s]+)/g)) assert.equal(email[1], "paucontrerasl@gmail.com");
  const contact = read("assets/paulina-contreras.vcf");
  assert.match(contact, /FN:Paulina Angélica Contreras Levio/);
  assert.match(contact, /TITLE:Ingeniero en Administración de Empresas \(en curso\)/);
  assert.match(contact, /TEL;TYPE=CELL:\+56964194547/);
  assert.match(contact, /EMAIL;TYPE=INTERNET:paucontrerasl@gmail.com/);
});

test("Conversemos opens a contact dialog instead of relying on an external email handler", () => {
  assert.match(html, /<button[^>]+data-open-dialog="contact-dialog"[^>]*><span data-i18n="hero.contact">/);
  const contactDialog = html.match(/<dialog id="contact-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(contactDialog, /https:\/\/wa\.me\/56964194547/);
  assert.match(contactDialog, /id="contact-whatsapp" href="whatsapp:\/\/send\/\?phone=56964194547"/);
  assert.match(contactDialog, /id="contact-whatsapp-web" href="https:\/\/wa\.me\/56964194547"/);
  assert.match(contactDialog, /id="contact-email"[^>]*value="paucontrerasl@gmail\.com"[^>]*readonly/);
  assert.match(contactDialog, /id="copy-contact-email"/);
  assert.doesNotMatch(contactDialog, /mailto:/);
});

test("the justified personal profile includes the requested career progression and agile competency", () => {
  const dialog = html.match(/<dialog id="personal-dialog"[\s\S]*?<\/dialog>/)[0];
  const profile = "Profesional en administración y ventas con más de 7 años de experiencia en consumo masivo. Trayectoria en Coca-Cola Andina como vendedora de ruta en terreno, Key Account Manager (KAM) y jefa de ventas, liderando equipos, gestionando clientes mayoristas estratégicos y fortaleciendo relaciones comerciales.";
  assert.equal(translations.es["personal.profile"], profile);
  assert.ok(dialog.includes(profile));
  assert.match(dialog, /class="personal-profile"/);
  assert.match(dialog, /class="detail-dialog personal-dialog adaptive-dialog"/);
  assert.match(css, /--dialog-padding-y:\s*clamp\(/);
  assert.match(dialog, /class="personal-competencies"/);
  assert.equal((dialog.match(/<li /g) || []).length, 7);
  assert.match(css, /\.personal-profile\s*\{[^}]*text-align:\s*justify/);
  assert.match(translations.en["personal.profile"], /Route Sales Representative, Key Account Manager \(KAM\) and Sales Manager/);
  assert.match(dialog, /data-i18n="skills.agile"/);
  assert.equal(translations.es["skills.agile"], "Trabajo con metodologías ágiles");
  assert.equal(translations.en["skills.agile"], "Working with agile methodologies");
});

test("the footer opens the approved real opportunity form, not the demo or mailto", () => {
  assert.match(html, /<button class="footer-contact-link"[^>]+data-open-dialog="opportunity-dialog"/);
  const dialog = html.match(/<dialog id="opportunity-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(dialog, /id="opportunity-form" method="dialog"/);
  assert.match(dialog, /id="opportunity-continue"[^>]*aria-disabled="true"/);
  assert.doesNotMatch(dialog, /\bvalue="|Empresa de ejemplo|Example company|preview\/|Modo demostración/);
  assert.match(read("js/opportunity.js"), /whatsapp:\/\/send\/\?phone=56964194547&text=\$\{encodedMessage\}/);
  assert.match(read("js/opportunity.js"), /https:\/\/wa\.me\/56964194547\?text=\$\{encodedMessage\}/);
  assert.match(read("js/opportunity.js"), /encodeURIComponent\(reviewedMessage\)/);
  assert.doesNotMatch(read("js/opportunity.js"), /localStorage|sessionStorage|\bfetch\(|XMLHttpRequest|innerHTML/);
});

test("both opportunity actions share green effects only when enabled and motion is permitted", () => {
  const opportunityCSS = read("css/opportunity.css");
  assert.equal((html.match(/class="button button--primary opportunity-action\b/g) || []).length, 2);
  assert.match(opportunityCSS, /@media screen and \(prefers-reduced-motion: no-preference\)/);
  assert.match(opportunityCSS, /\.opportunity-action:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{[^}]*animation:\s*opportunity-ready/);
  assert.match(opportunityCSS, /--opportunity-glow:\s*rgb\(34 197 94/);
  assert.match(opportunityCSS, /\.opportunity-action > span:not\(\.sr-only\)/);
  assert.match(opportunityCSS, /@keyframes opportunity-sheen/);
});

test("the footer invitation retains its accessible label with a decorative animated accent", () => {
  assert.match(html, /class="footer-contact-label" data-i18n="footer.talk"/);
  assert.match(html, /class="footer-contact-arrow" aria-hidden="true"/);
  assert.match(css, /@media screen and \(prefers-reduced-motion: no-preference\)/);
  assert.match(css, /@keyframes footer-invitation-line/);
  assert.match(css, /@keyframes footer-invitation-glow/);
});

test("the compact QR dialog hides redundant contact text without changing its vCard", () => {
  const dialog = html.match(/<dialog id="qr-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.doesNotMatch(dialog, /qr-role|data-i18n="qr.role"|Ingeniero|paucontrerasl@gmail\.com|tel:|mailto:/);
  assert.match(dialog, /class="qr-large"/);
  assert.match(dialog, /src="img\/contact-details\.svg"/);
  assert.match(read("img/contact-details.svg"), /shape-rendering="crispEdges"/);
  assert.match(dialog, /href="assets\/paulina-contreras\.vcf"/);
  assert.match(read("assets/paulina-contreras.vcf"), /EMAIL;TYPE=INTERNET:paucontrerasl@gmail.com/);
});

test("the scan QR contains four explicit text fields rather than a vCard preview", () => {
  const payload = read("assets/paulina-contact.txt").trimEnd();
  assert.equal(payload.split(/\r?\n/).length, 4);
  assert.match(payload, /^Nombre: Paulina Angélica Contreras Levio$/m);
  assert.match(payload, /^Teléfono: \+56 9 6419 4547$/m);
  assert.match(payload, /^Correo: paucontrerasl@gmail\.com$/m);
  assert.match(payload, /^Título: Ingeniero en Administración de Empresas \(en curso\)$/m);
  assert.doesNotMatch(payload, /BEGIN:VCARD/);
  assert.doesNotMatch(html, /img\/contact-qr\.(?:png|svg)/);
});

test("the original source and archival PDF copy remain intact", () => {
  const source = fs.readFileSync(path.join(root, "curriculum.md"));
  const download = fs.readFileSync(path.join(root, "assets/Paulina-Contreras-CV.pdf"));
  assert.equal(source.subarray(0, 5).toString(), "%PDF-");
  assert.ok(source.equals(download));
});

test("the CV download targets the supplied PDF through a GitHub Pages-safe relative URL", () => {
  const filename = "CVPaulina Angélica Contreras Levio.pdf";
  const link = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*download="([^"]+)"/g)].find((match) => match[2] === filename);
  assert.ok(link, "The requested download link is missing");
  assert.equal(decodeURIComponent(link[1]), filename);
  assert.doesNotMatch(link[1], /^(?:\/|[a-z]+:)/i);
  const pdf = fs.readFileSync(path.join(root, filename));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(fs.existsSync(path.join(root, ".nojekyll")));
});

test("the requested counters and source-backed education status are present", () => {
  assert.deepEqual([...html.matchAll(/data-count="(\d+)"/g)].map((match) => match[1]), ["3", "6", "6"]);
  assert.match(translations.es["hero.degreeNote"], /en curso/);
  assert.match(translations.en["hero.degreeNote"], /in progress/);
  assert.match(translations.es["stats.toolsNote"], /gestión/);
});

test("studies include the DUOC qualification and UTEM coursework status without applying no-scroll styling", () => {
  const dialog = html.match(/<dialog id="studies-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.equal((dialog.match(/class="education-item"/g) || []).length, 3);
  assert.match(dialog, /DUOC UC: <span data-i18n="studies.awarded">Titulado<\/span>/);
  assert.match(dialog, /Universidad UTEM: <span data-i18n="studies.courseworkCompleted">Egresada<\/span>/);
  assert.ok(dialog.indexOf('data-i18n="studies.hospitality"') < dialog.indexOf('data-i18n="studies.forensics"'));
  assert.ok(dialog.indexOf('data-i18n="studies.forensics"') < dialog.indexOf('data-i18n="studies.additional"'));
  assert.equal(translations.es["studies.forensics"], "Técnico en Perito Criminalístico");
  assert.equal(translations.en["studies.awarded"], "Degree awarded");
  assert.equal(translations.en["studies.courseworkCompleted"], "Coursework completed");
  assert.doesNotMatch(dialog, /adaptive-dialog|personal-dialog/);
});

test("the counters retain the original simple row without an added heading or hero link", () => {
  assert.doesNotMatch(html, /class="(?:stats-heading|section-next)"/);
  assert.doesNotMatch(html, /Mi trayectoria/);
  assert.equal((html.match(/class="stat"/g) || []).length, 3);
  assert.match(html, /class="stats-grid"/);
});

test("the main tools row includes Kanban and Scrum in both languages", () => {
  const row = html.match(/<div class="expertise-line"[\s\S]*?<\/ul>/)[0];
  assert.match(row, /data-i18n="tools.agileMethods">Metodologías ágiles: Kanban y Scrum/);
  assert.equal(translations.es["tools.agileMethods"], "Metodologías ágiles: Kanban y Scrum");
  assert.equal(translations.en["tools.agileMethods"], "Agile methods: Kanban and Scrum");
  assert.equal((row.match(/<li[ >]/g) || []).length, 7);
});

test("gallery copy is modal-only and the portrait remains only in the hero", () => {
  const main = html.match(/<main\b[\s\S]*?<\/main>/)[0];
  const gallery = html.match(/<dialog id="gallery-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.doesNotMatch(main, /gallery-section|gallery\.eyebrow|gallery\.description/);
  assert.doesNotMatch(gallery, /<img\b/);
  assert.match(gallery, /data-i18n="gallery.pending"/);
  assert.equal((html.match(/src="img\/foto\.jpg"/g) || []).length, 1);
  assert.equal((html.match(/data-open-dialog="gallery-dialog"/g) || []).length, 2);
  assert.doesNotMatch(html, /href="#galeria"|id="photo-dialog"/);
});

test("the header monogram and favicon use uppercase PC", () => {
  assert.match(html, /class="brand-monogram"[^>]*>PC<span>/);
  assert.match(read("img/favicon.svg"), />PC<\/text>/);
});

test("light-theme text retains readable contrast on the richer surfaces", () => {
  const token = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))[1];
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (first, second) => {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  const surfaces = [token("--page"), token("--surface"), token("--surface-soft"), token("--surface-accent"), "#f8f0ec", "#ecdee3", "#e5ced8", "#eadbe1", "#f2e7dd", "#e6d3dd", "#eee3d9", "#fdf8f2", "#f1e7e3"];
  for (const foreground of [token("--ink"), token("--muted"), token("--accent")]) {
    for (const background of surfaces) assert.ok(contrast(foreground, background) >= 4.5, `Insufficient contrast: ${foreground} on ${background}`);
  }
  for (const background of [token("--button-bg"), token("--accent-strong"), "#74465f", "#5b354e"]) assert.ok(contrast("#ffffff", background) >= 4.5);
  assert.match(css, /:root\[data-theme="light"\]/);
});

test("Pico, fonts, QR and icons are local rather than third-party runtime resources", () => {
  assert.match(read("css/vendor/pico.min.css").slice(0, 200), /Pico CSS[^\n]*v2\.1\.1/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(min-width:/);
  assert.doesNotMatch(html, /(?:src|href)="https?:[^\"]+\.(?:css|js|woff2?|png|jpg)/);
  const qr = fs.readFileSync(path.join(root, "img/contact-details.png"));
  assert.equal(qr.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
