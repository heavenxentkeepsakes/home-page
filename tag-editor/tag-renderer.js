// tag-renderer.js
// Canvas-based tag rendering for both editor preview and PDF generation.
// Provides reliable photo rendering and consistent output across all platforms.

// Cache decoded images so they aren't re-decoded on every keystroke
const _imageCache = new Map();
const MAX_CACHE_SIZE = 10; // Limit cache size to prevent memory issues

async function getCachedImage(url) {
  if (!url) return null;

  // For data URLs, we don't want to cache indefinitely as they change
  if (url.startsWith('data:')) {
    return await loadImage(url);
  }

  if (_imageCache.has(url)) return _imageCache.get(url);

  const img = await loadImage(url);

  // Simple LRU-like cache management
  if (_imageCache.size >= MAX_CACHE_SIZE) {
    const firstKey = _imageCache.keys().next().value;
    _imageCache.delete(firstKey);
  }

  _imageCache.set(url, img);
  return img;
}

// Clear the image cache (useful when changing photos)
function clearImageCache() {
  _imageCache.clear();
}

// ─── Font loading for canvas ───────────────────────────────────────────────────
const canvasLoadedFonts = new Set();

async function ensureFontsForCanvas(fontFamilies) {
  if (!document.fonts) return;

  const fontCheckPromises = fontFamilies.map(async (family) => {
    if (!family || canvasLoadedFonts.has(family)) return;

    const baseFamily = family.split(',')[0].trim().replace(/["']/g, '');

    try {
      // Load the font
      await document.fonts.load(`16px "${baseFamily}"`);
      // Wait a microtask to ensure the font is actually ready
      await new Promise(resolve => setTimeout(resolve, 10));
      canvasLoadedFonts.add(family);
    } catch (e) {
      console.warn(`Font ${baseFamily} could not be loaded:`, e);
    }
  });

  await Promise.all(fontCheckPromises);
}

// ─── Date formatting ──────────────────────────────────────────────────────────
MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
function formatDate(rawValue, format) {
  if (!rawValue) return defaultDateForFormat(format);

  const parts = rawValue.split('-');
  if (parts.length !== 3) return defaultDateForFormat(format);

  const [y, m, d] = parts;
  const monthNum = parseInt(m, 10);
  const monthName = MONTH_NAMES[monthNum - 1] || m;
  const day = parseInt(d, 10);

  switch (format) {
    case 'MM | DD | YYYY': return `${m} | ${d} | ${y}`;
    case 'MMMM DD, YYYY': return `${monthName} ${day}, ${y}`;
    case 'DD MMMM, YYYY': return `${day} ${monthName}, ${y}`;
    case 'MM · DD · YYYY': return `${m} · ${d} · ${y}`;
    case 'DD / MM / YYYY': return `${d} / ${m} / ${y}`;
    case 'YYYY-MM-DD': return `${y}-${m}-${d}`;
    default: return `${m} | ${d} | ${y}`;
  }
}

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
function getAnchorOffsets(width) {
  return { offsetX: -width / 2, offsetY: 0 };
}

// ─── Load image as promise ─────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Handle CORS if needed
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${src}`));
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
  if (!text) return '';
  if (!transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
  return text;
}

// ─── Parse font size from CSS value ────────────────────────────────────────────
function parseFontSize(sizeStr) {
  if (!sizeStr) return 16;
  const num = parseFloat(sizeStr);
  if (sizeStr.includes('rem')) return num * 16;
  return num;
}

// ─── Measure text width with letter spacing ──────────────────────────────────────
function measureTextWithSpacing(ctx, text, letterSpacing) {
  if (!text) return 0;

  const baseWidth = ctx.measureText(text).width;

  if (!letterSpacing || letterSpacing === 0) {
    return baseWidth;
  }

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

  for (let i = 0; i < text.length; i++) {
    const testText = currentText + text[i];
    if (measureTextFn(ctx, testText, letterSpacingPx) + ellipsisWidth > maxWidth) {
      return i;
    }
    currentText = testText;
  }
  return text.length;
}

// ─── Word wrapping helper ──────────────────────────────────────────────────────
function wrapText(ctx, text, maxWidth, letterSpacingPx, measureTextFn, maxLines = 0) {
  if (!text) return [];

  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0] || '';

  // Handle single long word
  if (currentLine.length > 0 && measureTextFn(ctx, currentLine, letterSpacingPx) > maxWidth) {
    if (maxLines === 1) {
      const truncIndex = getEllipsisIndex(ctx, currentLine, maxWidth, letterSpacingPx, measureTextFn);
      lines.push(currentLine.substring(0, truncIndex) + '...');
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
      if (maxLines > 0 && lines.length + 1 >= maxLines) {
        const truncIndex = getEllipsisIndex(ctx, currentLine, maxWidth, letterSpacingPx, measureTextFn);
        lines.push(currentLine.substring(0, truncIndex) + '...');
        return lines.slice(0, maxLines);
      }
      lines.push(currentLine);
      currentLine = word;

      // Check if the single word is too long
      if (measureTextFn(ctx, currentLine, letterSpacingPx) > maxWidth) {
        if (maxLines > 0 && lines.length + 1 >= maxLines) {
          const truncIndex = getEllipsisIndex(ctx, currentLine, maxWidth, letterSpacingPx, measureTextFn);
          lines.push(currentLine.substring(0, truncIndex) + '...');
          return lines.slice(0, maxLines);
        } else {
          lines.push(currentLine);
        }
      }
    }
  }

  if (currentLine !== '') {
    if (maxLines > 0 && lines.length + 1 > maxLines) {
      const truncIndex = getEllipsisIndex(ctx, currentLine, maxWidth, letterSpacingPx, measureTextFn);
      lines.push(currentLine.substring(0, truncIndex) + '...');
      return lines.slice(0, maxLines);
    } else {
      lines.push(currentLine);
    }
  }

  return lines;
}

// ─── Draw text with letter spacing support and word wrapping ────────────────────
function drawTextWithSpacing(ctx, text, x, y, letterSpacing, maxWidth, lineHeight, maxLines = 0, fontSizePx) {
  if (!text) return;

  const spacingPx = parseLetterSpacingToPx(ctx, letterSpacing);
  const lineHeightPx = (parseFloat(lineHeight) || 1.4) * fontSizePx;
  const originalTextAlign = ctx.textAlign;

  let lines = [text];
  if (maxWidth && maxWidth > 0) {
    ctx.textAlign = 'left';
    lines = wrapText(ctx, text, maxWidth, spacingPx, measureTextWithSpacing, maxLines);
    ctx.textAlign = originalTextAlign;
  }

  let currentY = y;
  const linesToDraw = (maxLines > 0 && lines.length > maxLines) ? lines.slice(0, maxLines) : lines;

  ctx.textAlign = 'left';
  for (const line of linesToDraw) {
    const lineWidth = measureTextWithSpacing(ctx, line, spacingPx);

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
      ctx.fillText(line[i], charX, currentY);
      if (i < line.length - 1) {
        charX += ctx.measureText(line[i]).width + spacingPx;
      }
    }
    currentY += lineHeightPx;
  }

  ctx.textAlign = originalTextAlign;
}

// ─── Build proper Canvas font string with quoted font names ────────────────────
function buildCanvasFont(fontStyle, fontWeight, fontSize, fontFamily) {
  let quotedFamily = fontFamily || 'sans-serif';
  const families = quotedFamily.split(',').map(f => {
    f = f.trim();
    if (f.includes(' ') && !f.startsWith('"') && !f.startsWith("'")) {
      return `"${f}"`;
    }
    return f;
  }).join(', ');

  return `${fontStyle || 'normal'} ${fontWeight || '400'} ${fontSize}px ${families}`;
}

// ─── Resolve ampersand style defaults from couple field ────────────────────────
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
  const minFontSizeScale = 0.6;
  const minNameFontSizePx = initialNameFontSizePx * minFontSizeScale;
  const minAmpFontSizePx = initialAmpFontSizePx * minFontSizeScale;

  const coupleMaxWidth = parseCoordinate(design.width, tagWidth) * dpiScale;
  const letterSpacing = design.letterSpacing || '0';
  const maxLines = design.maxLines || 1;

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = design.alignment === 'center' ? 'center' : design.alignment === 'right' ? 'right' : 'left';

  let currentY = y;
  let currentNameFontSize = initialNameFontSizePx;
  let currentAmpFontSize = initialAmpFontSizePx;
  let linesFit = false;

  while (!linesFit && currentNameFontSize >= minNameFontSizePx - 0.1) {
    const nameFont = buildCanvasFont(design.fontStyle, design.fontWeight, currentNameFontSize, design.fontFamily);
    ctx.font = nameFont;

    const name1SpacingPx = parseLetterSpacingToPx(ctx, letterSpacing);
    let requiredLines = 0;

    if (maxLines === 1) {
      const combinedText = name2 ? `${name1} ${ampChar} ${name2}` : name1;
      const combinedTextWidth = measureTextWithSpacing(ctx, combinedText, name1SpacingPx);
      requiredLines = combinedTextWidth > coupleMaxWidth ? 2 : 1;
    } else if (maxLines === 2) {
      const name1AndAmpText = name2 ? `${name1} ${ampChar}` : name1;
      const name1AndAmpWidth = measureTextWithSpacing(ctx, name1AndAmpText, name1SpacingPx);

      if (name1AndAmpWidth > coupleMaxWidth) requiredLines++;
      requiredLines++;

      if (name2) {
        const name2Width = measureTextWithSpacing(ctx, name2, name1SpacingPx);
        if (name2Width > coupleMaxWidth) requiredLines++;
        requiredLines++;
      }
    }

    if (requiredLines <= maxLines) {
      linesFit = true;
    } else {
      currentNameFontSize -= 1 * dpiScale;
      currentAmpFontSize = (currentNameFontSize / initialNameFontSizePx) * initialAmpFontSizePx;

      if (currentNameFontSize < minNameFontSizePx) {
        currentNameFontSize = minNameFontSizePx;
        currentAmpFontSize = minAmpFontSizePx;
        linesFit = true;
      }
    }
  }

  if (currentNameFontSize < minNameFontSizePx) currentNameFontSize = minNameFontSizePx;
  if (currentAmpFontSize < minAmpFontSizePx) currentAmpFontSize = minAmpFontSizePx;

  const finalNameFont = buildCanvasFont(design.fontStyle, design.fontWeight, currentNameFontSize, design.fontFamily);
  const lineHeightPx = (parseFloat(design.lineHeight) || 1.4) * currentNameFontSize;

  if (maxLines === 1) {
    ctx.font = finalNameFont;
    ctx.fillStyle = design.color || '#333';
    const combinedText = name2 ? `${name1} ${ampChar} ${name2}` : name1;
    drawTextWithSpacing(ctx, combinedText, x, currentY, letterSpacing, coupleMaxWidth, design.lineHeight, 0, currentNameFontSize);
  } else if (maxLines === 2) {
    ctx.font = finalNameFont;
    ctx.fillStyle = design.color || '#333';
    const name1AndAmpText = name2 ? `${name1} ${ampChar}` : name1;
    drawTextWithSpacing(ctx, name1AndAmpText, x, currentY, letterSpacing, coupleMaxWidth, design.lineHeight, 0, currentNameFontSize);

    if (name2) {
      currentY += lineHeightPx;
      ctx.font = finalNameFont;
      ctx.fillStyle = design.color || '#333';
      drawTextWithSpacing(ctx, name2, x, currentY, letterSpacing, coupleMaxWidth, design.lineHeight, 0, currentNameFontSize);
    }
  }

  ctx.restore();
}

// ─── Build canvas tag asynchronously ───────────────────────────────────────────
async function buildTagCanvas(design, values, photoDataURL) {
  try {
    console.log('🎨 buildTagCanvas: Starting for design:', design.name);

    const { tagDimensions, tagImage, fields } = design;
    const W = tagDimensions.width;
    const H = tagDimensions.height;

    // Wait for fonts to be ready
    if (document.fonts) {
      await document.fonts.ready;
    }

    // Collect and ensure fonts
    const fontFamilies = [];
    if (fields.name) fontFamilies.push(fields.name.fontFamily);
    if (fields.date) fontFamilies.push(fields.date.fontFamily);
    if (fields.tagline) fontFamilies.push(fields.tagline.fontFamily);

    await ensureFontsForCanvas(fontFamilies);

    // Create canvas at 2x DPI for sharp rendering
    const DPI_SCALE = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * DPI_SCALE;
    canvas.height = H * DPI_SCALE;

    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    if (!ctx) {
      throw new Error('Could not get 2D context from canvas');
    }

    // Enable image smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw background
    try {
      if (tagImage) {
        const bgImg = await getCachedImage(tagImage);
        if (bgImg) {
          ctx.drawImage(bgImg, 0, 0, W * DPI_SCALE, H * DPI_SCALE);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, W * DPI_SCALE, H * DPI_SCALE);
        }
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W * DPI_SCALE, H * DPI_SCALE);
      }
    } catch (e) {
      console.warn('Could not load tag background:', e);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W * DPI_SCALE, H * DPI_SCALE);
    }

    // Draw photo
    const p = fields.photo;
    if (p && p.enabled && photoDataURL) {
      try {
        // Load photo image
        const photoImg = await getCachedImage(photoDataURL);

        if (photoImg) {
          const photoX = (parseCoordinate(p.x, W) + getAnchorOffsets(p.width).offsetX) * DPI_SCALE;
          const photoY = parseCoordinate(p.y, H) * DPI_SCALE;
          const photoW = p.width * DPI_SCALE;
          const photoH = p.height * DPI_SCALE;

          // Create clipping path
          ctx.save();
          ctx.beginPath();

          if (p.shape === 'circle') {
            const centerX = photoX + photoW / 2;
            const centerY = photoY + photoH / 2;
            const radius = Math.min(photoW, photoH) / 2;
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          } else if (p.shape === 'oval' || p.shape === 'ellipse') {
            const centerX = photoX + photoW / 2;
            const centerY = photoY + photoH / 2;
            ctx.ellipse(centerX, centerY, photoW / 2, photoH / 2, 0, 0, Math.PI * 2);
          } else {
            // Rectangle with rounded corners
            const radius = (p.shape === 'square' ? 4 : 8) * DPI_SCALE;
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
            ctx.closePath();
          }

          ctx.clip();

          // Calculate cover crop
          const imgW = photoImg.width;
          const imgH = photoImg.height;
          const slotAspect = photoW / photoH;
          const imgAspect = imgW / imgH;

          let drawW, drawH, drawX, drawY;
          if (imgAspect > slotAspect) {
            drawH = photoH;
            drawW = drawH * imgAspect;
            drawX = photoX + (photoW - drawW) / 2;
            drawY = photoY;
          } else {
            drawW = photoW;
            drawH = drawW / imgAspect;
            drawX = photoX;
            drawY = photoY + (photoH - drawH) / 2;
          }

          ctx.drawImage(photoImg, drawX, drawY, drawW, drawH);
          ctx.restore();

          // Draw border if needed
          if (p.borderWidth > 0) {
            ctx.save();
            ctx.strokeStyle = p.borderColor || '#c4956a';
            ctx.lineWidth = (p.borderWidth || 1) * DPI_SCALE;
            ctx.beginPath();

            if (p.shape === 'circle') {
              const centerX = photoX + photoW / 2;
              const centerY = photoY + photoH / 2;
              const radius = Math.min(photoW, photoH) / 2;
              ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            } else if (p.shape === 'oval' || p.shape === 'ellipse') {
              const centerX = photoX + photoW / 2;
              const centerY = photoY + photoH / 2;
              ctx.ellipse(centerX, centerY, photoW / 2, photoH / 2, 0, 0, Math.PI * 2);
            } else {
              const radius = (p.shape === 'square' ? 4 : 8) * DPI_SCALE;
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
              ctx.closePath();
            }

            ctx.stroke();
            ctx.restore();
          }
        }
      } catch (e) {
        console.warn('Could not render photo:', e);
      }
    }

    // Draw text fields
    const textFields = ['name', 'date', 'tagline'];
    for (const key of textFields) {
      const f = fields[key];
      
      if (!f) continue;
      if ((key === 'date' || key === 'tagline') && f.enabled === false) continue;

      const textX = parseCoordinate(f.x, W) * DPI_SCALE;
      const textY = parseCoordinate(f.y, H) * DPI_SCALE;

      if (key === 'name') {
        let n1 = values.name1 || '';
        let n2 = values.name2 || '';

        n1 = applyTextTransform(n1, f.textTransform);
        n2 = applyTextTransform(n2, f.textTransform);

        const amp = resolveAmpDefaults(f);
        const ampChar = n2 ? amp.ampCharacter : '';

        await drawStyledCoupleText(ctx, n1, n2, ampChar, f, textX, textY, DPI_SCALE, W);
      } else if (key === 'date') {
        let dateText = formatDate(values.date, f.format);
        dateText = applyTextTransform(dateText, f.textTransform);

        ctx.save();
        const currentFontSizePx = parseFontSize(f.fontSize) * DPI_SCALE;
        ctx.font = buildCanvasFont(f.fontStyle, f.fontWeight, currentFontSizePx, f.fontFamily);
        ctx.fillStyle = f.color || '#333';
        ctx.textAlign = f.alignment === 'center' ? 'center' : f.alignment === 'right' ? 'right' : 'left';
        ctx.textBaseline = 'top';

        const dateMaxWidth = parseCoordinate(f.width, W) * DPI_SCALE;
        drawTextWithSpacing(ctx, dateText, textX, textY, f.letterSpacing, dateMaxWidth, f.lineHeight, f.maxLines, currentFontSizePx);
        ctx.restore();
      } else if (key === 'tagline') {
        let taglineText = values.tagline || f.defaultValue || '';
        taglineText = applyTextTransform(taglineText, f.textTransform);

        if (taglineText) {
          ctx.save();
          const currentFontSizePx = parseFontSize(f.fontSize) * DPI_SCALE;
          ctx.font = buildCanvasFont(f.fontStyle, f.fontWeight, currentFontSizePx, f.fontFamily);
          ctx.fillStyle = f.color || '#333';
          ctx.textAlign = f.alignment === 'center' ? 'center' : f.alignment === 'right' ? 'right' : 'left';
          ctx.textBaseline = 'top';

          const taglineMaxWidth = parseCoordinate(f.width, W) * DPI_SCALE;
          drawTextWithSpacing(ctx, taglineText, textX, textY, f.letterSpacing, taglineMaxWidth, f.lineHeight, f.maxLines, currentFontSizePx);
          ctx.restore();
        }
      }
    }

    console.log('✅ buildTagCanvas: Complete');
    return canvas;
  } catch (err) {
    console.error('❌ FATAL ERROR in buildTagCanvas:', err);
    throw err;
  }
}

// ─── Update canvas with new values ────────────────────────────────────────────
async function updateTagCanvas(canvas, design, values, photoDataURL) {
  const newCanvas = await buildTagCanvas(design, values, photoDataURL);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(newCanvas, 0, 0);
}

// ─── Build tag element for DOM display ─────────────────────────────────────────
async function buildTagElement(design, values, photoDataURL) {
  try {
    console.log('🏗️ buildTagElement: Starting...');
    const canvas = await buildTagCanvas(design, values, photoDataURL);

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

    console.log('✅ buildTagElement: Complete');
    return wrapper;
  } catch (err) {
    console.error('❌ FATAL ERROR in buildTagElement:', err);
    throw err;
  }
}

async function updateTagElement(root, design, values, photoDataURL) {
  const canvas = root.querySelector('.tag-canvas');
  if (canvas) {
    const newCanvas = await buildTagCanvas(design, values, photoDataURL);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(newCanvas, 0, 0);
  }
}

// ─── Font loading ──────────────────────────────────────────────────────────────
function getFontUrlForFamily(fontFamily) {
  const fontMap = {
    'Bebas Neue': 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
    'Barlow Condensed': 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&display=swap',
    'Gilda Display': 'https://fonts.googleapis.com/css2?family=Gilda+Display&display=swap',
    'Cinzel': 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800;900&display=swap',
    'Lora': 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&display=swap',
    'Literata': 'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400&display=swap',
    'Pinyon Script': 'https://fonts.googleapis.com/css2?family=Pinyon+Script&display=swap',
    'Great Vibes': 'https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap',
    'Inria Serif': 'https://fonts.googleapis.com/css2?family=Inria+Serif:ital,wght@0,400;0,700;1,400&display=swap',
    'Petit Formal Script': 'https://fonts.googleapis.com/css2?family=Petit+Formal+Script&display=swap',
    'Source Serif Pro': 'https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,600;0,700;1,400&display=swap',
    'Tangerine': 'https://fonts.googleapis.com/css2?family=Tangerine:wght@400;700&display=swap',
    'Roboto Condensed': 'https://fonts.googleapis.com/css2?family=Roboto+Condensed:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap',
    'Parisienne': 'https://fonts.googleapis.com/css2?family=Parisienne&display=swap',
    'Montserrat': 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&display=swap',
    'Alegreya': 'https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;0,600;1,400&display=swap',
    'Open Sans': 'https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&display=swap',
    'Srisakdi': 'https://fonts.googleapis.com/css2?family=Srisakdi:wght@400;700&display=swap',
    'Cormorant Garamond': 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap',
    'Glass Antiqua': 'https://fonts.googleapis.com/css2?family=Glass+Antiqua&display=swap',
    'Noto Sans JP': 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100;300;400;500;700&display=swap',
    'Pacifico': 'https://fonts.googleapis.com/css2?family=Pacifico&display=swap',
    'Pompiere': 'https://fonts.googleapis.com/css2?family=Pompiere&display=swap'
  };

  return fontMap[fontFamily] || null;
}

const loadedFonts = new Set();
const loadingFonts = new Map();

async function loadFontFamily(fontFamily) {
  if (!fontFamily) return;

  const mainFont = fontFamily.split(',')[0].trim().replace(/["']/g, '');
  if (loadedFonts.has(mainFont)) return;
  if (loadingFonts.has(mainFont)) return loadingFonts.get(mainFont);

  const loadPromise = (async () => {
    try {
      const fontUrl = getFontUrlForFamily(mainFont);
      if (fontUrl) {
        const fontId = `font-${mainFont.replace(/\s+/g, '-').toLowerCase()}`;
        if (!document.getElementById(fontId)) {
          const link = document.createElement('link');
          link.id = fontId;
          link.rel = 'stylesheet';
          link.href = fontUrl;
          document.head.appendChild(link);

          await new Promise((resolve) => {
            link.onload = resolve;
            link.onerror = resolve;
          });
        }

        if (document.fonts) {
          await document.fonts.load(`16px "${mainFont}"`);
        }
      }
      loadedFonts.add(mainFont);
    } catch (err) {
      console.warn(`Failed to load font: ${mainFont}`, err);
    }
  })();

  loadingFonts.set(mainFont, loadPromise);
  await loadPromise;
  loadingFonts.delete(mainFont);
}

// Export for use by both pages
window.TagRenderer = {
  buildTagElement,
  updateTagElement,
  buildTagCanvas,
  updateTagCanvas,
  formatDate,
  defaultDateForFormat,
  loadImage,
  getFontUrlForFamily,
  loadFontFamily,
  clearImageCache
};