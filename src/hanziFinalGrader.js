import HanziWriter from "hanzi-writer";

const COSINE_SIMILARITY_THRESHOLD = 0;
const START_AND_END_DIST_THRESHOLD = 250;
const FRECHET_THRESHOLD = 0.4;
const MIN_LEN_THRESHOLD = 0.35;
const SHAPE_FIT_ROTATIONS = [
  Math.PI / 16,
  Math.PI / 32,
  0,
  -Math.PI / 32,
  -Math.PI / 16,
];

function arrLast(arr) {
  return arr[arr.length - 1];
}

function average(arr) {
  return arr.reduce((acc, val) => acc + val, 0) / arr.length;
}

function subtract(p1, p2) {
  return { x: p1.x - p2.x, y: p1.y - p2.y };
}

function magnitude(point) {
  return Math.sqrt(point.x ** 2 + point.y ** 2);
}

function distance(point1, point2) {
  return magnitude(subtract(point1, point2));
}

function equals(point1, point2) {
  return point1.x === point2.x && point1.y === point2.y;
}

function length(points) {
  let lastPoint = points[0];
  return points.slice(1).reduce((acc, point) => {
    const dist = distance(point, lastPoint);
    lastPoint = point;
    return acc + dist;
  }, 0);
}

function cosineSimilarity(point1, point2) {
  const mag1 = magnitude(point1);
  const mag2 = magnitude(point2);
  if (mag1 === 0 || mag2 === 0) return -1;
  return (point1.x * point2.x + point1.y * point2.y) / mag1 / mag2;
}

function extendPointOnLine(p1, p2, dist) {
  const vect = subtract(p2, p1);
  const mag = magnitude(vect);
  if (mag === 0) return p2;
  const norm = dist / mag;
  return {
    x: p2.x + norm * vect.x,
    y: p2.y + norm * vect.y,
  };
}

function frechetDist(curve1, curve2) {
  const longCurve = curve1.length >= curve2.length ? curve1 : curve2;
  const shortCurve = curve1.length >= curve2.length ? curve2 : curve1;

  const calcVal = (i, j, prevResultsCol, curResultsCol) => {
    if (i === 0 && j === 0) return distance(longCurve[0], shortCurve[0]);
    if (i > 0 && j === 0) {
      return Math.max(prevResultsCol[0], distance(longCurve[i], shortCurve[0]));
    }

    const lastResult = curResultsCol[curResultsCol.length - 1];
    if (i === 0 && j > 0) {
      return Math.max(lastResult, distance(longCurve[0], shortCurve[j]));
    }

    return Math.max(
      Math.min(prevResultsCol[j], prevResultsCol[j - 1], lastResult),
      distance(longCurve[i], shortCurve[j])
    );
  };

  let prevResultsCol = [];
  for (let i = 0; i < longCurve.length; i++) {
    const curResultsCol = [];
    for (let j = 0; j < shortCurve.length; j++) {
      curResultsCol.push(calcVal(i, j, prevResultsCol, curResultsCol));
    }
    prevResultsCol = curResultsCol;
  }

  return prevResultsCol[shortCurve.length - 1];
}

function subdivideCurve(curve, maxLen = 0.05) {
  const newCurve = curve.slice(0, 1);

  for (const point of curve.slice(1)) {
    const prevPoint = newCurve[newCurve.length - 1];
    const segLen = distance(point, prevPoint);

    if (segLen > maxLen) {
      const numNewPoints = Math.ceil(segLen / maxLen);
      const newSegLen = segLen / numNewPoints;
      for (let i = 0; i < numNewPoints; i++) {
        newCurve.push(extendPointOnLine(point, prevPoint, -newSegLen * (i + 1)));
      }
    } else {
      newCurve.push(point);
    }
  }

  return newCurve;
}

