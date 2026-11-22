
import fs from "node:fs";
import path from "node:path";

const root = "offline-html";
const output = "dist/OCR-Scanner-Pro-Offline.html";

const read = file => fs.readFileSync(file);

const html = read(`${root}/index.html`).toString();
const tesseract = read(
  `${root}/vendor/tesseract.min.js`
).toString();

const coreJs = read(
  `${root}/vendor/core/tesseract-core.wasm.js`
);

const coreWasm = read(
  `${root}/vendor/core/tesseract-core.wasm`
);

const kor = read(
  `${root}/vendor/lang/kor.traineddata.gz`
);

const eng = read(
  `${root}/vendor/lang/eng.traineddata.gz`
);

const worker = `
self.importScripts(
  URL.createObjectURL(
    new Blob([${JSON.stringify(tesseract)}], {
      type: "text/javascript"
    })
  )
);
`;

const dataUrl = (mime, buffer) =>
  `data:${mime};base64,${buffer.toString("base64")}`;

let result = html.replace(
  "</head>",
  `<script>${tesseract}</script>
   </head>`
);

result = result.replace(
  "</body>",
  `
<script>
window.OCR_CORE_URL =
${JSON.stringify(dataUrl(
  "text/javascript",
  coreJs
))};

window.OCR_LANG_URL =
${JSON.stringify(dataUrl(
  "application/octet-stream",
  kor
))};
</script>
</body>`
);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, result);

console.log("Created:", output);
