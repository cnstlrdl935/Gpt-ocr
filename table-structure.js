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
    // Use contiguous line length rather than total dark pixels per row/column.
    // Text baselines can have many dark pixels, but rarely form a long continuous rule.
    const horizontalCandidates = [];
    for (let y = 0; y < height; y++) {
      let run = 0;
      let longest = 0;
      const offset = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (pixelIsDark(data, offset + x * 4, 205)) {
          run++;
          if (run > longest) longest = run;
        } else {
          run = 0;
        }
      }
      if (longest >= Math.max(25, width * 0.30)) horizontalCandidates.push(y);
    }
    const yCandidates = cluster(
      horizontalCandidates,
      Math.max(2, Math.round(Math.max(width, height) / 1000))
    );
    if (yCandidates.length < 3) return null;

    const verticalCandidates = [];
    for (let x = 0; x < width; x++) {
      let run = 0;
      let longest = 0;
      for (let y = 0; y < height; y++) {
        if (pixelIsDark(data, (y * width + x) * 4, 205)) {
          run++;
          if (run > longest) longest = run;
        } else {
          run = 0;
        }
      }
      if (longest >= Math.max(25, height * 0.03)) verticalCandidates.push(x);
    }
    const xCandidates = cluster(
      verticalCandidates,
      Math.max(2, Math.round(Math.max(width, height) / 1000))
    );
    if (xCandidates.length < 3) return null;

    // Remove a nearby page-frame border when it lies at the page edge.
    // A real narrow table column is retained because its next rule is farther away.
    if (xCandidates.length >= 4) {
      if (xCandidates[0] < width * 0.05 &&
          xCandidates[1] - xCandidates[0] < width * 0.08) xCandidates.shift();
      if (xCandidates.length >= 4 &&
          xCandidates[xCandidates.length - 1] > width * 0.95 &&
          xCandidates[xCandidates.length - 1] - xCandidates[xCandidates.length - 2] < width * 0.08) {
        xCandidates.pop();
      }
    }
    if (yCandidates.length >= 4) {
      if (yCandidates[0] < height * 0.05 &&
          yCandidates[1] - yCandidates[0] < height * 0.10) yCandidates.shift();
      if (yCandidates.length >= 4 &&
          yCandidates[yCandidates.length - 1] > height * 0.95 &&
          yCandidates[yCandidates.length - 1] - yCandidates[yCandidates.length - 2] < height * 0.10) {
        yCandidates.pop();
      }
    }

    const xGaps = xCandidates.slice(1).map((x, index) => x - xCandidates[index]).sort((a, b) => a - b);
    const yGaps = yCandidates.slice(1).map((y, index) => y - yCandidates[index]).sort((a, b) => a - b);
    const medianXGap = xGaps.length ? xGaps[Math.floor(xGaps.length / 2)] : 8;
    const medianYGap = yGaps.length ? yGaps[Math.floor(yGaps.length / 2)] : 8;
    const xRadius = Math.min(12, Math.max(2, Math.round(medianXGap * 0.25)));
    const yRadius = Math.min(12, Math.max(2, Math.round(medianYGap * 0.25)));

    function isIntersection(x, y) {
      const xi = Math.round(x);
      const yi = Math.round(y);
      const top = Math.max(0, yi - yRadius);
      const bottom = Math.min(height - 1, yi + yRadius);
      const left = Math.max(0, xi - xRadius);
      const right = Math.min(width - 1, xi + xRadius);
      let verticalHits = 0;
      let horizontalHits = 0;

      // Scale the test window to the table's actual cell spacing. This keeps
      // small tables detectable without mistaking nearby text for grid lines.
      for (let yy = top; yy <= bottom; yy++) {
        let hit = false;
        for (let xx = Math.max(0, xi - 1); xx <= Math.min(width - 1, xi + 1); xx++) {
          if (pixelIsDark(data, (yy * width + xx) * 4, 205)) {
            hit = true;
            break;
          }
        }
        if (hit) verticalHits++;
      }
      for (let xx = left; xx <= right; xx++) {
        let hit = false;
        for (let yy = Math.max(0, yi - 1); yy <= Math.min(height - 1, yi + 1); yy++) {
          if (pixelIsDark(data, (yy * width + xx) * 4, 205)) {
            hit = true;
            break;
          }
        }
        if (hit) horizontalHits++;
      }
      return verticalHits >= (bottom - top + 1) * 0.52 &&
        horizontalHits >= (right - left + 1) * 0.52;
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

  function hasHorizontalBoundary(canvas, y, x0, x1) {
    if (!canvas || !canvas.getContext) return false;
    const yi = Math.round(y);
    const left = Math.max(0, Math.round(x0 + 2));
    const right = Math.min(canvas.width - 1, Math.round(x1 - 2));
    if (right <= left) return false;
    const sampleWidth = right - left + 1;
    const top = Math.max(0, yi - 1);
    const bottom = Math.min(canvas.height - 1, yi + 1);
    const sampleHeight = bottom - top + 1;
    const data = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(left, top, sampleWidth, sampleHeight).data;
    let continuousColumns = 0;
    for (let x = 0; x < sampleWidth; x++) {
      let hit = false;
      for (let yy = 0; yy < sampleHeight; yy++) {
        if (pixelIsDark(data, (yy * sampleWidth + x) * 4, 170)) {
          hit = true;
          break;
        }
      }
      if (hit) continuousColumns++;
    }
    return continuousColumns >= Math.max(4, sampleWidth * 0.48);
  }

  root.TableStructureDetector = Object.freeze({ detectGrid, hasVerticalBoundary, hasHorizontalBoundary });
})(window);