function outlineCurve(curve, numPoints = 30) {
  const curveLen = length(curve);
  if (curve.length < 2 || curveLen === 0) return curve;

  const segmentLen = curveLen / (numPoints - 1);
  const outlinePoints = [curve[0]];
  const endPoint = arrLast(curve);
  const remainingCurvePoints = curve.slice(1);

  for (let i = 0; i < numPoints - 2; i++) {
    let lastPoint = arrLast(outlinePoints);
    let remainingDist = segmentLen;
    let outlinePointFound = false;

    while (!outlinePointFound && remainingCurvePoints.length > 0) {
      const nextPointDist = distance(lastPoint, remainingCurvePoints[0]);
      if (nextPointDist < remainingDist) {
        remainingDist -= nextPointDist;
        lastPoint = remainingCurvePoints.shift();
      } else {
        outlinePoints.push(
          extendPointOnLine(lastPoint, remainingCurvePoints[0], remainingDist - nextPointDist)
        );
        outlinePointFound = true;
      }
    }
  }

  outlinePoints.push(endPoint);
  return outlinePoints;
}

// Normalizing a curve (outline + translate + scale + subdivide) is the most
// expensive step in shape matching and runs many times per grade against the
// same expected-stroke arrays, so cache by array identity.
const normalizedCurveCache = new WeakMap();

function normalizeCurve(curve) {
  const cached = normalizedCurveCache.get(curve);
  if (cached) return cached;
  const result = computeNormalizedCurve(curve);
  normalizedCurveCache.set(curve, result);
  return result;
}

function computeNormalizedCurve(curve) {
  const outlinedCurve = outlineCurve(curve);
  if (outlinedCurve.length < 2) return outlinedCurve;

  const mean = {
    x: average(outlinedCurve.map((point) => point.x)),
    y: average(outlinedCurve.map((point) => point.y)),
  };
  const translatedCurve = outlinedCurve.map((point) => subtract(point, mean));
  const scale = Math.sqrt(
    average([
      translatedCurve[0].x ** 2 + translatedCurve[0].y ** 2,
      arrLast(translatedCurve).x ** 2 + arrLast(translatedCurve).y ** 2,
    ])
  );
  if (scale === 0) return translatedCurve;

  return subdivideCurve(
    translatedCurve.map((point) => ({
      x: point.x / scale,
      y: point.y / scale,
    }))
  );
}

function rotate(curve, theta) {
  return curve.map((point) => ({
    x: Math.cos(theta) * point.x - Math.sin(theta) * point.y,
    y: Math.sin(theta) * point.x + Math.cos(theta) * point.y,
  }));
}

function stripDuplicates(points) {
  if (points.length < 2) return points;
  const dedupedPoints = [points[0]];
  for (const point of points.slice(1)) {
    if (!equals(point, arrLast(dedupedPoints))) dedupedPoints.push(point);
  }
  return dedupedPoints;
}

class Stroke {
  constructor(points, strokeNum) {
    this.points = points;
    this.strokeNum = strokeNum;
  }

  getStartingPoint() {
    return this.points[0];
  }

  getEndingPoint() {
    return this.points[this.points.length - 1];
  }

  getLength() {
    return length(this.points);
  }

  getVectors() {
    let lastPoint = this.points[0];
    return this.points.slice(1).map((point) => {
      const vector = subtract(point, lastPoint);
      lastPoint = point;
      return vector;
    });
  }

  getDistance(point) {
    return Math.min(...this.points.map((strokePoint) => distance(strokePoint, point)));
  }

  getAverageDistance(points) {
    return points.reduce((acc, point) => acc + this.getDistance(point), 0) / points.length;
  }
}

function startAndEndMatches(points, closestStroke, leniency) {
  const startingDist = distance(closestStroke.getStartingPoint(), points[0]);
  const endingDist = distance(closestStroke.getEndingPoint(), points[points.length - 1]);
  return (
    startingDist <= START_AND_END_DIST_THRESHOLD * leniency &&
    endingDist <= START_AND_END_DIST_THRESHOLD * leniency
  );
}

function getEdgeVectors(points) {
  const vectors = [];
  let lastPoint = points[0];
  points.slice(1).forEach((point) => {
    vectors.push(subtract(point, lastPoint));
    lastPoint = point;
  });
  return vectors;
}

