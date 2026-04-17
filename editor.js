// ================================================================
// SnapShot Pro — Screenshot Editor
// ================================================================

'use strict';

const $ = (id) => document.getElementById(id);

const canvas = $('editor-canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = $('canvas-wrap');
const textEditor = $('text-editor');
const imageInput = $('image-input');
const loadInput = $('load-input');
const imageHelper = $('image-helper');
const gatedControls = Array.from(document.querySelectorAll('[data-requires-image]'));
const toolButtons = Array.from(document.querySelectorAll('.dock-tool'));
const inspectorPanels = Array.from(document.querySelectorAll('.inspector-panel'));
const colorButtons = Array.from(document.querySelectorAll('.color-chip'));
const penModeButtons = Array.from(document.querySelectorAll('[data-pen-mode]'));
const shapeKindButtons = Array.from(document.querySelectorAll('[data-shape-kind]'));
const shapeStyleButtons = Array.from(document.querySelectorAll('[data-shape-style]'));
const stampKindButtons = Array.from(document.querySelectorAll('[data-stamp-kind]'));
const textStyleButtons = Array.from(document.querySelectorAll('[data-text-style]'));
const textAlignButtons = Array.from(document.querySelectorAll('[data-text-align]'));

const sharedColorGroup = $('shared-color-group');
const sharedRangeGroup = $('shared-range-group');
const contextRange = $('context-range');
const rangeLabel = $('range-label');
const rangeValue = $('range-value');
const btnAddImage = $('btn-add-image');

const TOOL_LABELS = {
  pen: 'Pen',
  line: 'Line',
  highlight: 'Highlight',
  mask: 'Mask',
  shape: 'Shape',
  stamp: 'Stamp',
  text: 'Text',
  image: 'Image'
};

const TOOL_HINTS = {
  pen: 'Pen tool selected. Draw directly on the screenshot.',
  highlight: 'Highlight tool selected. Drag over the area you want to spotlight.',
  mask: 'Mask tool selected. Drag over private content to pixelate it.',
  shape: 'Shape tool selected. Drag to place the active shape.',
  stamp: 'Stamp tool selected. Click to place the active stamp, then drag it to reposition it.',
  text: 'Text tool selected. Click anywhere on the screenshot to type.',
  image: 'Image tool selected. Use Choose Image to place an overlay.'
};

const toolState = {
  color: '#38bdf8',
  penMode: 'free',
  shapeKind: 'rect',
  shapeStyle: 'stroke',
  stampKind: 'arrow',
  sizes: {
    pen: 6,
    highlight: 16,
    mask: 10,
    shape: 4,
    stamp: 72,
    text: 42
  },
  text: {
    bold: true,
    italic: false,
    underline: false,
    align: 'left'
  }
};

let draft = null;
let baseImage = null;
let annotations = [];
let undoStack = [];
let redoStack = [];
let activeDraft = null;
let activeTool = 'pen';
let drawing = false;
let selectedAnnotationId = null;
let imageInteraction = null;
let stampInteraction = null;
let textCommitTimer = null;
let annotationIdSeed = 0;
const imageCache = new Map();

const IMAGE_MIN_SIZE = 36;
const IMAGE_HANDLE_SIZE = 12;
const IMAGE_HIT_PADDING = 12;
const STAMP_HIT_PADDING = 14;

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function createTimestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function draftStorageKey(id) {
  return `editorDraft:${id}`;
}

function queryDraftId() {
  return new URLSearchParams(window.location.search).get('draft');
}

function setStatus(message) {
  $('status-text').textContent = message;
}

function typeLabel(type) {
  switch (type) {
    case 'visible':
      return 'Visible Capture';
    case 'fullPage':
      return 'Full-Page Capture';
    case 'area':
      return 'Area Capture';
    case 'edited':
      return 'Edited Capture';
    case 'loaded':
      return 'Loaded File';
    default:
      return 'Capture';
  }
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (data) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(data);
      }
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function downloadUrl(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

async function loadDraft() {
  const draftId = queryDraftId();
  if (!draftId) {
    return null;
  }

  const sessionKey = `snapshot-editor:${draftId}`;
  const cached = sessionStorage.getItem(sessionKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const storageKey = draftStorageKey(draftId);
  const data = await storageGet(storageKey);
  const storedDraft = data[storageKey] || null;

  if (!storedDraft) {
    return null;
  }

  sessionStorage.setItem(sessionKey, JSON.stringify(storedDraft));
  await storageRemove(storageKey);
  return storedDraft;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the selected screenshot.'));
    image.src = dataUrl;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read that image file.'));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to prepare the screenshot export.'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to prepare the screenshot export.'));
        return;
      }

      resolve(blob);
    }, type);
  });
}

async function copyBlobToClipboard(blob) {
  let directCopyError = null;

  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Clipboard image copy is not available in this browser context.');
    }

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type || 'image/png']: blob
      })
    ]);
    return;
  } catch (error) {
    directCopyError = error;
  }

  const response = await sendMsg({ type: 'copyImageBlobToClipboard', blob });
  if (!response?.success) {
    throw new Error(response?.error || directCopyError?.message || 'Clipboard image copy failed.');
  }
}

async function copyDataUrlToClipboard(dataUrl) {
  let directCopyError = null;

  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Clipboard image copy is not available in this browser context.');
    }

    const response = await fetch(dataUrl);
    const blob = await response.blob();

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type || 'image/png']: blob
      })
    ]);
    return;
  } catch (error) {
    directCopyError = error;
  }

  const response = await sendMsg({ type: 'copyImageToClipboard', dataUrl });
  if (!response?.success) {
    throw new Error(response?.error || directCopyError?.message || 'Clipboard image copy failed.');
  }
}

function pointFromEvent(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) * canvas.width) / bounds.width,
    y: ((event.clientY - bounds.top) * canvas.height) / bounds.height
  };
}

function pointToViewport(point) {
  const bounds = canvas.getBoundingClientRect();
  const wrapBounds = canvasWrap.getBoundingClientRect();
  return {
    x: (bounds.left - wrapBounds.left) + ((point.x / canvas.width) * bounds.width),
    y: (bounds.top - wrapBounds.top) + ((point.y / canvas.height) * bounds.height),
    scale: bounds.width / canvas.width
  };
}

