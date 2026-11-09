"use strict";

// Development-only dependency: qrcode@1.5.4. Runtime assets are generated locally.
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");

const root = path.resolve(__dirname, "..");
const contact = fs.readFileSync(path.join(root, "assets/paulina-contact.txt"), "utf8");
const payload = contact.replace(/\r\n/g, "\n").trimEnd();

const options = {
  margin: 4,
  errorCorrectionLevel: "M",
  color: { dark: "#171717ff", light: "#ffffffff" }
};

Promise.all([
  QRCode.toFile(path.join(root, "img/contact-details.png"), payload, { ...options, type: "png", width: 660 }),
  QRCode.toString(payload, { ...options, type: "svg" }).then((svg) => fs.promises.writeFile(path.join(root, "img/contact-details.svg"), svg))
]).then(() => {
  const canvasUnits = QRCode.create(payload, options).modules.size + options.margin * 2;
  console.log("PNG and SVG contact QR assets generated from assets/paulina-contact.txt.");
  console.log(`QR canvas: ${canvasUnits} units; modal widths ${canvasUnits * 3 + 2}px and ${canvasUnits * 2 + 2}px.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