function directionMatches(points, stroke) {
  const edgeVectors = getEdgeVectors(points);
  const strokeVectors = stroke.getVectors();
  if (edgeVectors.length === 0 || strokeVectors.length === 0) return false;
  const similarities = edgeVectors.map((edgeVector) =>
    Math.max(...strokeVectors.map((strokeVector) => cosineSimilarity(strokeVector, edgeVector)))
  );
  return average(similarities) > COSINE_SIMILARITY_THRESHOLD;
}

function lengthMatches(points, stroke, leniency) {
  return (leniency * (length(points) + 25)) / (stroke.getLength() + 25) >= MIN_LEN_THRESHOLD;
}

function shapeFit(curve1, curve2, leniency) {
  const normCurve1 = normalizeCurve(curve1);
  const normCurve2 = normalizeCurve(curve2);
  if (normCurve1.length < 2 || normCurve2.length < 2) return false;

  let minDist = Infinity;
  SHAPE_FIT_ROTATIONS.forEach((theta) => {
    const dist = frechetDist(normCurve1, rotate(normCurve2, theta));
    if (dist < minDist) minDist = dist;
  });
  return minDist <= FRECHET_THRESHOLD * leniency;
}

function getMatchData(points, stroke, options) {
  const {
    leniency = 1,
    isOutlineVisible = false,
    checkBackwards = true,
    averageDistanceThreshold = 350,
  } = options;
  const avgDist = stroke.getAverageDistance(points);
  const distMod = isOutlineVisible || stroke.strokeNum > 0 ? 0.5 : 1;
  const withinDistThresh = avgDist <= averageDistanceThreshold * distMod * leniency;
  const startAndEndMatch = startAndEndMatches(points, stroke, leniency);
  const directionMatch = directionMatches(points, stroke);
  const shapeMatch = shapeFit(points, stroke.points, leniency);
  const lengthMatch = lengthMatches(points, stroke, leniency);
  const checks = {
    withinDistThresh,
    startAndEndMatch,
    directionMatch,
    shapeMatch,
    lengthMatch,
  };
  const isMatch =
    withinDistThresh &&
    startAndEndMatch &&
    directionMatch &&
    shapeMatch &&
    lengthMatch;

  if (checkBackwards && !isMatch) {
    const backwardsMatchData = getMatchData([...points].reverse(), stroke, {
      ...options,
      checkBackwards: false,
    });
    if (backwardsMatchData.isMatch) {
      return {
        isMatch: false,
        avgDist,
        checks,
        meta: { isStrokeBackwards: true },
      };
    }
  }

  return { isMatch, avgDist, checks, meta: { isStrokeBackwards: false } };
}

function getFailureReason(result) {
  if (result.isMatch) return "ok";
  if (result.meta.matchesStrokeNum != null) return "order";
  if (result.meta.isStrokeBackwards) return "backwards";
  if (!result.checks?.withinDistThresh || !result.checks?.startAndEndMatch) return "location";
  if (!result.checks?.directionMatch) return "direction";
  if (!result.checks?.lengthMatch) return "length";
  if (!result.checks?.shapeMatch) return "shape";
  return "shape";
}

function findMatchedStrokeNum(points, strokes, strokeNum, options) {
  let bestMatch = null;
  for (let i = 0; i < strokes.length; i++) {
    if (i === strokeNum) continue;
    const match = getMatchData(points, strokes[i], {
      ...options,
      checkBackwards: false,
    });
    if (match.isMatch && (!bestMatch || match.avgDist < bestMatch.avgDist)) {
      bestMatch = { strokeNum: i, avgDist: match.avgDist };
    }
  }
  return bestMatch?.strokeNum ?? null;
}