function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y)
  };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((char) => char + char).join('')
    : clean;

  const int = Number.parseInt(value, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function cloneAnnotations(source = annotations) {
  if (typeof structuredClone === 'function') {
    return structuredClone(source);
  }

  return JSON.parse(JSON.stringify(source));
}

function createAnnotationId() {
  annotationIdSeed += 1;
  return `annotation-${Date.now().toString(36)}-${annotationIdSeed}`;
}

function ensureAnnotationIds(list) {
  return list.map((annotation) => (
    annotation.id
      ? annotation
      : { ...annotation, id: createAnnotationId() }
  ));
}

function getAnnotationById(annotationId) {
  return annotations.find((annotation) => annotation.id === annotationId) || null;
}

function getSelectedImageAnnotation() {
  const annotation = getAnnotationById(selectedAnnotationId);
  return annotation?.tool === 'image' ? annotation : null;
}

function getSelectedStampAnnotation() {
  const annotation = getAnnotationById(selectedAnnotationId);
  return annotation?.tool === 'stamp' ? annotation : null;
}

function syncSelectedAnnotation() {
  const annotation = getAnnotationById(selectedAnnotationId);

  if (selectedAnnotationId && (!annotation || !['image', 'stamp'].includes(annotation.tool))) {
    selectedAnnotationId = null;
  }
}

function setControlsEnabled(enabled) {
  gatedControls.forEach((control) => {
    control.disabled = !enabled;
  });
}

function getRangeConfig() {
  switch (activeTool) {
    case 'pen':
      return {
        label: toolState.penMode === 'free' ? 'Range' : 'Stroke',
        min: 2,
        max: 24,
        step: 1,
        value: toolState.sizes.pen,
        display: `${toolState.sizes.pen}`
      };
    case 'highlight':
      return {
        label: 'Range',
        min: 6,
        max: 36,
        step: 1,
        value: toolState.sizes.highlight,
        display: `${toolState.sizes.highlight}`
      };
    case 'mask':
      return {
        label: 'Range',
        min: 4,
        max: 24,
        step: 1,
        value: toolState.sizes.mask,
        display: `${Math.max(8, Math.round(toolState.sizes.mask * 2))}`
      };
    case 'shape':
      return {
        label: 'Stroke',
        min: 1,
        max: 18,
        step: 1,
        value: toolState.sizes.shape,
        display: `${toolState.sizes.shape}`
      };
    case 'stamp':
      return {
        label: 'Range',
        min: 32,
        max: 180,
        step: 2,
        value: toolState.sizes.stamp,
        display: `${toolState.sizes.stamp}`
      };
    case 'text':
      return {
        label: 'Text size',
        min: 18,
        max: 96,
        step: 2,
        value: toolState.sizes.text,
        display: `${toolState.sizes.text}`
      };
    default:
      return null;
  }
}

function updateCaptureMeta() {
  $('capture-pill').textContent = typeLabel(draft?.type);
  $('capture-size').textContent = baseImage
    ? `${canvas.width} x ${canvas.height} px`
    : '0 x 0 px';
}

function updateHistoryUi() {
  $('btn-undo').disabled = !baseImage || undoStack.length === 0;
  $('btn-redo').disabled = !baseImage || redoStack.length === 0;
  $('btn-clear').disabled = !baseImage || annotations.length === 0;
  $('btn-copy').disabled = !baseImage;
  $('btn-download').disabled = !baseImage;
}

function updateTextEditorStyles() {
  if (textEditor.hidden) {
    return;
  }

  const scale = Number(textEditor.dataset.scale || 1);
  textEditor.style.fontWeight = toolState.text.bold ? '700' : '500';
  textEditor.style.fontStyle = toolState.text.italic ? 'italic' : 'normal';
  textEditor.style.textDecoration = toolState.text.underline ? 'underline' : 'none';
  textEditor.style.textAlign = toolState.text.align;
  textEditor.style.color = toolState.color;
  textEditor.style.fontSize = `${Math.max(14, toolState.sizes.text * scale)}px`;
}

function updateContextUi() {
  inspectorPanels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === activeTool);
  });

  toolButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tool === activeTool);
  });

  penModeButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.penMode === toolState.penMode);
  });

  shapeKindButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.shapeKind === toolState.shapeKind);
  });

  shapeStyleButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.shapeStyle === toolState.shapeStyle);
  });

  stampKindButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.stampKind === toolState.stampKind);
  });

  textStyleButtons.forEach((button) => {
    button.classList.toggle('is-active', !!toolState.text[button.dataset.textStyle]);
  });

  textAlignButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.textAlign === toolState.text.align);
  });

  colorButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.color === toolState.color);
  });

  imageHelper.textContent = getSelectedImageAnnotation()
    ? 'Drag the active image to move it, or drag a corner handle to resize it. Choose Image to drop another overlay.'
    : 'Choose a PNG or JPG, drop it into the center automatically, then drag or resize it from the corner handles.';

  const showSharedControls = activeTool !== 'image';
  sharedColorGroup.hidden = !showSharedControls;
  sharedRangeGroup.hidden = !showSharedControls;

  const rangeConfig = getRangeConfig();
  if (showSharedControls && rangeConfig) {
    rangeLabel.textContent = rangeConfig.label;
    contextRange.min = String(rangeConfig.min);
    contextRange.max = String(rangeConfig.max);
    contextRange.step = String(rangeConfig.step);
    contextRange.value = String(rangeConfig.value);
    rangeValue.textContent = rangeConfig.display;
  }

  updateTextEditorStyles();
}

function cacheImage(dataUrl) {
  if (imageCache.has(dataUrl)) {
    return imageCache.get(dataUrl);
  }

  let resolveLoaded;
  let rejectLoaded;
  const loaded = new Promise((resolve, reject) => {
    resolveLoaded = resolve;
    rejectLoaded = reject;
  });

  const image = new Image();
  image.onload = () => {
    resolveLoaded(image);
    renderCanvas();
  };
  image.onerror = () => {
    imageCache.delete(dataUrl);
    rejectLoaded(new Error('Unable to load the selected overlay image.'));
  };
  image.src = dataUrl;

  const entry = { image, loaded };
  imageCache.set(dataUrl, entry);
  return entry;
}

async function ensureOverlayImagesReady() {
  const sources = Array.from(new Set(
    annotations
      .filter((annotation) => annotation.tool === 'image')
      .map((annotation) => annotation.dataUrl)
  ));

  await Promise.all(sources.map((source) => cacheImage(source).loaded));
}

function getImageHandles(annotation) {
  return [
    { name: 'nw', x: annotation.x, y: annotation.y, cursor: 'nwse-resize' },
    { name: 'ne', x: annotation.x + annotation.w, y: annotation.y, cursor: 'nesw-resize' },
    { name: 'se', x: annotation.x + annotation.w, y: annotation.y + annotation.h, cursor: 'nwse-resize' },
    { name: 'sw', x: annotation.x, y: annotation.y + annotation.h, cursor: 'nesw-resize' }
  ];
}

