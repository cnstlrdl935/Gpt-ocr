/* Table row/column structure detector for Tesseract.js output.
 * Keeps OCR text tokens unchanged. Geometry is used only to place tokens into cells.
 */
(function (root) {
  "use strict";

  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function validWord(word) {
    return word && typeof word.text === "string" && word.text.trim() &&
      word.bbox && Number.isFinite(word.bbox.x0) &&
      Number.isFinite(word.bbox.x1) && Number.isFinite(word.bbox.y0) &&
      Number.isFinite(word.bbox.y1) && word.bbox.x1 > word.bbox.x0 &&
      word.bbox.y1 > word.bbox.y0;
  }

  function detect(data) {
    const lines = Array.isArray(data && data.lines) ? data.lines : [];
    const rows = lines.map((line, index) => ({
      index,
      words: (Array.isArray(line.words) ? line.words : []).filter(validWord)
        .slice().sort((a, b) => a.bbox.x0 - b.bbox.x0)
    })).filter(row => row.words.length);

    if (rows.length < 2) {
      return { ok: false, reason: "행을 구분할 수 있는 OCR 줄이 부족합니다.", rowCount: rows.length };
    }

    const words = rows.flatMap(row => row.words);
    if (words.length < 4) {
      return { ok: false, reason: "표 구조를 분석할 글자가 부족합니다.", rowCount: rows.length };
    }

    const medianHeight = median(words.map(word => word.bbox.y1 - word.bbox.y0));
    const gapFloor = Math.max(10, medianHeight * 1.65);
    const clusterTolerance = Math.max(10, medianHeight * 1.8);
    const gaps = [];

    // 같은 OCR 줄 안의 큰 가로 공백만 열 경계 후보로 수집합니다.
    for (const row of rows) {
      for (let i = 1; i < row.words.length; i++) {
        const left = row.words[i - 1];
        const right = row.words[i];
        const gap = right.bbox.x0 - left.bbox.x1;
        if (gap >= gapFloor) {
          gaps.push({
            x: (left.bbox.x1 + right.bbox.x0) / 2,
            row: row.index,
            width: gap
          });
        }
      }
    }

    // 비슷한 x 위치에서 여러 행에 반복되는 공백만 열 경계로 인정합니다.
    const clusters = [];
    gaps.sort((a, b) => a.x - b.x);
    for (const gap of gaps) {
      let cluster = clusters.find(item =>
        Math.abs(item.center - gap.x) <= clusterTolerance &&
        !item.rowIds.has(gap.row)
      );
      if (!cluster) {
        cluster = { center: gap.x, count: 0, rowIds: new Set(), widths: [] };
        clusters.push(cluster);
      }
      cluster.rowIds.add(gap.row);
      cluster.widths.push(gap.width);
      cluster.count = cluster.rowIds.size;
      cluster.center = cluster.widths.reduce((sum, value) => sum + value, 0) /
        cluster.widths.length;
    }

    const minimumSupport = Math.max(2, Math.ceil(rows.length * 0.15));
    const boundaries = clusters
      .filter(cluster => cluster.count >= minimumSupport)
      .sort((a, b) => a.center - b.center)
      .map(cluster => cluster.center);

    if (!boundaries.length) {
      return {
        ok: false,
        reason: "여러 행에서 반복되는 열 간격을 찾지 못했습니다. 원본 표의 열 간격이 선명한지 확인해 주세요.",
        rowCount: rows.length
      };
    }

    // 경계 x 좌표를 기준으로 각 OCR 단어를 열에 배치합니다.
    const matrix = rows.map(row => {
      const cells = Array(boundaries.length + 1).fill("");
      for (const word of row.words) {
        const centerX = (word.bbox.x0 + word.bbox.x1) / 2;
        let column = 0;
        while (column < boundaries.length && centerX > boundaries[column]) column++;
        cells[column] = cells[column]
          ? cells[column] + " " + word.text.trim()
          : word.text.trim();
      }
      return cells;
    });

    // 표 변환은 재배치만 허용합니다. OCR에서 읽은 단어의 추가·삭제·중복을 차단합니다.
    const tokenCounts = text => {
      const counts = new Map();
      for (const token of (text.match(/[^\\s]+/g) || [])) {
        const key = token.toLocaleLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return counts;
    };
    const original = tokenCounts(words.map(word => word.text.trim()).join(" "));
    const converted = tokenCounts(matrix.flat().join(" "));
    if (original.size !== converted.size ||
        Array.from(original).some(([token, count]) => converted.get(token) !== count)) {
      return { ok: false, reason: "텍스트 보존 검사를 통과하지 못해 표 변환을 중단했습니다.", rowCount: rows.length };
    }

    return {
      ok: true,
      rowCount: matrix.length,
      columnCount: boundaries.length + 1,
      boundaries,
      text: matrix.map(row => row.join("\\t")).join("\\n")
    };
  }

  root.TableStructureDetector = Object.freeze({ detect });
})(window);
