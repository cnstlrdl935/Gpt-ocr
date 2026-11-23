/* General table-grid detection based on line intersections, not fixed table dimensions. */
(function (root) {
  "use strict";

  function cluster(values, maxGap) {
    const groups = [];
    for (const value of values) {
      const last = groups[groups.length - 1];
      if (!last || value - last[last.length - 1] > maxGap) groups.push([value]);
      else last.push(value);
    }
    return groups.map(group => group.reduce((sum, value) => sum + value, 0) / group.length);
  }

  function pixelIsDark(data, index, threshold) {
    return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2] < threshold;
  }

  function detectGrid(canvas) {
    if (!canvas || !canvas.getContext) return null;
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height || width * height > 18000000) return null;

    const data = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, width, height).data;
    const rowCounts = new Uint32Array(height);
    for (let y = 0; y < height; y++) {
      let count = 0;
      const offset = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (pixelIsDark(data, offset + x * 4, 205)) count++;
      }
      rowCounts[y] = count;
    }

    // Partial horizontal rules are allowed; text baselines are rejected later
    // by checking whether a genuine vertical rule continues through each crossing.
    const yCandidates = cluster(
      Array.from({ length: height }, (_, y) => y)
        .filter(y => rowCounts[y] >= Math.max(18, width * 0.22)),
      Math.max(2, Math.round(Math.max(width, height) / 1000))
    );
    if (yCandidates.length < 3) return null;

    const yTop = Math.max(0, Math.floor(yCandidates[0]));
    const yBottom = Math.min(height - 1, Math.ceil(yCandidates[yCandidates.length - 1]));
    const tableHeight = yBottom - yTop;
    if (tableHeight < 30) return null;

    const columnCounts = new Uint32Array(width);
    for (let y = yTop; y <= yBottom; y++) {
      const offset = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (pixelIsDark(data, offset + x * 4, 205)) columnCounts[x]++;
      }
    }
    const xCandidates = cluster(
      Array.from({ length: width }, (_, x) => x)
        .filter(x => columnCounts[x] >= Math.max(12, tableHeight * 0.35)),
      Math.max(2, Math.round(Math.max(width, height) / 1000))
    );
    if (xCandidates.length < 3) return null;

    function isIntersection(x, y) {
      const xi = Math.round(x);
      const yi = Math.round(y);
      let verticalHits = 0;
      let horizontalHits = 0;

      // A rule must continue in both directions. This rejects text strokes
      // that merely touch a candidate row or column.
      for (let yy = Math.max(0, yi - 12); yy <= Math.min(height - 1, yi + 12); yy++) {
        let hit = false;
        for (let xx = Math.max(0, xi - 1); xx <= Math.min(width - 1, xi + 1); xx++) {
          if (pixelIsDark(data, (yy * width + xx) * 4, 205)) {
            hit = true;
            break;
          }
        }
        if (hit) verticalHits++;
      }
      for (let xx = Math.max(0, xi - 12); xx <= Math.min(width - 1, xi + 12); xx++) {
        let hit = false;
        for (let yy = Math.max(0, yi - 1); yy <= Math.min(height - 1, yi + 1); yy++) {
          if (pixelIsDark(data, (yy * width + xx) * 4, 205)) {
            hit = true;
            break;
          }
        }
        if (hit) horizontalHits++;
      }
      return verticalHits >= 14 && horizontalHits >= 13;
    }

    // Build a bipartite graph of horizontal and vertical rules. A page frame
    // becomes a small 2x2 component; the actual table is the denser component.
    const xToY = xCandidates.map(x => {
      const connected = [];
      yCandidates.forEach((y, index) => {
        if (isIntersection(x, y)) connected.push(index);
      });
      return connected;
    });
    const yToX = yCandidates.map(() => []);
    xToY.forEach((ys, xIndex) => ys.forEach(yIndex => yToX[yIndex].push(xIndex)));

    const seenX = new Set();
    const components = [];
    for (let start = 0; start < xCandidates.length; start++) {
      if (seenX.has(start) || !xToY[start].length) continue;
      const componentX = new Set();
      const componentY = new Set();
      const queue = [{ axis: "x", index: start }];
      while (queue.length) {
        const item = queue.pop();
        if (item.axis === "x") {
          if (componentX.has(item.index)) continue;
          componentX.add(item.index);
          seenX.add(item.index);
          xToY[item.index].forEach(index => {
            if (!componentY.has(index)) queue.push({ axis: "y", index });
          });
        } else {
          if (componentY.has(item.index)) continue;
          componentY.add(item.index);
          yToX[item.index].forEach(index => {
            if (!componentX.has(index)) queue.push({ axis: "x", index });
          });
        }
      }
      if (componentX.size >= 3 && componentY.size >= 3) {
        components.push({ x: [...componentX].sort((a, b) => a - b), y: [...componentY].sort((a, b) => a - b) });
      }
    }
    if (!components.length) return null;

    components.sort((a, b) =>
      (b.x.length * b.y.length) - (a.x.length * a.y.length)
    );
    const best = components[0];
    const xs = best.x.map(index => xCandidates[index]);
    const ys = best.y.map(index => yCandidates[index]);
    if (xs.length < 3 || ys.length < 3) return null;

    return { xs, ys, top: ys[0], bottom: ys[ys.length - 1], width, height };
  }

  function hasVerticalBoundary(canvas, x, y0, y1) {
    if (!canvas || !canvas.getContext) return false;
    const xi = Math.round(x);
    const top = Math.max(0, Math.round(y0 + 2));
    const bottom = Math.min(canvas.height - 1, Math.round(y1 - 2));
    if (bottom <= top) return false;

    const left = Math.max(0, xi - 1);
    const right = Math.min(canvas.width - 1, xi + 1);
    const sampleWidth = right - left + 1;
    const sampleHeight = bottom - top + 1;
    const data = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(left, top, sampleWidth, sampleHeight).data;

    let continuousRows = 0;
    for (let y = 0; y < sampleHeight; y++) {
      let hit = false;
      for (let x0 = 0; x0 < sampleWidth; x0++) {
        if (pixelIsDark(data, (y * sampleWidth + x0) * 4, 170)) {
          hit = true;
          break;
        }
      }
      if (hit) continuousRows++;
    }
    // A real printed rule occupies most of the row height. Text glyphs and
    // diagonal separators do not satisfy this continuity test.
    return continuousRows >= Math.max(4, sampleHeight * 0.48);
  }

  root.TableStructureDetector = Object.freeze({ detectGrid, hasVerticalBoundary });
})(window);
