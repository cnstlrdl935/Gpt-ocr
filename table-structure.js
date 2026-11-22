/* Table grid detection for OCR. Coordinates are measured on the exact canvas passed by the caller. */
(function (root) {
  "use strict";

  function clusterRuns(values, gap) {
    const groups = [];
    for (const value of values) {
      const last = groups[groups.length - 1];
      if (!last || value - last[last.length - 1] > gap) groups.push([value]);
      else last.push(value);
    }
    return groups.map(group => group.reduce((a, b) => a + b, 0) / group.length);
  }

  function detectGrid(canvas) {
    if (!canvas || !canvas.getContext) return null;
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height || width * height > 12000000) return null;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = context.getImageData(0, 0, width, height).data;
    const columns = new Uint32Array(width);
    const rows = new Uint32Array(height);

    for (let y = 0; y < height; y++) {
      const offset = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = offset + x * 4;
        const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        if (gray < 180) {
          columns[x]++;
          rows[y]++;
        }
      }
    }

    let xs = clusterRuns(
      Array.from({ length: width }, (_, x) => x).filter(x => columns[x] >= height * 0.65),
      Math.max(2, Math.round(width / 500))
    );
    let ys = clusterRuns(
      Array.from({ length: height }, (_, y) => y).filter(y => rows[y] >= width * 0.65),
      Math.max(2, Math.round(height / 500))
    );
    if (xs.length < 3 || ys.length < 3) return null;

    const intersects = (x, y) => {
      const xi = Math.round(x);
      const yi = Math.round(y);
      let count = 0;
      for (let yy = Math.max(0, yi - 2); yy < Math.min(height, yi + 3); yy++) {
        for (let xx = Math.max(0, xi - 2); xx < Math.min(width, xi + 3); xx++) {
          const i = (yy * width + xx) * 4;
          if (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2] < 180) count++;
        }
      }
      return count >= 3;
    };

    // Page frames usually meet only at the four corners. Actual table rules
    // intersect several horizontal and vertical rules.
    xs = xs.filter(x => ys.filter(y => intersects(x, y)).length >= 3);
    ys = ys.filter(y => xs.filter(x => intersects(x, y)).length >= 3);
    if (xs.length < 3 || ys.length < 3) return null;

    const bodyStartIndex = Math.max(0, ys.findIndex(y =>
      xs.filter(x => intersects(x, y)).length >= xs.length - 1
    ));
    return { xs, ys, bodyStartIndex, width, height };
  }

  function isDiagonalDivider(canvas, x0, y0, x1, y1) {
    const width = Math.floor(x1 - x0 - 4);
    const height = Math.floor(y1 - y0 - 4);
    if (width < 20 || height < 20) return false;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    const data = context.getImageData(
      Math.round(x0 + 2), Math.round(y0 + 2), width, height
    ).data;

    const slopes = [0.32, 0.36, 0.40, 0.44, 0.48, -0.32, -0.36, -0.40, -0.44, -0.48];
    for (const slope of slopes) {
      for (let intercept = -Math.ceil(width * Math.abs(slope)) - height; intercept <= height; intercept += 2) {
        let samples = 0;
        let dark = 0;
        for (let x = 0; x < width; x += 2) {
          const y = Math.round(intercept + slope * x);
          if (y < 0 || y >= height) continue;
          samples++;
          let hit = false;
          for (let dy = -1; dy <= 1 && !hit; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= width) continue;
              const i = (yy * width + xx) * 4;
              const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              if (gray < 145) { hit = true; break; }
            }
          }
          if (hit) dark++;
        }
        if (samples >= width * 0.2 && dark / samples >= 0.8) return true;
      }
    }
    return false;
  }

  root.TableStructureDetector = Object.freeze({ detectGrid, isDiagonalDivider });
})(window);