function strokeMatches(userPoints, strokes, strokeNum, options = {}) {
  const points = stripDuplicates(userPoints);
  if (points.length < 2) {
    return {
      isMatch: false,
      checks: {
        withinDistThresh: false,
        startAndEndMatch: false,
        directionMatch: false,
        shapeMatch: false,
        lengthMatch: false,
      },
      meta: { isStrokeBackwards: false, matchesStrokeNum: null },
      avgDist: Infinity,
    };
  }

  const match = getMatchData(points, strokes[strokeNum], options);
  if (!match.isMatch) {
    const matchesStrokeNum = findMatchedStrokeNum(points, strokes, strokeNum, options);
    return {
      ...match,
      meta: {
        ...match.meta,
        matchesStrokeNum,
      },
    };
  }

  const laterStrokes = strokes.slice(strokeNum + 1);
  let closestMatchDist = match.avgDist;

  for (const laterStroke of laterStrokes) {
    const laterMatch = getMatchData(points, laterStroke, {
      ...options,
      checkBackwards: false,
    });
    if (laterMatch.isMatch && laterMatch.avgDist < closestMatchDist) {
      closestMatchDist = laterMatch.avgDist;
    }
  }

  if (closestMatchDist < match.avgDist) {
    const leniencyAdjustment = (0.6 * (closestMatchDist + match.avgDist)) / (2 * match.avgDist);
    return getMatchData(points, strokes[strokeNum], {
      ...options,
      leniency: (options.leniency || 1) * leniencyAdjustment,
    });
  }

  return match;
}

// Reuse hanzi-writer's own Positioner (via the public getScalingTransform) so
// the SVG↔character coordinate mapping stays in sync with the library's font
// coordinate system across upgrades.
function buildPositioner({ width, height, padding }) {
  const transform = HanziWriter.getScalingTransform(width, height, padding);
  return {
    scale: transform.scale,
    xOffset: transform.x,
    yOffset: transform.y,
    height,
  };
}

function convertExternalPoint(point, positioner) {
  return {
    x: (point.x - positioner.xOffset) / positioner.scale,
    y: (positioner.height - positioner.yOffset - point.y) / positioner.scale,
  };
}

function parseStrokes(charData) {
  return charData.medians.map(
    (median, index) => new Stroke(median.map(([x, y]) => ({ x, y })), index)
  );
}

// Character data is immutable per character; cache the load promise so repeated
// submits (and retries on the same character) don't re-hit the loader.
const charDataCache = new Map();

function loadCharData(character) {
  let cached = charDataCache.get(character);
  if (!cached) {
    cached = HanziWriter.loadCharacterData(character).catch((error) => {
      charDataCache.delete(character);
      throw error;
    });
    charDataCache.set(character, cached);
  }
  return cached;
}

export async function gradeCharacterDrawing(character, drawnStrokes, options = {}) {
  const {
    width = 260,
    height = 260,
    padding = 10,
    leniency = 1,
    averageDistanceThreshold = 350,
    isOutlineVisible = false,
  } = options;

  const charData = await loadCharData(character);
  const expectedStrokes = parseStrokes(charData);
  const positioner = buildPositioner({ width, height, padding });
  // Keep one entry per drawn stroke (no filtering) so indices stay aligned with
  // the rendered strokes in the UI; degenerate strokes are caught by
  // strokeMatches, which fails any stroke with fewer than two distinct points.
  const normalizedStrokes = drawnStrokes.map((stroke) =>
    stroke.map((point) => convertExternalPoint(point, positioner))
  );

  const strokeResults = expectedStrokes.map((_, index) => {
    const drawnStroke = normalizedStrokes[index];
    if (!drawnStroke) {
      return {
        strokeNum: index,
        passed: false,
        reason: "missing",
        isStrokeBackwards: false,
        avgDist: Infinity,
      };
    }

    const result = strokeMatches(drawnStroke, expectedStrokes, index, {
      leniency,
      averageDistanceThreshold,
      isOutlineVisible,
    });
    const reason = getFailureReason(result);
    return {
      strokeNum: index,
      passed: result.isMatch,
      reason,
      isStrokeBackwards: result.meta.isStrokeBackwards,
      matchesStrokeNum: result.meta.matchesStrokeNum,
      checks: result.checks,
      avgDist: result.avgDist,
    };
  });

  const extraStrokeCount = Math.max(0, normalizedStrokes.length - expectedStrokes.length);
  const failedStrokeCount =
    strokeResults.filter((result) => !result.passed).length + extraStrokeCount;

  return {
    passed: failedStrokeCount === 0,
    character,
    expectedStrokeCount: expectedStrokes.length,
    drawnStrokeCount: normalizedStrokes.length,
    failedStrokeCount,
    extraStrokeCount,
    strokeResults,
  };
}