function hitTestImageHandle(point, annotation) {
  return getImageHandles(annotation).find((handle) => (
    Math.abs(point.x - handle.x) <= IMAGE_HIT_PADDING &&
    Math.abs(point.y - handle.y) <= IMAGE_HIT_PADDING
  )) || null;
}

function isPointInsideImage(point, annotation) {
  return (
    point.x >= annotation.x &&
    point.x <= annotation.x + annotation.w &&
    point.y >= annotation.y &&
    point.y <= annotation.y + annotation.h
  );
}

function getImageHitTarget(point) {
  const selectedImage = getSelectedImageAnnotation();
  if (selectedImage) {
    const handle = hitTestImageHandle(point, selectedImage);
    if (handle) {
      return { annotation: selectedImage, type: 'resize', handle };
    }
  }

  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (annotation.tool !== 'image') {
      continue;
    }

    if (isPointInsideImage(point, annotation)) {
      return { annotation, type: 'move' };
    }
  }

  return null;
}

function getStampBounds(annotation, padding = 0) {
  const half = annotation.size / 2;
  let width = annotation.size;
  let height = annotation.size;
  let left = annotation.x - half;
  let top = annotation.y - half;

  switch (annotation.kind) {
    case 'arrow':
      width = annotation.size * 1.02;
      height = annotation.size * 0.72;
      left = annotation.x - (width / 2);
      top = annotation.y - (height / 2);
      break;
    case 'bubble':
      width = annotation.size * 1.12;
      height = annotation.size * 0.92;
      left = annotation.x - (width / 2);
      top = annotation.y - (height * 0.54);
      break;
    case 'location':
      width = annotation.size * 0.92;
      height = annotation.size * 1.28;
      left = annotation.x - (width / 2);
      top = annotation.y - (annotation.size * 0.72);
      break;
    case 'heart':
      width = annotation.size;
      height = annotation.size * 1.08;
      left = annotation.x - (width / 2);
      top = annotation.y - (annotation.size * 0.55);
      break;
    default:
      break;
  }

  return {
    x: left - padding,
    y: top - padding,
    w: width + (padding * 2),
    h: height + (padding * 2)
  };
}

function isPointInsideBounds(point, bounds) {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.w &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.h
  );
}

function getStampHitTarget(point) {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (annotation.tool !== 'stamp') {
      continue;
    }

    if (isPointInsideBounds(point, getStampBounds(annotation, STAMP_HIT_PADDING))) {
      return { annotation, type: 'move' };
    }
  }

  return null;
}

function getDefaultCursor() {
  if (!baseImage) {
    return 'default';
  }

  if (activeTool === 'text') {
    return 'text';
  }

  if (activeTool === 'image') {
    return getSelectedImageAnnotation() ? 'move' : 'default';
  }

  if (activeTool === 'stamp') {
    return getSelectedStampAnnotation() ? 'move' : 'copy';
  }

  return 'crosshair';
}

function updateCanvasCursor(event = null) {
  if (!baseImage) {
    canvas.style.cursor = 'default';
    return;
  }

  if (imageInteraction) {
    canvas.style.cursor = imageInteraction.type === 'resize'
      ? imageInteraction.handle.cursor
      : 'move';
    return;
  }

  if (stampInteraction) {
    canvas.style.cursor = 'move';
    return;
  }

  if (activeTool === 'image' && event) {
    const point = pointFromEvent(event);
    const hit = getImageHitTarget(point);
    if (hit?.type === 'resize') {
      canvas.style.cursor = hit.handle.cursor;
      return;
    }
    if (hit?.type === 'move') {
      canvas.style.cursor = 'move';
      return;
    }
  }

  if (activeTool === 'stamp' && event) {
    const point = pointFromEvent(event);
    if (getStampHitTarget(point)) {
      canvas.style.cursor = 'move';
      return;
    }
  }

  canvas.style.cursor = getDefaultCursor();
}

function syncUi() {
  syncSelectedAnnotation();
  updateCaptureMeta();
  updateHistoryUi();
  updateContextUi();
  updateCanvasCursor();
}

function updateCanvasVisibility(hasImage) {
  $('canvas-shell').hidden = !hasImage;
  $('empty-state').hidden = hasImage;
}

function setActiveTool(tool) {
  activeTool = tool;
  syncUi();
  renderCanvas();
}

function commitAnnotations(nextAnnotations, options = {}) {
  const {
    recordHistory = false,
    historySnapshot = annotations,
    selectedId = selectedAnnotationId
  } = options;

  if (recordHistory) {
    undoStack.push(cloneAnnotations(historySnapshot));
    redoStack = [];
  }

  annotations = ensureAnnotationIds(nextAnnotations);
  selectedAnnotationId = selectedId;
  syncUi();
  renderCanvas();
}

function pushAnnotation(annotation) {
  const nextAnnotation = annotation.id
    ? annotation
    : { ...annotation, id: createAnnotationId() };

  commitAnnotations(
    [...annotations, nextAnnotation],
    {
      recordHistory: true,
      selectedId: ['image', 'stamp'].includes(nextAnnotation.tool) ? nextAnnotation.id : null
    }
  );

  return nextAnnotation;
}

