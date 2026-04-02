// tag-renderer.js
// Canvas-based tag rendering for both editor preview and PDF generation.
// Provides reliable photo rendering and consistent output across all platforms.

// ─── Font loading for canvas ───────────────────────────────────────────────────
const canvasLoadedFonts = new Set();

async function ensureFontsForCanvas(fontFamilies) {
  if (!document.fonts) return;

  const fontCheckPromises = fontFamilies.map(family => {
    if (!family || canvasLoadedFonts.has(family)) return Promise.resolve();
    const baseFamily = family.split(',')[0].trim().replace(/["']/g, '');
    return document.fonts.load(`16px "${baseFamily}"`).then(() => {
      canvasLoadedFonts.add(family);
    }).catch(() => null);
  });

  await Promise.all(fontCheckPromises);
}

// ─── Date formatting ──────────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function formatDate(rawValue, format) {
  if (!rawValue) return defaultDateForFormat(format);
  const [y, m, d] = rawValue.split('-');
  const monthName = MONTH_NAMES[parseInt(m, 10) - 1] || m;
  switch (format) {
    case 'MM | DD | YYYY': return `${m} | ${d} | ${y}`;
    case 'MMMM DD, YYYY': return `${monthName} ${parseInt(d)}, ${y}`;
    case 'DD MMMM, YYYY': return `${parseInt(d)} ${monthName}, ${y}`;
    case 'MM · DD · YYYY': return `${m} · ${d} · ${y}`;
    case 'DD / MM / YYYY': return `${d} / ${m} / ${y}`;
    case 'YYYY-MM-DD': return `${y}-${m}-${d}`;
    default: return `${m} | ${d} | ${y}`;
  }
}

// tag-renderer.js
function defaultDateForFormat(format) {
  const currentYear = new Date().getFullYear();
  switch (format) {
    case 'MM | DD | YYYY': return `06 | 15 | ${currentYear}`;
    case 'MMMM DD, YYYY': return `June 15, ${currentYear}`;
    case 'DD MMMM, YYYY': return `15 June, ${currentYear}`;
    case 'MM · DD · YYYY': return `06 · 15 · ${currentYear}`;
    case 'DD / MM / YYYY': return `15 / 06 / ${currentYear}`;
    case 'YYYY-MM-DD': return `${currentYear}-06-15`;
    default: return `06 | 15 | ${currentYear}`;
  }
}

// ─── Anchor calculations ──────────────────────────────────────────────────────
// Anchor is always 'top-center': x is the horizontal center, y is the top edge.
function getAnchorOffsets(width) {
  return { offsetX: -width / 2, offsetY: 0 };
}

function shapeToRadius(shape) {
  if (shape === 'circle') return '50%';
  if (shape === 'square') return '4px';
  if (shape === 'rectangle') return '8px';
  return '50%';
}

// ─── Load image as promise ─────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ─── Parse coordinate from percentage or pixel string ──────────────────────────
function parseCoordinate(coord, containerSize) {
  if (!coord) return 0;
  const str = String(coord).trim();
  if (str.endsWith('%')) {
    const percent = parseFloat(str) / 100;
    return percent * containerSize;
  }
  return parseFloat(str);
}

// ─── Apply text transformation (uppercase, lowercase, none) ────────────────────
function applyTextTransform(text, transform) {
  if (!transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  return text;
}

// ─── Parse font size from CSS value ────────────────────────────────────────────
function parseFontSize(sizeStr) {
  if (!sizeStr) return 16;
  const num = parseFloat(sizeStr);
  // If it's already in px, return as is; if in rem, convert to px (assuming 16px base)
  if (sizeStr.includes('rem')) return num * 16;
  return num;
}

// ─── Measure text width with letter spacing ──────────────────────────────────────
function measureTextWithSpacing(ctx, text, letterSpacing) {
  const baseWidth = ctx.measureText(text).width;

  if (!letterSpacing || letterSpacing === 0) {
    return baseWidth;
  }

  // Parse letter spacing
  let spacingPx = 0;
  if (typeof letterSpacing === 'string') {
    if (letterSpacing.includes('em')) {
      const fontSizeMatch = ctx.font.match(/(\d+(?:\.\d+)?)px/);
      const fontSize = fontSizeMatch ? parseFloat(fontSizeMatch[1]) : 16;
      spacingPx = parseFloat(letterSpacing) * fontSize;
    } else {
      spacingPx = parseFloat(letterSpacing);
    }
  } else {
    spacingPx = letterSpacing;
  }

  if (spacingPx <= 0) {
    return baseWidth;
  }

  // Add spacing for each character gap (n-1 gaps for n characters)
  return baseWidth + (spacingPx * (text.length - 1));
}

// ─── Helper to parse letter spacing to pixels ──────────────────────────────────
function parseLetterSpacingToPx(ctx, letterSpacing) {
  if (!letterSpacing || letterSpacing === 0) return 0;
  let spacingPx = 0;
  if (typeof letterSpacing === 'string') {
    if (letterSpacing.includes('em')) {
      const fontSizeMatch = ctx.font.match(/(\d+(?:\.\d+)?)px/);
      const fontSize = fontSizeMatch ? parseFloat(fontSizeMatch[1]) : 16;
      spacingPx = parseFloat(letterSpacing) * fontSize;
    } else {
      spacingPx = parseFloat(letterSpacing);
    }
  } else {
    spacingPx = letterSpacing;
  }
  return spacingPx;
}

// ─── Helper to find the index for ellipsis truncation ──────────────────────────
function getEllipsisIndex(ctx, text, maxWidth, letterSpacingPx, measureTextFn) {
  const ellipsisWidth = measureTextFn(ctx, '...', letterSpacingPx);
  let currentText = '';
  let i = 0;
  for (; i < text.length; i++) {
    const testText = currentText + text[i];
    if (measureTextFn(ctx, testText, letterSpacingPx) + ellipsisWidth > maxWidth) {
      break;
    }
    currentText = testText;
  }
  return i;
}

// ─── Word wrapping helper ──────────────────────────────────────────────────────
function wrapText(ctx, text, maxWidth, letterSpacingPx, measureTextFn, maxLines = 0) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0] || '';

  if (currentLine.length > 0 && measureTextFn(ctx, currentLine, letterSpacingPx) > maxWidth) {
    if (maxLines === 1) {
      lines.push(currentLine.substring(0, getEllipsisIndex(ctx, currentLine, maxWidth, letterSpacingPx, measureTextFn)) + '...');
      return lines;
    } else {
      lines.push(currentLine);
      currentLine = '';
    }
  }

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine === '' ? word : currentLine + ' ' + word;
    const testWidth = measureTextFn(ctx, testLine, letterSpacingPx);

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (maxLines > 0 && lines.length + 1 >= maxLines) { // Check if adding this word exceeds maxLines
        const lineWithEllipsis = currentLine.substring(0, getEllipsisIndex(ctx, currentLine, maxWidth, letterSpacingPx, measureTextFn)) + '...';
        lines.push(lineWithEllipsis);
        return lines.slice(0, maxLines); // Return lines up to maxLines
      }
      lines.push(currentLine);
      currentLine = word;
      if (currentLine.length > 0 && measureTextFn(ctx, currentLine, letterSpacingPx) > maxWidth) {
        // Handle case where a single word is wider than maxWidth
        if (maxLines > 0 && lines.length + 1 >= maxLines) {
          lines.push(currentLine.substring(0, getEllipsisIndex(ctx, currentLine, maxWidth, letterSpacingPx, measureTextFn)) + '...');
          return lines.slice(0, maxLines);
        } else {
          lines.push(currentLine); // Allow it to overflow if no maxLines or not last line
        }
      }
    }
  }
  if (currentLine !== '') {
    if (maxLines > 0 && lines.length + 1 > maxLines) { // If adding this last line exceeds maxLines
      const lineWithEllipsis = currentLine.substring(0, getEllipsisIndex(ctx, currentLine, maxWidth, letterSpacingPx, measureTextFn)) + '...';
      lines.push(lineWithEllipsis);
      return lines.slice(0, maxLines);
    } else {
      lines.push(currentLine);
    }
  }
  return lines;
}


