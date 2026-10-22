import { fmt, pathData, shapeToPathData } from './lib/path.js';
import { booleanOperands } from './lib/boolean.js';
import { parseSvg } from './lib/svg-import.js';
import { invertMatrix, multiplyMatrices, parseTransform } from './lib/svg-path.js';
import { measureText, outlineCommands, parseLocalFont, textBaselineY } from './lib/text-outline.js';
import { compareFontData, orderFonts, pushRecentFont, readRecentFonts } from './lib/recent-fonts.js';
import { snapMove, snapResize, snapPoint } from './lib/snap.js';
import { unionBounds, alignDelta, distributeDeltas } from './lib/align.js';
import { ZOOM_MIN, ZOOM_MAX, clampZoom, nextZoom, wheelZoomFactor, zoomPercent } from './lib/zoom.js';
import {
  detectLanguage,
  LANGUAGE_STORAGE_KEY,
  MESSAGES,
  translate,
  translateCount
} from './lib/i18n.js';

(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const DEFAULT_W = 960;
  const DEFAULT_H = 640;
  const MIN_CANVAS = 64;
  const MAX_CANVAS = 10000;
  const STORAGE_KEY = 'albedo-svg-studio:v1';
  const SOURCE_KEY = 'albedo-svg-studio:source:v1';
  const UNDERLAY_KEY = 'albedo-svg-studio:underlay:v1';
  const MAX_UNDERLAY_STORE = 3200000;
  const MAX_HISTORY = 70;
  const TAU = Math.PI * 2;
  const SNAP_PX = 6;
  const GRID_SIZES = [1, 2, 4, 8, 16, 32];
  const BOOLEAN_META = {
    unite: { labelKey: 'boolean.unite', titleKey: 'boolean.uniteTitle' },
    subtract: { labelKey: 'boolean.subtract', titleKey: 'boolean.subtractTitle' },
    intersect: { labelKey: 'boolean.intersect', titleKey: 'boolean.intersectTitle' },
    exclude: { labelKey: 'boolean.exclude', titleKey: 'boolean.excludeTitle' }
  };
  const TYPE_META = {
    rect: { code: 'R', labelKey: 'shape.rect', titleKey: 'shape.rect', nameKey: 'name.rect' },
    ellipse: { code: 'E', labelKey: 'shape.ellipse', titleKey: 'shape.ellipse', nameKey: 'name.ellipse' },
    circle: { code: 'C', labelKey: 'shape.circle', titleKey: 'shape.circle', nameKey: 'name.circle' },
    polygon: { code: 'G', labelKey: 'shape.polygon', titleKey: 'shape.polygon', nameKey: 'name.polygon' },
    line: { code: 'L', labelKey: 'shape.line', titleKey: 'shape.line', nameKey: 'name.line' },
    text: { code: 'T', labelKey: 'shape.text', titleKey: 'shape.text', nameKey: 'name.text' },
    path: { code: 'P', labelKey: 'shape.path', titleKey: 'shape.pathTitle', nameKey: 'name.path' }
  };
  const SHAPE_SHORTCUTS = { rect: 'R', ellipse: 'O', circle: 'C', polygon: 'G', line: 'L', text: 'T', path: 'P' };
  const CMD_META = {
    M: { titleKey: 'cmd.M', shortKey: 'cmd.short.M', code: 'M' },
    L: { titleKey: 'cmd.L', shortKey: 'cmd.short.L', code: 'L' },
    Q: { titleKey: 'cmd.Q', shortKey: 'cmd.short.Q', code: 'Q' },
    C: { titleKey: 'cmd.C', shortKey: 'cmd.short.C', code: 'C' },
    A: { titleKey: 'cmd.A', shortKey: 'cmd.short.A', code: 'A' },
    Z: { titleKey: 'cmd.Z', shortKey: 'cmd.short.Z', code: 'Z' }
  };
  const SHAPE_COLORS = ['#f2c75c', '#f26b4f', '#7bb6a4', '#98a6e8', '#e9a4b8', '#cfd8a6'];
  const RAIL_META = {
    insert: { labelKey: 'nav.insert', icon: 'insert' },
    guides: { labelKey: 'nav.guides', icon: 'guides' },
    layers: { labelKey: 'nav.layers', icon: 'layers' },
    document: { labelKey: 'nav.document', icon: 'document' },
    shortcuts: { labelKey: 'nav.shortcuts', icon: 'keyboard' },
    geometry: { labelKey: 'nav.geometry', icon: 'geometry' },
    vertices: { labelKey: 'nav.vertices', icon: 'vertices' },
    path: { labelKey: 'nav.path', icon: 'path' },
    align: { labelKey: 'nav.align', icon: 'align' },
    style: { labelKey: 'nav.style', icon: 'style' },
    operations: { labelKey: 'nav.operations', icon: 'operations' },
    tips: { labelKey: 'nav.tips', icon: 'tips' },
    position: { labelKey: 'nav.position', icon: 'position' },
    display: { labelKey: 'nav.display', icon: 'display' }
  };
  const RAIL_ICONS = {
    insert: '<path d="M64 28v72M28 64h72"/>',
    guides: '<path d="M30 30h68v68H30z"/><path d="M64 30v68M30 64h68"/>',
    layers: '<path d="M64 20 16 44l48 24 48-24-48-24Z"/><path d="M16 64l48 24 48-24"/><path d="M16 84l48 24 48-24"/>',
    document: '<rect x="24" y="18" width="80" height="92" rx="10"/><path d="M40 44h48M40 64h48M40 84h30"/>',
    keyboard: '<rect x="18" y="38" width="92" height="52" rx="8"/><circle cx="37" cy="56" r="4" fill="currentColor" stroke="none"/><circle cx="57" cy="56" r="4" fill="currentColor" stroke="none"/><circle cx="77" cy="56" r="4" fill="currentColor" stroke="none"/><circle cx="97" cy="56" r="4" fill="currentColor" stroke="none"/><path d="M34 78h60"/>',
    geometry: '<rect x="18" y="18" width="54" height="54" rx="7"/><circle cx="82" cy="82" r="26"/>',
    vertices: '<path d="M24 46 64 20l40 26-12 56H36L24 46Z"/><circle cx="24" cy="46" r="6" fill="currentColor" stroke="none"/><circle cx="64" cy="20" r="6" fill="currentColor" stroke="none"/><circle cx="104" cy="46" r="6" fill="currentColor" stroke="none"/>',
    path: '<path d="M16 92c24 0 18-56 44-56s22 56 52 56"/><circle cx="44" cy="62" r="6" fill="currentColor" stroke="none"/><circle cx="82" cy="62" r="6" fill="currentColor" stroke="none"/>',
    align: '<path d="M22 20v88"/><rect x="38" y="36" width="52" height="14" rx="4"/><path d="M22 64h84"/><rect x="38" y="78" width="34" height="14" rx="4"/>',
    style: '<circle cx="64" cy="64" r="42"/><path d="M64 22a42 42 0 0 1 0 84Z" fill="currentColor" stroke="none"/>',
    operations: '<circle cx="52" cy="64" r="30"/><circle cx="76" cy="64" r="30"/>',
    tips: '<path d="M64 16a30 30 0 0 0-18 54v14h36V70a30 30 0 0 0-18-54Z"/><path d="M50 104h28"/>',
    position: '<path d="M24 44V24h20M84 24h20v20M104 84v20H84M44 104H24V84"/><path d="M64 40v48M40 64h48"/>',
    display: '<path d="M16 64c14-24 30-36 48-36s34 12 48 36c-14 24-30 36-48 36s-34-12-48-36Z"/><circle cx="64" cy="64" r="16"/>'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const deepClone = (value) => JSON.parse(JSON.stringify(value));
  const esc = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  let idSeq = 0;
  const uid = (prefix = 's') => {
    idSeq += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + idSeq.toString(36);
  };

  const dom = {
    stage: $('#stage'),
    stageDefs: $('#stageDefs'),
    gridLayer: $('#gridLayer'),
    shapeLayer: $('#shapeLayer'),
    underlayLayer: $('#underlayLayer'),
    overlay: $('#overlay'),
    canvasBg: $('#canvasBg'),
    layers: $('#layers'),
    layerCount: $('#layerCount'),
    leftRail: $('#leftRail'),
    leftPanelBody: $('#leftPanelBody'),
    inspectorRail: $('#inspectorRail'),
    inspector: $('#inspector'),
    underlayEmpty: $('#underlayEmpty'),
    underlayControls: $('#underlayControls'),
    underlayImportBtn: $('#underlayImportBtn'),
    underlayThumb: $('#underlayThumb'),
    underlayName: $('#underlayName'),
    underlayMeta: $('#underlayMeta'),
    underlayVisibleBtn: $('#underlayVisibleBtn'),
    underlayAdjustBtn: $('#underlayAdjustBtn'),
    underlayReplaceBtn: $('#underlayReplaceBtn'),
    underlayRemoveBtn: $('#underlayRemoveBtn'),
    underlayHint: $('#underlayHint'),
    underlayFile: $('#underlayFile'),
    importSvgFile: $('#importSvgFile'),
    importSvgBtn: $('#importSvgBtn'),
    insertSvgBtn: $('#insertSvgBtn'),
    stageDrop: $('#stageDrop'),
    docTitle: $('#docTitle'),
    saveState: $('#saveState'),
    crumbTitle: $('#crumbTitle'),
    coordStatus: $('#coordStatus'),
    shapeStatus: $('#shapeStatus'),
    nodeStatus: $('#nodeStatus'),
    canvasTip: $('#canvasTip'),
    emptyCanvas: $('#emptyCanvas'),
    artboardWrap: $('#artboardWrap'),
    stageBody: $('.stage-body'),
    zoomInBtn: $('#zoomInBtn'),
    zoomOutBtn: $('#zoomOutBtn'),
    zoomFitBtn: $('#zoomFitBtn'),
    zoomLabel: $('#zoomLabel'),
    canvasSizeBtn: $('#canvasSizeBtn'),
    canvasSizeLabel: $('#canvasSizeLabel'),
    canvasModal: $('#canvasModal'),
    canvasWidthInput: $('#canvasWidthInput'),
    canvasHeightInput: $('#canvasHeightInput'),
    canvasRatioChip: $('#canvasRatioChip'),
    canvasSizeError: $('#canvasSizeError'),
    canvasApplyBtn: $('#canvasApplyBtn'),
    fontModal: $('#fontModal'),
    fontSearch: $('#fontSearch'),
    fontList: $('#fontList'),
    fontEmpty: $('#fontEmpty'),
    fontDenied: $('#fontDenied'),
    undoBtn: $('#undoBtn'),
    redoBtn: $('#redoBtn'),
    gridToggle: $('#gridToggle'),
    gridSize: $('#gridSize'),
    snapToggle: $('#snapToggle'),
    langSelect: $('#langSelect'),
    toast: $('#toast')
  };

  const state = {
    doc: null,
    lang: 'en',
    langMode: 'auto',
    saveStatus: 'saved',
    selectedId: null,
    selectedIds: [],
    selectedCmdId: null,
    grid: { visible: false, size: 8 },
    snapEnabled: true,
    snapGuides: [],
    marquee: null,
    pathEdit: true,
    undo: [],
    redo: [],
    gesture: null,
    editBefore: null,
    editTimer: null,
    saveTimer: null,
    saveStatusTimer: null,
    toastTimer: null,
    tipTimer: null,
    tipDismissed: false,
    canvasTrigger: null,
    underlay: null,
    underlayAdjust: false,
    underlaySaveTimer: null,
    underlayWarned: false,
    underlayPersistFailed: false,
    underlayImportToken: 0,
    svgImportToken: 0,
    starter: false,
    // Source document kept for structural export.  `doc` is a normalized
    // template, `entries` maps an editable shape id to the source element key
    // and the signature it had when it was imported.
    source: null,
    sourceSerial: 0,
    sourcePersisted: false,
    // Doc snapshot -> source template at import boundaries, so undo/redo can
    // put the matching template back instead of leaving a stale one behind.
    sourceByDoc: new Map(),
    leftTab: 'insert',
    rightTab: null,
    layerDrag: null,
    uiScale: 1,
    zoom: 1,
    // postscriptName -> { font, cssFamily, family, style }; parsed from local
    // font files picked through the Font Access API.
    fonts: new Map(),
    localFonts: [],
    // PostScript names, most recently picked first (persisted in localStorage).
    recentFonts: readRecentFonts(localStorage),
    fontTargetId: null,
    fontLoading: false
  };

  // Overlay chrome is authored in screen pixels. uiScale converts CSS pixels
  // into artboard user units, so handles and guides do not grow with the canvas.
  const uiScaleValue = () => (Number.isFinite(state.uiScale) && state.uiScale > 0 ? state.uiScale : 1);
  const uiSize = (value) => value * uiScaleValue();
  const uiTransform = (x, y) => {
    const scale = Math.round(uiScaleValue() * 100000) / 100000;
    return 'translate(' + fmt(x) + ' ' + fmt(y) + ') scale(' + scale + ')';
  };

  const t = (key, vars = {}) => translate(state.lang, key, vars);
  const tc = (key, count, vars = {}) => translateCount(state.lang, key, count, vars);
  const typeLabel = (type) => t(TYPE_META[type].labelKey);
  const typeTitle = (type) => t(TYPE_META[type].titleKey);
  const commandTitle = (code) => t(CMD_META[code].titleKey);
  const commandShort = (code) => t(CMD_META[code].shortKey);
  const shapeName = (type, index, nameKey = TYPE_META[type].nameKey) => t(nameKey) + ' ' + index;

  function setSaveState(status) {
    state.saveStatus = status;
    dom.saveState.textContent = t('save.' + status);
    dom.saveState.classList.toggle('saving', status === 'saving');
    dom.saveState.classList.toggle('error', status === 'unsaved');
  }

  function loadLanguageMode() {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      return stored === 'zh' || stored === 'en' ? stored : 'auto';
    } catch (error) {
      return 'auto';
    }
  }

  function resolveLanguage(mode) {
    if (mode === 'zh' || mode === 'en') return mode;
    const languages = typeof navigator !== 'undefined'
      ? (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language])
      : [];
    return detectLanguage(languages);
  }

  function updateLanguageSelect() {
    if (!dom.langSelect) return;
    dom.langSelect.value = state.langMode;
    const auto = dom.langSelect.querySelector('option[value="auto"]');
    if (auto) auto.textContent = t('lang.auto');
    dom.langSelect.setAttribute('aria-label', t('lang.label'));
  }

  function applyStaticI18n() {
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
    document.title = t('app.title');
    $$('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    $$('[data-i18n-title]').forEach((node) => {
      node.title = t(node.dataset.i18nTitle);
    });
    $$('[data-i18n-aria]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nAria));
    });
    $$('.shape-btn').forEach((button) => {
      const type = button.dataset.add;
      if (!TYPE_META[type]) return;
      const label = typeLabel(type);
      button.title = t('shape.addTitle', {
        label: state.lang === 'en' ? label.toLowerCase() : label,
        key: SHAPE_SHORTCUTS[type]
      });
    });
    updateLanguageSelect();
    setSaveState(state.saveStatus);
  }

  const nameLabels = (key) => [MESSAGES.zh[key], MESSAGES.en[key]];
  const GENERATED_NAME_KEYS = [
    { key: 'name.roundedRect', labels: nameLabels('name.roundedRect') },
    { key: 'name.bezierCurve', labels: [...nameLabels('name.bezierCurve'), 'Bezier curve'] },
    ...['rect', 'ellipse', 'circle', 'polygon', 'line', 'text', 'path'].map((type) => ({
      key: TYPE_META[type].nameKey,
      labels: nameLabels(TYPE_META[type].nameKey)
    }))
  ];
  const BOOLEAN_NAME_KEYS = ['unite', 'subtract', 'intersect', 'exclude'].map((operation) => ({
    key: 'boolean.' + operation,
    labels: nameLabels('boolean.' + operation)
  }));
  const DEFAULT_DOC_NAMES = nameLabels('doc.untitled');
  const DEFAULT_UNDERLAY_NAMES = nameLabels('underlay.defaultName');
  const COPY_SUFFIXES = nameLabels('name.copySuffix');
  const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function localizeGeneratedName(name) {
    if (typeof name !== 'string' || !name) return name;
    let base = name;
    let suffix = '';
    const copyMatch = base.match(new RegExp('(' + COPY_SUFFIXES.map(escapePattern).join('|') + ')$'));
    if (copyMatch) {
      suffix = t('name.copySuffix');
      base = base.slice(0, copyMatch.index);
    }
    for (const entry of BOOLEAN_NAME_KEYS) {
      if (entry.labels.includes(base)) return t(entry.key) + suffix;
    }
    for (const entry of GENERATED_NAME_KEYS) {
      const labels = entry.labels.map(escapePattern).join('|');
      const match = base.match(new RegExp('^(' + labels + ')\\s+(\\d+)$', 'i'));
      if (match) return t(entry.key) + ' ' + match[2] + suffix;
    }
    return name;
  }

  function localizeGeneratedNames() {
    if (!state.doc) return false;
    let changed = false;
    if (DEFAULT_DOC_NAMES.includes(state.doc.name)) {
      const next = t('doc.untitled');
      if (next !== state.doc.name) {
        state.doc.name = next;
        changed = true;
      }
    }
    state.doc.shapes.forEach((shape) => {
      const next = localizeGeneratedName(shape.name);
      if (next !== shape.name) {
        shape.name = next;
        changed = true;
      }
    });
    if (state.underlay && DEFAULT_UNDERLAY_NAMES.includes(state.underlay.name)) {
      const next = t('underlay.defaultName');
      if (next !== state.underlay.name) {
        state.underlay.name = next;
        changed = true;
      }
    }
    return changed;
  }

  function applyLanguage(mode, options = {}) {
    state.langMode = mode === 'zh' || mode === 'en' ? mode : 'auto';
    state.lang = resolveLanguage(state.langMode);
    if (options.persist !== false) {
      try {
        if (state.langMode === 'auto') localStorage.removeItem(LANGUAGE_STORAGE_KEY);
        else localStorage.setItem(LANGUAGE_STORAGE_KEY, state.langMode);
      } catch (error) {
        // Language still applies for this session when storage is unavailable.
      }
    }
    applyStaticI18n();
    const changedNames = localizeGeneratedNames();
    if (state.doc) {
      dom.docTitle.value = state.doc.name;
      dom.crumbTitle.textContent = state.doc.name;
      if (!dom.canvasModal.hidden) dom.canvasSizeError.textContent = '';
      renderAll();
      if (changedNames) markDirty();
    }
  }

  /* ------------------------------------------------------------------ *
   * Document shape
   * ------------------------------------------------------------------ */

  function starterDocument() {
    const c1 = uid('c');
    const c2 = uid('c');
    return {
      name: t('doc.untitled'),
      background: '#fffdf8',
      width: DEFAULT_W,
      height: DEFAULT_H,
      shapes: [
        {
          id: uid('s'), type: 'ellipse', name: shapeName('ellipse', 1),
          cx: 612, cy: 322, rx: 171, ry: 171,
          fill: '#f26b4f', stroke: '#1b1d22', strokeWidth: 2, opacity: 1
        },
        {
          id: uid('s'), type: 'rect', name: shapeName('rect', 1, 'name.roundedRect'),
          x: 150, y: 180, w: 304, h: 304, rx: 68,
          fill: '#f2c75c', stroke: '#1b1d22', strokeWidth: 2, opacity: 1
        },
        {
          id: uid('s'), type: 'path', name: shapeName('path', 1, 'name.bezierCurve'),
          commands: [
            { id: c1, type: 'M', x: 242, y: 438 },
            { id: c2, type: 'C', x1: 335, y1: 216, x2: 504, y2: 519, x: 652, y: 318 },
            { id: uid('c'), type: 'C', x1: 731, y1: 219, x2: 820, y2: 276, x: 842, y: 409 }
          ],
          fill: 'none', stroke: '#171a1f', strokeWidth: 6, opacity: 1
        }
      ]
    };
  }

  function normalizeDoc(raw) {
    const rawW = num(raw?.width, DEFAULT_W);
    const rawH = num(raw?.height, DEFAULT_H);
    const out = {
      name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name : t('doc.untitled'),
      background: raw?.background === 'none' || isValidColor(raw?.background) ? raw.background : '#fffdf8',
      width: clamp(Math.round(rawW), MIN_CANVAS, MAX_CANVAS),
      height: clamp(Math.round(rawH), MIN_CANVAS, MAX_CANVAS),
      shapes: []
    };
    const list = Array.isArray(raw?.shapes) ? raw.shapes : [];
    list.forEach((item) => {
      if (!item || !TYPE_META[item.type]) return;
      const base = {
        id: typeof item.id === 'string' && item.id ? item.id : uid('s'),
        type: item.type,
        name: typeof item.name === 'string' && item.name ? item.name : shapeName(item.type, out.shapes.length + 1),
        fill: item.type === 'line' ? 'none' : (isValidColor(item.fill) || item.fill === 'none' ? item.fill : '#f2c75c'),
        stroke: isValidColor(item.stroke) || item.stroke === 'none' ? item.stroke : '#1b1d22',
        strokeWidth: Number.isFinite(Number(item.strokeWidth)) ? clamp(Number(item.strokeWidth), 0, 120) : 2,
        opacity: Number.isFinite(Number(item.opacity)) ? clamp(Number(item.opacity), 0, 1) : 1,
        fillRule: item.type === 'path' && item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
      };
      if (item.type === 'rect') {
        Object.assign(base, {
          x: num(item.x, 360), y: num(item.y, 240),
          w: Math.max(1, num(item.w, 240)), h: Math.max(1, num(item.h, 160)),
          rx: clamp(num(item.rx, 0), 0, 10000)
        });
      } else if (item.type === 'ellipse') {
        Object.assign(base, {
          cx: num(item.cx, 480), cy: num(item.cy, 320),
          rx: Math.max(1, num(item.rx, 130)), ry: Math.max(1, num(item.ry, 100))
        });
      } else if (item.type === 'circle') {
        Object.assign(base, {
          cx: num(item.cx, out.width / 2), cy: num(item.cy, out.height / 2),
          r: Math.max(1, num(item.r, Math.min(out.width, out.height) * 0.18))
        });
      } else if (item.type === 'polygon') {
        base.points = normalizePolygonPoints(item.points) ||
          regularPolygonPoints(out.width / 2, out.height / 2, Math.min(out.width, out.height) * 0.22, 5);
      } else if (item.type === 'line') {
        Object.assign(base, {
          x1: num(item.x1, 300), y1: num(item.y1, 380),
          x2: num(item.x2, 660), y2: num(item.y2, 260)
        });
      } else if (item.type === 'text') {
        Object.assign(base, {
          x: num(item.x, out.width * 0.25), y: num(item.y, out.height * 0.4),
          text: typeof item.text === 'string' ? item.text : '',
          fontFamily: typeof item.fontFamily === 'string' ? item.fontFamily : '',
          fontDisplay: typeof item.fontDisplay === 'string' ? item.fontDisplay : '',
          fontSize: clamp(num(item.fontSize, 64), 1, 5000)
        });
      } else if (item.type === 'path') {
        const commands = Array.isArray(item.commands) ? item.commands : [];
        base.commands = normalizeCommands(commands);
      }
      out.shapes.push(base);
    });
    return out;
  }

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function regularPolygonPoints(cx, cy, radius, sides, startAngle = -Math.PI / 2) {
    const count = Number.isFinite(Number(sides)) ? clamp(Math.round(Number(sides)), 3, 24) : 5;
    const r = Number.isFinite(Number(radius)) ? Math.max(1, Number(radius)) : 60;
    const angle0 = Number.isFinite(Number(startAngle)) ? Number(startAngle) : -Math.PI / 2;
    return Array.from({ length: count }, (_, index) => {
      const angle = angle0 + index * Math.PI * 2 / count;
      return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });
  }

  function normalizePolygonPoints(points) {
    if (!Array.isArray(points)) return null;
    const out = [];
    points.slice(0, 24).forEach((point) => {
      if (!point) return;
      const x = num(point.x, NaN);
      const y = num(point.y, NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
    });
    return out.length >= 3 ? out : null;
  }

  function polygonMetrics(points) {
    if (!Array.isArray(points) || !points.length) {
      return { cx: 0, cy: 0, radius: 60, startAngle: -Math.PI / 2 };
    }
    const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const average = points.reduce((sum, point) => sum + Math.hypot(point.x - cx, point.y - cy), 0) / points.length;
    const first = points[0];
    return {
      cx, cy,
      radius: Number.isFinite(average) ? Math.max(8, average) : 60,
      startAngle: Math.atan2(first.y - cy, first.x - cx)
    };
  }

  function polygonPointsAttr(points) {
    return (Array.isArray(points) ? points : []).map((point) => fmt(point.x) + ',' + fmt(point.y)).join(' ');
  }

  function normalizeCommands(commands) {
    const out = [];
    commands.forEach((cmd) => {
      if (!cmd || !CMD_META[cmd.type]) return;
      const base = { id: typeof cmd.id === 'string' && cmd.id ? cmd.id : uid('c'), type: cmd.type };
      if (cmd.type === 'M' || cmd.type === 'L') {
        base.x = num(cmd.x, 200);
        base.y = num(cmd.y, 200);
      } else if (cmd.type === 'Q') {
        base.x1 = num(cmd.x1, 250);
        base.y1 = num(cmd.y1, 150);
        base.x = num(cmd.x, 320);
        base.y = num(cmd.y, 220);
      } else if (cmd.type === 'C') {
        base.x1 = num(cmd.x1, 260);
        base.y1 = num(cmd.y1, 120);
        base.x2 = num(cmd.x2, 420);
        base.y2 = num(cmd.y2, 260);
        base.x = num(cmd.x, 480);
        base.y = num(cmd.y, 180);
      } else if (cmd.type === 'A') {
        base.rx = Math.max(0.5, Math.abs(num(cmd.rx, 70)));
        base.ry = Math.max(0.5, Math.abs(num(cmd.ry, 50)));
        base.rotation = num(cmd.rotation, 0);
        base.largeArc = num(cmd.largeArc, 0) ? 1 : 0;
        base.sweep = num(cmd.sweep, 0) ? 1 : 0;
        base.x = num(cmd.x, 520);
        base.y = num(cmd.y, 240);
      }
      out.push(base);
    });
    return out;
  }

  function isValidColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  /* ------------------------------------------------------------------ *
   * History + persistence
   * ------------------------------------------------------------------ */

  function snapshot() {
    return JSON.stringify(state.doc);
  }

  function pushHistory(before) {
    if (typeof before !== 'string' || before === snapshot()) return false;
    state.undo.push(before);
    if (state.undo.length > MAX_HISTORY) state.undo.shift();
    state.redo.length = 0;
    updateHistoryButtons();
    return true;
  }

  function flushEdit() {
    if (state.editTimer) {
      clearTimeout(state.editTimer);
      state.editTimer = null;
    }
    if (state.editBefore === null) return;
    const before = state.editBefore;
    state.editBefore = null;
    pushHistory(before);
  }

  function trackEdit() {
    if (state.editBefore === null) state.editBefore = snapshot();
    if (state.editTimer) clearTimeout(state.editTimer);
    state.editTimer = setTimeout(() => {
      state.editTimer = null;
      flushEdit();
      saveNow();
    }, 650);
  }

  function undo() {
    flushEdit();
    if (!state.undo.length) return;
    const current = snapshot();
    const previous = state.undo.pop();
    state.redo.push(current);
    restoreSnapshot(previous);
    toast(t('toast.undo'));
  }

  function redo() {
    flushEdit();
    if (!state.redo.length) return;
    const current = snapshot();
    const previous = state.redo.pop();
    state.undo.push(current);
    restoreSnapshot(previous);
    toast(t('toast.redo'));
  }

  function restoreSnapshot(json) {
    try {
      state.doc = normalizeDoc(JSON.parse(json));
    } catch (error) {
      toast(t('toast.historyCorrupt'));
      return;
    }
    if (state.sourceByDoc.has(json)) {
      state.source = state.sourceByDoc.get(json) || null;
      state.sourcePersisted = false;
    }
    localizeGeneratedNames();
    const existing = new Set(state.doc.shapes.map((s) => s.id));
    state.selectedIds = state.selectedIds.filter((id) => existing.has(id));
    if (!existing.has(state.selectedId)) {
      state.selectedId = state.selectedIds.length ? state.selectedIds[state.selectedIds.length - 1] : null;
    }
    if (state.selectedIds.length !== 1) {
      state.selectedCmdId = null;
    } else {
      const selected = selectedShape();
      if (selected?.type === 'path' && !selected.commands.some((c) => c.id === state.selectedCmdId)) {
        state.selectedCmdId = lastDrawableCommand(selected)?.id || null;
      }
    }
    if (!state.selectedIds.length) state.selectedCmdId = null;
    dom.docTitle.value = state.doc.name;
    dom.crumbTitle.textContent = state.doc.name;
    renderAll();
    updateHistoryButtons();
    markDirty();
  }

  function updateHistoryButtons() {
    dom.undoBtn.disabled = state.undo.length === 0;
    dom.redoBtn.disabled = state.redo.length === 0;
  }

  function markDirty() {
    state.starter = false;
    setSaveState('saving');
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 320);
  }

  function saveNow() {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.doc));
    } catch (error) {
      setSaveState('unsaved');
      return;
    }
    try {
      if (!state.source) {
        localStorage.removeItem(SOURCE_KEY);
        state.sourcePersisted = false;
      } else if (!state.sourcePersisted) {
        saveSource();
        state.sourcePersisted = true;
      }
    } catch (error) {
      state.sourcePersisted = false;
      // The document is still saved; losing the optional source template only
      // means the next export falls back to a generated file.  Drop any stale
      // template too, rather than restoring one that does not match this doc.
      try { localStorage.removeItem(SOURCE_KEY); } catch (removeError) {}
    }
    setSaveState('saved');
  }

  function sourcePayload() {
    if (!state.source || !state.source.doc) return null;
    try {
      return {
        svg: new XMLSerializer().serializeToString(state.source.doc),
        entries: Array.from(state.source.entries.entries())
      };
    } catch (error) {
      return null;
    }
  }

  function saveSource() {
    const payload = sourcePayload();
    if (!payload) {
      localStorage.removeItem(SOURCE_KEY);
      return;
    }
    localStorage.setItem(SOURCE_KEY, JSON.stringify(payload));
  }

  function loadSavedSource() {
    try {
      const raw = localStorage.getItem(SOURCE_KEY);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (!payload || typeof payload.svg !== 'string' || !Array.isArray(payload.entries)) return null;
      const doc = new DOMParser().parseFromString(payload.svg, 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
      const entries = new Map();
      payload.entries.forEach((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) return;
        const [id, entry] = pair;
        if (typeof id !== 'string' || !entry || typeof entry.key !== 'string' || typeof entry.baseline !== 'string') return;
        entries.set(id, {
          key: entry.key,
          baseline: entry.baseline,
          ancestorOpacity: Number.isFinite(Number(entry.ancestorOpacity))
            ? clamp(Number(entry.ancestorOpacity), 0, 1)
            : 1
        });
      });
      if (!entries.size) return null;
      return { doc, root, entries };
    } catch (error) {
      return null;
    }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.shapes)) return null;
      return normalizeDoc(parsed);
    } catch (error) {
      return null;
    }
  }

  function normalizeUnderlay(raw) {
    if (!raw || typeof raw.src !== 'string' || !/^data:image\//i.test(raw.src)) return null;
    const rawWidth = num(raw.w, 0);
    const rawHeight = num(raw.h, 0);
    if (rawWidth <= 0 || rawHeight <= 0) return null;
    const width = Math.max(8, rawWidth);
    const height = Math.max(8, rawHeight);
    return {
      name: typeof raw.name === 'string' && raw.name ? raw.name : t('underlay.defaultName'),
      src: raw.src,
      x: num(raw.x, 0),
      y: num(raw.y, 0),
      w: width,
      h: height,
      naturalW: Math.max(1, num(raw.naturalW, width)),
      naturalH: Math.max(1, num(raw.naturalH, height)),
      opacity: clamp(num(raw.opacity, 0.85), 0.05, 1),
      visible: raw.visible !== false
    };
  }

  function loadUnderlay() {
    try {
      const raw = localStorage.getItem(UNDERLAY_KEY);
      if (!raw) return null;
      return normalizeUnderlay(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function saveUnderlayNow() {
    if (state.underlaySaveTimer) {
      clearTimeout(state.underlaySaveTimer);
      state.underlaySaveTimer = null;
    }
    const wasFailed = state.underlayPersistFailed;
    try {
      if (state.underlay) {
        if (state.underlay.src.length > MAX_UNDERLAY_STORE - 1000) {
          localStorage.removeItem(UNDERLAY_KEY);
          throw new Error('underlay-too-large');
        }
        const payload = JSON.stringify(state.underlay);
        if (payload.length > MAX_UNDERLAY_STORE) {
          localStorage.removeItem(UNDERLAY_KEY);
          throw new Error('underlay-too-large');
        }
        localStorage.setItem(UNDERLAY_KEY, payload);
      } else {
        localStorage.removeItem(UNDERLAY_KEY);
      }
      state.underlayWarned = false;
      state.underlayPersistFailed = false;
      if (wasFailed) renderUnderlayPanel();
    } catch (error) {
      try { localStorage.removeItem(UNDERLAY_KEY); } catch (removeError) {}
      state.underlayPersistFailed = Boolean(state.underlay);
      if (!state.underlayWarned) {
        state.underlayWarned = true;
        toast(t('toast.underlayLarge'));
      }
      renderUnderlayPanel();
    }
  }

  function markUnderlayDirty() {
    if (state.underlaySaveTimer) clearTimeout(state.underlaySaveTimer);
    state.underlaySaveTimer = setTimeout(saveUnderlayNow, 420);
  }

  /* ------------------------------------------------------------------ *
   * Geometry helpers
   * ------------------------------------------------------------------ */

  function selectedShape() {
    return state.doc.shapes.find((shape) => shape.id === state.selectedId) || null;
  }

  function selectedShapes() {
    if (!state.selectedIds.length) return [];
    const ids = new Set(state.selectedIds);
    return state.doc.shapes.filter((shape) => ids.has(shape.id));
  }

  function isSelected(id) {
    return state.selectedIds.includes(id);
  }

  function isAdditiveEvent(event) {
    return Boolean(event.shiftKey || event.metaKey || event.ctrlKey);
  }

  function applySelection(ids, primary = null) {
    const valid = new Set(Array.isArray(ids) ? ids : []);
    state.selectedIds = state.doc.shapes.filter((shape) => valid.has(shape.id)).map((shape) => shape.id);
    if (primary && valid.has(primary)) {
      state.selectedId = primary;
    } else {
      state.selectedId = state.selectedIds.length ? state.selectedIds[state.selectedIds.length - 1] : null;
    }
    if (state.selectedIds.length !== 1) {
      state.selectedCmdId = null;
      state.pathEdit = true;
    }
  }

  function shapeById(id) {
    return state.doc.shapes.find((shape) => shape.id === id) || null;
  }

  function commandPoint(cmd, key) {
    if (key === 'c1') return { x: cmd.x1, y: cmd.y1 };
    if (key === 'c2') return { x: cmd.x2, y: cmd.y2 };
    if (key === 'c') return { x: cmd.x1, y: cmd.y1 };
    return { x: cmd.x, y: cmd.y };
  }

  function pathEnd(commands, beforeIndex = commands.length) {
    let point = null;
    let first = null;
    for (let i = 0; i < beforeIndex; i += 1) {
      const cmd = commands[i];
      if (cmd.type === 'M') {
        point = { x: cmd.x, y: cmd.y };
        first = point;
      } else if (cmd.type === 'L' || cmd.type === 'Q' || cmd.type === 'C' || cmd.type === 'A') {
        point = { x: cmd.x, y: cmd.y };
      } else if (cmd.type === 'Z' && first) {
        point = { ...first };
      }
    }
    return point;
  }

  function preferredCommand(shape) {
    if (!shape || shape.type !== 'path') return null;
    return shape.commands.find((cmd) => cmd.type === 'C' || cmd.type === 'Q') || lastDrawableCommand(shape);
  }

  function lastDrawableCommand(shape) {
    if (!shape || shape.type !== 'path') return null;
    for (let i = shape.commands.length - 1; i >= 0; i -= 1) {
      if (shape.commands[i].type !== 'Z') return shape.commands[i];
    }
    return null;
  }

  function cubicAt(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
  }

  function cubicExtrema(p0, p1, p2, p3) {
    const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
    const b = 2 * (3 * p0 - 6 * p1 + 3 * p2);
    const c = -3 * p0 + 3 * p1;
    const roots = [];
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) > 1e-9) roots.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
      }
    }
    return roots.filter((t) => t > 0 && t < 1);
  }

  function arcGeometry(start, cmd) {
    const snap = (value) => Number(fmt(value));
    const startX = start ? snap(start.x) : 0;
    const startY = start ? snap(start.y) : 0;
    const endX = snap(num(cmd.x, 0));
    const endY = snap(num(cmd.y, 0));
    const rx0 = Math.abs(snap(num(cmd.rx, 0)));
    const ry0 = Math.abs(snap(num(cmd.ry, 0)));
    if (!start || !(rx0 > 1e-6) || !(ry0 > 1e-6)) return null;
    if (Math.hypot(endX - startX, endY - startY) < 1e-9) return null;

    const phi = snap(num(cmd.rotation, 0)) * Math.PI / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (startX - endX) / 2;
    const dy = (startY - endY) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    let rx = rx0;
    let ry = ry0;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      const scale = Math.sqrt(lambda);
      rx *= scale;
      ry *= scale;
    }
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    const denom = rx2 * y1p * y1p + ry2 * x1p * x1p;
    if (!(denom > 1e-12)) return null;

    const large = cmd.largeArc ? 1 : 0;
    const sweep = cmd.sweep ? 1 : 0;
    const sign = large !== sweep ? 1 : -1;
    const radicand = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
    const coef = sign * Math.sqrt(Math.max(0, radicand / denom));
    const cxp = coef * (rx * y1p / ry);
    const cyp = -coef * (ry * x1p / rx);
    const cx = cos * cxp - sin * cyp + (startX + endX) / 2;
    const cy = sin * cxp + cos * cyp + (startY + endY) / 2;
    const ux = (x1p - cxp) / rx;
    const uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx;
    const vy = (-y1p - cyp) / ry;
    const theta1 = Math.atan2(uy, ux);
    let delta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (!sweep && delta > 0) delta -= TAU;
    if (sweep && delta < 0) delta += TAU;
    return { cx, cy, rx, ry, phi, cos, sin, theta1, delta };
  }

  function arcPoint(arc, theta) {
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    return {
      x: arc.cx + arc.rx * cosT * arc.cos - arc.ry * sinT * arc.sin,
      y: arc.cy + arc.rx * cosT * arc.sin + arc.ry * sinT * arc.cos
    };
  }

  function arcContains(arc, theta) {
    let offset = theta - arc.theta1;
    if (arc.delta >= 0) {
      offset = ((offset % TAU) + TAU) % TAU;
      return offset <= arc.delta + 1e-7;
    }
    offset = ((offset % TAU) - TAU) % TAU;
    return offset >= arc.delta - 1e-7;
  }

  function arcBounds(arc, start, end, include) {
    include(start.x, start.y);
    include(end.x, end.y);
    if (!arc) return;
    const xBase = Math.atan2(-arc.ry * arc.sin, arc.rx * arc.cos);
    const yBase = Math.atan2(arc.ry * arc.cos, arc.rx * arc.sin);
    [xBase, xBase + Math.PI, yBase, yBase + Math.PI].forEach((theta) => {
      if (!arcContains(arc, theta)) return;
      const point = arcPoint(arc, theta);
      include(point.x, point.y);
    });
  }

  function pathBounds(commands) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let current = null;
    let first = null;
    const include = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    commands.forEach((cmd) => {
      if (cmd.type === 'M') {
        current = { x: cmd.x, y: cmd.y };
        first = current;
        include(cmd.x, cmd.y);
      } else if (cmd.type === 'L') {
        include(cmd.x, cmd.y);
        current = { x: cmd.x, y: cmd.y };
      } else if (cmd.type === 'Q' && current) {
        const start = current;
        const c = { x: cmd.x1, y: cmd.y1 };
        const end = { x: cmd.x, y: cmd.y };
        const ax = start.x - 2 * c.x + end.x;
        const bx = -2 * start.x + 2 * c.x;
        const ay = start.y - 2 * c.y + end.y;
        const by = -2 * start.y + 2 * c.y;
        const ts = [];
        if (Math.abs(ax) > 1e-9) ts.push(-bx / (2 * ax));
        if (Math.abs(ay) > 1e-9) ts.push(-by / (2 * ay));
        include(end.x, end.y);
        ts.filter((t) => t > 0 && t < 1).forEach((t) => {
          const mt = 1 - t;
          include(mt * mt * start.x + 2 * mt * t * c.x + t * t * end.x,
            mt * mt * start.y + 2 * mt * t * c.y + t * t * end.y);
        });
        current = end;
      } else if (cmd.type === 'C' && current) {
        const start = current;
        const c1 = { x: cmd.x1, y: cmd.y1 };
        const c2 = { x: cmd.x2, y: cmd.y2 };
        const end = { x: cmd.x, y: cmd.y };
        include(end.x, end.y);
        const ts = [
          ...cubicExtrema(start.x, c1.x, c2.x, end.x),
          ...cubicExtrema(start.y, c1.y, c2.y, end.y)
        ];
        ts.forEach((t) => {
          include(cubicAt(start.x, c1.x, c2.x, end.x, t), cubicAt(start.y, c1.y, c2.y, end.y, t));
        });
        current = end;
      } else if (cmd.type === 'A' && current) {
        const start = current;
        const end = { x: cmd.x, y: cmd.y };
        arcBounds(arcGeometry(start, cmd), start, end, include);
        current = end;
      } else if (cmd.type === 'Z') {
        if (first) current = { ...first };
      }
    });
    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function getShapeBounds(shape) {
    if (!shape) return { x: 0, y: 0, w: 0, h: 0 };
    if (shape.type === 'rect') {
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    }
    if (shape.type === 'ellipse') {
      return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
    }
    if (shape.type === 'circle') {
      return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: shape.r * 2, h: shape.r * 2 };
    }
    if (shape.type === 'polygon') {
      if (!Array.isArray(shape.points) || !shape.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
    }
    if (shape.type === 'line') {
      return {
        x: Math.min(shape.x1, shape.x2), y: Math.min(shape.y1, shape.y2),
        w: Math.abs(shape.x2 - shape.x1), h: Math.abs(shape.y2 - shape.y1)
      };
    }
    if (shape.type === 'text') {
      const m = measureText(shape.text, shape.fontSize, cachedFont(shape.fontFamily));
      return { x: shape.x, y: shape.y, w: m.width, h: m.height };
    }
    if (shape.type === 'path') {
      return pathBounds(shape.commands);
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  function translateShape(shape, dx, dy) {
    if (shape.type === 'rect') {
      shape.x += dx; shape.y += dy;
    } else if (shape.type === 'ellipse') {
      shape.cx += dx; shape.cy += dy;
    } else if (shape.type === 'circle') {
      shape.cx += dx; shape.cy += dy;
    } else if (shape.type === 'polygon') {
      shape.points.forEach((point) => { point.x += dx; point.y += dy; });
    } else if (shape.type === 'line') {
      shape.x1 += dx; shape.y1 += dy; shape.x2 += dx; shape.y2 += dy;
    } else if (shape.type === 'text') {
      shape.x += dx; shape.y += dy;
    } else if (shape.type === 'path') {
      shape.commands.forEach((cmd) => {
        ['x', 'y', 'x1', 'y1', 'x2', 'y2'].forEach((key) => {
          if (typeof cmd[key] === 'number') cmd[key] += key === 'x' || key === 'x1' || key === 'x2' ? dx : dy;
        });
      });
    }
  }

  function scalePoint(x, y, oldB, newB) {
    const sx = oldB.w > 0.001 ? (newB.w / oldB.w) : 1;
    const sy = oldB.h > 0.001 ? (newB.h / oldB.h) : 1;
    return {
      x: oldB.w > 0.001 ? newB.x + (x - oldB.x) * sx : newB.x + newB.w / 2,
      y: oldB.h > 0.001 ? newB.y + (y - oldB.y) * sy : newB.y + newB.h / 2
    };
  }

  function resizeArcCommand(cmd, start, oldB, newB) {
    const sx = oldB.w > 0.001 ? (newB.w / oldB.w) : 1;
    const sy = oldB.h > 0.001 ? (newB.h / oldB.h) : 1;
    const end = scalePoint(cmd.x, cmd.y, oldB, newB);
    const arc = arcGeometry(start, cmd);
    if (!arc) {
      return {
        x: end.x, y: end.y,
        rx: Math.max(0.5, Math.abs(num(cmd.rx, 70)) * Math.abs(sx)),
        ry: Math.max(0.5, Math.abs(num(cmd.ry, 50)) * Math.abs(sy)),
        rotation: num(cmd.rotation, 0),
        largeArc: cmd.largeArc ? 1 : 0,
        sweep: cmd.sweep ? 1 : 0
      };
    }

    const newStart = scalePoint(start.x, start.y, oldB, newB);
    const cos = Math.cos(arc.phi);
    const sin = Math.sin(arc.phi);
    const c1x = sx * arc.rx * cos;
    const c1y = sy * arc.rx * sin;
    const c2x = -sx * arc.ry * sin;
    const c2y = sy * arc.ry * cos;
    const a = c1x * c1x + c2x * c2x;
    const b = c1x * c1y + c2x * c2y;
    const d = c1y * c1y + c2y * c2y;
    const trace = a + d;
    const disc = Math.sqrt(Math.max(0, (a - d) * (a - d) + 4 * b * b));
    const rx = Math.max(0.5, Math.sqrt(Math.max(0, (trace + disc) / 2)));
    const ry = Math.max(0.5, Math.sqrt(Math.max(0, (trace - disc) / 2)));
    let rotation = Math.abs(rx - ry) < 1e-6 ? 0 : 0.5 * Math.atan2(2 * b, a - d);
    const center = scalePoint(arc.cx, arc.cy, oldB, newB);
    const localAngle = (point) => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const rc = Math.cos(rotation);
      const rs = Math.sin(rotation);
      const lx = rc * dx + rs * dy;
      const ly = -rs * dx + rc * dy;
      return Math.atan2(ly / ry, lx / rx);
    };
    const from = localAngle(newStart);
    const to = localAngle(end);
    let delta;
    if (cmd.sweep) {
      delta = ((to - from) % TAU + TAU) % TAU;
    } else {
      delta = -(((from - to) % TAU + TAU) % TAU);
    }
    return {
      x: end.x, y: end.y,
      rx, ry,
      rotation: Math.abs(rotation) < 1e-9 ? 0 : rotation * 180 / Math.PI,
      largeArc: Math.abs(delta) > Math.PI + 1e-7 ? 1 : 0,
      sweep: cmd.sweep ? 1 : 0
    };
  }

  function resizeShape(shape, original, oldB, newB) {
    if (shape.type === 'rect') {
      shape.x = newB.x; shape.y = newB.y; shape.w = Math.max(1, newB.w); shape.h = Math.max(1, newB.h);
    } else if (shape.type === 'ellipse') {
      shape.cx = newB.x + newB.w / 2;
      shape.cy = newB.y + newB.h / 2;
      shape.rx = Math.max(1, newB.w / 2);
      shape.ry = Math.max(1, newB.h / 2);
    } else if (shape.type === 'circle') {
      shape.cx = newB.x + newB.w / 2;
      shape.cy = newB.y + newB.h / 2;
      shape.r = Math.max(1, Math.min(newB.w, newB.h) / 2);
    } else if (shape.type === 'polygon') {
      shape.points = original.points.map((point) => scalePoint(point.x, point.y, oldB, newB));
    } else if (shape.type === 'line') {
      const a = scalePoint(original.x1, original.y1, oldB, newB);
      const b = scalePoint(original.x2, original.y2, oldB, newB);
      shape.x1 = a.x; shape.y1 = a.y; shape.x2 = b.x; shape.y2 = b.y;
    } else if (shape.type === 'text') {
      const sy = oldB.h > 0.001 ? newB.h / oldB.h : 1;
      shape.fontSize = Math.max(1, original.fontSize * sy);
      shape.x = newB.x;
      shape.y = newB.y;
    } else if (shape.type === 'path') {
      shape.commands = original.commands.map((cmd, index) => {
        const copy = { ...cmd };
        if (cmd.type === 'M' || cmd.type === 'L') {
          const p = scalePoint(cmd.x, cmd.y, oldB, newB);
          copy.x = p.x; copy.y = p.y;
        } else if (cmd.type === 'Q') {
          const c = scalePoint(cmd.x1, cmd.y1, oldB, newB);
          const e = scalePoint(cmd.x, cmd.y, oldB, newB);
          copy.x1 = c.x; copy.y1 = c.y; copy.x = e.x; copy.y = e.y;
        } else if (cmd.type === 'C') {
          const c1 = scalePoint(cmd.x1, cmd.y1, oldB, newB);
          const c2 = scalePoint(cmd.x2, cmd.y2, oldB, newB);
          const e = scalePoint(cmd.x, cmd.y, oldB, newB);
          copy.x1 = c1.x; copy.y1 = c1.y; copy.x2 = c2.x; copy.y2 = c2.y; copy.x = e.x; copy.y = e.y;
        } else if (cmd.type === 'A') {
          const start = pathEnd(original.commands, index);
          if (start) {
            Object.assign(copy, resizeArcCommand(cmd, start, oldB, newB));
          } else {
            const e = scalePoint(cmd.x, cmd.y, oldB, newB);
            copy.x = e.x; copy.y = e.y;
          }
        }
        return copy;
      });
    }
  }

  function resizeBounds(originalBounds, handle, dx, dy, keepRatio) {
    const b = { ...originalBounds };
    let left = b.x;
    let top = b.y;
    let right = b.x + b.w;
    let bottom = b.y + b.h;
    const minSize = 3;
    if (handle.includes('w')) left = Math.min(b.x + dx, right - minSize);
    if (handle.includes('e')) right = Math.max(b.x + b.w + dx, left + minSize);
    if (handle.includes('n')) top = Math.min(b.y + dy, bottom - minSize);
    if (handle.includes('s')) bottom = Math.max(b.y + b.h + dy, top + minSize);

    if (keepRatio && b.w > 0.001 && b.h > 0.001) {
      const ratio = b.w / b.h;
      let w = right - left;
      let h = bottom - top;
      if (Math.abs(w / h) > ratio) {
        w = h * ratio;
        if (handle.includes('w')) left = right - w; else right = left + w;
      } else {
        h = w / ratio;
        if (handle.includes('n')) top = bottom - h; else bottom = top + h;
      }
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function screenToDoc(clientX, clientY) {
    const pt = dom.stage.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = dom.stage.getScreenCTM();
    if (!ctm) return null;
    const result = pt.matrixTransform(ctm.inverse());
    return { x: result.x, y: result.y };
  }

  function clientToSvg(event) {
    const point = screenToDoc(event.clientX, event.clientY);
    return point || { x: 0, y: 0 };
  }

  /* ------------------------------------------------------------------ *
   * Local fonts (Font Access API)
   * ------------------------------------------------------------------ */

  function cachedFont(postscriptName) {
    if (!postscriptName) return null;
    const entry = state.fonts.get(postscriptName);
    return entry ? entry.font : null;
  }

  const fontLabel = (fontData) => [fontData.family, fontData.style].filter(Boolean).join(' ');

  const sortFonts = (fonts) => (Array.isArray(fonts) ? fonts.slice() : []).sort(compareFontData);

  /**
   * Read a FontData entry from disk, parse it for outlines and register the
   * same bytes as a renderable FontFace, so editing shows exactly what export
   * will bake.  Chrome exposes the bytes as `blob()` (older builds) or
   * `getFile()`.
   */
  async function loadFontData(fontData) {
    const psn = fontData.postscriptName;
    const existing = state.fonts.get(psn);
    if (existing) return existing;
    const blob = fontData.getFile ? await fontData.getFile() : await fontData.blob();
    const buffer = await blob.arrayBuffer();
    const { font, faceBuffer } = parseLocalFont(buffer, psn);
    const cssFamily = 'albedo-' + String(psn).replace(/[^A-Za-z0-9_-]/g, '');
    let face;
    try {
      face = new FontFace(cssFamily, faceBuffer);
      await face.load();
    } catch (error) {
      face = new FontFace(cssFamily, "local('" + String(psn).replace(/['\\]/g, '') + "')");
      await face.load();
    }
    document.fonts.add(face);
    const entry = { font, cssFamily, family: fontData.family || fontData.fullName || psn, style: fontData.style || '' };
    state.fonts.set(psn, entry);
    return entry;
  }

  /**
   * Load every font the text layers reference.  Returns false (with a toast)
   * when a font cannot be found or read — export refuses rather than shipping
   * `<text>` or an approximation.
   */
  async function ensureFontsForShapes() {
    const missing = [];
    for (const shape of state.doc.shapes) {
      if (shape.type !== 'text') continue;
      if (!shape.fontFamily) {
        toast(t('toast.fontNotChosen', { name: shape.name }));
        return false;
      }
      if (!state.fonts.has(shape.fontFamily) && !missing.includes(shape.fontFamily)) missing.push(shape.fontFamily);
    }
    if (!missing.length) return true;
    if (typeof window.queryLocalFonts !== 'function') {
      toast(t('toast.fontUnsupported'));
      return false;
    }
    try {
      state.localFonts = sortFonts(await window.queryLocalFonts());
    } catch (error) {
      toast(t('toast.fontDenied'));
      return false;
    }
    if (!state.localFonts.length) {
      toast(t('toast.fontDenied'));
      return false;
    }
    for (const name of missing) {
      const fontData = state.localFonts.find((item) => item.postscriptName === name);
      if (!fontData) continue;
      try {
        await loadFontData(fontData);
      } catch (error) {
        console.error('[albedo] font parse failed', name, error);
      }
    }
    const stillMissing = missing.filter((name) => !state.fonts.has(name));
    if (stillMissing.length) {
      toast(t('toast.fontMissing', { name: stillMissing[0] }));
      return false;
    }
    renderCanvas();
    return true;
  }

  function renderFontList() {
    if (dom.fontModal.hidden) return;
    const query = dom.fontSearch.value.trim().toLowerCase();
    // Chrome answers an ungranted request with an empty list rather than an
    // error, so "no fonts at all" is the permission state, not a bad search.
    const noAccess = !state.localFonts.length;
    const matched = state.localFonts.filter((fontData) => !query ||
      [fontData.family, fontData.style, fontData.fullName, fontData.postscriptName]
        .some((part) => String(part || '').toLowerCase().includes(query)));
    const shown = orderFonts(matched, state.recentFonts).slice(0, 240);
    const recentShown = query ? 0 : shown.filter((fontData) => state.recentFonts.includes(fontData.postscriptName)).length;
    dom.fontDenied.hidden = !noAccess;
    dom.fontEmpty.hidden = noAccess || shown.length > 0;
    dom.fontList.hidden = noAccess;
    const searchRow = dom.fontSearch.closest('.font-search-row');
    if (searchRow) searchRow.hidden = noAccess;
    dom.fontList.innerHTML = noAccess ? '' : shown.map((fontData, index) => {
      const preview = String(fontData.family || fontData.postscriptName || '').replace(/[^\w -]/g, '');
      const group = index === 0 && recentShown ? '<div class="font-group">' + esc(t('font.recent')) + '</div>' : '';
      return group + '<button type="button" class="font-item" data-font-ps="' + esc(fontData.postscriptName) + '">' +
        '<span style="font-family:\'' + esc(preview) + '\'">' + esc(fontLabel(fontData)) + '</span>' +
        '<em>' + esc(fontData.postscriptName) + '</em>' +
      '</button>';
    }).join('');
  }

  function queryLocalFontList() {
    dom.fontList.hidden = false;
    dom.fontList.innerHTML = '<div class="font-loading">' + esc(t('font.loading')) + '</div>';
    dom.fontDenied.hidden = true;
    dom.fontEmpty.hidden = true;
    const searchRow = dom.fontSearch.closest('.font-search-row');
    if (searchRow) searchRow.hidden = false;
    const showNoAccess = () => {
      state.localFonts = [];
      toast(t('toast.fontDenied'));
      renderFontList();
    };
    window.queryLocalFonts().then((fonts) => {
      state.localFonts = sortFonts(fonts);
      if (!state.localFonts.length) showNoAccess();
      else renderFontList();
    }).catch(showNoAccess);
  }

  function openFontModal() {
    const shape = selectedShape();
    if (!shape || shape.type !== 'text') return;
    if (typeof window.queryLocalFonts !== 'function') {
      toast(t('toast.fontUnsupported'));
      return;
    }
    state.fontTargetId = shape.id;
    dom.fontModal.hidden = false;
    dom.fontSearch.value = '';
    dom.fontSearch.placeholder = t('font.search');
    if (state.localFonts.length) {
      renderFontList();
    } else {
      queryLocalFontList();
    }
    dom.fontSearch.focus();
  }

  function closeFontModal() {
    dom.fontModal.hidden = true;
    state.fontTargetId = null;
  }

  async function applyFontChoice(postscriptName) {
    const shape = shapeById(state.fontTargetId);
    const fontData = state.localFonts.find((item) => item.postscriptName === postscriptName);
    closeFontModal();
    if (!shape || !fontData) return;
    try {
      const entry = await loadFontData(fontData);
      flushEdit();
      const before = snapshot();
      shape.fontFamily = fontData.postscriptName;
      shape.fontDisplay = [entry.family, entry.style].filter(Boolean).join(' ');
      state.recentFonts = pushRecentFont(localStorage, fontData.postscriptName);
      pushHistory(before);
      renderAll();
      markDirty();
      toast(t('toast.fontApplied', { name: shape.fontDisplay || postscriptName }));
    } catch (error) {
      console.error('[albedo] font load failed', error);
      toast(t('toast.fontFailed', { name: postscriptName }));
    }
  }

  /* ------------------------------------------------------------------ *
   * Canvas rendering
   * ------------------------------------------------------------------ */

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) el.setAttribute(key, String(value));
    });
    return el;
  }

  function shapeAttrs(shape) {
    const attrs = {
      fill: shape.type === 'line' ? 'none' : shape.fill,
      stroke: shape.stroke,
      'stroke-width': shape.strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      opacity: shape.opacity
    };
    if (shape.stroke === 'none' || shape.strokeWidth === 0) attrs.stroke = 'none';
    return attrs;
  }

  function createShapeElement(shape) {
    const group = svgEl('g', { class: 'shape', 'data-id': shape.id });
    const common = shapeAttrs(shape);
    if (shape.type === 'rect') {
      group.appendChild(svgEl('rect', {
        ...common, x: shape.x, y: shape.y, width: shape.w, height: shape.h,
        rx: clamp(shape.rx, 0, Math.min(shape.w, shape.h) / 2)
      }));
    } else if (shape.type === 'ellipse') {
      group.appendChild(svgEl('ellipse', {
        ...common, cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry
      }));
    } else if (shape.type === 'circle') {
      group.appendChild(svgEl('circle', {
        ...common, cx: shape.cx, cy: shape.cy, r: shape.r
      }));
    } else if (shape.type === 'polygon') {
      group.appendChild(svgEl('polygon', {
        ...common, points: polygonPointsAttr(shape.points)
      }));
    } else if (shape.type === 'line') {
      const hit = svgEl('line', {
        x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2,
        stroke: 'transparent', 'stroke-width': Math.max(16, shape.strokeWidth + 12),
        class: 'shape-hit', 'stroke-linecap': 'round'
      });
      group.appendChild(hit);
      group.appendChild(svgEl('line', {
        ...common, x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2
      }));
    } else if (shape.type === 'text') {
      const entry = shape.fontFamily ? state.fonts.get(shape.fontFamily) : null;
      const textEl = svgEl('text', {
        ...common,
        x: shape.x,
        y: textBaselineY(shape, entry ? entry.font : null),
        'font-family': entry ? entry.cssFamily : 'sans-serif',
        'font-size': shape.fontSize
      });
      textEl.textContent = shape.text || ' ';
      group.appendChild(textEl);
    } else if (shape.type === 'path') {
      const d = pathData(shape.commands);
      const hit = svgEl('path', {
        d, fill: 'none', stroke: 'transparent',
        'stroke-width': Math.max(16, shape.strokeWidth + 12),
        class: 'shape-hit', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      });
      group.appendChild(hit);
      group.appendChild(svgEl('path', {
        ...common,
        d,
        'fill-rule': shape.fillRule === 'evenodd' ? 'evenodd' : null
      }));
    }
    return group;
  }

  function updateCanvasChrome() {
    const { width, height } = state.doc;
    const size = width + ' × ' + height;
    dom.stage.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    dom.stage.setAttribute('aria-label', t('canvas.stageAria', { size }));
    dom.canvasBg.setAttribute('width', width);
    dom.canvasBg.setAttribute('height', height);
    dom.canvasSizeLabel.textContent = size;
    dom.canvasSizeBtn.title = t('canvas.changeSizeCurrent', { size });
    const stat = $('#docSizeStat');
    if (stat) stat.textContent = size;
  }

  function syncAssistControls() {
    if (dom.gridToggle) dom.gridToggle.checked = state.grid.visible;
    if (dom.gridSize) dom.gridSize.value = String(state.grid.size);
    if (dom.snapToggle) dom.snapToggle.checked = state.snapEnabled;
  }

  function renderGrid() {
    if (!dom.gridLayer || !dom.stageDefs) return;
    dom.gridLayer.replaceChildren();
    dom.stageDefs.replaceChildren();
    const size = Number(state.grid.size) || 8;
    if (!state.grid.visible || size <= 0) return;
    const pattern = svgEl('pattern', {
      id: 'gridPattern',
      width: size,
      height: size,
      patternUnits: 'userSpaceOnUse'
    });
    pattern.appendChild(svgEl('path', {
      d: 'M ' + fmt(size) + ' 0 L 0 0 L 0 ' + fmt(size),
      fill: 'none',
      stroke: '#171a1f',
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
      opacity: 0.13
    }));
    dom.stageDefs.appendChild(pattern);
    dom.gridLayer.appendChild(svgEl('rect', {
      x: 0,
      y: 0,
      width: state.doc.width,
      height: state.doc.height,
      fill: 'url(#gridPattern)'
    }));
  }

  function fitArtboard(anchor) {
    if (!state.doc || !dom.stageBody || !dom.artboardWrap) return;
    const availW = Math.max(1, dom.stageBody.clientWidth - 68);
    const availH = Math.max(1, dom.stageBody.clientHeight - 52);
    const ratio = state.doc.width / state.doc.height;
    let displayW = Math.min(availW, 980);
    let displayH = displayW / ratio;
    if (displayH > availH) {
      displayH = availH;
      displayW = displayH * ratio;
    }
    const zoom = clampZoom(state.zoom);
    // The point to keep under the cursor, in doc units. The artboard is
    // centered while it fits and flush-left/top once it overflows, so the
    // anchor has to be tracked through the CTM, not through the size ratio.
    const anchorPoint = anchor ? screenToDoc(anchor.x, anchor.y) : null;
    const width = Math.max(1, Math.floor(displayW * zoom));
    const height = Math.max(1, Math.floor(displayH * zoom));
    dom.artboardWrap.style.width = width + 'px';
    dom.artboardWrap.style.height = height + 'px';

    if (anchorPoint) {
      const m = dom.stage.getScreenCTM();
      if (m) {
        dom.stageBody.scrollLeft += m.a * anchorPoint.x + m.c * anchorPoint.y + m.e - anchor.x;
        dom.stageBody.scrollTop += m.b * anchorPoint.x + m.d * anchorPoint.y + m.f - anchor.y;
      }
    }

    const ctm = dom.stage.getScreenCTM();
    const nextScale = ctm && ctm.a > 0
      ? 1 / ctm.a
      : state.doc.width / Math.max(1, width);
    if (Math.abs(nextScale - uiScaleValue()) > 0.0005) {
      state.uiScale = nextScale;
      renderOverlay();
    }
    updateZoomChrome();
  }

  function updateZoomChrome() {
    const zoom = clampZoom(state.zoom);
    if (!dom.zoomLabel) return;
    dom.zoomLabel.textContent = zoomPercent(zoom);
    const atMin = zoom <= ZOOM_MIN;
    const atMax = zoom >= ZOOM_MAX;
    if (dom.zoomOutBtn) dom.zoomOutBtn.disabled = atMin;
    if (dom.zoomInBtn) dom.zoomInBtn.disabled = atMax;
  }

  function centerAnchor() {
    const rect = dom.stageBody.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function setZoom(next, anchor = centerAnchor()) {
    const value = clampZoom(next);
    if (value === clampZoom(state.zoom)) return;
    state.zoom = value;
    fitArtboard(anchor);
  }

  function renderUnderlay() {
    const u = state.underlay;
    dom.underlayLayer.replaceChildren();
    if (u && u.visible) {
      dom.underlayLayer.appendChild(svgEl('image', {
        href: u.src,
        x: u.x,
        y: u.y,
        width: u.w,
        height: u.h,
        opacity: u.opacity,
        preserveAspectRatio: 'none',
        'aria-hidden': 'true'
      }));
    }
    dom.emptyCanvas.classList.toggle('hidden', state.doc.shapes.length > 0 || Boolean(u?.visible));
  }

  function syncUnderlayImage() {
    const u = state.underlay;
    const image = dom.underlayLayer.querySelector('image');
    if (!u || !u.visible || !image) {
      renderUnderlay();
      return;
    }
    image.setAttribute('x', String(u.x));
    image.setAttribute('y', String(u.y));
    image.setAttribute('width', String(u.w));
    image.setAttribute('height', String(u.h));
    image.setAttribute('opacity', String(u.opacity));
  }

  function renderCanvas() {
    updateCanvasChrome();
    dom.canvasBg.setAttribute('fill', state.doc.background);
    const fragment = document.createDocumentFragment();
    state.doc.shapes.forEach((shape) => fragment.appendChild(createShapeElement(shape)));
    dom.shapeLayer.replaceChildren(fragment);
    dom.emptyCanvas.classList.toggle('hidden', state.doc.shapes.length > 0 || Boolean(state.underlay?.visible));
    renderOverlay();
    updateStatus();
  }

  function renderAll() {
    dom.canvasBg.setAttribute('fill', state.doc.background);
    dom.docTitle.value = state.doc.name;
    dom.crumbTitle.textContent = state.doc.name || t('doc.untitled');
    renderGrid();
    renderUnderlay();
    renderCanvas();
    renderLayers();
    renderInspector();
    renderUnderlayPanel();
    updateHistoryButtons();
    updateCanvasTip();
    fitArtboard();
    updatePanelRails();
  }

  function renderOverlay() {
    const shapes = selectedShapes();
    dom.overlay.replaceChildren();
    if (shapes.length === 1) {
      const shape = shapes[0];
      if (shape.type === 'path' && state.pathEdit) {
        renderPathOverlay(shape);
      } else {
        renderBoxOverlay(shape);
      }
    } else if (shapes.length > 1) {
      renderMultiBoxOverlay(shapes);
    }
    if (!shapes.length && state.underlayAdjust && state.underlay?.visible) {
      renderUnderlayOverlay();
    }
    if (state.marquee) renderMarquee();
    renderSnapGuides();
    updateCanvasTip();
  }

  function selectionFrame(bounds, label, handleOrder) {
    const scale = uiScaleValue();
    const frag = document.createDocumentFragment();
    frag.appendChild(svgEl('rect', {
      class: 'selection-box', x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h,
      'stroke-width': uiSize(1.2), 'stroke-dasharray': uiSize(4) + ' ' + uiSize(3)
    }));

    const positions = {
      nw: [bounds.x, bounds.y], n: [bounds.x + bounds.w / 2, bounds.y], ne: [bounds.x + bounds.w, bounds.y],
      e: [bounds.x + bounds.w, bounds.y + bounds.h / 2], se: [bounds.x + bounds.w, bounds.y + bounds.h],
      s: [bounds.x + bounds.w / 2, bounds.y + bounds.h], sw: [bounds.x, bounds.y + bounds.h], w: [bounds.x, bounds.y + bounds.h / 2]
    };
    const cursors = {
      nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
      se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize'
    };
    (handleOrder || Object.keys(positions)).forEach((handle) => {
      const [x, y] = positions[handle];
      const g = svgEl('g', {
        class: 'sel-handle-g', 'data-handle': handle,
        style: 'cursor:' + cursors[handle], transform: uiTransform(x, y)
      });
      g.appendChild(svgEl('circle', { class: 'handle-hit', cx: 0, cy: 0, r: 11 }));
      g.appendChild(svgEl('rect', {
        class: 'handle-visual', x: -4, y: -4, width: 8, height: 8, rx: 1.4
      }));
      frag.appendChild(g);
    });

    const labelW = Math.max(64, label.length * 6.2 + 16);
    const labelWArt = labelW * scale;
    const margin = 4 * scale;
    const labelX = clamp(
      bounds.x + bounds.w / 2 - labelWArt / 2,
      margin,
      Math.max(margin, state.doc.width - labelWArt - margin)
    );
    let labelY = bounds.y - 25 * scale;
    if (labelY < margin) labelY = bounds.y + bounds.h + 8 * scale;
    labelY = clamp(labelY, margin, Math.max(margin, state.doc.height - 18 * scale - margin));
    const labelGroup = svgEl('g', { class: 'selection-label', transform: uiTransform(labelX, labelY) });
    labelGroup.appendChild(svgEl('rect', { class: 'sel-size-bg', width: labelW, height: 18, rx: 3 }));
    const labelNode = svgEl('text', {
      class: 'sel-size-text', x: labelW / 2, y: 12, 'text-anchor': 'middle'
    });
    labelNode.textContent = label;
    labelGroup.appendChild(labelNode);
    frag.appendChild(labelGroup);
    dom.overlay.appendChild(frag);
  }

  function renderBoxOverlay(shape) {
    const b = getShapeBounds(shape);
    const label = shape.type === 'circle'
      ? 'R ' + Math.round(shape.r)
      : Math.round(b.w) + ' × ' + Math.round(b.h);
    selectionFrame(b, label, shape.type === 'circle' ? ['nw', 'ne', 'se', 'sw'] : null);
  }

  function renderMultiBoxOverlay(shapes) {
    const b = unionBounds(shapes.map((shape) => getShapeBounds(shape)));
    if (!b) return;
    selectionFrame(b, tc('selection.multiLabel', shapes.length, { w: Math.round(b.w), h: Math.round(b.h) }));
  }

  function renderMarquee() {
    const m = state.marquee;
    if (!m) return;
    dom.overlay.appendChild(svgEl('rect', {
      class: 'marquee', x: m.x, y: m.y, width: m.w, height: m.h,
      'stroke-width': uiSize(1),
      'stroke-dasharray': uiSize(3) + ' ' + uiSize(3)
    }));
  }

  function renderSnapGuides() {
    if (!state.snapGuides.length) return;
    const { width, height } = state.doc;
    state.snapGuides.forEach((guide) => {
      const line = guide.axis === 'x'
        ? { x1: guide.value, y1: 0, x2: guide.value, y2: height }
        : { x1: 0, y1: guide.value, x2: width, y2: guide.value };
      dom.overlay.appendChild(svgEl('line', {
        ...line,
        class: 'snap-guide ' + (guide.kind || 'shape'),
        'stroke-width': uiSize(1),
        'stroke-dasharray': uiSize(4) + ' ' + uiSize(3)
      }));
    });
  }

  function renderPathOverlay(shape) {
    const frag = document.createDocumentFragment();

    const anchors = [];
    const controls = [];
    const guides = [];
    let current = null;
    let first = null;

    shape.commands.forEach((cmd) => {
      const active = cmd.id === state.selectedCmdId;
      if (cmd.type === 'M') {
        current = { x: cmd.x, y: cmd.y };
        first = current;
        anchors.push({ cmd, point: current, active });
        return;
      }
      if (!current) return;

      if (cmd.type === 'L') {
        const end = { x: cmd.x, y: cmd.y };
        if (active) {
          frag.appendChild(svgEl('path', {
            class: 'active-segment', 'stroke-width': uiSize(2.6),
            d: 'M ' + fmt(current.x) + ' ' + fmt(current.y) + ' L ' + fmt(end.x) + ' ' + fmt(end.y)
          }));
        }
        anchors.push({ cmd, point: end, active });
        current = end;
      } else if (cmd.type === 'Q') {
        const control = { x: cmd.x1, y: cmd.y1 };
        const end = { x: cmd.x, y: cmd.y };
        if (active) {
          frag.appendChild(svgEl('path', {
            class: 'active-segment', 'stroke-width': uiSize(2.6),
            d: 'M ' + fmt(current.x) + ' ' + fmt(current.y) + ' Q ' + fmt(control.x) + ' ' + fmt(control.y) + ' ' + fmt(end.x) + ' ' + fmt(end.y)
          }));
        }
        guides.push({ a: current, b: control, active });
        guides.push({ a: end, b: control, active });
        controls.push({ cmd, part: 'c', point: control, active });
        anchors.push({ cmd, point: end, active });
        current = end;
      } else if (cmd.type === 'C') {
        const c1 = { x: cmd.x1, y: cmd.y1 };
        const c2 = { x: cmd.x2, y: cmd.y2 };
        const end = { x: cmd.x, y: cmd.y };
        if (active) {
          frag.appendChild(svgEl('path', {
            class: 'active-segment', 'stroke-width': uiSize(2.6),
            d: 'M ' + fmt(current.x) + ' ' + fmt(current.y) + ' C ' + fmt(c1.x) + ' ' + fmt(c1.y) + ' ' + fmt(c2.x) + ' ' + fmt(c2.y) + ' ' + fmt(end.x) + ' ' + fmt(end.y)
          }));
        }
        guides.push({ a: current, b: c1, active });
        guides.push({ a: end, b: c2, active });
        controls.push({ cmd, part: 'c1', point: c1, active });
        controls.push({ cmd, part: 'c2', point: c2, active });
        anchors.push({ cmd, point: end, active });
        current = end;
      } else if (cmd.type === 'A') {
        const end = { x: cmd.x, y: cmd.y };
        if (active) {
          frag.appendChild(svgEl('path', {
            class: 'active-segment', 'stroke-width': uiSize(2.6),
            d: pathData([{ type: 'M', x: current.x, y: current.y }, cmd])
          }));
        }
        anchors.push({ cmd, point: end, active });
        current = end;
      } else if (cmd.type === 'Z') {
        if (first) current = { ...first };
      }
    });

    guides.forEach((guide) => {
      frag.appendChild(svgEl('line', {
        class: 'guide-line' + (guide.active ? ' active' : ''),
        x1: guide.a.x, y1: guide.a.y, x2: guide.b.x, y2: guide.b.y,
        'stroke-width': uiSize(guide.active ? 1.35 : 1),
        'stroke-dasharray': uiSize(4) + ' ' + uiSize(4)
      }));
    });

    anchors.forEach((entry) => {
      const { point, cmd, active } = entry;
      const g = svgEl('g', {
        class: 'node' + (active ? ' is-active' : ''),
        'data-node': 'anchor', 'data-cmd': cmd.id,
        transform: uiTransform(point.x, point.y)
      });
      g.appendChild(svgEl('circle', { class: 'node-hit', cx: 0, cy: 0, r: 11 }));
      g.appendChild(svgEl('rect', {
        class: 'node-anchor' + (active ? ' is-active' : ''),
        x: -4.2, y: -4.2, width: 8.4, height: 8.4, rx: 1
      }));
      frag.appendChild(g);
    });

    controls.forEach((entry) => {
      const { point, cmd, part, active } = entry;
      const g = svgEl('g', {
        class: 'node' + (active ? ' is-active' : ''),
        'data-node': 'control', 'data-cmd': cmd.id, 'data-part': part,
        transform: uiTransform(point.x, point.y)
      });
      g.appendChild(svgEl('circle', { class: 'node-hit', cx: 0, cy: 0, r: 10 }));
      g.appendChild(svgEl('circle', {
        class: 'node-control' + (active ? ' is-active' : ''),
        cx: 0, cy: 0, r: 3.9
      }));
      if (active) {
        const label = part === 'c1' ? 'C1' : part === 'c2' ? 'C2' : 'Q';
        const labelNode = svgEl('text', { class: 'node-label', x: 7, y: -7 });
        labelNode.textContent = label;
        g.appendChild(labelNode);
      }
      frag.appendChild(g);
    });

    dom.overlay.appendChild(frag);
  }

  function renderUnderlayOverlay() {
    const u = state.underlay;
    if (!u) return;
    const frag = document.createDocumentFragment();
    frag.appendChild(svgEl('rect', {
      class: 'underlay-hit',
      x: u.x, y: u.y, width: u.w, height: u.h,
      'data-underlay': 'move'
    }));
    frag.appendChild(svgEl('rect', {
      class: 'underlay-frame',
      x: u.x, y: u.y, width: u.w, height: u.h,
      'stroke-width': uiSize(1.5),
      'stroke-dasharray': uiSize(7) + ' ' + uiSize(5)
    }));

    const scale = uiScaleValue();
    const text = t('underlay.overlayLabel');
    const labelW = 126;
    const labelH = 18;
    const labelWArt = labelW * scale;
    const labelHArt = labelH * scale;
    const margin = 4 * scale;
    const labelX = clamp(
      u.x + 3 * scale,
      margin,
      Math.max(margin, state.doc.width - labelWArt - margin)
    );
    let labelY = u.y >= labelHArt + 8 * scale ? u.y - labelHArt - 5 * scale : u.y + 8 * scale;
    labelY = clamp(labelY, margin, Math.max(margin, state.doc.height - labelHArt - margin));
    const label = svgEl('g', { transform: uiTransform(labelX, labelY) });
    label.appendChild(svgEl('rect', { class: 'underlay-label-bg', width: labelW, height: labelH, rx: 3 }));
    const labelText = svgEl('text', { class: 'underlay-label', x: 8, y: 12 });
    labelText.textContent = text;
    label.appendChild(labelText);
    frag.appendChild(label);

    const corners = {
      nw: [u.x, u.y, 'nwse-resize'],
      ne: [u.x + u.w, u.y, 'nesw-resize'],
      se: [u.x + u.w, u.y + u.h, 'nwse-resize'],
      sw: [u.x, u.y + u.h, 'nesw-resize']
    };
    const handleMargin = 6 * scale;
    Object.entries(corners).forEach(([corner, [x, y, cursor]]) => {
      const handleX = clamp(x, handleMargin, Math.max(handleMargin, state.doc.width - handleMargin));
      const handleY = clamp(y, handleMargin, Math.max(handleMargin, state.doc.height - handleMargin));
      const g = svgEl('g', {
        class: 'underlay-handle-g',
        'data-underlay': corner,
        style: 'cursor:' + cursor,
        transform: uiTransform(handleX, handleY)
      });
      g.appendChild(svgEl('circle', { class: 'handle-hit', cx: 0, cy: 0, r: 12 }));
      g.appendChild(svgEl('rect', {
        class: 'underlay-handle',
        x: -4.2, y: -4.2, width: 8.4, height: 8.4, rx: 1.2
      }));
      frag.appendChild(g);
    });

    dom.overlay.appendChild(frag);
  }

  function updateCanvasTip() {
    const shape = selectedShape();
    const show = Boolean(shape && shape.type === 'path' && state.pathEdit && !state.tipDismissed);
    dom.canvasTip.classList.toggle('hidden', !show);
  }

  /* ------------------------------------------------------------------ *
   * Inspector
   * ------------------------------------------------------------------ */

  function typeIcon(type) {
    if (type === 'rect') return '<span class="mini-rect"></span>';
    if (type === 'ellipse') return '<span class="mini-ellipse"></span>';
    if (type === 'circle') return '<span class="mini-circle"></span>';
    if (type === 'polygon') {
      return '<svg class="mini-polygon" viewBox="0 0 20 20" aria-hidden="true">' +
        '<polygon points="10,2 18,8 15,18 5,18 2,8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"></polygon>' +
      '</svg>';
    }
    if (type === 'line') return '<span class="mini-line"></span>';
    if (type === 'text') return '<span class="mini-text">A</span>';
    return '<span class="mini-path">∿</span>';
  }

  function inputField(label, prop, value, step = 1, unit = '') {
    return '<div class="field">' +
      '<label>' + esc(label) + (unit ? ' · ' + unit : '') + '</label>' +
      '<div class="input-shell"><input type="number" data-prop="' + prop + '" data-cast="number" step="' + step + '" value="' + esc(fmt(value)) + '"></div>' +
      '</div>';
  }

  function colorField(label, prop, value, allowNone = true) {
    const isNone = value === 'none';
    const display = isNone ? '' : value;
    return '<div class="color-field field full">' +
      '<div class="field-label">' + esc(label) + '</div>' +
      '<div class="color-control">' +
        '<label class="swatch' + (isNone ? ' is-none' : '') + '" style="--swatch:' + (isNone ? 'transparent' : esc(value)) + '" title="' + esc(t('inspector.swatchTitle')) + '">' +
          '<input type="color" data-prop="' + prop + '" value="' + (isNone ? '#000000' : esc(value)) + '" aria-label="' + esc(label) + '">' +
        '</label>' +
        '<div class="hex-box"><input type="text" data-prop="' + prop + '" data-color-text="true" maxlength="7" placeholder="' + esc(t('inspector.none')) + '" value="' + esc(display) + '" aria-label="' + esc(t('inspector.hexAria', { label })) + '"></div>' +
        (allowNone ? '<button type="button" class="none-chip' + (isNone ? ' active' : '') + '" data-set-none="' + prop + '">' + esc(t('inspector.none')) + '</button>' : '') +
      '</div>' +
      '</div>';
  }

  function renderUnderlayPanel() {
    const u = state.underlay;
    dom.underlayEmpty.hidden = Boolean(u);
    dom.underlayControls.hidden = !u;
    const newBtn = $('#newBtn');
    if (newBtn) newBtn.title = u ? t('action.newKeepTitle') : t('action.newTitle');
    if (!u) {
      dom.underlayThumb.removeAttribute('src');
      dom.underlayHint.hidden = true;
      return;
    }
    if (dom.underlayThumb.getAttribute('src') !== u.src) dom.underlayThumb.src = u.src;
    dom.underlayThumb.alt = u.name;
    dom.underlayName.textContent = u.name;
    dom.underlayName.title = u.name;
    if (state.underlayPersistFailed) {
      dom.underlayMeta.textContent = t('underlay.metaUnsaved');
      dom.underlayMeta.title = t('underlay.metaUnsavedTitle');
      dom.underlayMeta.classList.add('is-warning');
    } else {
      dom.underlayMeta.textContent = Math.round(u.naturalW) + ' × ' + Math.round(u.naturalH) + ' px';
      dom.underlayMeta.removeAttribute('title');
      dom.underlayMeta.classList.remove('is-warning');
    }
    dom.underlayVisibleBtn.textContent = u.visible ? t('underlay.visible') : t('underlay.hidden');
    dom.underlayVisibleBtn.title = u.visible ? t('underlay.visibleTitleOn') : t('underlay.visibleTitleOff');
    dom.underlayVisibleBtn.classList.toggle('is-off', !u.visible);
    dom.underlayVisibleBtn.setAttribute('aria-pressed', String(u.visible));
    dom.underlayAdjustBtn.textContent = state.underlayAdjust ? t('underlay.done') : t('underlay.adjust');
    dom.underlayAdjustBtn.title = state.underlayAdjust ? t('underlay.adjustTitleOn') : t('underlay.adjustTitleOff');
    dom.underlayAdjustBtn.classList.toggle('active', state.underlayAdjust);
    dom.underlayAdjustBtn.disabled = !u.visible;
    dom.underlayAdjustBtn.setAttribute('aria-pressed', String(state.underlayAdjust));
    dom.underlayHint.textContent = state.doc.shapes.length
      ? t('underlay.inspectorHintMoving')
      : t('underlay.inspectorHint');
    dom.underlayHint.hidden = !state.underlayAdjust;
  }

  function renderPolygonInspector(shape) {
    let vertices = '';
    shape.points.forEach((point, index) => {
      const number = index + 1;
      vertices += '<div class="poly-vertex-row">' +
        '<span class="poly-vertex-index">P' + number + '</span>' +
        '<div class="input-shell"><span class="prefix">X</span>' +
          '<input type="number" data-poly-point="' + index + '" data-poly-axis="x" step="1" value="' + esc(fmt(point.x)) + '" aria-label="' + esc(t('inspector.vertexAria', { n: number, axis: 'X' })) + '">' +
        '</div>' +
        '<div class="input-shell"><span class="prefix">Y</span>' +
          '<input type="number" data-poly-point="' + index + '" data-poly-axis="y" step="1" value="' + esc(fmt(point.y)) + '" aria-label="' + esc(t('inspector.vertexAria', { n: number, axis: 'Y' })) + '">' +
        '</div>' +
      '</div>';
    });

    return '<section class="ins-section" data-rail-section="geometry">' +
      '<div class="ins-section-head"><h2>' + esc(t('inspector.geometry')) + '</h2><span class="rule"></span><span class="tiny">GEOMETRY</span></div>' +
      '<div class="field-grid">' +
        '<div class="field full"><label>' + esc(t('inspector.sides')) + '</label><div class="input-shell">' +
          '<input type="number" data-poly-sides min="3" max="24" step="1" value="' + shape.points.length + '" aria-label="' + esc(t('inspector.sidesAria')) + '">' +
        '</div></div>' +
      '</div>' +
      '<p class="field-hint">' + esc(t('inspector.polygonHint')) + '</p>' +
    '</section>' +
    '<section class="ins-section" data-rail-section="vertices">' +
      '<div class="ins-section-head"><h2>' + esc(t('inspector.vertices')) + '</h2><span class="rule"></span><span class="tiny">VERTICES</span></div>' +
      '<div class="poly-vertex-list">' + vertices + '</div>' +
    '</section>';
  }

  function refreshInspectorGeometry() {
    const shapes = selectedShapes();
    if (shapes.length > 1) {
      const label = dom.inspector.querySelector('.multi-head p');
      if (label) {
        const bounds = unionBounds(shapes.map((shape) => getShapeBounds(shape)));
        label.textContent = t('selection.subtitle', { w: Math.round(bounds.w), h: Math.round(bounds.h) });
      }
      return;
    }
    const shape = shapes[0];
    if (!shape || document.activeElement?.matches?.('[data-prop], [data-cmd-key]')) return;
    const props = shape.type === 'rect' ? ['x', 'y', 'w', 'h', 'rx']
      : shape.type === 'ellipse' ? ['cx', 'cy', 'rx', 'ry']
        : shape.type === 'circle' ? ['cx', 'cy', 'r']
          : shape.type === 'line' ? ['x1', 'y1', 'x2', 'y2']
            : [];
    props.forEach((prop) => {
      const input = dom.inspector.querySelector('input[data-prop="' + prop + '"]');
      if (input) input.value = fmt(shape[prop]);
    });
    if (shape.type === 'path' && state.selectedCmdId) {
      const cmd = shape.commands.find((item) => item.id === state.selectedCmdId);
      if (cmd) {
        dom.inspector.querySelectorAll('[data-cmd-key]').forEach((input) => {
          const key = input.dataset.cmdKey;
          if (input.dataset.cmdId === cmd.id && Number.isFinite(Number(cmd[key]))) {
            input.value = fmt(cmd[key]);
          }
        });
      }
    }
  }

  function alignControlsMarkup(scopeKey) {
    const buttons = [
      ['left', '⇤', 'align.left'],
      ['center', '↔', 'align.center'],
      ['right', '⇥', 'align.right'],
      ['top', '⇡', 'align.top'],
      ['middle', '↕', 'align.middle'],
      ['bottom', '⇣', 'align.bottom']
    ];
    const scope = t(scopeKey);
    return '<div class="align-grid">' + buttons.map(([mode, glyph, key]) => {
      const label = t(key);
      return '<button type="button" class="tool-btn" data-align="' + mode + '" title="' + esc(label + ' · ' + scope) + '">' +
        '<span class="tool-glyph">' + glyph + '</span><span>' + esc(label) + '</span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function renderMultiInspector(shapes) {
    const scrollTop = dom.inspector.scrollTop;
    const b = unionBounds(shapes.map((shape) => getShapeBounds(shape)));
    const canBoolean = shapes.every((shape) => shape.type !== 'line');
    const canDistribute = shapes.length >= 3;
    const opButtons = Object.entries(BOOLEAN_META).map(([op, meta]) => {
      const label = t(meta.labelKey);
      return '<button type="button" class="op-btn" data-boolean="' + op + '" title="' + esc(t(meta.titleKey)) + '"' +
        (canBoolean ? '' : ' disabled') + '><b>' + esc(label) + '</b><span>' + op + '</span></button>';
    }).join('');
    const html = '<div class="inspector-head multi-head">' +
        '<div class="inspector-icon"><span class="multi-count">' + shapes.length + '</span></div>' +
        '<div class="inspector-title-block">' +
          '<h1>' + esc(tc('selection.title', shapes.length)) + '</h1>' +
          '<p>' + esc(t('selection.subtitle', { w: Math.round(b.w), h: Math.round(b.h) })) + '</p>' +
        '</div>' +
        '<div class="inspector-actions">' +
          '<button class="mini-btn" data-action="duplicate" title="' + esc(t('selection.duplicate')) + '" aria-label="' + esc(t('selection.duplicateAria')) + '">⧉</button>' +
          '<button class="mini-btn danger" data-action="delete" title="' + esc(t('selection.delete')) + '" aria-label="' + esc(t('selection.deleteAria')) + '">✕</button>' +
        '</div>' +
      '</div>' +
      '<section class="ins-section" data-rail-section="operations">' +
        '<div class="ins-section-head"><h2>' + esc(t('boolean.pathOperations')) + '</h2><span class="rule"></span><span class="tiny">PAPER.JS</span></div>' +
        '<div class="op-grid">' + opButtons + '</div>' +
        '<p class="panel-hint">' + esc(t('boolean.hint')) + '</p>' +
      '</section>' +
      '<section class="ins-section" data-rail-section="align">' +
        '<div class="ins-section-head"><h2>' + esc(t('align.title')) + '</h2><span class="rule"></span><span class="tiny">' + (canDistribute ? 'SELECTION' : 'NEED 3+') + '</span></div>' +
        alignControlsMarkup('align.scopeSelection') +
        '<div class="distribute-row">' +
          '<button type="button" class="tool-btn wide" data-distribute="x"' + (canDistribute ? '' : ' disabled') + ' title="' + esc(t('align.distributeXTitle')) + '"><span class="tool-glyph">⇹</span><span>' + esc(t('align.distributeX')) + '</span></button>' +
          '<button type="button" class="tool-btn wide" data-distribute="y"' + (canDistribute ? '' : ' disabled') + ' title="' + esc(t('align.distributeYTitle')) + '"><span class="tool-glyph">⇳</span><span>' + esc(t('align.distributeY')) + '</span></button>' +
        '</div>' +
      '</section>' +
      '<section class="ins-section compact" data-rail-section="tips">' +
        '<div class="ins-section-head"><h2>' + esc(t('align.tipsTitle')) + '</h2><span class="rule"></span><span class="tiny">TIPS</span></div>' +
        '<p class="panel-hint">' + esc(t('align.tips')) + '</p>' +
      '</section>';
    dom.inspector.innerHTML = html;
    dom.inspector.scrollTop = scrollTop;
  }

  function renderInspectorContent() {
    const shapes = selectedShapes();
    if (shapes.length > 1) {
      renderMultiInspector(shapes);
      return;
    }
    const shape = shapes[0] || null;
    if (!shape) {
      if (state.underlayAdjust && state.underlay?.visible) {
        renderUnderlayInspector();
        return;
      }
      renderEmptyInspector();
      return;
    }
    const scrollTop = dom.inspector.scrollTop;
    const type = shape.type;
    const commands = type === 'path' ? shape.commands : [];
    const subtitle = type === 'path'
      ? tc('inspector.commandsCount', commands.length)
      : type === 'polygon'
        ? tc('inspector.verticesCount', shape.points.length)
        : type.toUpperCase();
    let html = '';

    html += '<div class="inspector-head">' +
      '<div class="inspector-icon">' + typeIcon(type) + '</div>' +
      '<div class="inspector-title-block">' +
        '<h1>' + esc(typeTitle(type)) + '</h1>' +
        '<p>' + esc(shape.name) + ' · ' + esc(subtitle) + '</p>' +
      '</div>' +
      '<div class="inspector-actions">' +
        '<button class="mini-btn" data-action="duplicate" title="' + esc(t('inspector.duplicate')) + '" aria-label="' + esc(t('inspector.duplicateAria')) + '">⧉</button>' +
        '<button class="mini-btn danger" data-action="delete" title="' + esc(t('inspector.delete')) + '" aria-label="' + esc(t('inspector.deleteAria')) + '">✕</button>' +
      '</div>' +
    '</div>';

    if (type === 'polygon') {
      html += renderPolygonInspector(shape);
    } else if (type === 'text') {
      html += '<section class="ins-section" data-rail-section="geometry">' +
        '<div class="ins-section-head"><h2>' + esc(t('inspector.geometry')) + '</h2><span class="rule"></span><span class="tiny">TEXT</span></div>' +
        '<div class="field-grid">' +
          '<div class="field full"><label>' + esc(t('inspector.textContent')) + '</label><div class="input-shell">' +
            '<input type="text" data-prop="text" value="' + esc(shape.text) + '" aria-label="' + esc(t('inspector.textContent')) + '">' +
          '</div></div>' +
          inputField('X', 'x', shape.x) + inputField('Y', 'y', shape.y) +
          inputField(t('inspector.fontSize'), 'fontSize', shape.fontSize, 0.5) +
          '<div class="field full font-field">' +
            '<span class="field-label">' + esc(t('inspector.font')) + '</span>' +
            '<div class="font-control">' +
              '<button type="button" class="font-btn" data-action="choose-font">' + esc(t('inspector.chooseFont')) + '</button>' +
              '<span class="font-name" title="' + esc(shape.fontDisplay || '') + '">' + esc(shape.fontDisplay || t('inspector.noFont')) + '</span>' +
            '</div>' +
            '<p class="field-hint">' + esc(t('inspector.textHint')) + '</p>' +
          '</div>' +
        '</div>' +
      '</section>';
    } else if (type !== 'path') {
      let fields = '';
      let gridClass = 'field-grid';

      if (type === 'rect') {
        fields += inputField('X', 'x', shape.x) + inputField('Y', 'y', shape.y);
        fields += inputField('W', 'w', shape.w) + inputField('H', 'h', shape.h);
        fields += inputField(t('inspector.radius'), 'rx', shape.rx);
      } else if (type === 'ellipse') {
        fields += inputField('CX', 'cx', shape.cx) + inputField('CY', 'cy', shape.cy);
        fields += inputField('RX', 'rx', shape.rx) + inputField('RY', 'ry', shape.ry);
      } else if (type === 'circle') {
        fields += inputField('CX', 'cx', shape.cx) + inputField('CY', 'cy', shape.cy) + inputField('R', 'r', shape.r);
        gridClass = 'field-grid three';
      } else if (type === 'line') {
        fields += inputField('X1', 'x1', shape.x1) + inputField('Y1', 'y1', shape.y1);
        fields += inputField('X2', 'x2', shape.x2) + inputField('Y2', 'y2', shape.y2);
      }
      html += '<section class="ins-section" data-rail-section="geometry">' +
        '<div class="ins-section-head"><h2>' + esc(t('inspector.geometry')) + '</h2><span class="rule"></span><span class="tiny">GEOMETRY</span></div>' +
        '<div class="' + gridClass + '">' + fields + '</div>' +
      '</section>';
    }

    if (type === 'path') {
      html += renderPathInspector(shape);
    }

    html += '<section class="ins-section compact" data-rail-section="align">' +
      '<div class="ins-section-head"><h2>' + esc(t('inspector.alignCanvas')) + '</h2><span class="rule"></span><span class="tiny">ARTBOARD</span></div>' +
      alignControlsMarkup('align.scopeCanvas') +
    '</section>';

    html += '<section class="ins-section" data-rail-section="style">' +
      '<div class="ins-section-head"><h2>' + esc(t('inspector.style')) + '</h2><span class="rule"></span><span class="tiny">STYLE</span></div>';
    if (type !== 'line') {
      html += colorField(t('inspector.fill'), 'fill', shape.fill, true);
    }
    html += colorField(t('inspector.stroke'), 'stroke', shape.stroke, true);
    html += '<div class="field-grid">' +
      inputField(t('inspector.strokeWidth'), 'strokeWidth', shape.strokeWidth, 0.5) +
      '<div class="field"><span class="field-label">' + esc(t('inspector.opacity')) + '</span><div class="opacity-row">' +
        '<input type="range" min="0" max="1" step="0.01" data-prop="opacity" value="' + fmt(shape.opacity) + '">' +
        '<span class="pct" data-opacity-label>' + Math.round(shape.opacity * 100) + '%</span>' +
      '</div></div>' +
    '</div></section>';

    dom.inspector.innerHTML = html;
    dom.inspector.scrollTop = scrollTop;
  }

  function renderInspector() {
    renderInspectorContent();
    renderInspectorRail();
  }

  function underlayField(label, prop, value, step = 1) {
    return '<div class="field">' +
      '<label>' + esc(label) + '</label>' +
      '<div class="input-shell"><input type="number" data-underlay-prop="' + prop + '" step="' + step + '" value="' + esc(fmt(value)) + '"></div>' +
    '</div>';
  }

  function renderUnderlayInspector() {
    const u = state.underlay;
    if (!u) {
      renderEmptyInspector();
      return;
    }
    dom.inspector.innerHTML =
      '<div class="inspector-head underlay-inspector">' +
        '<div class="inspector-icon"><span class="mini-underlay">▧</span></div>' +
        '<div class="inspector-title-block">' +
          '<h1>' + esc(t('underlay.title')) + '</h1>' +
          '<p>' + esc(u.name) + ' · REFERENCE</p>' +
        '</div>' +
        '<div class="inspector-actions">' +
          '<button class="mini-btn danger" data-underlay-action="remove" title="' + esc(t('underlay.remove')) + '" aria-label="' + esc(t('underlay.remove')) + '">✕</button>' +
        '</div>' +
      '</div>' +
      '<section class="ins-section" data-rail-section="position">' +
        '<div class="ins-section-head"><h2>' + esc(t('underlay.position')) + '</h2><span class="rule"></span><span class="tiny">TRANSFORM</span></div>' +
        '<div class="field-grid">' +
          underlayField('X', 'x', u.x) +
          underlayField('Y', 'y', u.y) +
          underlayField(t('underlay.width'), 'w', u.w) +
          underlayField(t('underlay.height'), 'h', u.h) +
        '</div>' +
        '<p class="field-hint">' + esc(t('underlay.naturalSize', { w: Math.round(u.naturalW), h: Math.round(u.naturalH) })) + '</p>' +
      '</section>' +
      '<section class="ins-section" data-rail-section="display">' +
        '<div class="ins-section-head"><h2>' + esc(t('underlay.display')) + '</h2><span class="rule"></span><span class="tiny">DISPLAY</span></div>' +
        '<div class="field"><span class="field-label">' + esc(t('inspector.opacity')) + '</span><div class="opacity-row">' +
          '<input type="range" min="0.05" max="1" step="0.01" data-underlay-opacity value="' + fmt(u.opacity) + '">' +
          '<span class="pct" id="underlayOpacityLabel">' + Math.round(u.opacity * 100) + '%</span>' +
        '</div></div>' +
        '<div class="underlay-action-grid" style="margin-top:12px">' +
          '<button type="button" class="underlay-action" data-underlay-action="fit">' + esc(t('underlay.fit')) + '</button>' +
          '<button type="button" class="underlay-action" data-underlay-action="fill">' + esc(t('underlay.fill')) + '</button>' +
          '<button type="button" class="underlay-action" data-underlay-action="center">' + esc(t('underlay.center')) + '</button>' +
        '</div>' +
      '</section>' +
      '<section class="ins-section">' +
        '<button type="button" class="underlay-done" data-underlay-action="done">' + esc(t('underlay.done')) + '</button>' +
        '<p class="underlay-export-note">' + esc(t('underlay.exportNote')) + '</p>' +
      '</section>';
  }

  function renderEmptyInspector() {
    const count = state.doc.shapes.length;
    dom.inspector.innerHTML =
      '<div class="empty-inspector">' +
        '<div class="empty-graphic"><span></span></div>' +
        '<h2>' + esc(t('inspector.emptyTitle')) + '</h2>' +
        '<p>' + esc(t('inspector.emptyHint')) + '</p>' +
        '<div class="doc-settings" data-rail-section="document">' +
          '<div class="ins-section-head"><h2>' + esc(t('inspector.document')) + '</h2><span class="rule"></span><span class="tiny">DOCUMENT</span></div>' +
          colorField(t('inspector.background'), 'background', state.doc.background, true) +
          '<p class="field-hint">' + esc(t('inspector.backgroundHint')) + '</p>' +
          '<div class="doc-stat-grid">' +
            '<button type="button" class="doc-stat doc-stat-button" data-action="open-canvas-size" title="' + esc(t('canvas.changeSize')) + '">' +
              '<strong id="docSizeStat">' + state.doc.width + ' × ' + state.doc.height + '</strong><span>' + esc(t('inspector.canvasSizeStat')) + '</span>' +
            '</button>' +
            '<div class="doc-stat"><strong>' + count + '</strong><span>' + esc(t('inspector.shapeCount')) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="shortcut-card" data-rail-section="shortcuts">' +
          '<h3>' + esc(t('inspector.shortcuts')) + '</h3>' +
          '<div><span>' + esc(t('inspector.addRectEllipse')) + '</span><span><kbd>R</kbd> <kbd>O</kbd></span></div>' +
          '<div><span>' + esc(t('inspector.addCirclePolygon')) + '</span><span><kbd>C</kbd> <kbd>G</kbd></span></div>' +
          '<div><span>' + esc(t('inspector.addLinePath')) + '</span><span><kbd>L</kbd> <kbd>P</kbd></span></div>' +
          '<div><span>' + esc(t('inspector.addText')) + '</span><span><kbd>T</kbd></span></div>' +
          '<div><span>' + esc(t('inspector.duplicateShortcut')) + '</span><span><kbd>⌘D</kbd></span></div>' +
          '<div><span>' + esc(t('inspector.exportShortcut')) + '</span><span><kbd>⌘S</kbd></span></div>' +
        '</div>' +
      '</div>';
  }

  function renderPathInspector(shape) {
    const commands = shape.commands;
    let html = '<section class="ins-section path-section" data-rail-section="path">' +
      '<div class="ins-section-head"><h2>' + esc(t('inspector.pathStack')) + '</h2><span class="rule"></span>' +
        '<label class="switch" title="' + esc(t('inspector.nodeToggleTitle')) + '"><input type="checkbox" data-action="toggle-path-edit"' + (state.pathEdit ? ' checked' : '') + '><span>' + esc(t('inspector.nodeEditing')) + '</span></label>' +
      '</div>' +
      '<p class="panel-hint">' + t('inspector.pathHint') + '</p>' +
      '<div class="cmd-add-bar">' +
        ['M', 'L', 'Q', 'C', 'A', 'Z'].map((code) => '<button class="cmd-add" data-add-cmd="' + code + '" title="' + esc(t('inspector.addCommand', { name: commandTitle(code) })) + '"><span class="code">' + code + '</span><span class="label">' + esc(commandShort(code)) + '</span></button>').join('') +
      '</div>';

    html += '<div class="cmd-list">';
    commands.forEach((cmd, index) => {
      const selected = cmd.id === state.selectedCmdId;
      const coordText = cmd.type === 'Z' ? 'CLOSE' : Math.round(cmd.x) + ', ' + Math.round(cmd.y);
      const delTitle = index === 0 ? t('inspector.startNoDelete') : t('inspector.deleteCommand');
      html += '<article class="cmd-card' + (selected ? ' selected' : '') + '" data-cmd-card="' + cmd.id + '">' +
        '<div class="cmd-head" data-select-cmd="' + cmd.id + '">' +
          '<span class="cmd-code ' + cmd.type + '">' + cmd.type + '</span>' +
          '<span class="cmd-title">' + esc(commandTitle(cmd.type)) + '</span>' +
          '<span class="cmd-coords">' + esc(coordText) + '</span>' +
          '<span class="cmd-index">' + String(index + 1).padStart(2, '0') + '</span>' +
          '<button class="cmd-del" data-del-cmd="' + cmd.id + '" title="' + esc(delTitle) + '"' + (index === 0 ? ' disabled' : '') + '>✕</button>' +
        '</div>' +
        '<div class="cmd-body">' + renderCommandFields(cmd, index) + '</div>' +
      '</article>';
    });
    html += '</div>';

    html += '<div class="path-code"><code id="pathCode">' + esc(pathData(commands)) + '</code><button data-copy-path title="' + esc(t('inspector.copyPath')) + '" aria-label="' + esc(t('inspector.copyPath')) + '">⧉</button></div>' +
      '<div class="node-legend">' +
        '<span><i class="legend-anchor"></i>' + esc(t('inspector.legendAnchor')) + '</span>' +
        '<span><i class="legend-control"></i>' + esc(t('inspector.legendControl')) + '</span>' +
        '<span><i class="legend-guide"></i>' + esc(t('inspector.legendGuide')) + '</span>' +
      '</div>' +
    '</section>';
    return html;
  }

  function renderCommandFields(cmd, index) {
    if (cmd.type === 'Z') {
      return '<div class="group-label">' + esc(t('inspector.endAtStart')) + '</div>';
    }
    if (cmd.type === 'M' || cmd.type === 'L') {
      return cmdField(cmd.id, 'X', 'x', cmd.x) + cmdField(cmd.id, 'Y', 'y', cmd.y);
    }
    if (cmd.type === 'Q') {
      return '<div class="group-label">' + esc(t('inspector.controlPoint')) + '</div>' +
        cmdField(cmd.id, 'CX', 'x1', cmd.x1) + cmdField(cmd.id, 'CY', 'y1', cmd.y1) +
        '<div class="group-label">' + esc(t('inspector.anchor')) + '</div>' +
        cmdField(cmd.id, 'X', 'x', cmd.x) + cmdField(cmd.id, 'Y', 'y', cmd.y);
    }
    if (cmd.type === 'A') {
      return '<div class="group-label">' + esc(t('inspector.ellipseRadii')) + '</div>' +
        cmdField(cmd.id, 'RX', 'rx', cmd.rx) + cmdField(cmd.id, 'RY', 'ry', cmd.ry) +
        cmdField(cmd.id, t('inspector.rotation'), 'rotation', cmd.rotation, 'wide') +
        '<div class="group-label">' + esc(t('inspector.arcDirection')) + '</div>' +
        '<div class="cmd-arc-flags">' +
          cmdFlag(cmd, 'largeArc', t('inspector.largeArc')) +
          cmdFlag(cmd, 'sweep', t('inspector.sweep')) +
        '</div>' +
        '<div class="group-label">' + esc(t('inspector.end')) + '</div>' +
        cmdField(cmd.id, 'X', 'x', cmd.x) + cmdField(cmd.id, 'Y', 'y', cmd.y);
    }
    return '<div class="group-label">' + esc(t('inspector.control1')) + '</div>' +
      cmdField(cmd.id, 'C1X', 'x1', cmd.x1) + cmdField(cmd.id, 'C1Y', 'y1', cmd.y1) +
      '<div class="group-label">' + esc(t('inspector.control2')) + '</div>' +
      cmdField(cmd.id, 'C2X', 'x2', cmd.x2) + cmdField(cmd.id, 'C2Y', 'y2', cmd.y2) +
      '<div class="group-label">' + esc(t('inspector.end')) + '</div>' +
      cmdField(cmd.id, 'X', 'x', cmd.x) + cmdField(cmd.id, 'Y', 'y', cmd.y);
  }

  function cmdField(cmdId, label, key, value, className = '') {
    return '<label class="field' + (className ? ' ' + className : '') + '"><span>' + esc(label) + '</span><div class="input-shell"><input type="number" step="1" data-cmd-id="' + cmdId + '" data-cmd-key="' + key + '" value="' + esc(fmt(value)) + '"></div></label>';
  }

  function cmdFlag(cmd, key, label) {
    return '<label class="cmd-arc-flag"><input type="checkbox" data-cmd-id="' + cmd.id + '" data-cmd-flag="' + key + '"' + (cmd[key] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }

  /* ------------------------------------------------------------------ *
   * Panel tabs
   *
   * The icon strips on both sides are real tabs, not a table of contents:
   * exactly one section is mounted at a time, and clicking a button swaps
   * the visible panel instead of scrolling the panel body.
   * ------------------------------------------------------------------ */

  const railIcon = (name) => '<svg class="rail-icon" viewBox="0 0 128 128" width="128" height="128" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + RAIL_ICONS[name] + '</svg>';

  function tabSections(scroller) {
    return Array.from(scroller.querySelectorAll('[data-rail-section]'));
  }

  function tabKeys(scroller) {
    const seen = new Set();
    return tabSections(scroller)
      .map((section) => section.dataset.railSection)
      .filter((key) => {
        if (!RAIL_META[key] || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function tabPanelId(scroller, key) {
    const prefix = scroller === dom.inspector ? 'inspectorPanel' : 'leftPanel';
    return prefix + key.charAt(0).toUpperCase() + key.slice(1);
  }

  function setActiveTabButton(rail, key) {
    rail.querySelectorAll('.rail-btn').forEach((button) => {
      const active = button.dataset.railGo === key;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function applyPanelTab(scroller, rail, key, options = {}) {
    const sections = tabSections(scroller);
    const keys = tabKeys(scroller);
    if (!keys.length) {
      setActiveTabButton(rail, null);
      return null;
    }
    const next = keys.includes(key) ? key : keys[0];
    const seen = new Map();
    sections.forEach((section) => {
      const sectionKey = section.dataset.railSection;
      const active = sectionKey === next;
      const count = seen.get(sectionKey) || 0;
      seen.set(sectionKey, count + 1);
      if (!section.id) section.id = tabPanelId(scroller, sectionKey) + (count ? String(count + 1) : '');
      section.hidden = !active;
      section.classList.toggle('is-tab-active', active);
      section.setAttribute('role', 'tabpanel');
      section.setAttribute('aria-hidden', String(!active));
      const button = rail.querySelector('.rail-btn[data-rail-go="' + sectionKey + '"]');
      if (button) {
        if (!button.id) button.id = tabPanelId(scroller, sectionKey) + 'Tab';
        button.setAttribute('aria-controls', section.id);
        section.setAttribute('aria-labelledby', button.id);
      }
    });
    setActiveTabButton(rail, next);
    if (options.resetScroll) scroller.scrollTop = 0;
    return next;
  }

  function activateLeftTab(key, options = {}) {
    const next = applyPanelTab(dom.leftPanelBody, dom.leftRail, key, options);
    if (next) state.leftTab = next;
    return next;
  }

  function activateRightTab(key, options = {}) {
    const next = applyPanelTab(dom.inspector, dom.inspectorRail, key, options);
    state.rightTab = next;
    return next;
  }

  function bindPanelTabs(rail, activate) {
    if (!rail) return;
    rail.addEventListener('click', (event) => {
      const button = event.target.closest('.rail-btn');
      if (!button || !rail.contains(button) || !button.dataset.railGo) return;
      activate(button.dataset.railGo, { resetScroll: true });
    });
    rail.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(rail.querySelectorAll('.rail-btn'));
      if (!buttons.length) return;
      event.preventDefault();
      const current = Math.max(0, buttons.indexOf(document.activeElement));
      let index = current;
      if (event.key === 'ArrowDown') index = (current + 1) % buttons.length;
      else if (event.key === 'ArrowUp') index = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      buttons[index].focus();
      activate(buttons[index].dataset.railGo, { resetScroll: true });
    });
  }

  function renderInspectorRail() {
    if (!dom.inspectorRail) return;
    const keys = tabKeys(dom.inspector);
    const active = keys.includes(state.rightTab) ? state.rightTab : keys[0] || null;
    const buttons = keys.map((key) => {
      const label = t(RAIL_META[key].labelKey);
      const selected = key === active;
      return '<button type="button" class="rail-btn' + (selected ? ' active' : '') + '" id="inspectorTab' +
        esc(key.charAt(0).toUpperCase() + key.slice(1)) + '" role="tab" aria-selected="' + String(selected) +
        '" tabindex="' + (selected ? '0' : '-1') + '" data-rail-go="' + esc(key) +
        '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + railIcon(RAIL_META[key].icon) + '</button>';
    }).join('');
    dom.inspectorRail.innerHTML = buttons;
    dom.inspectorRail.hidden = !keys.length;
    if (keys.length) {
      const changed = state.rightTab !== active;
      state.rightTab = activateRightTab(active, { resetScroll: changed });
    }
  }

  function updatePanelRails() {
    state.leftTab = applyPanelTab(dom.leftPanelBody, dom.leftRail, state.leftTab) || state.leftTab;
    if (!dom.inspectorRail.hidden) {
      state.rightTab = applyPanelTab(dom.inspector, dom.inspectorRail, state.rightTab) || state.rightTab;
    }
  }

  /* ------------------------------------------------------------------ *
   * Layers
   * ------------------------------------------------------------------ */

  function renderLayers() {
    dom.layerCount.textContent = String(state.doc.shapes.length).padStart(2, '0');
    if (!state.doc.shapes.length) {
      dom.layers.innerHTML = '<div class="layer-empty"><strong>' + esc(t('layers.emptyTitle')) + '</strong>' + esc(t('layers.emptyHint')) + '</div>';
      return;
    }
    const rows = state.doc.shapes.slice().reverse().map((shape, visualIndex) => {
      const index = state.doc.shapes.length - 1 - visualIndex;
      const selected = isSelected(shape.id);
      return '<div class="layer-row' + (selected ? ' selected' : '') + '" data-layer-id="' + shape.id + '" draggable="true">' +
        '<span class="layer-grip">⋮⋮</span>' +
        '<span class="layer-mark">' + TYPE_META[shape.type].code + '</span>' +
        '<span class="layer-name">' + esc(shape.name) + '</span>' +
        '<span class="layer-actions">' +
          '<button data-layer-action="up" title="' + esc(t('layers.up')) + '" aria-label="' + esc(t('layers.up')) + '"' + (index === state.doc.shapes.length - 1 ? ' disabled' : '') + '>↑</button>' +
          '<button data-layer-action="down" title="' + esc(t('layers.down')) + '" aria-label="' + esc(t('layers.down')) + '"' + (index === 0 ? ' disabled' : '') + '>↓</button>' +
          '<button class="danger" data-layer-action="delete" title="' + esc(t('layers.delete')) + '" aria-label="' + esc(t('layers.delete')) + '">✕</button>' +
        '</span>' +
      '</div>';
    }).join('');
    dom.layers.innerHTML = rows;
  }

  /* ------------------------------------------------------------------ *
   * Selection
   * ------------------------------------------------------------------ */

  function selectShape(id, options = {}) {
    if (id && !shapeById(id)) id = null;
    if (id) state.underlayAdjust = false;
    state.snapGuides = [];
    const additive = Boolean(options.additive || options.toggle);

    if (!id) {
      applySelection([]);
    } else if (additive) {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      applySelection([...next], next.has(id) ? id : null);
    } else {
      applySelection([id], id);
    }

    const shape = selectedShape();
    if (shape && state.selectedIds.length === 1) {
      if (shape.type === 'path') {
        state.pathEdit = options.keepPathEdit ? state.pathEdit : true;
        if (!shape.commands.some((cmd) => cmd.id === state.selectedCmdId)) {
          state.selectedCmdId = preferredCommand(shape)?.id || null;
        }
      } else {
        state.selectedCmdId = null;
      }
    } else {
      state.selectedCmdId = null;
    }

    renderLayers();
    renderInspector();
    renderOverlay();
    renderUnderlayPanel();
    updateStatus();
    if (options.scrollLayer) {
      const row = dom.layers.querySelector('[data-layer-id="' + id + '"]');
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  }

  function setSelection(ids, primary = null) {
    applySelection(ids, primary);
    const shape = selectedShape();
    if (shape && state.selectedIds.length === 1 && shape.type === 'path') {
      state.selectedCmdId = preferredCommand(shape)?.id || null;
    } else {
      state.selectedCmdId = null;
    }
    renderLayers();
    renderInspector();
    renderOverlay();
    renderUnderlayPanel();
    updateStatus();
  }

  function selectCommand(id, scroll = false) {
    const shape = selectedShape();
    if (!shape || shape.type !== 'path') return;
    if (!shape.commands.some((cmd) => cmd.id === id)) return;
    state.selectedCmdId = id;
    $$('.cmd-card', dom.inspector).forEach((card) => {
      card.classList.toggle('selected', card.dataset.cmdCard === id);
    });
    if (scroll) {
      const card = dom.inspector.querySelector('[data-cmd-card="' + id + '"]');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    renderOverlay();
    updateStatus();
  }

  function updateStatus() {
    const shapes = selectedShapes();
    const shape = selectedShape();
    const count = state.doc.shapes.length;
    dom.shapeStatus.textContent = tc('status.shapes', count);
    if (!shapes.length) {
      dom.nodeStatus.textContent = state.underlayAdjust ? t('status.underlayAdjusting') : t('status.noSelection');
    } else if (shapes.length > 1) {
      const b = unionBounds(shapes.map((item) => getShapeBounds(item)));
      dom.nodeStatus.textContent = tc('status.selected', shapes.length, { w: Math.round(b.w), h: Math.round(b.h) });
    } else if (shape.type === 'path' && state.pathEdit) {
      const countCommands = shape.commands.length;
      const selectedCmd = shape.commands.find((cmd) => cmd.id === state.selectedCmdId);
      dom.nodeStatus.textContent = tc('status.path', countCommands, { cmd: selectedCmd ? ' · ' + selectedCmd.type : '' });
    } else {
      const b = getShapeBounds(shape);
      dom.nodeStatus.textContent = t('status.shape', { label: typeLabel(shape.type), w: Math.round(b.w), h: Math.round(b.h) });
    }
  }

  function updateCoordStatus(point) {
    const x = clamp(point.x, 0, state.doc.width);
    const y = clamp(point.y, 0, state.doc.height);
    dom.coordStatus.textContent = 'X ' + String(Math.round(x)).padStart(3, '0') + '  Y ' + String(Math.round(y)).padStart(3, '0');
  }

  /* ------------------------------------------------------------------ *
   * Add / duplicate / delete / reorder
   * ------------------------------------------------------------------ */

  function addShape(type) {
    flushEdit();
    const before = snapshot();
    state.underlayAdjust = false;
    const W = state.doc.width;
    const H = state.doc.height;
    const scale = clamp(Math.min(W / DEFAULT_W, H / DEFAULT_H), 0.35, 1.6);
    const offset = (state.doc.shapes.length % 5) * Math.min(22, Math.min(W, H) * 0.035);
    const index = state.doc.shapes.filter((shape) => shape.type === type).length + 1;
    let shape;
    if (type === 'rect') {
      const w = clamp(260 * scale, 24, W * 0.6);
      const h = clamp(180 * scale, 24, H * 0.6);
      shape = {
        id: uid('s'), type: 'rect', name: shapeName('rect', index),
        x: clamp((W - w) / 2 + offset, 4, Math.max(4, W - w - 4)), y: clamp((H - h) / 2 + offset, 4, Math.max(4, H - h - 4)),
        w, h, rx: clamp(18 * scale, 0, Math.min(w, h) / 2),
        fill: SHAPE_COLORS[(state.doc.shapes.length) % SHAPE_COLORS.length],
        stroke: '#1b1d22', strokeWidth: 2, opacity: 1
      };
    } else if (type === 'ellipse') {
      const rx = clamp(135 * scale, 12, W * 0.29);
      const ry = clamp(105 * scale, 12, H * 0.29);
      shape = {
        id: uid('s'), type: 'ellipse', name: shapeName('ellipse', index),
        cx: clamp(W / 2 + offset, rx + 4, W - rx - 4), cy: clamp(H / 2 + offset, ry + 4, H - ry - 4), rx, ry,
        fill: SHAPE_COLORS[(state.doc.shapes.length + 1) % SHAPE_COLORS.length],
        stroke: '#1b1d22', strokeWidth: 2, opacity: 1
      };
    } else if (type === 'circle') {
      const r = clamp(112 * scale, 12, Math.min(W, H) * 0.3);
      shape = {
        id: uid('s'), type: 'circle', name: shapeName('circle', index),
        cx: clamp(W / 2 + offset, r + 4, W - r - 4), cy: clamp(H / 2 + offset, r + 4, H - r - 4), r,
        fill: SHAPE_COLORS[(state.doc.shapes.length + 2) % SHAPE_COLORS.length],
        stroke: '#1b1d22', strokeWidth: 2, opacity: 1
      };
    } else if (type === 'polygon') {
      const radius = clamp(122 * scale, 16, Math.min(W, H) * 0.32);
      const cx = clamp(W / 2 + offset, radius + 4, W - radius - 4);
      const cy = clamp(H / 2 + offset, radius + 4, H - radius - 4);
      shape = {
        id: uid('s'), type: 'polygon', name: shapeName('polygon', index),
        points: regularPolygonPoints(cx, cy, radius, 5),
        fill: SHAPE_COLORS[(state.doc.shapes.length + 3) % SHAPE_COLORS.length],
        stroke: '#1b1d22', strokeWidth: 2, opacity: 1
      };
    } else if (type === 'line') {
      shape = {
        id: uid('s'), type: 'line', name: shapeName('line', index),
        x1: clamp(W * 0.28 + offset, 4, W - 4), y1: clamp(H * 0.62 + offset, 4, H - 4),
        x2: clamp(W * 0.7 + offset, 4, W - 4), y2: clamp(H * 0.37 + offset, 4, H - 4),
        fill: 'none', stroke: '#1b1d22', strokeWidth: 3, opacity: 1
      };
    } else if (type === 'text') {
      const fontSize = clamp(96 * scale, 12, 400);
      shape = {
        id: uid('s'), type: 'text', name: shapeName('text', index),
        x: clamp(W * 0.25 + offset, 4, Math.max(4, W * 0.6)), y: clamp(H * 0.38 + offset, 4, Math.max(4, H - fontSize * 1.3)),
        text: t('text.sample'), fontFamily: '', fontDisplay: '', fontSize,
        fill: SHAPE_COLORS[(state.doc.shapes.length + 4) % SHAPE_COLORS.length],
        stroke: 'none', strokeWidth: 0, opacity: 1
      };
    } else {
      shape = {
        id: uid('s'), type: 'path', name: shapeName('path', index),
        commands: [
          { id: uid('c'), type: 'M', x: W * 0.28 + offset, y: H * 0.625 + offset },
          {
            id: uid('c'), type: 'C',
            x1: W * 0.37 + offset, y1: H * 0.36 + offset,
            x2: W * 0.52 + offset, y2: H * 0.77 + offset,
            x: W * 0.67 + offset, y: H * 0.48 + offset
          }
        ],
        fill: 'none', stroke: '#1b1d22', strokeWidth: 5, opacity: 1
      };
    }
    state.doc.shapes.push(shape);
    applySelection([shape.id], shape.id);
    state.selectedCmdId = type === 'path' ? lastDrawableCommand(shape)?.id : null;
    state.pathEdit = true;
    pushHistory(before);
    renderAll();
    markDirty();
    toast(t('toast.added', { label: shape.name }));
  }

  function addCommand(type) {
    const shape = selectedShape();
    if (!shape || shape.type !== 'path') return;
    if (type === 'Z' && shape.commands.some((cmd) => cmd.type === 'Z')) {
      toast(t('toast.pathClosed'));
      return;
    }
    if (type === 'Z' && shape.commands.filter((cmd) => ['L', 'Q', 'C', 'A'].includes(cmd.type)).length < 1) {
      toast(t('toast.needSegment'));
      return;
    }
    flushEdit();
    const before = snapshot();
    const hasZ = shape.commands[shape.commands.length - 1]?.type === 'Z';
    const insertBeforeClose = hasZ && type !== 'M';
    const insertIndex = insertBeforeClose ? shape.commands.length - 1 : shape.commands.length;
    const end = pathEnd(shape.commands, insertIndex) || { x: 300, y: 320 };
    const W = state.doc.width;
    const H = state.doc.height;
    const roomX = W - 34 - end.x;
    const roomY = H - 34 - end.y;
    const dirX = roomX < 100 ? -1 : 1;
    const dirY = roomY < 100 ? -1 : 1;
    let cmd;
    if (type === 'M') {
      cmd = { id: uid('c'), type: 'M', x: clamp(end.x + 70 * dirX, 24, W - 24), y: clamp(end.y + 70 * dirY, 24, H - 24) };
    } else if (type === 'L') {
      cmd = { id: uid('c'), type: 'L', x: clamp(end.x + 88 * dirX, 16, W - 16), y: end.y };
    } else if (type === 'Q') {
      cmd = {
        id: uid('c'), type: 'Q',
        x1: clamp(end.x + 45 * dirX, 8, W - 8), y1: clamp(end.y - 66, 8, H - 8),
        x: clamp(end.x + 108 * dirX, 16, W - 16), y: end.y
      };
    } else if (type === 'C') {
      cmd = {
        id: uid('c'), type: 'C',
        x1: clamp(end.x + 44 * dirX, 8, W - 8), y1: clamp(end.y - 28, 8, H - 8),
        x2: clamp(end.x + 96 * dirX, 8, W - 8), y2: clamp(end.y - 72, 8, H - 8),
        x: clamp(end.x + 154 * dirX, 16, W - 16), y: end.y
      };
    } else if (type === 'A') {
      const xDir = (W - 16 - end.x) >= (end.x - 16) ? 1 : -1;
      const yDir = (H - 16 - end.y) >= (end.y - 16) ? 1 : -1;
      const spaceX = xDir > 0 ? W - 16 - end.x : end.x - 16;
      const spaceY = yDir > 0 ? H - 16 - end.y : end.y - 16;
      const horizontal = spaceX >= spaceY;
      const ideal = clamp(Math.min(W, H) * 0.28, 24, 140);
      const length = Math.max(10, Math.min(ideal, (horizontal ? spaceX : spaceY) * 0.9));
      cmd = {
        id: uid('c'), type: 'A',
        rx: Math.max(8, length * 0.72),
        ry: Math.max(6, length * 0.56),
        rotation: 0,
        largeArc: 0,
        sweep: (horizontal ? xDir : yDir) > 0 ? 1 : 0,
        x: clamp(horizontal ? end.x + length * xDir : end.x, 16, W - 16),
        y: clamp(horizontal ? end.y : end.y + length * yDir, 16, H - 16)
      };
    } else {
      cmd = { id: uid('c'), type: 'Z' };
    }
    shape.commands.splice(insertIndex, 0, cmd);
    state.selectedCmdId = cmd.id;
    state.pathEdit = true;
    applySelection([shape.id], shape.id);
    pushHistory(before);
    renderAll();
    markDirty();
    requestAnimationFrame(() => {
      const card = dom.inspector.querySelector('[data-cmd-card="' + cmd.id + '"]');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    toast(t('toast.commandAdded', { type: commandTitle(type) }));
  }

  function deleteCommand(cmdId) {
    const shape = selectedShape();
    if (!shape || shape.type !== 'path') return;
    const index = shape.commands.findIndex((cmd) => cmd.id === cmdId);
    if (index < 0) return;
    if (index === 0) {
      toast(t('toast.startNoDelete'));
      return;
    }
    flushEdit();
    const before = snapshot();
    shape.commands.splice(index, 1);
    const next = shape.commands[Math.min(index, shape.commands.length - 1)];
    state.selectedCmdId = next?.id || null;
    pushHistory(before);
    renderAll();
    markDirty();
    toast(t('toast.commandDeleted'));
  }

  function deleteShape(id = state.selectedId) {
    const shape = shapeById(id);
    if (!shape) return;
    flushEdit();
    const before = snapshot();
    state.doc.shapes = state.doc.shapes.filter((item) => item.id !== id);
    const remaining = state.selectedIds.filter((item) => item !== id);
    applySelection(remaining);
    if (remaining.length === 1 && shapeById(remaining[0])?.type === 'path') {
      state.selectedCmdId = preferredCommand(shapeById(remaining[0]))?.id || null;
    } else if (!remaining.length) {
      state.selectedCmdId = null;
    }
    pushHistory(before);
    renderAll();
    markDirty();
    toast(t('toast.shapeDeleted', { label: typeLabel(shape.type) }));
  }

  function deleteSelection() {
    const shapes = selectedShapes();
    if (!shapes.length) return;
    flushEdit();
    const before = snapshot();
    const ids = new Set(shapes.map((shape) => shape.id));
    state.doc.shapes = state.doc.shapes.filter((shape) => !ids.has(shape.id));
    applySelection([]);
    pushHistory(before);
    renderAll();
    markDirty();
    toast(shapes.length > 1 ? tc('toast.shapesDeleted', shapes.length) : t('toast.shapeDeleted', { label: typeLabel(shapes[0].type) }));
  }

  function duplicateShape() {
    const shapes = selectedShapes();
    if (!shapes.length) return;
    flushEdit();
    const before = snapshot();
    const copies = shapes.map((shape) => {
      const copy = deepClone(shape);
      copy.id = uid('s');
      copy.name = shape.name.replace(/\s+\d+$/, '') + t('name.copySuffix');
      if (copy.type === 'path') {
        copy.commands.forEach((cmd) => { cmd.id = uid('c'); });
      }
      translateShape(copy, 24, 24);
      return copy;
    });
    if (shapes.length === 1) {
      const index = state.doc.shapes.findIndex((item) => item.id === shapes[0].id);
      state.doc.shapes.splice(index + 1, 0, copies[0]);
    } else {
      state.doc.shapes.push(...copies);
    }
    const primary = copies[copies.length - 1];
    applySelection(copies.map((copy) => copy.id), primary.id);
    state.selectedCmdId = copies.length === 1 && primary.type === 'path'
      ? lastDrawableCommand(primary)?.id || null
      : null;
    pushHistory(before);
    renderAll();
    markDirty();
    toast(copies.length > 1 ? tc('toast.shapesDuplicated', copies.length) : t('toast.shapeDuplicated'));
  }

  function moveLayer(id, direction) {
    const index = state.doc.shapes.findIndex((shape) => shape.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.doc.shapes.length) return;
    flushEdit();
    const before = snapshot();
    const [shape] = state.doc.shapes.splice(index, 1);
    state.doc.shapes.splice(target, 0, shape);
    pushHistory(before);
    renderAll();
    markDirty();
  }

  function reorderLayer(dragId, targetId, placeAfter) {
    if (!dragId || !targetId || dragId === targetId) return;
    const from = state.doc.shapes.findIndex((shape) => shape.id === dragId);
    let to = state.doc.shapes.findIndex((shape) => shape.id === targetId);
    if (from < 0 || to < 0) return;
    flushEdit();
    const before = snapshot();
    const [shape] = state.doc.shapes.splice(from, 1);
    to = state.doc.shapes.findIndex((item) => item.id === targetId);
    const insert = placeAfter ? to + 1 : to;
    state.doc.shapes.splice(insert, 0, shape);
    if (snapshot() === before) { renderLayers(); return; }
    pushHistory(before);
    renderAll();
    markDirty();
  }

  function alignSelection(mode) {
    const shapes = selectedShapes();
    if (!shapes.length) return;
    const frame = shapes.length === 1
      ? { x: 0, y: 0, w: state.doc.width, h: state.doc.height }
      : unionBounds(shapes.map((shape) => getShapeBounds(shape)));
    flushEdit();
    const before = snapshot();
    let moved = false;
    shapes.forEach((shape) => {
      const delta = alignDelta(getShapeBounds(shape), frame, mode);
      if (Math.abs(delta.dx) > 1e-6 || Math.abs(delta.dy) > 1e-6) {
        translateShape(shape, delta.dx, delta.dy);
        moved = true;
      }
    });
    if (!moved) {
      toast(t('align.already'));
      return;
    }
    pushHistory(before);
    renderCanvas();
    renderInspector();
    markDirty();
    const labels = {
      left: 'align.left', center: 'align.center', right: 'align.right',
      top: 'align.top', middle: 'align.middle', bottom: 'align.bottom'
    };
    toast(t(labels[mode] || 'align.aligned'));
  }

  function distributeSelection(axis) {
    const shapes = selectedShapes();
    if (shapes.length < 3) {
      toast(t('align.needThree'));
      return;
    }
    flushEdit();
    const before = snapshot();
    const entries = shapes.map((shape) => ({ id: shape.id, bounds: getShapeBounds(shape) }));
    const deltas = distributeDeltas(entries, axis);
    let moved = false;
    deltas.forEach((delta) => {
      if (Math.abs(delta.dx) < 1e-6 && Math.abs(delta.dy) < 1e-6) return;
      const shape = shapeById(delta.id);
      if (!shape) return;
      translateShape(shape, delta.dx, delta.dy);
      moved = true;
    });
    if (!moved) {
      toast(t('align.alreadyEven'));
      return;
    }
    pushHistory(before);
    renderCanvas();
    renderInspector();
    markDirty();
    toast(t(axis === 'x' ? 'align.distributedX' : 'align.distributedY'));
  }

  function booleanSelected(operation) {
    const meta = BOOLEAN_META[operation];
    if (!meta) return;
    const shapes = selectedShapes();
    if (shapes.length < 2) {
      toast(t('toast.booleanMin'));
      return;
    }
    if (shapes.some((shape) => shape.type === 'line')) {
      toast(t('toast.lineNoArea'));
      return;
    }
    const operands = shapes.map((shape) => ({
      d: shapeToPathData(shape),
      fillRule: shape.fillRule || 'nonzero'
    }));
    if (operands.some((operand) => !operand.d)) {
      toast(t('toast.cannotRead'));
      return;
    }

    let result;
    try {
      result = booleanOperands(operands, operation);
    } catch (error) {
      console.error('[albedo] boolean failed', error);
      toast(t('toast.booleanFailed', { message: error?.message || t('toast.maySelfIntersect') }));
      return;
    }
    if (!result) {
      toast(t('toast.emptyResult'));
      return;
    }

    flushEdit();
    const before = snapshot();
    const base = shapes[0];
    const top = shapes[shapes.length - 1];
    let style = operation === 'subtract' ? base : top;
    if (style.fill === 'none') {
      style = shapes.find((shape) => shape.fill !== 'none') || style;
    }
    const shape = {
      id: uid('s'),
      type: 'path',
      name: t(meta.labelKey),
      commands: result.commands.map((cmd) => ({ ...cmd, id: uid('c') })),
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      opacity: style.opacity,
      fillRule: result.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
    };

    const selectedSet = new Set(shapes.map((item) => item.id));
    const indices = shapes.map((item) => state.doc.shapes.findIndex((candidate) => candidate.id === item.id));
    const anchorIndex = operation === 'subtract' ? Math.min(...indices) : Math.max(...indices);
    const below = state.doc.shapes.slice(0, anchorIndex).filter((item) => !selectedSet.has(item.id)).length;
    state.doc.shapes = state.doc.shapes.filter((item) => !selectedSet.has(item.id));
    state.doc.shapes.splice(below, 0, shape);
    applySelection([shape.id], shape.id);
    state.selectedCmdId = null;
    pushHistory(before);
    renderAll();
    markDirty();
    toast(t('toast.generated', { label: t(meta.labelKey) }));
  }

  /* ------------------------------------------------------------------ *
   * Drag gestures
   * ------------------------------------------------------------------ */

  function snapContext(extraPoints = []) {
    const selected = new Set(state.selectedIds);
    return {
      enabled: state.snapEnabled,
      threshold: SNAP_PX * uiScaleValue(),
      grid: { enabled: state.grid.visible, size: state.grid.size },
      artboard: { w: state.doc.width, h: state.doc.height },
      targets: state.doc.shapes
        .filter((shape) => !selected.has(shape.id))
        .map((shape) => getShapeBounds(shape)),
      points: extraPoints
    };
  }

  function nodeSnapContext(shape, cmdId) {
    const points = [];
    state.doc.shapes.forEach((item) => {
      if (item.type !== 'path') return;
      item.commands.forEach((cmd) => {
        if (item.id === shape.id && cmd.id === cmdId) return;
        if (typeof cmd.x === 'number' && typeof cmd.y === 'number') {
          points.push({ x: cmd.x, y: cmd.y });
        }
      });
    });
    return snapContext(points);
  }

  function boundsIntersect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function scaleShapeInFrame(shape, original, oldFrame, newFrame) {
    const oldBounds = getShapeBounds(original);
    const sx = oldFrame.w > 0.001 ? newFrame.w / oldFrame.w : 1;
    const sy = oldFrame.h > 0.001 ? newFrame.h / oldFrame.h : 1;
    const target = {
      x: newFrame.x + (oldBounds.x - oldFrame.x) * sx,
      y: newFrame.y + (oldBounds.y - oldFrame.y) * sy,
      w: Math.max(1, oldBounds.w * sx),
      h: Math.max(1, oldBounds.h * sy)
    };
    if (original.type === 'circle' && Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-6) {
      shape.type = 'ellipse';
      shape.cx = target.x + target.w / 2;
      shape.cy = target.y + target.h / 2;
      shape.rx = Math.max(1, target.w / 2);
      shape.ry = Math.max(1, target.h / 2);
      delete shape.r;
      return;
    }
    resizeShape(shape, original, oldBounds, target);
  }

  function beginShapeDrag(event, shape) {
    const shapes = selectedShapes();
    if (!shapes.length) return;
    flushEdit();
    const start = clientToSvg(event);
    const originals = shapes.map((item) => deepClone(item));
    state.gesture = {
      kind: 'move',
      ids: shapes.map((item) => item.id),
      start,
      originals,
      bounds: unionBounds(shapes.map((item) => getShapeBounds(item))),
      before: snapshot(),
      moved: false
    };
    document.body.classList.add('is-dragging');
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    event.preventDefault();
  }

  function beginResize(event, handle) {
    const shapes = selectedShapes();
    if (!shapes.length) return;
    flushEdit();
    const start = clientToSvg(event);
    const originals = shapes.map((item) => deepClone(item));
    state.gesture = {
      kind: 'resize',
      ids: shapes.map((item) => item.id),
      handle,
      start,
      originals,
      originalBounds: unionBounds(shapes.map((item) => getShapeBounds(item))),
      before: snapshot(),
      keepAspect: shapes.length === 1 && shapes[0].type === 'circle',
      moved: false
    };
    document.body.classList.add('is-dragging');
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    event.preventDefault();
  }

  function beginNodeDrag(event, cmdId, part) {
    const shape = selectedShape();
    if (!shape || shape.type !== 'path') return;
    const cmd = shape.commands.find((item) => item.id === cmdId);
    if (!cmd) return;
    flushEdit();
    const start = clientToSvg(event);
    state.gesture = {
      kind: 'node',
      shapeId: shape.id,
      cmdId,
      part,
      start,
      original: deepClone(shape),
      before: snapshot(),
      moved: false
    };
    selectCommand(cmdId, false);
    document.body.classList.add('is-dragging');
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    event.preventDefault();
  }

  function beginUnderlayGesture(event, part) {
    const u = state.underlay;
    if (!u || !u.visible || !state.underlayAdjust) return;
    const start = clientToSvg(event);
    const cornerX = part.includes('w') ? u.x : u.x + u.w;
    const cornerY = part.includes('n') ? u.y : u.y + u.h;
    state.gesture = {
      kind: part === 'move' ? 'underlay-move' : 'underlay-resize',
      part,
      start,
      pointerOffset: part === 'move' ? { x: 0, y: 0 } : { x: start.x - cornerX, y: start.y - cornerY },
      original: { x: u.x, y: u.y, w: u.w, h: u.h },
      moved: false
    };
    document.body.classList.add('is-dragging');
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    event.preventDefault();
  }

  function syncUnderlayInspectorFields() {
    const u = state.underlay;
    if (!u || !state.underlayAdjust) return;
    ['x', 'y', 'w', 'h'].forEach((prop) => {
      const input = dom.inspector.querySelector('[data-underlay-prop="' + prop + '"]');
      if (input && document.activeElement !== input) input.value = fmt(u[prop]);
    });
  }

  function onUnderlayGestureMove(gesture, pointer, event) {
    const u = state.underlay;
    if (!u) return;
    const orig = gesture.original;
    const dx = pointer.x - gesture.start.x;
    const dy = pointer.y - gesture.start.y;
    if (gesture.kind === 'underlay-move') {
      let moveX = dx;
      let moveY = dy;
      if (event.shiftKey) {
        if (Math.abs(moveX) >= Math.abs(moveY)) moveY = 0;
        else moveX = 0;
      }
      u.x = orig.x + moveX;
      u.y = orig.y + moveY;
    } else if (gesture.kind === 'underlay-resize') {
      const right = orig.x + orig.w;
      const bottom = orig.y + orig.h;
      let anchorX = orig.x;
      let anchorY = orig.y;
      if (gesture.part.includes('w')) anchorX = right;
      if (gesture.part.includes('n')) anchorY = bottom;
      const cornerX = gesture.part.includes('w') ? orig.x : right;
      const cornerY = gesture.part.includes('n') ? orig.y : bottom;
      const vx = cornerX - anchorX;
      const vy = cornerY - anchorY;
      const pointerX = pointer.x - (gesture.pointerOffset?.x || 0);
      const pointerY = pointer.y - (gesture.pointerOffset?.y || 0);
      const px = pointerX - anchorX;
      const py = pointerY - anchorY;
      const denominator = vx * vx + vy * vy;
      const rawScale = denominator ? (px * vx + py * vy) / denominator : 1;
      const minScale = Math.max(8 / orig.w, 8 / orig.h);
      const scale = Math.max(minScale, rawScale);
      u.w = orig.w * scale;
      u.h = orig.h * scale;
      u.x = gesture.part.includes('w') ? anchorX - u.w : anchorX;
      u.y = gesture.part.includes('n') ? anchorY - u.h : anchorY;
    }
    syncUnderlayImage();
    renderOverlay();
    syncUnderlayInspectorFields();
    updateCoordStatus(pointer);
  }

  function beginMarquee(event) {
    const start = clientToSvg(event);
    state.gesture = {
      kind: 'marquee',
      start,
      additive: isAdditiveEvent(event),
      beforeSelection: [...state.selectedIds],
      moved: false
    };
    state.marquee = { x: start.x, y: start.y, w: 0, h: 0 };
    document.body.classList.add('is-selecting');
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    event.preventDefault();
  }

  function onGestureMove(event) {
    const gesture = state.gesture;
    if (!gesture) return;
    const pointer = clientToSvg(event);
    const dx = pointer.x - gesture.start.x;
    const dy = pointer.y - gesture.start.y;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) gesture.moved = true;

    if (gesture.kind === 'underlay-move' || gesture.kind === 'underlay-resize') {
      state.snapGuides = [];
      onUnderlayGestureMove(gesture, pointer, event);
      return;
    }

    if (gesture.kind === 'marquee') {
      state.marquee = {
        x: Math.min(gesture.start.x, pointer.x),
        y: Math.min(gesture.start.y, pointer.y),
        w: Math.abs(pointer.x - gesture.start.x),
        h: Math.abs(pointer.y - gesture.start.y)
      };
      if (state.marquee.w > 1 || state.marquee.h > 1) gesture.moved = true;
      updateCoordStatus(pointer);
      renderOverlay();
      return;
    }

    if (gesture.kind === 'move') {
      let rawDx = dx;
      let rawDy = dy;
      let lockX = false;
      let lockY = false;
      if (event.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) lockY = true;
        else lockX = true;
      }
      if (lockX) rawDx = 0;
      if (lockY) rawDy = 0;

      let snapped;
      if (state.snapEnabled && !event.altKey) {
        snapped = snapMove(gesture.bounds, rawDx, rawDy, snapContext());
      } else {
        snapped = { dx: rawDx, dy: rawDy, guides: [] };
      }
      if (lockX) {
        snapped.dx = 0;
        snapped.guides = snapped.guides.filter((guide) => guide.axis !== 'x');
      }
      if (lockY) {
        snapped.dy = 0;
        snapped.guides = snapped.guides.filter((guide) => guide.axis !== 'y');
      }

      gesture.originals.forEach((original) => {
        const target = shapeById(original.id);
        if (!target) return;
        const copy = deepClone(original);
        translateShape(copy, snapped.dx, snapped.dy);
        Object.assign(target, copy);
      });
      state.snapGuides = snapped.guides;
    } else if (gesture.kind === 'resize') {
      let bounds = resizeBounds(
        gesture.originalBounds,
        gesture.handle,
        dx,
        dy,
        event.shiftKey || gesture.keepAspect
      );
      let guides = [];
      if (state.snapEnabled && !event.altKey) {
        const snapped = snapResize(bounds, gesture.handle, snapContext());
        bounds = snapped.bounds;
        guides = snapped.guides;
      }
      if (gesture.originals.length === 1) {
        const original = gesture.originals[0];
        const target = shapeById(original.id);
        if (target) resizeShape(target, original, gesture.originalBounds, bounds);
      } else {
        gesture.originals.forEach((original) => {
          const target = shapeById(original.id);
          if (target) scaleShapeInFrame(target, original, gesture.originalBounds, bounds);
        });
      }
      state.snapGuides = guides;
    } else if (gesture.kind === 'node') {
      const shape = shapeById(gesture.shapeId);
      if (!shape) return;
      const copy = deepClone(gesture.original);
      const cmd = copy.commands.find((item) => item.id === gesture.cmdId);
      const originalCmd = gesture.original.commands.find((item) => item.id === gesture.cmdId);
      if (!cmd || !originalCmd) return;
      if (gesture.part === 'anchor') {
        let point = { x: originalCmd.x + dx, y: originalCmd.y + dy };
        let guides = [];
        if (state.snapEnabled && !event.altKey) {
          const snapped = snapPoint(point, nodeSnapContext(shape, gesture.cmdId));
          point = snapped.point;
          guides = snapped.guides;
        }
        cmd.x = point.x;
        cmd.y = point.y;
        state.snapGuides = guides;
      } else if (gesture.part === 'c1') {
        cmd.x1 = originalCmd.x1 + dx;
        cmd.y1 = originalCmd.y1 + dy;
        state.snapGuides = [];
      } else if (gesture.part === 'c2') {
        cmd.x2 = originalCmd.x2 + dx;
        cmd.y2 = originalCmd.y2 + dy;
        state.snapGuides = [];
      } else if (gesture.part === 'c') {
        cmd.x1 = originalCmd.x1 + dx;
        cmd.y1 = originalCmd.y1 + dy;
        state.snapGuides = [];
      }
      Object.assign(shape, copy);
    }
    updateCoordStatus(pointer);
    renderCanvas();
    refreshInspectorGeometry();
  }

  function endGesture() {
    const gesture = state.gesture;
    if (!gesture) return;
    state.gesture = null;
    document.body.classList.remove('is-dragging', 'is-selecting');
    window.removeEventListener('pointermove', onGestureMove);
    window.removeEventListener('pointerup', endGesture);
    window.removeEventListener('pointercancel', endGesture);

    if (gesture.kind === 'underlay-move' || gesture.kind === 'underlay-resize') {
      if (gesture.moved) {
        renderInspector();
        renderUnderlayPanel();
        saveUnderlayNow();
      } else {
        renderOverlay();
      }
      updateStatus();
      return;
    }

    if (gesture.kind === 'marquee') {
      const marquee = state.marquee;
      state.marquee = null;
      state.snapGuides = [];
      if (marquee && (marquee.w > 1 || marquee.h > 1)) {
        const hits = state.doc.shapes
          .filter((shape) => boundsIntersect(getShapeBounds(shape), marquee))
          .map((shape) => shape.id);
        const next = gesture.additive
          ? [...new Set([...gesture.beforeSelection, ...hits])]
          : hits;
        setSelection(next);
      } else {
        renderOverlay();
      }
      updateStatus();
      return;
    }

    state.snapGuides = [];
    if (gesture.moved) {
      pushHistory(gesture.before);
      markDirty();
      renderInspector();
      renderLayers();
      renderOverlay();
      updateStatus();
    } else {
      renderOverlay();
    }
  }

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */

  function shapeMarkup(shape) {
    const common = [];
    const fill = shape.type === 'line' ? 'none' : shape.fill;
    common.push('fill="' + esc(fill) + '"');
    common.push('stroke="' + esc(shape.stroke) + '"');
    if (shape.strokeWidth) common.push('stroke-width="' + fmt(shape.strokeWidth) + '"');
    common.push('stroke-linecap="round"');
    common.push('stroke-linejoin="round"');
    if (shape.opacity !== 1) common.push('opacity="' + fmt(shape.opacity) + '"');
    if (shape.type === 'rect') {
      return '  <rect x="' + fmt(shape.x) + '" y="' + fmt(shape.y) + '" width="' + fmt(shape.w) + '" height="' + fmt(shape.h) +
        '" rx="' + fmt(clamp(shape.rx, 0, Math.min(shape.w, shape.h) / 2)) + '" ' + common.join(' ') + '/>';
    }
    if (shape.type === 'ellipse') {
      return '  <ellipse cx="' + fmt(shape.cx) + '" cy="' + fmt(shape.cy) + '" rx="' + fmt(shape.rx) + '" ry="' + fmt(shape.ry) + '" ' + common.join(' ') + '/>';
    }
    if (shape.type === 'circle') {
      return '  <circle cx="' + fmt(shape.cx) + '" cy="' + fmt(shape.cy) + '" r="' + fmt(shape.r) + '" ' + common.join(' ') + '/>';
    }
    if (shape.type === 'polygon') {
      return '  <polygon points="' + esc(polygonPointsAttr(shape.points)) + '" ' + common.join(' ') + '/>';
    }
    if (shape.type === 'line') {
      return '  <line x1="' + fmt(shape.x1) + '" y1="' + fmt(shape.y1) + '" x2="' + fmt(shape.x2) + '" y2="' + fmt(shape.y2) + '" ' + common.join(' ') + '/>';
    }
    if (shape.type === 'text') {
      const entry = shape.fontFamily ? state.fonts.get(shape.fontFamily) : null;
      if (!entry) return '';
      const commands = outlineCommands(entry.font, shape.text, shape.x, textBaselineY(shape, entry.font), shape.fontSize);
      if (!commands.length) return '';
      return '  <g>\n    <path d="' + esc(pathData(commands)) + '" ' + common.join(' ') + '/>\n  </g>';
    }
    if (shape.type === 'path') {
      const rule = shape.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      return '  <path d="' + esc(pathData(shape.commands)) + '"' + rule + ' ' + common.join(' ') + '/>';
    }
    return '';
  }

  function exportShapeElement(shape) {
    const f = (value) => fmt(value, 6);
    const attrs = {
      fill: shape.type === 'line' ? 'none' : shape.fill,
      stroke: shape.stroke,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    };
    if (shape.strokeWidth) attrs['stroke-width'] = f(shape.strokeWidth);
    if (shape.opacity !== 1) attrs.opacity = f(shape.opacity);
    const create = (tag, values) => {
      const element = document.createElementNS(NS, tag);
      Object.entries(values).forEach(([key, value]) => {
        if (value !== undefined && value !== null) element.setAttribute(key, String(value));
      });
      return element;
    };
    if (shape.type === 'rect') {
      return create('rect', {
        ...attrs,
        x: f(shape.x), y: f(shape.y),
        width: f(shape.w), height: f(shape.h),
        rx: f(clamp(shape.rx, 0, Math.min(shape.w, shape.h) / 2))
      });
    }
    if (shape.type === 'ellipse') {
      return create('ellipse', { ...attrs, cx: f(shape.cx), cy: f(shape.cy), rx: f(shape.rx), ry: f(shape.ry) });
    }
    if (shape.type === 'circle') {
      return create('circle', { ...attrs, cx: f(shape.cx), cy: f(shape.cy), r: f(shape.r) });
    }
    if (shape.type === 'polygon') {
      return create('polygon', { ...attrs, points: shape.points.map((point) => f(point.x) + ',' + f(point.y)).join(' ') });
    }
    if (shape.type === 'line') {
      return create('line', {
        ...attrs,
        x1: f(shape.x1), y1: f(shape.y1), x2: f(shape.x2), y2: f(shape.y2)
      });
    }
    if (shape.type === 'path') {
      const values = { ...attrs, d: pathData(shape.commands, 6) };
      if (shape.fillRule === 'evenodd') values['fill-rule'] = 'evenodd';
      return create('path', values);
    }
    if (shape.type === 'text') {
      const entry = shape.fontFamily ? state.fonts.get(shape.fontFamily) : null;
      if (!entry) return null;
      const commands = outlineCommands(entry.font, shape.text, shape.x, textBaselineY(shape, entry.font), shape.fontSize);
      if (!commands.length) return null;
      const group = document.createElementNS(NS, 'g');
      group.appendChild(create('path', { ...attrs, d: pathData(commands, 6) }));
      return group;
    }
    return null;
  }

  function matrixAttribute(matrix) {
    const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
      .map((value) => String(Number(value.toFixed(6))));
    return 'matrix(' + values.join(' ') + ')';
  }

  function matrixIsIdentity(matrix) {
    return Math.abs(matrix.a - 1) < 1e-9 && Math.abs(matrix.b) < 1e-9 &&
      Math.abs(matrix.c) < 1e-9 && Math.abs(matrix.d - 1) < 1e-9 &&
      Math.abs(matrix.e) < 1e-9 && Math.abs(matrix.f) < 1e-9;
  }

  function sourceParentMatrix(element, root) {
    const chain = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      chain.push(node);
      if (node === root) break;
    }
    chain.reverse();
    let matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    for (const node of chain) {
      if (/(?:^|;)\s*transform\s*:/i.test(node.getAttribute('style') || '')) return null;
      const value = node.getAttribute('transform');
      if (!value) continue;
      const transform = parseTransform(value);
      if (!transform) return null;
      matrix = multiplyMatrices(matrix, transform);
    }
    return matrix;
  }

  function sourceElement(doc, key) {
    const escaped = String(key).replace(/["\\]/g, '\\$&');
    return doc.querySelector('[data-albedo-key="' + escaped + '"]');
  }

  /**
   * Keep source z-order in sync with the layer panel.  Only elements sharing a
   * parent can be swapped without moving them across groups; non-shape siblings
   * keep their slots.
   */
  function reorderSource(doc, root, shapes, entries) {
    const order = new Map();
    shapes.forEach((shape, index) => order.set(shape.id, index));
    const byParent = new Map();
    shapes.forEach((shape) => {
      const entry = entries.get(shape.id);
      if (!entry) return;
      const element = sourceElement(root, entry.key);
      if (!element || !element.parentNode) return;
      const parent = element.parentNode;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push({ element, order: order.get(shape.id) });
    });
    byParent.forEach((items, parent) => {
      const seen = new Set();
      const unique = items.filter((item) => {
        if (seen.has(item.element)) return false;
        seen.add(item.element);
        return true;
      });
      if (unique.length < 2) return;
      const slots = unique.map((item) => ({
        ...item,
        slot: Array.prototype.indexOf.call(parent.childNodes, item.element)
      })).sort((a, b) => a.slot - b.slot);
      const desired = slots.slice().sort((a, b) => a.order - b.order);
      if (desired.every((item, index) => item.element === slots[index].element)) return;
      slots.forEach((item) => {
        item.placeholder = doc.createComment('albedo-order');
        parent.replaceChild(item.placeholder, item.element);
      });
      slots.forEach((slot, index) => {
        parent.replaceChild(desired[index].element, slot.placeholder);
      });
    });
  }

  function withSourceOpacity(shape, entry) {
    const factor = Number(entry.ancestorOpacity);
    if (!(factor > 0) || Math.abs(factor - 1) < 1e-9) return shape;
    return { ...shape, opacity: clamp(shape.opacity / factor, 0, 1) };
  }

  /**
   * When only geometry changed, keep the original paint attributes.  This
   * preserves gradients, patterns, dash arrays and other styling the editor
   * model does not represent.
   */
  function keepSourcePaint(element, generated, shape, entry) {
    let baseline;
    try {
      baseline = JSON.parse(entry.baseline);
    } catch (error) {
      return;
    }
    if (!baseline) return;
    const current = normalizeDoc({ width: MIN_CANVAS, height: MIN_CANVAS, shapes: [shape] }).shapes[0];
    const keys = ['fill', 'stroke', 'strokeWidth', 'opacity', 'fillRule'];
    if (!keys.every((key) => current[key] === baseline[key])) return;
    const fill = element.getAttribute('fill') || '';
    const stroke = element.getAttribute('stroke') || '';
    const paintServer = /^url\(/i.test(fill) || /^url\(/i.test(stroke);
    [
      'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap',
      'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
      'stroke-miterlimit', 'paint-order', 'vector-effect',
      'marker-start', 'marker-mid', 'marker-end',
      'color-interpolation', 'shape-rendering'
    ].forEach((name) => {
      const value = element.getAttribute(name);
      if (value !== null) generated.setAttribute(name, value);
    });
    if (paintServer) {
      // A gradient/pattern carries its own alpha in its stops; the model
      // opacity already folded the first stop's alpha in, so use the source
      // element's own opacity instead to avoid applying it twice.
      const ownOpacity = element.getAttribute('opacity');
      if (ownOpacity !== null) generated.setAttribute('opacity', ownOpacity);
      else generated.removeAttribute('opacity');
    }
  }

  /**
   * Export from the source template.  Untouched shapes are left exactly as
   * they were authored (primitive type, `d` data, ids, attributes); only
   * changed shapes are regenerated, and added shapes are appended.  Generated
   * shapes that live inside a transformed source group receive the inverse of
   * the group matrix so they still render at their editor coordinates.
   */
  function buildSourceSvg() {
    const source = state.source;
    const shapes = state.doc.shapes;
    if (!source || !source.doc) return null;
    const entries = source.entries;

    const doc = source.doc.cloneNode(true);
    const root = doc.documentElement;
    const W = state.doc.width;
    const H = state.doc.height;
    root.setAttribute('width', String(W));
    root.setAttribute('height', String(H));
    root.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    let title = Array.from(root.children).find((element) => element.nodeName.toLowerCase() === 'title');
    if (!title) {
      title = doc.createElementNS(NS, 'title');
      root.insertBefore(title, root.firstChild);
    }
    title.textContent = state.doc.name || t('doc.untitled');

    reorderSource(doc, root, shapes, entries);
    shapes.forEach((shape) => {
      const entry = entries.get(shape.id);
      if (!entry) {
        const element = exportShapeElement(shape);
        if (element) root.appendChild(element);
        return;
      }
      const element = sourceElement(doc, entry.key);
      if (!element) {
        const generated = exportShapeElement(shape);
        if (generated) root.appendChild(generated);
        return;
      }
      if (shapeSignature(shape) === entry.baseline) return;
      const generated = exportShapeElement(withSourceOpacity(shape, entry));
      if (!generated) return;
      keepSourcePaint(element, generated, shape, entry);
      const sourceId = element.getAttribute('id');
      if (sourceId) generated.setAttribute('id', sourceId);
      ['filter', 'clip-path', 'mask'].forEach((name) => {
        const value = element.getAttribute(name);
        if (value) generated.setAttribute(name, value);
      });
      const parentMatrix = sourceParentMatrix(element, root);
      const inverse = parentMatrix ? invertMatrix(parentMatrix) : null;
      if (!inverse) {
        // The ancestor transform cannot be expressed (e.g. a CSS transform).
        // Generate at the root so editor coordinates stay correct instead of
        // letting the unknown transform apply twice.
        if (element.parentNode) element.parentNode.removeChild(element);
        root.appendChild(generated);
        return;
      }
      if (!matrixIsIdentity(inverse)) {
        generated.setAttribute('transform', matrixAttribute(inverse));
      }
      element.parentNode.replaceChild(generated, element);
    });

    entries.forEach((entry, id) => {
      if (shapes.some((shape) => shape.id === id)) return;
      const element = sourceElement(doc, entry.key);
      if (element && element.parentNode) element.parentNode.removeChild(element);
    });

    doc.querySelectorAll('[data-albedo-key]').forEach((element) => {
      element.removeAttribute('data-albedo-key');
    });

    const serialized = new XMLSerializer().serializeToString(doc);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + serialized + '\n';
  }

  /**
   * Fallback for documents without a source template (new drawings, or a
   * source that could not be mapped): the artboard and its background are view
   * state and are not written as shapes.
   */
  function buildGeneratedSvg() {
    const W = state.doc.width;
    const H = state.doc.height;
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
      '  <title>' + esc(state.doc.name || t('doc.untitled')) + '</title>'
    ];
    state.doc.shapes.forEach((shape) => {
      const markup = shapeMarkup(shape);
      if (markup) lines.push(markup);
    });
    lines.push('</svg>', '');
    return lines.join('\n');
  }

  function buildSvg() {
    return buildSourceSvg() || buildGeneratedSvg();
  }

  async function exportSvg() {
    flushEdit();
    if (!(await ensureFontsForShapes())) return;
    const svg = buildSvg();
    const name = (state.doc.name || 'albedo-svg').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'albedo-svg';
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name + '.svg';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('toast.svgExported'));
  }

  async function copySvg() {
    flushEdit();
    if (!(await ensureFontsForShapes())) return;
    const svg = buildSvg();
    try {
      await navigator.clipboard.writeText(svg);
      toast(t('toast.svgCopied'));
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = svg;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        toast(t('toast.svgCopied'));
      } catch (err) {
        toast(t('toast.copyFailed'));
      }
      area.remove();
    }
  }

  /* ------------------------------------------------------------------ *
   * Canvas size
   * ------------------------------------------------------------------ */

  function gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) {
      const t = x % y;
      x = y;
      y = t;
    }
    return x || 1;
  }

  function ratioLabel(w, h) {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '—';
    const d = gcd(Math.round(w), Math.round(h));
    const rw = Math.round(w) / d;
    const rh = Math.round(h) / d;
    if (rw <= 30 && rh <= 30) return rw + ' : ' + rh;
    return (w / h).toFixed(2) + ' : 1';
  }

  function syncCanvasModal() {
    const w = Number(dom.canvasWidthInput.value);
    const h = Number(dom.canvasHeightInput.value);
    dom.canvasRatioChip.textContent = ratioLabel(w, h);
    const presetValue = w + ',' + h;
    $$('.size-preset', dom.canvasModal).forEach((button) => {
      button.classList.toggle('active', button.dataset.preset === presetValue);
    });
    dom.canvasSizeError.textContent = '';
  }

  function openCanvasModal(trigger) {
    if (!state.doc) return;
    state.canvasTrigger = trigger || document.activeElement;
    dom.canvasWidthInput.value = state.doc.width;
    dom.canvasHeightInput.value = state.doc.height;
    dom.canvasSizeError.textContent = '';
    syncCanvasModal();
    dom.canvasModal.hidden = false;
    requestAnimationFrame(() => {
      dom.canvasWidthInput.focus();
      dom.canvasWidthInput.select();
    });
  }

  function closeCanvasModal() {
    if (dom.canvasModal.hidden) return;
    dom.canvasModal.hidden = true;
    const trigger = state.canvasTrigger;
    state.canvasTrigger = null;
    if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) {
      requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
    }
  }

  function applyCanvasSize() {
    const widthText = dom.canvasWidthInput.value.trim();
    const heightText = dom.canvasHeightInput.value.trim();
    if (!widthText || !heightText) {
      dom.canvasSizeError.textContent = t('modal.required');
      return;
    }
    const rawW = Number(widthText);
    const rawH = Number(heightText);
    if (!Number.isFinite(rawW) || !Number.isFinite(rawH)) {
      dom.canvasSizeError.textContent = t('modal.invalid');
      return;
    }
    const width = Math.round(rawW);
    const height = Math.round(rawH);
    if (width < MIN_CANVAS || width > MAX_CANVAS || height < MIN_CANVAS || height > MAX_CANVAS) {
      dom.canvasSizeError.textContent = t('modal.range', { min: MIN_CANVAS, max: MAX_CANVAS });
      return;
    }
    if (width === state.doc.width && height === state.doc.height) {
      closeCanvasModal();
      return;
    }
    flushEdit();
    const before = snapshot();
    state.doc.width = width;
    state.doc.height = height;
    pushHistory(before);
    closeCanvasModal();
    renderAll();
    markDirty();
    toast(t('toast.canvasResized', { w: width, h: height }));
  }

  /* ------------------------------------------------------------------ *
   * Underlay / tracing reference
   * ------------------------------------------------------------------ */

  function setUnderlayAdjust(active) {
    if (!state.underlay) return;
    if (active && !state.underlay.visible) {
      toast(t('toast.showUnderlay'));
      return;
    }
    state.underlayAdjust = Boolean(active);
    if (state.underlayAdjust) {
      applySelection([]);
    }
    renderAll();
  }

  function fitUnderlay(mode) {
    const u = state.underlay;
    if (!u) return;
    const scale = mode === 'fill'
      ? Math.max(state.doc.width / u.naturalW, state.doc.height / u.naturalH)
      : Math.min(state.doc.width / u.naturalW, state.doc.height / u.naturalH);
    u.w = Math.max(1, u.naturalW * scale);
    u.h = Math.max(1, u.naturalH * scale);
    u.x = (state.doc.width - u.w) / 2;
    u.y = (state.doc.height - u.h) / 2;
    state.underlayAdjust = true;
    applySelection([]);
    renderAll();
    markUnderlayDirty();
    toast(t(mode === 'fill' ? 'toast.underlayFilled' : 'toast.underlayFitted'));
  }

  function centerUnderlay() {
    const u = state.underlay;
    if (!u) return;
    u.x = (state.doc.width - u.w) / 2;
    u.y = (state.doc.height - u.h) / 2;
    state.underlayAdjust = true;
    applySelection([]);
    renderAll();
    markUnderlayDirty();
    toast(t('toast.underlayCentered'));
  }

  function applyUnderlayProp(prop, value) {
    const u = state.underlay;
    if (!u || !Number.isFinite(value)) return;
    const ratio = u.naturalW / u.naturalH;
    if (prop === 'x') u.x = value;
    else if (prop === 'y') u.y = value;
    else if (prop === 'w') {
      u.w = Math.max(8, value);
      u.h = u.w / ratio;
    } else if (prop === 'h') {
      u.h = Math.max(8, value);
      u.w = u.h * ratio;
    }
    syncUnderlayImage();
    renderOverlay();
    markUnderlayDirty();
    if (prop === 'w' || prop === 'h') {
      const other = dom.inspector.querySelector('[data-underlay-prop="' + (prop === 'w' ? 'h' : 'w') + '"]');
      if (other) other.value = fmt(prop === 'w' ? u.h : u.w);
    }
  }

  function nudgeUnderlay(dx, dy) {
    const u = state.underlay;
    if (!u) return;
    u.x += dx;
    u.y += dy;
    syncUnderlayImage();
    renderOverlay();
    const xField = dom.inspector.querySelector('[data-underlay-prop="x"]');
    const yField = dom.inspector.querySelector('[data-underlay-prop="y"]');
    if (xField) xField.value = fmt(u.x);
    if (yField) yField.value = fmt(u.y);
    markUnderlayDirty();
  }

  function toggleUnderlayVisibility() {
    const u = state.underlay;
    if (!u) return;
    u.visible = !u.visible;
    if (!u.visible) state.underlayAdjust = false;
    renderAll();
    markUnderlayDirty();
    toast(t(u.visible ? 'toast.underlayShown' : 'toast.underlayHidden'));
  }

  function removeUnderlay() {
    if (!state.underlay) return;
    state.underlayImportToken += 1;
    state.underlay = null;
    state.underlayAdjust = false;
    state.underlayWarned = false;
    state.underlayPersistFailed = false;
    saveUnderlayNow();
    renderAll();
    toast(t('toast.underlayRemoved'));
  }

  function importUnderlayFile(file) {
    if (!file) return;
    const looksLikeImage = /^image\//i.test(file.type) || /\.(png|jpe?g|jfif|webp|gif|svg|avif|bmp|ico)$/i.test(file.name);
    if (!looksLikeImage) {
      toast(t('toast.chooseImage'));
      return;
    }
    const token = ++state.underlayImportToken;
    toast(t('toast.readingUnderlay'));
    const reader = new FileReader();
    reader.onload = () => {
      if (token !== state.underlayImportToken) return;
      const src = String(reader.result || '');
      const probe = new Image();
      probe.onload = () => {
        if (token !== state.underlayImportToken) return;
        const naturalW = probe.naturalWidth || probe.width;
        const naturalH = probe.naturalHeight || probe.height;
        if (!naturalW || !naturalH) {
          toast(t('toast.imageNoSize'));
          return;
        }
        const scale = Math.min(state.doc.width / naturalW, state.doc.height / naturalH);
        const u = {
          name: file.name || t('underlay.defaultName'),
          src,
          naturalW,
          naturalH,
          x: (state.doc.width - naturalW * scale) / 2,
          y: (state.doc.height - naturalH * scale) / 2,
          w: naturalW * scale,
          h: naturalH * scale,
          opacity: state.underlay?.opacity ?? 0.85,
          visible: true
        };
        state.underlay = u;
        state.underlayAdjust = true;
        state.underlayWarned = false;
        state.underlayPersistFailed = false;
        applySelection([]);
        activateLeftTab('guides');
        renderAll();
        toast(t('toast.underlayImported'));
        saveUnderlayNow();
      };
      probe.onerror = () => {
        if (token === state.underlayImportToken) toast(t('toast.imageDecodeFailed'));
      };
      probe.src = src;
    };
    reader.onerror = () => {
      if (token === state.underlayImportToken) toast(t('toast.imageReadFailed'));
    };
    reader.readAsDataURL(file);
  }

  /* ------------------------------------------------------------------ *
   * SVG import
   * ------------------------------------------------------------------ */

  function isSvgFile(file) {
    return Boolean(file) && (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || ''));
  }

  function svgBaseName(name) {
    const base = String(name || '').replace(/\.svg$/i, '').trim().slice(0, 40);
    return base || t('shape.path');
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort()
        .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]))
        .join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function shapeSignature(shape) {
    // Compare the same canonical form that normalizeDoc will produce after a
    // save/reload, so persisted baselines keep matching.
    const canonical = normalizeDoc({
      width: MIN_CANVAS, height: MIN_CANVAS, shapes: [shape]
    }).shapes[0];
    const copy = deepClone(canonical);
    delete copy.id;
    delete copy.name;
    delete copy.sourceKey;
    if (Array.isArray(copy.commands)) copy.commands.forEach((command) => delete command.id);
    return stableStringify(copy);
  }

  function ancestorOpacityFor(element) {
    let opacity = 1;
    for (let node = element?.parentElement; node; node = node.parentElement) {
      const directValue = node.getAttribute('opacity');
      if (directValue !== null && directValue.trim() !== '') {
        const direct = Number(directValue);
        if (Number.isFinite(direct)) opacity *= clamp(direct, 0, 1);
      }
      const style = node.getAttribute('style') || '';
      const match = /(?:^|;)\s*opacity\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+))/i.exec(style);
      if (match) opacity *= clamp(Number(match[1]), 0, 1);
      if (node.nodeName.toLowerCase() === 'svg') break;
    }
    return clamp(opacity, 0, 1);
  }

  function prefixSourceIds(root, prefix) {
    const ids = new Map();
    root.querySelectorAll('[id]').forEach((element) => {
      const oldId = element.getAttribute('id');
      if (!oldId) return;
      const nextId = prefix + oldId;
      ids.set(oldId, nextId);
      element.setAttribute('id', nextId);
    });
    if (!ids.size) return;
    const replace = (value) => String(value).replace(/url\(\s*#([^)\s]+)\s*\)/g,
      (match, id) => (ids.has(id) ? 'url(#' + ids.get(id) + ')' : match));
    const rewrite = (element) => {
      Array.from(element.attributes).forEach((attr) => {
        if (attr.name === 'id') return;
        if (attr.name === 'href' || attr.name.endsWith(':href')) {
          if (attr.value.startsWith('#') && ids.has(attr.value.slice(1))) {
            element.setAttribute(attr.name, '#' + ids.get(attr.value.slice(1)));
          }
          return;
        }
        if (attr.value.includes('url(')) element.setAttribute(attr.name, replace(attr.value));
      });
    };
    rewrite(root);
    root.querySelectorAll('*').forEach(rewrite);
  }

  function importCanvasSize(source, replaceStarter) {
    const width = Number(source?.width);
    const height = Number(source?.height);
    if (!(width > 0) || !(height > 0)) return;
    const nextW = clamp(Math.round(width), MIN_CANVAS, MAX_CANVAS);
    const nextH = clamp(Math.round(height), MIN_CANVAS, MAX_CANVAS);
    if (replaceStarter) {
      state.doc.width = nextW;
      state.doc.height = nextH;
    } else {
      state.doc.width = clamp(Math.max(state.doc.width, nextW), MIN_CANVAS, MAX_CANVAS);
      state.doc.height = clamp(Math.max(state.doc.height, nextH), MIN_CANVAS, MAX_CANVAS);
    }
  }

  function cloneSource(source) {
    if (!source || !source.doc) return null;
    const doc = source.doc.cloneNode(true);
    return { doc, root: doc.documentElement, entries: new Map(source.entries) };
  }

  /**
   * Keep the source template around so export can re-emit untouched elements
   * verbatim and only replace the shapes that actually changed.
   */
  function rememberSource(parsed, shapes, replace) {
    if (!parsed.sourceDoc || !parsed.sourceRoot) return;
    let shapeByKey = new Map();
    shapes.forEach((shape) => {
      if (shape.sourceKey) shapeByKey.set(shape.sourceKey, shape);
    });
    if (!shapeByKey.size) return;
    if (replace || !state.source) {
      state.source = { doc: parsed.sourceDoc, root: parsed.sourceRoot, entries: new Map() };
    } else {
      // Keep import checkpoints immutable: merge into a copy rather than the
      // template that an earlier undo state may still reference.
      state.source = cloneSource(state.source);
      state.sourceSerial += 1;
      const prefix = uid('imp') + '-';
      const existingIds = new Set();
      state.source.root.querySelectorAll('[id]').forEach((element) => existingIds.add(element.getAttribute('id')));
      const collides = Array.from(parsed.sourceRoot.querySelectorAll('[id]'))
        .some((element) => existingIds.has(element.getAttribute('id')));
      if (collides) prefixSourceIds(parsed.sourceRoot, prefix);
      const keyMap = new Map();
      parsed.sourceRoot.querySelectorAll('[data-albedo-key]').forEach((element) => {
        const oldKey = element.getAttribute('data-albedo-key');
        if (!oldKey) return;
        const nextKey = prefix + oldKey;
        keyMap.set(oldKey, nextKey);
        element.setAttribute('data-albedo-key', nextKey);
      });
      // Root-level presentation attributes (fill, stroke, style, opacity, ...)
      // are inherited by the imported children.  Keep them on a wrapper so the
      // merged document still renders the new import as it did on its own.
      const wrapper = parsed.sourceDoc.createElementNS(
        parsed.sourceRoot.namespaceURI || 'http://www.w3.org/2000/svg', 'g'
      );
      const skipRootAttrs = new Set(['width', 'height', 'viewBox', 'preserveAspectRatio', 'version', 'id', 'x', 'y']);
      Array.from(parsed.sourceRoot.attributes).forEach((attr) => {
        if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) return;
        if (skipRootAttrs.has(attr.name)) return;
        wrapper.setAttribute(attr.name, attr.value);
      });
      Array.from(parsed.sourceRoot.childNodes).forEach((node) => {
        if (node.nodeType === 1 && node.nodeName.toLowerCase() === 'title') return;
        wrapper.appendChild(node);
      });
      state.source.root.appendChild(wrapper);
      const renamed = new Map();
      shapeByKey.forEach((shape, oldKey) => renamed.set(keyMap.get(oldKey) || oldKey, shape));
      shapeByKey = renamed;
    }
    shapeByKey.forEach((shape, key) => {
      const escaped = key.replace(/["\\]/g, '\\$&');
      const element = state.source.root.querySelector('[data-albedo-key="' + escaped + '"]');
      state.source.entries.set(shape.id, {
        key,
        baseline: shapeSignature(shape),
        ancestorOpacity: element ? ancestorOpacityFor(element) : 1
      });
    });
  }

  function importSvgContent(svgText, name) {
    let parsed;
    try {
      parsed = parseSvg(svgText);
    } catch (error) {
      toast(t('toast.svgInvalid'));
      return false;
    }
    if (!parsed || !parsed.shapes.length) {
      toast(t('toast.svgNoShapes'));
      return false;
    }

    flushEdit();
    const before = snapshot();
    const replaceStarter = state.starter;
    const replaceSource = replaceStarter || state.doc.shapes.length === 0;
    const base = svgBaseName(name);
    const shapes = parsed.shapes.map((shape, index) => {
      const next = { ...shape, id: uid('s'), name: base + ' ' + (index + 1) };
      if (next.type === 'path') next.commands = normalizeCommands(next.commands);
      return next;
    });
    const previousSource = cloneSource(state.source);
    if (replaceSource) state.source = null;
    rememberSource(parsed, shapes, replaceSource);
    shapes.forEach((shape) => delete shape.sourceKey);
    importCanvasSize(parsed.source, replaceStarter);
    if (replaceStarter) state.doc.shapes = [];
    if (state.doc.name === t('doc.untitled')) {
      if (parsed.title) state.doc.name = parsed.title;
      else if (replaceStarter) state.doc.name = base;
    }
    state.doc.shapes.push(...shapes);
    state.sourceByDoc.set(before, previousSource);
    state.sourceByDoc.set(snapshot(), state.source);
    state.sourcePersisted = false;
    applySelection(shapes.map((shape) => shape.id));
    state.pathEdit = false;
    state.rightTab = 'style';
    pushHistory(before);
    renderAll();
    markDirty();

    let message = tc('toast.svgImported', shapes.length, { count: shapes.length });
    if (parsed.warnings && parsed.warnings.gradients) {
      message += ' · ' + t('toast.svgGradientsFlattened');
    }
    toast(message);
    return true;
  }

  async function importSvgFile(file) {
    if (!isSvgFile(file)) {
      toast(t('toast.chooseSvg'));
      return;
    }
    const token = ++state.svgImportToken;
    toast(t('toast.readingSvg'));
    try {
      const text = await file.text();
      if (token !== state.svgImportToken) return;
      importSvgContent(text, file.name);
    } catch (error) {
      if (token === state.svgImportToken) toast(t('toast.svgReadFailed'));
    }
  }

  function chooseSvgFile() {
    if (dom.importSvgFile) dom.importSvgFile.click();
  }

  function underlayAction(action) {
    const u = state.underlay;
    if (action === 'fit') fitUnderlay('contain');
    else if (action === 'fill') fitUnderlay('fill');
    else if (action === 'center') centerUnderlay();
    else if (action === 'done') {
      setUnderlayAdjust(false);
      toast(t('toast.underlayFixed'));
    } else if (action === 'remove') removeUnderlay();
    else if (action === 'replace') dom.underlayFile.click();
    else if (action === 'adjust') setUnderlayAdjust(!state.underlayAdjust);
    else if (action === 'visible' && u) toggleUnderlayVisibility();
  }

  /* ------------------------------------------------------------------ *
   * Misc UI
   * ------------------------------------------------------------------ */

  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 1900);
  }

  function newDocument() {
    flushEdit();
    const before = snapshot();
    const previousSource = state.source;
    const width = state.doc.width;
    const height = state.doc.height;
    const hasUnderlay = Boolean(state.underlay);
    state.doc = { name: t('doc.untitled'), background: '#fffdf8', width, height, shapes: [] };
    state.source = null;
    state.sourceSerial = 0;
    state.sourceByDoc.set(before, previousSource);
    state.sourceByDoc.set(snapshot(), null);
    state.sourcePersisted = false;
    applySelection([]);
    state.pathEdit = true;
    state.underlayAdjust = false;
    dom.docTitle.value = state.doc.name;
    pushHistory(before);
    renderAll();
    saveNow();
    toast(t(hasUnderlay ? 'toast.newBlankKeep' : 'toast.newBlank'));
  }

  function updateDocTitle() {
    const value = dom.docTitle.value.trim() || t('doc.untitled');
    state.doc.name = value;
    dom.crumbTitle.textContent = value;
    markDirty();
  }

  function nudgeSelected(dx, dy) {
    const shapes = selectedShapes();
    if (!shapes.length) return;
    flushEdit();
    const before = snapshot();
    shapes.forEach((shape) => translateShape(shape, dx, dy));
    pushHistory(before);
    renderCanvas();
    renderInspector();
    markDirty();
  }

  function applyProp(el, prop, value) {
    const shape = selectedShape();
    if (prop === 'background') {
      state.doc.background = value;
      dom.canvasBg.setAttribute('fill', value);
      markDirty();
      return;
    }
    if (!shape) return;
    if (['x', 'y', 'w', 'h', 'rx', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'ry', 'r', 'fontSize', 'strokeWidth', 'opacity'].includes(prop)) {
      if (!Number.isFinite(value)) return;
      if (prop === 'w' || prop === 'h' || prop === 'rx' || prop === 'ry') value = Math.max(prop === 'rx' ? 0 : 0.5, value);
      if (prop === 'r') value = Math.max(1, value);
      if (prop === 'fontSize') value = clamp(value, 1, 5000);
      if (prop === 'opacity') value = clamp(value, 0, 1);
      if (prop === 'strokeWidth') value = clamp(value, 0, 120);
    }
    shape[prop] = value;
    renderCanvas();
    if (prop === 'opacity') {
      const label = dom.inspector.querySelector('[data-opacity-label]');
      if (label) label.textContent = Math.round(value * 100) + '%';
    }
    markDirty();
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  function bindEvents() {
    dom.langSelect?.addEventListener('change', () => applyLanguage(dom.langSelect.value));
    window.addEventListener('languagechange', () => {
      if (state.langMode === 'auto') applyLanguage('auto', { persist: false });
    });
    dom.undoBtn.addEventListener('click', undo);
    dom.redoBtn.addEventListener('click', redo);
    $('#newBtn').addEventListener('click', newDocument);
    $('#copyBtn').addEventListener('click', copySvg);
    $('#exportBtn').addEventListener('click', exportSvg);
    dom.docTitle.addEventListener('input', updateDocTitle);
    dom.docTitle.addEventListener('blur', () => {
      if (!dom.docTitle.value.trim()) dom.docTitle.value = t('doc.untitled');
      updateDocTitle();
    });

    $$('.shape-btn').forEach((button) => {
      button.addEventListener('click', () => addShape(button.dataset.add));
    });

    if (dom.importSvgBtn) dom.importSvgBtn.addEventListener('click', chooseSvgFile);
    if (dom.insertSvgBtn) dom.insertSvgBtn.addEventListener('click', chooseSvgFile);
    if (dom.importSvgFile) {
      dom.importSvgFile.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (file) importSvgFile(file);
      });
    }

    bindPanelTabs(dom.leftRail, activateLeftTab);
    bindPanelTabs(dom.inspectorRail, activateRightTab);

    dom.gridToggle.addEventListener('change', () => {
      state.grid.visible = dom.gridToggle.checked;
      renderGrid();
    });
    dom.gridSize.addEventListener('change', () => {
      const size = Number(dom.gridSize.value);
      state.grid.size = GRID_SIZES.includes(size) ? size : 8;
      renderGrid();
    });
    dom.snapToggle.addEventListener('change', () => {
      state.snapEnabled = dom.snapToggle.checked;
      if (!state.snapEnabled) {
        state.snapGuides = [];
        renderOverlay();
      }
    });

    dom.underlayImportBtn.addEventListener('click', () => dom.underlayFile.click());
    dom.underlayReplaceBtn.addEventListener('click', () => dom.underlayFile.click());
    dom.underlayFile.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) importUnderlayFile(file);
    });
    dom.underlayVisibleBtn.addEventListener('click', toggleUnderlayVisibility);
    dom.underlayAdjustBtn.addEventListener('click', () => {
      const next = !state.underlayAdjust;
      setUnderlayAdjust(next);
      if (!next) toast(t('toast.underlayFixed'));
    });
    dom.underlayRemoveBtn.addEventListener('click', removeUnderlay);

    dom.canvasSizeBtn.addEventListener('click', () => openCanvasModal(dom.canvasSizeBtn));
    dom.zoomInBtn.addEventListener('click', () => setZoom(nextZoom(state.zoom, 1)));
    dom.zoomOutBtn.addEventListener('click', () => setZoom(nextZoom(state.zoom, -1)));
    dom.zoomFitBtn.addEventListener('click', () => setZoom(1));
    dom.stageBody.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(clampZoom(state.zoom * wheelZoomFactor(event.deltaY)), { x: event.clientX, y: event.clientY });
    }, { passive: false });
    dom.canvasModal.addEventListener('click', (event) => {
      const preset = event.target.closest('[data-preset]');
      if (preset) {
        const [width, height] = preset.dataset.preset.split(',');
        dom.canvasWidthInput.value = width;
        dom.canvasHeightInput.value = height;
        syncCanvasModal();
        dom.canvasWidthInput.focus();
        return;
      }
      if (event.target.closest('[data-close-canvas]')) closeCanvasModal();
    });
    [dom.canvasWidthInput, dom.canvasHeightInput].forEach((input) => {
      input.addEventListener('input', syncCanvasModal);
    });
    dom.canvasApplyBtn.addEventListener('click', applyCanvasSize);

    dom.fontModal.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-font]')) {
        closeFontModal();
        return;
      }
      const item = event.target.closest('[data-font-ps]');
      if (item) {
        applyFontChoice(item.dataset.fontPs);
        return;
      }
      if (event.target.closest('#fontRetryBtn')) queryLocalFontList();
    });
    dom.fontSearch.addEventListener('input', renderFontList);

    dom.stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const shapeNode = event.target.closest('.shape');
      if (shapeNode) {
        const shape = shapeById(shapeNode.dataset.id);
        if (!shape) return;
        const additive = isAdditiveEvent(event);
        if (additive) {
          selectShape(shape.id, { additive: true, keepPathEdit: false });
          return;
        }
        if (!isSelected(shape.id)) {
          selectShape(shape.id, { keepPathEdit: false });
        }
        beginShapeDrag(event, shape);
      } else if (event.target === dom.stage || event.target === dom.canvasBg) {
        if (!isAdditiveEvent(event)) selectShape(null);
        beginMarquee(event);
      }
    });

    dom.stage.addEventListener('pointermove', (event) => {
      if (state.gesture) return;
      const point = clientToSvg(event);
      updateCoordStatus(point);
    });

    const hasFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
    dom.stageBody.addEventListener('dragover', (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      dom.stageBody.classList.add('is-drop');
    });
    dom.stageBody.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget || !dom.stageBody.contains(event.relatedTarget)) {
        dom.stageBody.classList.remove('is-drop');
      }
    });
    dom.stageBody.addEventListener('drop', (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      dom.stageBody.classList.remove('is-drop');
      const file = Array.from(event.dataTransfer.files || [])[0];
      if (!file) return;
      if (isSvgFile(file)) importSvgFile(file);
      else importUnderlayFile(file);
    });
    window.addEventListener('dragover', (event) => {
      if (hasFileDrag(event)) event.preventDefault();
    });
    window.addEventListener('drop', (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      if (!dom.stageBody.contains(event.target)) {
        dom.stageBody.classList.remove('is-drop');
        toast(t('toast.dropImage'));
      }
    });

    dom.overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const underlayPart = event.target.closest('[data-underlay]');
      if (underlayPart) {
        event.preventDefault();
        event.stopPropagation();
        beginUnderlayGesture(event, underlayPart.dataset.underlay);
        return;
      }
      const node = event.target.closest('[data-node]');
      if (node) {
        event.preventDefault();
        event.stopPropagation();
        beginNodeDrag(event, node.dataset.cmd, node.dataset.node === 'control' ? node.dataset.part : 'anchor');
        return;
      }
      const handle = event.target.closest('[data-handle]');
      if (handle) {
        event.preventDefault();
        event.stopPropagation();
        beginResize(event, handle.dataset.handle);
      }
    });

    dom.layers.addEventListener('click', (event) => {
      const action = event.target.closest('[data-layer-action]');
      const row = event.target.closest('[data-layer-id]');
      if (!row) return;
      const id = row.dataset.layerId;
      if (action) {
        event.stopPropagation();
        const type = action.dataset.layerAction;
        if (type === 'delete') deleteShape(id);
        if (type === 'up') moveLayer(id, 1);
        if (type === 'down') moveLayer(id, -1);
        return;
      }
      selectShape(id, {
        additive: isAdditiveEvent(event),
        keepPathEdit: false,
        scrollLayer: false
      });
    });

    dom.layers.addEventListener('dragstart', (event) => {
      const row = event.target.closest('[data-layer-id]');
      if (!row) return;
      state.layerDrag = row.dataset.layerId;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData('text/plain', row.dataset.layerId); } catch (error) {}
    });
    dom.layers.addEventListener('dragover', (event) => {
      const row = event.target.closest('[data-layer-id]');
      if (!row || !state.layerDrag) return;
      event.preventDefault();
      $$('.layer-row', dom.layers).forEach((item) => item.classList.remove('drop-above', 'drop-below'));
      const rect = row.getBoundingClientRect();
      row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
    });
    dom.layers.addEventListener('drop', (event) => {
      const row = event.target.closest('[data-layer-id]');
      if (!row || !state.layerDrag) return;
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      const dragId = state.layerDrag;
      state.layerDrag = null;
      reorderLayer(dragId, row.dataset.layerId, !after);
    });
    dom.layers.addEventListener('dragend', () => {
      state.layerDrag = null;
      $$('.layer-row', dom.layers).forEach((item) => item.classList.remove('dragging', 'drop-above', 'drop-below'));
    });

    dom.inspector.addEventListener('click', (event) => {
      const underlayActionEl = event.target.closest('[data-underlay-action]');
      if (underlayActionEl) {
        event.preventDefault();
        underlayAction(underlayActionEl.dataset.underlayAction);
        return;
      }
      const booleanButton = event.target.closest('[data-boolean]');
      if (booleanButton && !booleanButton.disabled) {
        booleanSelected(booleanButton.dataset.boolean);
        return;
      }
      const alignButton = event.target.closest('[data-align]');
      if (alignButton && !alignButton.disabled) {
        alignSelection(alignButton.dataset.align);
        return;
      }
      const distributeButton = event.target.closest('[data-distribute]');
      if (distributeButton && !distributeButton.disabled) {
        distributeSelection(distributeButton.dataset.distribute);
        return;
      }
      const action = event.target.closest('[data-action]');
      if (action) {
        const kind = action.dataset.action;
        if (kind === 'delete') deleteSelection();
        if (kind === 'duplicate') duplicateShape();
        if (kind === 'choose-font') openFontModal();
        if (kind === 'open-canvas-size') {
          openCanvasModal(action);
          return;
        }
        if (kind === 'toggle-path-edit') {
          state.pathEdit = action.checked;
          renderOverlay();
          updateStatus();
        }
        return;
      }
      const none = event.target.closest('[data-set-none]');
      if (none) {
        const prop = none.dataset.setNone;
        flushEdit();
        const before = snapshot();
        if (prop === 'background') state.doc.background = 'none';
        else if (selectedShape()) selectedShape()[prop] = 'none';
        pushHistory(before);
        renderAll();
        markDirty();
        return;
      }
      const addCmd = event.target.closest('[data-add-cmd]');
      if (addCmd) {
        addCommand(addCmd.dataset.addCmd);
        return;
      }
      const delCmd = event.target.closest('[data-del-cmd]');
      if (delCmd) {
        event.stopPropagation();
        deleteCommand(delCmd.dataset.delCmd);
        return;
      }
      const copyPath = event.target.closest('[data-copy-path]');
      if (copyPath) {
        const shape = selectedShape();
        if (shape?.type === 'path') {
          navigator.clipboard?.writeText(pathData(shape.commands)).then(() => toast(t('toast.pathCopied'))).catch(() => toast(t('toast.copyFailedGeneric')));
        }
        return;
      }
      const selectCmd = event.target.closest('[data-select-cmd]');
      if (selectCmd) {
        selectCommand(selectCmd.dataset.selectCmd, true);
      }
    });

    dom.inspector.addEventListener('change', (event) => {
      const el = event.target;
      if (el.matches('input[data-action="toggle-path-edit"]')) {
        state.pathEdit = el.checked;
        renderOverlay();
        updateStatus();
        return;
      }
      if (el.matches('[data-poly-sides]')) {
        const shape = selectedShape();
        if (!shape || shape.type !== 'polygon') return;
        const value = parseFloat(el.value);
        if (!Number.isFinite(value)) {
          renderInspector();
          return;
        }
        const sides = clamp(Math.round(value), 3, 24);
        if (sides === shape.points.length) {
          el.value = String(sides);
          return;
        }
        flushEdit();
        const before = snapshot();
        const metrics = polygonMetrics(shape.points);
        shape.points = regularPolygonPoints(metrics.cx, metrics.cy, metrics.radius, sides, metrics.startAngle);
        pushHistory(before);
        renderAll();
        markDirty();
        toast(t('toast.polygonSides', { n: sides }));
      }
    });

    dom.inspector.addEventListener('input', (event) => {
      const el = event.target;
      if (el.matches('[data-underlay-opacity]')) {
        const u = state.underlay;
        if (!u) return;
        const value = parseFloat(el.value);
        if (!Number.isFinite(value)) return;
        u.opacity = clamp(value, 0.05, 1);
        syncUnderlayImage();
        const label = $('#underlayOpacityLabel', dom.inspector);
        if (label) label.textContent = Math.round(u.opacity * 100) + '%';
        markUnderlayDirty();
        return;
      }
      if (el.matches('[data-underlay-prop]')) {
        const value = parseFloat(el.value);
        if (Number.isFinite(value)) applyUnderlayProp(el.dataset.underlayProp, value);
        return;
      }
      if (el.matches('[data-poly-point]')) {
        const shape = selectedShape();
        if (!shape || shape.type !== 'polygon') return;
        const index = Number(el.dataset.polyPoint);
        const axis = el.dataset.polyAxis;
        const point = shape.points[index];
        const value = parseFloat(el.value);
        if (!point || (axis !== 'x' && axis !== 'y') || !Number.isFinite(value)) return;
        trackEdit();
        point[axis] = value;
        renderCanvas();
        markDirty();
        return;
      }
      if (el.matches('input[type="color"][data-prop]')) {
        const prop = el.dataset.prop;
        trackEdit();
        applyProp(el, prop, el.value);
        const hex = el.closest('.color-control')?.querySelector('[data-color-text]');
        if (hex) hex.value = el.value.toUpperCase();
        const swatch = el.closest('.swatch');
        if (swatch) { swatch.classList.remove('is-none'); swatch.style.setProperty('--swatch', el.value); }
        return;
      }
      if (el.matches('[data-color-text]')) {
        const value = el.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(value) || value === '') {
          if (value === '') return;
          trackEdit();
          applyProp(el, el.dataset.prop, value);
          const swatch = el.closest('.color-control')?.querySelector('.swatch');
          if (swatch) { swatch.classList.remove('is-none'); swatch.style.setProperty('--swatch', value); }
        }
        return;
      }
      if (el.matches('[data-cmd-flag]')) {
        const cmdId = el.dataset.cmdId;
        const shape = selectedShape();
        if (!shape || shape.type !== 'path') return;
        const cmd = shape.commands.find((item) => item.id === cmdId);
        if (!cmd) return;
        trackEdit();
        cmd[el.dataset.cmdFlag] = el.checked ? 1 : 0;
        renderCanvas();
        const code = $('#pathCode', dom.inspector);
        if (code) code.textContent = pathData(shape.commands);
        markDirty();
        return;
      }
      if (el.matches('[data-cmd-key]')) {
        const cmdId = el.dataset.cmdId;
        const shape = selectedShape();
        if (!shape || shape.type !== 'path') return;
        const cmd = shape.commands.find((item) => item.id === cmdId);
        if (!cmd) return;
        let value = parseFloat(el.value);
        if (!Number.isFinite(value)) return;
        const key = el.dataset.cmdKey;
        if (cmd.type === 'A' && (key === 'rx' || key === 'ry')) {
          value = Math.max(0.5, Math.abs(value));
          el.value = fmt(value);
        }
        trackEdit();
        cmd[key] = value;
        renderCanvas();
        const code = $('#pathCode', dom.inspector);
        if (code) code.textContent = pathData(shape.commands);
        const card = el.closest('.cmd-card');
        const coords = card?.querySelector('.cmd-coords');
        if (coords) coords.textContent = cmd.type === 'Z' ? 'CLOSE' : Math.round(cmd.x) + ', ' + Math.round(cmd.y);
        markDirty();
        return;
      }
      if (el.matches('[data-prop]')) {
        const prop = el.dataset.prop;
        let value;
        if (el.dataset.cast === 'number' || el.type === 'number' || el.type === 'range') {
          value = parseFloat(el.value);
          if (!Number.isFinite(value)) return;
        } else {
          value = el.value;
        }
        trackEdit();
        applyProp(el, prop, value);
      }
    });

    dom.inspector.addEventListener('focusout', (event) => {
      if (event.target.matches('[data-underlay-prop], [data-underlay-opacity]')) {
        const input = event.target;
        if (input.matches('[data-underlay-prop]') && state.underlay) {
          input.value = fmt(state.underlay[input.dataset.underlayProp]);
          syncUnderlayInspectorFields();
        }
        saveUnderlayNow();
        return;
      }
      if (event.target.matches('[data-color-text], [data-prop], [data-cmd-key], [data-poly-point]')) {
        if (event.target.matches('[data-poly-point]')) {
          const shape = selectedShape();
          const point = shape?.type === 'polygon' ? shape.points[Number(event.target.dataset.polyPoint)] : null;
          const axis = event.target.dataset.polyAxis;
          if (point && (axis === 'x' || axis === 'y')) event.target.value = fmt(point[axis]);
        }
        flushEdit();
        saveNow();
        if (event.target.matches('[data-color-text]')) {
          const value = event.target.value.trim();
          if (!/^#[0-9a-fA-F]{6}$/.test(value)) renderInspector();
        }
      }
    });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', () => {
      if (state.gesture) endGesture();
    });
    window.addEventListener('beforeunload', () => {
      flushEdit();
      saveNow();
      saveUnderlayNow();
    });

    window.addEventListener('resize', () => {
      fitArtboard();
      updatePanelRails();
    });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(fitArtboard).observe(dom.stageBody);
    }
  }

  function onKeyDown(event) {
    const target = event.target;
    if (!dom.fontModal.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFontModal();
      }
      return;
    }
    if (!dom.canvasModal.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCanvasModal();
      } else if (event.key === 'Enter' && target instanceof HTMLInputElement) {
        event.preventDefault();
        applyCanvasSize();
      }
      return;
    }
    const typing = target instanceof HTMLElement && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
    );
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (mod && key === 's') {
      event.preventDefault();
      exportSvg();
      return;
    }
    if (mod && key === 'd') {
      event.preventDefault();
      duplicateShape();
      return;
    }
    if (mod && (event.key === '=' || event.key === '+' || event.key === 'add')) {
      event.preventDefault();
      setZoom(nextZoom(state.zoom, 1));
      return;
    }
    if (mod && (event.key === '-' || event.key === '−' || event.key === 'subtract')) {
      event.preventDefault();
      setZoom(nextZoom(state.zoom, -1));
      return;
    }
    if (mod && event.key === '0') {
      event.preventDefault();
      setZoom(1);
      return;
    }
    if (!typing && mod && key === 'a') {
      event.preventDefault();
      setSelection(state.doc.shapes.map((shape) => shape.id));
      return;
    }

    if (event.key === 'Escape' && state.underlayAdjust) {
      event.preventDefault();
      setUnderlayAdjust(false);
      toast(t('toast.underlayFixed'));
      return;
    }

    if (typing) return;

    if (event.key === 'Escape') {
      selectShape(null);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (state.selectedIds.length) {
        event.preventDefault();
        deleteSelection();
      }
      return;
    }
    if (event.key === 'Enter' && state.underlayAdjust && !(target instanceof HTMLButtonElement)) {
      event.preventDefault();
      setUnderlayAdjust(false);
      toast(t('toast.underlayFixed'));
      return;
    }
    if (event.key.startsWith('Arrow') && state.underlayAdjust && state.underlay) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      nudgeUnderlay(dx, dy);
      return;
    }
    if (event.key === 'Enter' && selectedShape()?.type === 'path') {
      event.preventDefault();
      state.pathEdit = !state.pathEdit;
      renderInspector();
      renderOverlay();
      updateStatus();
      return;
    }
    if (event.key.startsWith('Arrow') && state.selectedId) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      nudgeSelected(dx, dy);
      return;
    }
    if (!mod && !event.altKey) {
      if (key === 'r') addShape('rect');
      else if (key === 'o') addShape('ellipse');
      else if (key === 'c') addShape('circle');
      else if (key === 'g') addShape('polygon');
      else if (key === 'l') addShape('line');
      else if (key === 't') addShape('text');
      else if (key === 'p') addShape('path');
    }
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function installTestApi() {
    window.__ALBEDO_TEST__ = {
      load(doc) {
        flushEdit();
        state.doc = normalizeDoc(doc);
        state.starter = false;
        state.source = null;
        state.sourceSerial = 0;
        state.sourceByDoc.clear();
        state.sourcePersisted = false;
        try { localStorage.removeItem(SOURCE_KEY); } catch (error) {}
        state.undo = [];
        state.redo = [];
        state.underlayAdjust = false;
        state.snapGuides = [];
        applySelection([]);
        syncAssistControls();
        renderAll();
        updateHistoryButtons();
      },
      doc() {
        return deepClone(state.doc);
      },
      selection() {
        return [...state.selectedIds];
      },
      async export() {
        flushEdit();
        if (!(await ensureFontsForShapes())) return null;
        return buildSvg();
      },
      importSvg(text, name) {
        return importSvgContent(text, name || 'import.svg');
      },
      tabs() {
        return { left: state.leftTab, right: state.rightTab };
      },
      setGrid(visible, size) {
        state.grid.visible = Boolean(visible);
        if (GRID_SIZES.includes(Number(size))) state.grid.size = Number(size);
        syncAssistControls();
        renderGrid();
      },
      setSnap(enabled) {
        state.snapEnabled = Boolean(enabled);
        syncAssistControls();
      },
      snapInfo() {
        return {
          enabled: state.snapEnabled,
          grid: { ...state.grid },
          uiScale: uiScaleValue(),
          threshold: SNAP_PX * uiScaleValue()
        };
      },
      language() {
        return { mode: state.langMode, lang: state.lang };
      },
      setLanguage(mode) {
        applyLanguage(mode, { persist: false });
      }
    };
  }

  function init() {
    state.langMode = loadLanguageMode();
    state.lang = resolveLanguage(state.langMode);
    applyStaticI18n();
    const saved = loadSaved();
    state.doc = saved || starterDocument();
    state.starter = !saved;
    state.source = saved ? loadSavedSource() : null;
    state.sourcePersisted = Boolean(state.source);
    localizeGeneratedNames();
    if (saved) {
      applySelection([]);
    } else {
      const path = state.doc.shapes.find((shape) => shape.type === 'path');
      if (path) {
        applySelection([path.id], path.id);
        state.selectedCmdId = preferredCommand(path)?.id || null;
      }
    }
    state.pathEdit = true;
    state.underlay = loadUnderlay();
    localizeGeneratedNames();
    bindEvents();
    syncAssistControls();
    installTestApi();
    renderAll();
    updateHistoryButtons();
    updateCoordStatus({ x: 0, y: 0 });
    requestAnimationFrame(fitArtboard);
    if (!saved) {
      state.tipTimer = setTimeout(() => {
        state.tipDismissed = true;
        dom.canvasTip.classList.add('hidden');
      }, 9000);
    }
  }

  init();
})();