function buildShapePath(kind, x, y, w, h) {
  ctx.beginPath();

  switch (kind) {
    case 'circle':
      ctx.ellipse(x + (w / 2), y + (h / 2), w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(x + (w / 2), y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    case 'rect':
    default:
      ctx.rect(x, y, w, h);
      break;
  }
}

function drawSelectedImageOverlay(annotation) {
  ctx.save();
  ctx.strokeStyle = '#19b4ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
  ctx.setLineDash([]);

  getImageHandles(annotation).forEach((handle) => {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#19b4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(
      handle.x - (IMAGE_HANDLE_SIZE / 2),
      handle.y - (IMAGE_HANDLE_SIZE / 2),
      IMAGE_HANDLE_SIZE,
      IMAGE_HANDLE_SIZE
    );
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
}

function drawSelectedStampOverlay(annotation) {
  const bounds = getStampBounds(annotation, 8);

  ctx.save();
  ctx.strokeStyle = '#19b4ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.restore();
}

function drawFreehand(annotation) {
  if (!annotation.points?.length) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = annotation.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (annotation.points.length === 1) {
    const point = annotation.points[0];
    ctx.beginPath();
    ctx.arc(point.x, point.y, annotation.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(annotation.points[0].x, annotation.points[0].y);

  for (let i = 1; i < annotation.points.length; i += 1) {
    ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
  }

  ctx.stroke();
  ctx.restore();
}

function drawLine(annotation) {
  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.size;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(annotation.x1, annotation.y1);
  ctx.lineTo(annotation.x2, annotation.y2);
  ctx.stroke();
  ctx.restore();
}

function drawShape(annotation) {
  ctx.save();
  buildShapePath(annotation.kind, annotation.x, annotation.y, annotation.w, annotation.h);

  if (annotation.style === 'fill') {
    ctx.fillStyle = hexToRgba(annotation.color, 0.26);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, annotation.size * 0.55);
    ctx.strokeStyle = annotation.color;
    ctx.stroke();
  } else {
    ctx.lineWidth = annotation.size;
    ctx.strokeStyle = annotation.color;
    ctx.stroke();
  }

  ctx.restore();
}

function drawHighlight(annotation) {
  ctx.save();
  ctx.fillStyle = hexToRgba(annotation.color, 0.18);
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = Math.max(1.5, annotation.size * 0.45);
  ctx.fillRect(annotation.x, annotation.y, annotation.w, annotation.h);
  ctx.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
  ctx.restore();
}

function pixelateAnnotation(annotation) {
  const x = Math.round(clamp(annotation.x, 0, canvas.width));
  const y = Math.round(clamp(annotation.y, 0, canvas.height));
  const w = Math.round(clamp(annotation.w, 0, canvas.width - x));
  const h = Math.round(clamp(annotation.h, 0, canvas.height - y));

  if (!w || !h) {
    return;
  }

  const blockSize = Math.max(8, Math.round(annotation.size * 2));
  const imageData = ctx.getImageData(x, y, w, h);
  const data = imageData.data;

  for (let by = 0; by < h; by += blockSize) {
    for (let bx = 0; bx < w; bx += blockSize) {
      const sampleX = Math.min(w - 1, bx + Math.floor(blockSize / 2));
      const sampleY = Math.min(h - 1, by + Math.floor(blockSize / 2));
      const sampleIndex = (sampleY * w + sampleX) * 4;
      const r = data[sampleIndex];
      const g = data[sampleIndex + 1];
      const b = data[sampleIndex + 2];
      const a = data[sampleIndex + 3];

      for (let py = by; py < Math.min(h, by + blockSize); py += 1) {
        for (let px = bx; px < Math.min(w, bx + blockSize); px += 1) {
          const index = (py * w + px) * 4;
          data[index] = r;
          data[index + 1] = g;
          data[index + 2] = b;
          data[index + 3] = a;
        }
      }
    }
  }

  ctx.putImageData(imageData, x, y);

  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = Math.max(1.5, annotation.size * 0.45);
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawMaskPreview(annotation) {
  ctx.save();
  ctx.fillStyle = hexToRgba(annotation.color, 0.12);
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = Math.max(1.5, annotation.size * 0.45);
  ctx.setLineDash([10, 8]);
  ctx.fillRect(annotation.x, annotation.y, annotation.w, annotation.h);
  ctx.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
  ctx.restore();
}

function drawStamp(annotation) {
  const { x, y, size, color, kind } = annotation;
  const half = size / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = hexToRgba(color, 0.22);
  ctx.lineWidth = Math.max(2, size * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(x - half, y);
      ctx.lineTo(x + (half * 0.42), y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x + half, y);
      ctx.lineTo(x + (half * 0.22), y - (half * 0.35));
      ctx.lineTo(x + (half * 0.22), y + (half * 0.35));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      break;
    }
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const angle = (-Math.PI / 2) + (i * Math.PI / 5);
        const radius = i % 2 === 0 ? half : half * 0.45;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'polygon': {
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 6) + (i * Math.PI / 3);
        const px = x + Math.cos(angle) * half;
        const py = y + Math.sin(angle) * half;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'location': {
      const radius = half * 0.46;
      ctx.beginPath();
      ctx.moveTo(x, y + half);
      ctx.bezierCurveTo(
        x + half * 0.72,
        y + half * 0.18,
        x + half * 0.74,
        y - half * 0.72,
        x,
        y - half * 0.72
      );
      ctx.bezierCurveTo(
        x - half * 0.74,
        y - half * 0.72,
        x - half * 0.72,
        y + half * 0.18,
        x,
        y + half
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y - half * 0.26, radius * 0.52, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(x, y + half * 0.65);
      ctx.bezierCurveTo(x + half, y + half * 0.1, x + half, y - half * 0.55, x, y - half * 0.18);
      ctx.bezierCurveTo(x - half, y - half * 0.55, x - half, y + half * 0.1, x, y + half * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'bubble':
    default: {
      const w = size * 1.1;
      const h = size * 0.72;
      const left = x - (w / 2);
      const top = y - (h / 2);
      const radius = Math.min(18, size * 0.18);
      ctx.beginPath();
      ctx.moveTo(left + radius, top);
      ctx.lineTo(left + w - radius, top);
      ctx.quadraticCurveTo(left + w, top, left + w, top + radius);
      ctx.lineTo(left + w, top + h - radius);
      ctx.quadraticCurveTo(left + w, top + h, left + w - radius, top + h);
      ctx.lineTo(x + 10, top + h);
      ctx.lineTo(x - 2, top + h + 14);
      ctx.lineTo(x - 2, top + h);
      ctx.lineTo(left + radius, top + h);
      ctx.quadraticCurveTo(left, top + h, left, top + h - radius);
      ctx.lineTo(left, top + radius);
      ctx.quadraticCurveTo(left, top, left + radius, top);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

function drawText(annotation) {
  const lines = annotation.text.split('\n');
  const lineHeight = annotation.fontSize * 1.24;

  ctx.save();
  ctx.fillStyle = annotation.color;
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = Math.max(1.2, annotation.fontSize * 0.06);
  ctx.font = `${annotation.italic ? 'italic ' : ''}${annotation.bold ? '700 ' : '500 '}${annotation.fontSize}px "DM Sans", sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = annotation.align;

  lines.forEach((line, index) => {
    const y = annotation.y + (index * lineHeight);
    ctx.fillText(line, annotation.x, y);

    if (annotation.underline) {
      const width = ctx.measureText(line).width;
      let startX = annotation.x;

      if (annotation.align === 'center') {
        startX -= width / 2;
      } else if (annotation.align === 'right') {
        startX -= width;
      }

      const underlineY = y + annotation.fontSize + 4;
      ctx.beginPath();
      ctx.moveTo(startX, underlineY);
      ctx.lineTo(startX + width, underlineY);
      ctx.stroke();
    }
  });

  ctx.restore();
}

function drawImageAnnotation(annotation) {
  const { image } = cacheImage(annotation.dataUrl);
  if (!image.complete) {
    return;
  }

  ctx.drawImage(image, annotation.x, annotation.y, annotation.w, annotation.h);
}

function drawAnnotation(annotation, isPreview = false) {
  if (!annotation) {
    return;
  }

  switch (annotation.tool) {
    case 'pen':
      drawFreehand(annotation);
      break;
    case 'line':
      drawLine(annotation);
      break;
    case 'shape':
      drawShape(annotation);
      break;
    case 'highlight':
      drawHighlight(annotation);
      break;
    case 'mask':
      if (isPreview) {
        drawMaskPreview(annotation);
      } else {
        pixelateAnnotation(annotation);
      }
      break;
    case 'stamp':
      drawStamp(annotation);
      break;
    case 'text':
      drawText(annotation);
      break;
    case 'image':
      drawImageAnnotation(annotation);
      break;
    default:
      break;
  }
}

function annotationFromDraft(draftValue = activeDraft) {
  if (!draftValue) {
    return null;
  }

  if (draftValue.tool === 'pen') {
    return draftValue;
  }

  if (draftValue.tool === 'line') {
    return {
      tool: 'line',
      color: draftValue.color,
      size: draftValue.size,
      x1: draftValue.start.x,
      y1: draftValue.start.y,
      x2: draftValue.end.x,
      y2: draftValue.end.y
    };
  }

  const rect = normalizeRect(draftValue.start, draftValue.end);
  return {
    tool: draftValue.tool,
    color: draftValue.color,
    size: draftValue.size,
    kind: draftValue.kind,
    style: draftValue.style,
    ...rect
  };
}

function renderCanvas(options = {}) {
  const { includeSelection = activeTool === 'image' || activeTool === 'stamp' } = options;

  if (!baseImage) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
  annotations.forEach((annotation) => drawAnnotation(annotation));
  drawAnnotation(annotationFromDraft(), true);

  if (includeSelection) {
    const selectedImage = getSelectedImageAnnotation();
    if (selectedImage) {
      drawSelectedImageOverlay(selectedImage);
    }

    const selectedStamp = getSelectedStampAnnotation();
    if (selectedStamp) {
      drawSelectedStampOverlay(selectedStamp);
    }
  }
}

function clearTextEditor() {
  if (textCommitTimer) {
    clearTimeout(textCommitTimer);
    textCommitTimer = null;
  }

  textEditor.hidden = true;
  textEditor.value = '';
  textEditor.dataset.x = '';
  textEditor.dataset.y = '';
  textEditor.dataset.scale = '';
  textEditor.style.height = '';
}

function resizeTextEditorBox() {
  if (textEditor.hidden) {
    return;
  }

  textEditor.style.height = 'auto';
  textEditor.style.height = `${Math.max(52, textEditor.scrollHeight)}px`;
}

function commitTextEditor() {
  if (textCommitTimer) {
    clearTimeout(textCommitTimer);
    textCommitTimer = null;
  }

  if (textEditor.hidden) {
    return false;
  }

  const text = textEditor.value.replace(/\r/g, '').trim();
  const x = Number(textEditor.dataset.x);
  const y = Number(textEditor.dataset.y);

  clearTextEditor();

  if (!text) {
    return false;
  }

  pushAnnotation({
    tool: 'text',
    text,
    x,
    y,
    fontSize: toolState.sizes.text,
    color: toolState.color,
    bold: toolState.text.bold,
    italic: toolState.text.italic,
    underline: toolState.text.underline,
    align: toolState.text.align
  });

  setStatus('Text added to the screenshot.');
  return true;
}

function scheduleTextCommit() {
  if (textCommitTimer) {
    clearTimeout(textCommitTimer);
  }

  textCommitTimer = setTimeout(() => {
    commitTextEditor();
  }, 0);
}

function flushTextEditor() {
  return commitTextEditor();
}

function openTextEditor(point) {
  selectedAnnotationId = null;
  syncUi();
  renderCanvas();

  const screen = pointToViewport(point);
  textEditor.hidden = false;
  textEditor.value = '';
  textEditor.dataset.x = String(point.x);
  textEditor.dataset.y = String(point.y);
  textEditor.dataset.scale = String(Math.max(0.6, screen.scale));
  textEditor.style.left = `${screen.x}px`;
  textEditor.style.top = `${screen.y}px`;
  textEditor.style.minWidth = `${Math.max(220, Math.min(320, canvasWrap.clientWidth * 0.25))}px`;
  textEditor.style.maxWidth = `${Math.max(240, canvasWrap.clientWidth - screen.x - 24)}px`;
  textEditor.style.height = '52px';
  updateTextEditorStyles();
  resizeTextEditorBox();

  requestAnimationFrame(() => {
    textEditor.focus();
    textEditor.select();
  });

  setStatus('Type your text and press Enter to place it.');
}

function getCenteredCanvasPoint() {
  return {
    x: canvas.width / 2,
    y: canvas.height / 2
  };
}

function placeImageAsset(asset, point = getCenteredCanvasPoint()) {
  const maxWidth = canvas.width * 0.32;
  const maxHeight = canvas.height * 0.32;
  const scale = Math.min(
    1,
    maxWidth / asset.width,
    maxHeight / asset.height
  );

  const width = Math.max(IMAGE_MIN_SIZE, asset.width * scale);
  const height = Math.max(IMAGE_MIN_SIZE, asset.height * scale);
  const x = clamp(point.x - (width / 2), 0, canvas.width - width);
  const y = clamp(point.y - (height / 2), 0, canvas.height - height);

  const placedAnnotation = pushAnnotation({
    tool: 'image',
    name: asset.name,
    dataUrl: asset.dataUrl,
    x,
    y,
    w: width,
    h: height
  });

  selectedAnnotationId = placedAnnotation.id;
  syncUi();
  renderCanvas();
  setStatus(`Placed ${placedAnnotation.name}. Drag it to move, or use the corner handles to resize it.`);
  return placedAnnotation;
}

function hasImageBoundsChanged(current, original) {
  return (
    Math.abs(current.x - original.x) > 0.5 ||
    Math.abs(current.y - original.y) > 0.5 ||
    Math.abs(current.w - original.w) > 0.5 ||
    Math.abs(current.h - original.h) > 0.5
  );
}

function hasStampPositionChanged(current, original) {
  return (
    Math.abs(current.x - original.x) > 0.5 ||
    Math.abs(current.y - original.y) > 0.5
  );
}

function startImageInteraction(event, target, point) {
  selectedAnnotationId = target.annotation.id;
  imageInteraction = {
    pointerId: event.pointerId,
    annotationId: target.annotation.id,
    type: target.type,
    handle: target.handle || null,
    startPoint: point,
    originalAnnotation: cloneAnnotations([target.annotation])[0],
    historySnapshot: cloneAnnotations(annotations)
  };

  canvas.setPointerCapture(event.pointerId);
  syncUi();
  renderCanvas();
  setStatus(
    target.type === 'resize'
      ? 'Resize the selected image from the corner handle.'
      : 'Drag the selected image to reposition it.'
  );
}

function clampStampPosition(annotation, desiredX, desiredY) {
  const bounds = getStampBounds({ ...annotation, x: desiredX, y: desiredY });
  let nextX = desiredX;
  let nextY = desiredY;

  if (bounds.x < 0) {
    nextX -= bounds.x;
  } else if ((bounds.x + bounds.w) > canvas.width) {
    nextX -= (bounds.x + bounds.w) - canvas.width;
  }

  if (bounds.y < 0) {
    nextY -= bounds.y;
  } else if ((bounds.y + bounds.h) > canvas.height) {
    nextY -= (bounds.y + bounds.h) - canvas.height;
  }

  return { x: nextX, y: nextY };
}

function startStampInteraction(event, target, point) {
  selectedAnnotationId = target.annotation.id;
  stampInteraction = {
    pointerId: event.pointerId,
    annotationId: target.annotation.id,
    startPoint: point,
    originalAnnotation: cloneAnnotations([target.annotation])[0],
    historySnapshot: cloneAnnotations(annotations)
  };

  canvas.setPointerCapture(event.pointerId);
  syncUi();
  renderCanvas();
  setStatus('Drag the selected stamp to reposition it.');
}

function updateImageMove(point) {
  const annotation = getAnnotationById(imageInteraction.annotationId);
  if (!annotation) {
    return;
  }

  const { originalAnnotation, startPoint } = imageInteraction;
  annotation.x = clamp(
    originalAnnotation.x + (point.x - startPoint.x),
    0,
    Math.max(0, canvas.width - originalAnnotation.w)
  );
  annotation.y = clamp(
    originalAnnotation.y + (point.y - startPoint.y),
    0,
    Math.max(0, canvas.height - originalAnnotation.h)
  );
}

function updateImageResize(point) {
  const annotation = getAnnotationById(imageInteraction.annotationId);
  if (!annotation) {
    return;
  }

  const { handle, originalAnnotation } = imageInteraction;
  const anchorX = handle.name.includes('e')
    ? originalAnnotation.x
    : originalAnnotation.x + originalAnnotation.w;
  const anchorY = handle.name.includes('s')
    ? originalAnnotation.y
    : originalAnnotation.y + originalAnnotation.h;
  const maxWidth = handle.name.includes('e') ? canvas.width - anchorX : anchorX;
  const maxHeight = handle.name.includes('s') ? canvas.height - anchorY : anchorY;
  const aspectRatio = Math.max(0.1, originalAnnotation.w / originalAnnotation.h);
  const widthFromPointer = Math.abs(handle.name.includes('e') ? point.x - anchorX : anchorX - point.x);
  const heightFromPointer = Math.abs(handle.name.includes('s') ? point.y - anchorY : anchorY - point.y);
  const maxAllowedWidth = Math.max(4, Math.min(maxWidth, maxHeight * aspectRatio));
  const minAllowedWidth = Math.min(IMAGE_MIN_SIZE, maxAllowedWidth);
  const width = clamp(
    Math.max(widthFromPointer, heightFromPointer * aspectRatio, minAllowedWidth),
    minAllowedWidth,
    maxAllowedWidth
  );
  const height = width / aspectRatio;

  annotation.w = width;
  annotation.h = height;
  annotation.x = handle.name.includes('e') ? anchorX : anchorX - width;
  annotation.y = handle.name.includes('s') ? anchorY : anchorY - height;
}

function updateStampMove(point) {
  const annotation = getAnnotationById(stampInteraction.annotationId);
  if (!annotation) {
    return;
  }

  const { originalAnnotation, startPoint } = stampInteraction;
  const desiredX = originalAnnotation.x + (point.x - startPoint.x);
  const desiredY = originalAnnotation.y + (point.y - startPoint.y);
  const clamped = clampStampPosition(originalAnnotation, desiredX, desiredY);

  annotation.x = clamped.x;
  annotation.y = clamped.y;
}

function finishImageInteraction(event) {
  if (!imageInteraction) {
    return;
  }

  const currentInteraction = imageInteraction;
  imageInteraction = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  const annotation = getAnnotationById(currentInteraction.annotationId);
  const changed = annotation && hasImageBoundsChanged(annotation, currentInteraction.originalAnnotation);

  if (changed) {
    undoStack.push(currentInteraction.historySnapshot);
    redoStack = [];
    syncUi();
    renderCanvas();
    setStatus(
      currentInteraction.type === 'resize'
        ? 'Image size updated.'
        : 'Image position updated.'
    );
    return;
  }

  syncUi();
  renderCanvas();
  setStatus('Image selected. Drag to move it or use a corner handle to resize it.');
}

function finishStampInteraction(event) {
  if (!stampInteraction) {
    return;
  }

  const currentInteraction = stampInteraction;
  stampInteraction = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  const annotation = getAnnotationById(currentInteraction.annotationId);
  const changed = annotation && hasStampPositionChanged(annotation, currentInteraction.originalAnnotation);

  if (changed) {
    undoStack.push(currentInteraction.historySnapshot);
    redoStack = [];
    syncUi();
    renderCanvas();
    setStatus('Stamp position updated.');
    return;
  }

  syncUi();
  renderCanvas();
  setStatus('Stamp selected. Drag it to reposition it.');
}

function cancelImageInteraction(event) {
  if (!imageInteraction) {
    return;
  }

  const currentInteraction = imageInteraction;
  imageInteraction = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  annotations = ensureAnnotationIds(currentInteraction.historySnapshot);
  selectedAnnotationId = currentInteraction.annotationId;
  syncUi();
  renderCanvas();
  setStatus('Image adjustment cancelled.');
}

function cancelStampInteraction(event) {
  if (!stampInteraction) {
    return;
  }

  const currentInteraction = stampInteraction;
  stampInteraction = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  annotations = ensureAnnotationIds(currentInteraction.historySnapshot);
  selectedAnnotationId = currentInteraction.annotationId;
  syncUi();
  renderCanvas();
  setStatus('Stamp move cancelled.');
}

function beginDraft(event) {
  if (!baseImage || event.button !== 0) {
    return;
  }

  if (!textEditor.hidden) {
    flushTextEditor();
  }

  const point = pointFromEvent(event);

  if (activeTool === 'text') {
    openTextEditor(point);
    return;
  }

  if (activeTool === 'image') {
    event.preventDefault();
    const hitTarget = getImageHitTarget(point);

    if (hitTarget) {
      startImageInteraction(event, hitTarget, point);
      return;
    }

    selectedAnnotationId = null;
    syncUi();
    renderCanvas();
    setStatus('Choose Image to add a new overlay, or click an existing image to move or resize it.');
    return;
  }

  if (activeTool === 'stamp') {
    event.preventDefault();
    const hitTarget = getStampHitTarget(point);

    if (hitTarget) {
      startStampInteraction(event, hitTarget, point);
      return;
    }

    const stamp = pushAnnotation({
      tool: 'stamp',
      kind: toolState.stampKind,
      color: toolState.color,
      size: toolState.sizes.stamp,
      x: point.x,
      y: point.y
    });
    selectedAnnotationId = stamp.id;
    syncUi();
    renderCanvas();
    setStatus(`${toolState.stampKind} stamp added. Drag it to reposition it.`);
    return;
  }

  drawing = true;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);

  switch (activeTool) {
    case 'pen':
      if (toolState.penMode === 'free') {
        activeDraft = {
          tool: 'pen',
          color: toolState.color,
          size: toolState.sizes.pen,
          points: [point]
        };
      } else {
        activeDraft = {
          tool: 'line',
          color: toolState.color,
          size: toolState.sizes.pen,
          start: point,
          end: point
        };
      }
      break;
    case 'shape':
      activeDraft = {
        tool: 'shape',
        color: toolState.color,
        size: toolState.sizes.shape,
        kind: toolState.shapeKind,
        style: toolState.shapeStyle,
        start: point,
        end: point
      };
      break;
    case 'highlight':
      activeDraft = {
        tool: 'highlight',
        color: toolState.color,
        size: toolState.sizes.highlight,
        start: point,
        end: point
      };
      break;
    case 'mask':
      activeDraft = {
        tool: 'mask',
        color: toolState.color,
        size: toolState.sizes.mask,
        start: point,
        end: point
      };
      break;
    default:
      drawing = false;
      activeDraft = null;
      break;
  }

  renderCanvas();
}

function moveDraft(event) {
  if (imageInteraction) {
    event.preventDefault();
    const point = pointFromEvent(event);

    if (imageInteraction.type === 'resize') {
      updateImageResize(point);
    } else {
      updateImageMove(point);
    }

    renderCanvas();
    updateCanvasCursor();
    return;
  }

  if (stampInteraction) {
    event.preventDefault();
    updateStampMove(pointFromEvent(event));
    renderCanvas();
    updateCanvasCursor();
    return;
  }

  if (!drawing || !activeDraft) {
    updateCanvasCursor(event);
    return;
  }

  const point = pointFromEvent(event);

  if (activeDraft.tool === 'pen') {
    activeDraft.points.push(point);
  } else {
    activeDraft.end = point;
  }

  renderCanvas();
}

function finishDraft(event) {
  if (imageInteraction) {
    event.preventDefault();
    finishImageInteraction(event);
    return;
  }

  if (stampInteraction) {
    event.preventDefault();
    finishStampInteraction(event);
    return;
  }

  if (!drawing || !activeDraft) {
    return;
  }

  const currentDraft = activeDraft;
  drawing = false;
  activeDraft = null;
  canvas.releasePointerCapture(event.pointerId);

  let annotation = null;

  if (currentDraft.tool === 'pen') {
    if (currentDraft.points.length === 1) {
      currentDraft.points.push({ ...currentDraft.points[0] });
    }
    annotation = currentDraft;
  } else if (currentDraft.tool === 'line') {
    if (distance(currentDraft.start, currentDraft.end) >= 4) {
      annotation = {
        tool: 'line',
        color: currentDraft.color,
        size: currentDraft.size,
        x1: currentDraft.start.x,
        y1: currentDraft.start.y,
        x2: currentDraft.end.x,
        y2: currentDraft.end.y
      };
    }
  } else {
    const rect = normalizeRect(currentDraft.start, currentDraft.end);
    if (rect.w >= 4 && rect.h >= 4) {
      annotation = {
        tool: currentDraft.tool,
        color: currentDraft.color,
        size: currentDraft.size,
        kind: currentDraft.kind,
        style: currentDraft.style,
        ...rect
      };
    }
  }

  if (annotation) {
    pushAnnotation(annotation);
    setStatus(`${TOOL_LABELS[annotation.tool] || 'Annotation'} added.`);
  } else {
    renderCanvas();
  }

  updateCanvasCursor();
}

function cancelDraft(event) {
  if (imageInteraction) {
    cancelImageInteraction(event);
    return;
  }

  if (stampInteraction) {
    cancelStampInteraction(event);
    return;
  }

  if (!drawing) {
    return;
  }

  drawing = false;
  activeDraft = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  renderCanvas();
  updateCanvasCursor();
  setStatus('Draft cancelled.');
}

async function exportCurrentDataUrl() {
  if (!baseImage) {
    throw new Error('There is no screenshot loaded yet.');
  }

  flushTextEditor();
  await ensureOverlayImagesReady();
  renderCanvas({ includeSelection: false });
  const blob = await canvasToBlob('image/png');
  renderCanvas();
  return blobToDataUrl(blob);
}

async function saveLastScreenshot(dataUrl, type = 'edited') {
  const ts = createTimestamp();
  await storageSet({
    lastScreenshot: {
      dataUrl,
      type,
      ts
    }
  });
  return ts;
}

async function downloadEditedScreenshot() {
  const dataUrl = await exportCurrentDataUrl();
  const ts = await saveLastScreenshot(dataUrl, 'edited');
  await downloadUrl(dataUrl, `snapshot-edited-${ts}.png`);
  setStatus('Edited screenshot saved to Downloads.');
}

async function copyEditedScreenshot() {
  flushTextEditor();
  await ensureOverlayImagesReady();
  renderCanvas({ includeSelection: false });

  let dataUrl = null;

  try {
    const blob = await canvasToBlob('image/png');
    await copyBlobToClipboard(blob);
    dataUrl = await blobToDataUrl(blob);
  } catch (_directCopyError) {
    dataUrl = canvas.toDataURL('image/png');
    await copyDataUrlToClipboard(dataUrl);
  } finally {
    renderCanvas();
  }

  await saveLastScreenshot(dataUrl, 'edited');
  setStatus('Edited screenshot copied to the clipboard.');
}

async function loadOverlayImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);

  setActiveTool('image');
  placeImageAsset({
    dataUrl,
    width: image.naturalWidth,
    height: image.naturalHeight,
    name: file.name || 'image overlay'
  });
}

async function loadWorkspaceImage(dataUrl, type = 'loaded') {
  draft = {
    dataUrl,
    type,
    ts: createTimestamp()
  };

  baseImage = await loadImage(dataUrl);
  canvas.width = baseImage.naturalWidth;
  canvas.height = baseImage.naturalHeight;

  annotations = [];
  undoStack = [];
  redoStack = [];
  activeDraft = null;
  drawing = false;
  selectedAnnotationId = null;
  imageInteraction = null;
  stampInteraction = null;
  clearTextEditor();

  updateCanvasVisibility(true);
  setControlsEnabled(true);
  setActiveTool('pen');
  syncUi();
  renderCanvas();
}

async function loadWorkspaceImageFromFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  await loadWorkspaceImage(dataUrl, 'loaded');
  setStatus(`Loaded ${file.name}. Choose a tool and start annotating.`);
}

function handleRangeInput(value) {
  switch (activeTool) {
    case 'pen':
      toolState.sizes.pen = value;
      break;
    case 'highlight':
      toolState.sizes.highlight = value;
      break;
    case 'mask':
      toolState.sizes.mask = value;
      break;
    case 'shape':
      toolState.sizes.shape = value;
      break;
    case 'stamp':
      toolState.sizes.stamp = value;
      break;
    case 'text':
      toolState.sizes.text = value;
      break;
    default:
      break;
  }

  syncUi();
  renderCanvas();
}

function bindOptionEvents() {
  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      flushTextEditor();
      setActiveTool(button.dataset.tool);
      setStatus(TOOL_HINTS[button.dataset.tool] || 'Tool selected.');
    });
  });

  penModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolState.penMode = button.dataset.penMode;
      syncUi();
      setStatus(button.dataset.penMode === 'free' ? 'Freehand pen enabled.' : 'Straight line pen enabled.');
    });
  });

  shapeKindButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolState.shapeKind = button.dataset.shapeKind;
      syncUi();
      setStatus(`${button.textContent} shape selected.`);
    });
  });

  shapeStyleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolState.shapeStyle = button.dataset.shapeStyle;
      syncUi();
      setStatus(`${button.textContent} shape style selected.`);
    });
  });

  stampKindButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolState.stampKind = button.dataset.stampKind;
      syncUi();
      setStatus(`${button.textContent} stamp selected.`);
    });
  });

  textStyleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.textStyle;
      toolState.text[key] = !toolState.text[key];
      syncUi();
      resizeTextEditorBox();
      setStatus(`${button.textContent} text style updated.`);
    });
  });

  textAlignButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolState.text.align = button.dataset.textAlign;
      syncUi();
      resizeTextEditorBox();
      setStatus(`${button.textContent} text alignment selected.`);
    });
  });

  colorButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolState.color = button.dataset.color;
      syncUi();
      renderCanvas();
      setStatus(`${button.title} color selected.`);
    });
  });

  contextRange.addEventListener('input', (event) => {
    handleRangeInput(Number(event.target.value));
  });

  btnAddImage.addEventListener('click', () => {
    flushTextEditor();
    imageInput.click();
  });

  imageInput.addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    try {
      await loadOverlayImage(file);
    } catch (error) {
      setStatus(error.message || 'Unable to load that image.');
    } finally {
      imageInput.value = '';
    }
  });
}

function bindUtilityEvents() {
  $('btn-load').addEventListener('click', () => {
    loadInput.click();
  });

  loadInput.addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    try {
      await loadWorkspaceImageFromFile(file);
    } catch (error) {
      setStatus(error.message || 'Unable to load that screenshot.');
    } finally {
      loadInput.value = '';
    }
  });

  $('btn-undo').addEventListener('click', () => {
    if (!undoStack.length) {
      return;
    }

    flushTextEditor();
    redoStack.push(cloneAnnotations(annotations));
    annotations = ensureAnnotationIds(undoStack.pop());
    syncUi();
    renderCanvas();
    setStatus('Last change undone.');
  });

  $('btn-redo').addEventListener('click', () => {
    flushTextEditor();
    if (!redoStack.length) {
      return;
    }

    undoStack.push(cloneAnnotations(annotations));
    annotations = ensureAnnotationIds(redoStack.pop());
    syncUi();
    renderCanvas();
    setStatus('Change restored.');
  });

  $('btn-clear').addEventListener('click', () => {
    flushTextEditor();
    if (!annotations.length) {
      return;
    }

    commitAnnotations([], {
      recordHistory: true,
      selectedId: null
    });
    setStatus('All annotations cleared.');
  });

  $('btn-download').addEventListener('click', async () => {
    try {
      await downloadEditedScreenshot();
    } catch (error) {
      setStatus(error.message || 'Unable to download the edited screenshot.');
    }
  });

  $('btn-copy').addEventListener('click', async () => {
    try {
      await copyEditedScreenshot();
    } catch (error) {
      setStatus(error.message || 'Unable to copy the edited screenshot.');
    }
  });
}

function bindTextEvents() {
  textEditor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      flushTextEditor();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      clearTextEditor();
      setStatus('Text placement cancelled.');
    }
  });

  textEditor.addEventListener('blur', () => {
    scheduleTextCommit();
  });

  textEditor.addEventListener('input', () => {
    resizeTextEditorBox();
  });
}

function bindCanvasEvents() {
  canvas.addEventListener('pointerdown', beginDraft);
  canvas.addEventListener('pointermove', moveDraft);
  canvas.addEventListener('pointerup', finishDraft);
  canvas.addEventListener('pointercancel', cancelDraft);
  canvas.addEventListener('pointerleave', () => {
    updateCanvasCursor();
  });
}

function bindKeyboardShortcuts() {
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z';
    const isRedo = (event.ctrlKey || event.metaKey) &&
      ((event.shiftKey && key === 'z') || key === 'y');

    if (isUndo) {
      event.preventDefault();
      $('btn-undo').click();
      return;
    }

    if (isRedo) {
      event.preventDefault();
      $('btn-redo').click();
      return;
    }

    if (event.key === 'Escape' && ['image', 'stamp'].includes(activeTool) && selectedAnnotationId) {
      selectedAnnotationId = null;
      syncUi();
      renderCanvas();
      setStatus(`${TOOL_LABELS[activeTool]} selection cleared.`);
    }
  });
}

async function init() {
  setControlsEnabled(false);
  updateCanvasVisibility(false);
  syncUi();
  setStatus('Load a screenshot to start editing.');

  bindOptionEvents();
  bindUtilityEvents();
  bindTextEvents();
  bindCanvasEvents();
  bindKeyboardShortcuts();

  try {
    draft = await loadDraft();

    if (!draft?.dataUrl) {
      return;
    }

    await loadWorkspaceImage(draft.dataUrl, draft.type);
    setStatus('Screenshot loaded. Choose a tool and start annotating.');
  } catch (error) {
    updateCanvasVisibility(false);
    setStatus(error.message || 'Unable to load the screenshot editor.');
  }
}

init();