// ─── Draw text with letter spacing support and word wrapping ────────────────────
// Added fontSizePx parameter
function drawTextWithSpacing(ctx, text, x, y, letterSpacing, maxWidth, lineHeight, maxLines = 0, fontSizePx) {
  if (!text) return;

  const spacingPx = parseLetterSpacingToPx(ctx, letterSpacing);
  // const currentFontSize = parseFontSize(ctx.font); // Removed: use fontSizePx parameter
  const lineHeightPx = (parseFloat(lineHeight) || 1.4) * fontSizePx; // Use passed fontSizePx

  // Capture alignment before mutating ctx inside the loop
  const originalTextAlign = ctx.textAlign;

  let lines = [text];
  if (maxWidth && maxWidth > 0) {
    // Set ctx.textAlign to 'left' before wrapText so measureText calls inside
    // are not affected by alignment state that may change during the draw loop
    ctx.textAlign = 'left';
    lines = wrapText(ctx, text, maxWidth, spacingPx, measureTextWithSpacing, maxLines);
    ctx.textAlign = originalTextAlign;
  }

  let currentY = y;
  const linesToDraw = (maxLines > 0 && lines.length > maxLines) ? lines.slice(0, maxLines) : lines;

  ctx.textAlign = 'left'; // All character drawing uses manual x positioning
  for (const line of linesToDraw) {
    const lineWidth = measureTextWithSpacing(ctx, line, spacingPx);

    // Resolve the true left-edge pixel where character drawing starts,
    // based on alignment:
    //   center — x is the horizontal center of the column
    //   right  — x is the right edge of the column
    //   left   — x is already the left edge
    let startX;
    if (originalTextAlign === 'center') {
      startX = x - lineWidth / 2;
    } else if (originalTextAlign === 'right') {
      startX = x - lineWidth;
    } else {
      startX = x;
    }

    let charX = startX;
    for (let i = 0; i < line.length; i++) {
      // Ensure the font is set correctly before drawing text, especially if it changed
      // ctx.font = buildCanvasFont(f.fontStyle, f.fontWeight, fontSizePx, f.fontFamily); // This line should be set before the loop or passed appropriately
      ctx.fillText(line[i], charX, currentY);
      if (i < line.length - 1) {
        charX += ctx.measureText(line[i]).width + spacingPx;
      }
    }
    currentY += lineHeightPx;
  }

  ctx.textAlign = originalTextAlign;
}

// ─── Build canvas tag asynchronously ───────────────────────────────────────────
async function buildTagCanvas(design, values, photoDataURL) {
  const { tagDimensions, tagImage, fields } = design;
  const W = tagDimensions.width;
  const H = tagDimensions.height;

  // Wait for fonts to be ready before rendering
  if (document.fonts) {
    await document.fonts.ready;
  }

  // Collect font families for this design
  const fontFamilies = [];
  if (fields.couple) fontFamilies.push(fields.couple.fontFamily);
  if (fields.date) fontFamilies.push(fields.date.fontFamily);
  if (fields.tagline) fontFamilies.push(fields.tagline.fontFamily);

  // Ensure fonts are loaded before rendering
  await ensureFontsForCanvas(fontFamilies);

  // Create canvas at 2x DPI for sharp text rendering
  const DPI_SCALE = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * DPI_SCALE;
  canvas.height = H * DPI_SCALE;
  const ctx = canvas.getContext('2d', { alpha: true });

  // Load background image - scale to 2x size
  try {
    if (tagImage) {
      const bgImg = await loadImage(tagImage);
      ctx.drawImage(bgImg, 0, 0, W * DPI_SCALE, H * DPI_SCALE);
    } else {
      // Fallback: white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W * DPI_SCALE, H * DPI_SCALE);
    }
  } catch (e) {
    console.warn('Could not load tag background image:', e);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W * DPI_SCALE, H * DPI_SCALE);
  }

  // Draw photo
  const p = fields.photo;
  if (p && p.enabled) {
    try {
      if (photoDataURL) {
        const photoImg = await loadImage(photoDataURL);

        // Calculate position — anchor is always top-center: x is center, y is top edge
        const photoX = (parseCoordinate(p.x, W) + getAnchorOffsets(p.width).offsetX) * DPI_SCALE;
        const photoY = parseCoordinate(p.y, H) * DPI_SCALE;
        const photoW = p.width * DPI_SCALE;
        const photoH = p.height * DPI_SCALE;

        // Create clipping path based on shape
        ctx.save();
        ctx.beginPath();

        if (p.shape === 'circle') {
          // Draw a perfect circle
          const centerX = photoX + photoW / 2;
          const centerY = photoY + photoH / 2;
          const radius = Math.min(photoW, photoH) / 2;
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        } else if (p.shape === 'oval' || p.shape === 'ellipse') {
          // Draw an oval/ellipse (different radii for x and y)
          const centerX = photoX + photoW / 2;
          const centerY = photoY + photoH / 2;
          const radiusX = photoW / 2;
          const radiusY = photoH / 2;
          ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
        } else if (p.shape === 'square') {
          // Square with slight rounded corners (4px)
          const radius = 4 * DPI_SCALE;
          const x = photoX, y = photoY, w = photoW, h = photoH;
          ctx.moveTo(x + radius, y);
          ctx.lineTo(x + w - radius, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
          ctx.lineTo(x + w, y + h - radius);
          ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
          ctx.lineTo(x + radius, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
          ctx.lineTo(x, y + radius);
          ctx.quadraticCurveTo(x, y, x + radius, y);
        } else if (p.shape === 'rectangle') {
          // Rectangle with slight rounded corners (8px)
          const radius = 8 * DPI_SCALE;
          const x = photoX, y = photoY, w = photoW, h = photoH;
          ctx.moveTo(x + radius, y);
          ctx.lineTo(x + w - radius, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
          ctx.lineTo(x + w, y + h - radius);
          ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
          ctx.lineTo(x + radius, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
          ctx.lineTo(x, y + radius);
          ctx.quadraticCurveTo(x, y, x + radius, y);
        } else {
          // Default to rectangle with rounded corners
          const radius = 8 * DPI_SCALE;
          const x = photoX, y = photoY, w = photoW, h = photoH;
          ctx.moveTo(x + radius, y);
          ctx.lineTo(x + w - radius, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
          ctx.lineTo(x + w, y + h - radius);
          ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
          ctx.lineTo(x + radius, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
          ctx.lineTo(x, y + radius);
          ctx.quadraticCurveTo(x, y, x + radius, y);
        }

        ctx.clip();

        // Draw image with proper cropping (cover mode)
        const imgW = photoImg.width;
        const imgH = photoImg.height;
        const slotAspect = photoW / photoH;
        const imgAspect = imgW / imgH;

        let drawW, drawH, drawX, drawY;
        if (imgAspect > slotAspect) {
          // Image is wider than slot - crop sides
          drawH = photoH;
          drawW = drawH * imgAspect;
          drawX = photoX + (photoW - drawW) / 2;
          drawY = photoY;
        } else {
          // Image is taller than slot - crop top/bottom
          drawW = photoW;
          drawH = drawW / imgAspect;
          drawX = photoX;
          drawY = photoY + (photoH - drawH) / 2;
        }

        ctx.drawImage(photoImg, drawX, drawY, drawW, drawH);
        ctx.restore();

        // Draw border if borderWidth > 0
        if (p.borderWidth > 0) {
          ctx.save();
          ctx.strokeStyle = p.borderColor || '#c4956a';
          ctx.lineWidth = (p.borderWidth || 1) * DPI_SCALE;
          ctx.beginPath();

          if (p.shape === 'circle') {
            // Draw circle border
            const centerX = photoX + photoW / 2;
            const centerY = photoY + photoH / 2;
            const radius = Math.min(photoW, photoH) / 2;
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          } else if (p.shape === 'oval' || p.shape === 'ellipse') {
            // Draw oval/ellipse border
            const centerX = photoX + photoW / 2;
            const centerY = photoY + photoH / 2;
            const radiusX = photoW / 2;
            const radiusY = photoH / 2;
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
          } else if (p.shape === 'square') {
            // Square border with rounded corners
            const radius = 4 * DPI_SCALE;
            const x = photoX, y = photoY, w = photoW, h = photoH;
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + w - radius, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
            ctx.lineTo(x + w, y + h - radius);
            ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            ctx.lineTo(x + radius, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
          } else if (p.shape === 'rectangle') {
            // Rectangle border with rounded corners
            const radius = 8 * DPI_SCALE;
            const x = photoX, y = photoY, w = photoW, h = photoH;
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + w - radius, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
            ctx.lineTo(x + w, y + h - radius);
            ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            ctx.lineTo(x + radius, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
          } else {
            // Default rectangle border
            const radius = 8 * DPI_SCALE;
            const x = photoX, y = photoY, w = photoW, h = photoH;
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + w - radius, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
            ctx.lineTo(x + w, y + h - radius);
            ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            ctx.lineTo(x + radius, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
          }

          ctx.stroke();
          ctx.restore();
        }
      }
    } catch (e) {
      console.warn('Could not load photo:', e);
    }
  }

  // Draw text fields
  const textFields = ['couple', 'date', 'tagline'];
  for (const key of textFields) {
    const f = fields[key];
    if (!f) continue;

    const textX = parseCoordinate(f.x, W) * DPI_SCALE;
    const textY = parseCoordinate(f.y, H) * DPI_SCALE;

    if (key === 'couple') {
      let n1 = values.name1 || 'Ethan';
      let n2 = values.name2 || 'Maria';
      const amp = resolveAmpDefaults(f);
      let ampChar = amp.ampCharacter;

      // Apply text transformations
      n1 = applyTextTransform(n1, f.textTransform);
      n2 = applyTextTransform(n2, f.textTransform);
      ampChar = applyTextTransform(ampChar, amp.ampTextTransform);

      await drawStyledCoupleText(ctx, n1, n2, ampChar, f, textX, textY, DPI_SCALE, W);
    } else if (key === 'date') {
      let dateText = formatDate(values.date, f.format);
      dateText = applyTextTransform(dateText, f.textTransform);
      ctx.save();
      const currentFontSizePx = parseFontSize(f.fontSize) * DPI_SCALE; // Calculate font size in pixels
      ctx.font = buildCanvasFont(f.fontStyle, f.fontWeight, currentFontSizePx, f.fontFamily);
      ctx.fillStyle = f.color || '#333';
      ctx.textAlign = f.alignment === 'center' ? 'center' : f.alignment === 'right' ? 'right' : 'left';
      ctx.textBaseline = 'top';
      const dateMaxWidth = parseCoordinate(f.width, W) * DPI_SCALE; // Calculate max width
      // Pass calculated font size in pixels to drawTextWithSpacing
      drawTextWithSpacing(ctx, dateText, textX, textY, f.letterSpacing, dateMaxWidth, f.lineHeight, f.maxLines, currentFontSizePx);
      ctx.restore();
    } else if (key === 'tagline') {
      let taglineText = values.tagline || f.defaultValue || 'Forever starts today';
      taglineText = applyTextTransform(taglineText, f.textTransform);
      ctx.save();
      const currentFontSizePx = parseFontSize(f.fontSize) * DPI_SCALE; // Calculate font size in pixels
      ctx.font = buildCanvasFont(f.fontStyle, f.fontWeight, currentFontSizePx, f.fontFamily);
      ctx.fillStyle = f.color || '#333';
      ctx.textAlign = f.alignment === 'center' ? 'center' : f.alignment === 'right' ? 'right' : 'left';
      ctx.textBaseline = 'top';
      const taglineMaxWidth = parseCoordinate(f.width, W) * DPI_SCALE; // Calculate max width
      // Pass calculated font size in pixels to drawTextWithSpacing
      drawTextWithSpacing(ctx, taglineText, textX, textY, f.letterSpacing, taglineMaxWidth, f.lineHeight, f.maxLines, currentFontSizePx);
      ctx.restore();
    }
  }

  return canvas;
}

// ─── Build proper Canvas font string with quoted font names ────────────────────
function buildCanvasFont(fontStyle, fontWeight, fontSize, fontFamily) {
  // Quote the first font name if it has spaces
  let quotedFamily = fontFamily || 'sans-serif';
  const families = quotedFamily.split(',').map(f => {
    f = f.trim();
    // Quote if it has spaces and isn't already quoted
    if (f.includes(' ') && !f.startsWith('"') && !f.startsWith("'")) {
      return `"${f}"`;
    }
    return f;
  }).join(', ');

  return `${fontStyle || 'normal'} ${fontWeight || '400'} ${fontSize}px ${families}`;
}

// ─── Resolve ampersand style defaults from couple field ────────────────────────
// Removed properties (ampFontFamily, ampFontStyle, ampFontWeight, ampTextTransform)
// fall back to the couple field's own values so designs need not declare them.
function resolveAmpDefaults(f) {
  return {
    ampFontFamily: f.ampFontFamily || f.fontFamily,
    ampFontSize: f.ampFontSize || f.fontSize,
    ampFontStyle: f.ampFontStyle || 'normal',
    ampFontWeight: f.ampFontWeight || f.fontWeight,
    ampTextTransform: f.ampTextTransform || f.textTransform || 'none',
    ampColor: f.ampColor || f.color,
    ampCharacter: f.ampCharacter || '&',
  };
}

// ─── Draw styled couple text with colored ampersand ────────────────────────────
async function drawStyledCoupleText(ctx, name1, name2, ampChar, design, x, y, dpiScale = 1, tagWidth) {
  const amp = resolveAmpDefaults(design);

  const initialNameFontSizePx = parseFontSize(design.fontSize) * dpiScale;
  const initialAmpFontSizePx = (parseFontSize(amp.ampFontSize) || parseFontSize(design.fontSize)) * dpiScale;
  const minFontSizeScale = 0.6; // Allow font to shrink to 60% of original size
  const minNameFontSizePx = initialNameFontSizePx * minFontSizeScale;
  const minAmpFontSizePx = initialAmpFontSizePx * minFontSizeScale;

  const coupleMaxWidth = parseCoordinate(design.width, tagWidth) * dpiScale;
  const letterSpacing = design.letterSpacing || '0';
  const maxLines = design.maxLines || 1; // Default to 1 line for couple names

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = design.alignment === 'center' ? 'center' : design.alignment === 'right' ? 'right' : 'left';

  let currentY = y;
  let currentNameFontSize = initialNameFontSizePx;
  let currentAmpFontSize = initialAmpFontSizePx;
  let linesFit = false;

  while (!linesFit && currentNameFontSize >= minNameFontSizePx - 0.1) { // -0.1 to account for potential floating point issues
    const nameFont = buildCanvasFont(design.fontStyle, design.fontWeight, currentNameFontSize, design.fontFamily);
    const ampFont = buildCanvasFont(amp.ampFontStyle, amp.ampFontWeight, currentAmpFontSize, amp.ampFontFamily);

    // Set font for measurements
    ctx.font = nameFont;
    const name1SpacingPx = parseLetterSpacingToPx(ctx, letterSpacing);
    const name2SpacingPx = parseLetterSpacingToPx(ctx, letterSpacing);

    ctx.font = ampFont;
    const ampSpacingPx = parseLetterSpacingToPx(ctx, '0'); // Ampersand typically doesn't get extra spacing

    let requiredLines = 0;

    if (maxLines === 1) {
      const combinedText = `${name1} ${ampChar} ${name2}`;
      ctx.font = nameFont; // Use name font for combined text measurement
      const combinedTextWidth = measureTextWithSpacing(ctx, combinedText, name1SpacingPx);
      if (combinedTextWidth > coupleMaxWidth) {
        requiredLines = 2; // Requires more than 1 line
      } else {
        requiredLines = 1;
      }
    } else if (maxLines === 2) {
      // Check if name1 + ampersand fits on line 1
      ctx.font = nameFont; // Ensure correct font for name1 measurement
      const name1AndAmpText = `${name1} ${ampChar}`;
      const name1AndAmpWidth = measureTextWithSpacing(ctx, name1AndAmpText, name1SpacingPx);
      if (name1AndAmpWidth > coupleMaxWidth) {
        requiredLines += 1; // This part itself would take more than one line
      }
      requiredLines += 1; // Account for name1+amp line

      // Check if name2 fits on line 2
      ctx.font = nameFont; // Ensure correct font for name2 measurement
      const name2Width = measureTextWithSpacing(ctx, name2, name2SpacingPx);
      if (name2Width > coupleMaxWidth) {
        requiredLines += 1; // This part itself would take more than one line
      }
      requiredLines += 1; // Account for name2 line
    }

    if (requiredLines <= maxLines) {
      linesFit = true;
    } else {
      currentNameFontSize -= 1 * dpiScale; // Decrease font size
      currentAmpFontSize = (currentNameFontSize / initialNameFontSizePx) * initialAmpFontSizePx; // Scale amp font size proportionally
      if (currentNameFontSize < minNameFontSizePx) { // If we've gone below min, just use min
        currentNameFontSize = minNameFontSizePx;
        currentAmpFontSize = minAmpFontSizePx;
        linesFit = true; // Stop trying to shrink if at min font size
      }
    }
  }

  // Ensure font sizes don't go below min (final check after loop)
  if (currentNameFontSize < minNameFontSizePx) currentNameFontSize = minNameFontSizePx;
  if (currentAmpFontSize < minAmpFontSizePx) currentAmpFontSize = minAmpFontSizePx;

  const finalNameFont = buildCanvasFont(design.fontStyle, design.fontWeight, currentNameFontSize, design.fontFamily);
  const finalAmpFont = buildCanvasFont(amp.ampFontStyle, amp.ampFontWeight, currentAmpFontSize, amp.ampFontFamily);
  // Use the adjusted currentNameFontSize for lineHeight calculation
  const lineHeightPx = (parseFloat(design.lineHeight) || 1.4) * currentNameFontSize;

  if (maxLines === 1) {
    // Draw all on one line, font size adjusted to fit (wrapText will handle line breaks if still needed, but no maxLines here for ellipsis prevention)
    ctx.font = finalNameFont;
    ctx.fillStyle = design.color || '#333';
    const combinedText = `${name1} ${ampChar} ${name2}`;
    // Pass the calculated font size in pixels to drawTextWithSpacing
    drawTextWithSpacing(ctx, combinedText, x, currentY, letterSpacing, coupleMaxWidth, design.lineHeight, 0, currentNameFontSize);
  } else if (maxLines === 2) {
    // Draw name 1 + ampersand on line 1
    ctx.font = finalNameFont;
    ctx.fillStyle = design.color || '#333';
    const name1AndAmpText = `${name1} ${ampChar}`;
    // Pass the calculated font size in pixels to drawTextWithSpacing
    drawTextWithSpacing(ctx, name1AndAmpText, x, currentY, letterSpacing, coupleMaxWidth, design.lineHeight, 0, currentNameFontSize);
    currentY += lineHeightPx;

    // Draw name 2 on line 2
    ctx.font = finalNameFont;
    ctx.fillStyle = design.color || '#333';
    // Pass the calculated font size in pixels to drawTextWithSpacing
    drawTextWithSpacing(ctx, name2, x, currentY, letterSpacing, coupleMaxWidth, design.lineHeight, 0, currentNameFontSize);
  }

  ctx.restore();
}

// ─── Update canvas with new values ────────────────────────────────────────────
async function updateTagCanvas(canvas, design, values, photoDataURL) {
  const newCanvas = await buildTagCanvas(design, values, photoDataURL);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(newCanvas, 0, 0);
}

// ─── Legacy HTML wrapper for backward compatibility ───────────────────────────
async function buildTagElement(design, values, photoDataURL) {
  const canvas = await buildTagCanvas(design, values, photoDataURL);

  // Create wrapper div
  const wrapper = document.createElement('div');
  wrapper.className = 'tag-root';
  wrapper.style.cssText = `
    position: relative;
    width: ${design.tagDimensions.width}px;
    height: ${design.tagDimensions.height}px;
    border-radius: 16px;
    overflow: hidden;
    flex-shrink: 0;
  `;

  // Canvas is internally 2x DPI for sharp text, but display at normal size
  canvas.style.display = 'block';
  canvas.style.width = `${design.tagDimensions.width}px`;
  canvas.style.height = `${design.tagDimensions.height}px`;
  canvas.style.margin = '0';
  canvas.style.padding = '0';
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.imageRendering = 'auto';
  canvas.className = 'tag-canvas';
  wrapper.appendChild(canvas);

  return wrapper;
}

async function updateTagElement(root, design, values, photoDataURL) {
  const canvas = root.querySelector('.tag-canvas');
  if (canvas) {
    await updateTagCanvas(canvas, design, values, photoDataURL);
  }
}

// Export for use by both pages
window.TagRenderer = {
  buildTagElement,
  updateTagElement,
  buildTagCanvas,
  updateTagCanvas,
  formatDate,
  defaultDateForFormat,
  loadImage
};
