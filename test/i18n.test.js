import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  MESSAGES,
  detectLanguage,
  normalizeLanguage,
  translate,
  translateCount
} from '../lib/i18n.js';

describe('language detection', () => {
  it('maps Simplified Chinese locales to zh', () => {
    expect(detectLanguage(['zh'])).toBe('zh');
    expect(detectLanguage(['zh-CN'])).toBe('zh');
    expect(detectLanguage(['zh-Hans'])).toBe('zh');
    expect(detectLanguage(['zh-Hans-CN'])).toBe('zh');
    expect(detectLanguage(['zh-SG'])).toBe('zh');
    expect(detectLanguage(['ZH_cn'])).toBe('zh');
  });

  it('maps English locales to en', () => {
    expect(detectLanguage(['en'])).toBe('en');
    expect(detectLanguage(['en-US'])).toBe('en');
    expect(detectLanguage(['en-GB'])).toBe('en');
  });

  it('follows navigator.languages order and picks the first supported locale', () => {
    expect(detectLanguage(['fr-FR', 'en-US'])).toBe('en');
    expect(detectLanguage(['de-DE', 'zh-CN', 'en-US'])).toBe('zh');
    expect(detectLanguage(['en-US', 'zh-CN'])).toBe('en');
  });

  it('falls back to English for unsupported and Traditional Chinese locales', () => {
    expect(detectLanguage(['fr-FR'])).toBe('en');
    expect(detectLanguage(['ja-JP', 'ko-KR'])).toBe('en');
    expect(detectLanguage(['zh-TW'])).toBe('en');
    expect(detectLanguage(['zh-HK'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
  });

  it('accepts a single locale string', () => {
    expect(detectLanguage('zh-CN')).toBe('zh');
    expect(detectLanguage('fr-FR')).toBe('en');
  });
});

describe('language persistence values', () => {
  it('only normalizes the explicit stored values', () => {
    expect(normalizeLanguage('zh')).toBe('zh');
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('auto')).toBeNull();
    expect(normalizeLanguage('zh-CN')).toBeNull();
  });

  it('ships exactly the two supported languages', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['zh', 'en']);
    expect(Object.keys(MESSAGES).sort()).toEqual(['en', 'zh']);
  });
});

describe('translation', () => {
  it('translates in both languages', () => {
    expect(translate('zh', 'action.new')).toBe('新建');
    expect(translate('en', 'action.new')).toBe('New');
    expect(translate('zh', 'shape.rect')).toBe('矩形');
    expect(translate('en', 'shape.rect')).toBe('Rectangle');
  });

  it('interpolates named values and leaves unknown placeholders intact', () => {
    expect(translate('en', 'shape.addTitle', { label: 'Rectangle', key: 'R' }))
      .toBe('Add Rectangle (R)');
    expect(translate('zh', 'status.shape', { label: '矩形', w: 120, h: 80 }))
      .toBe('矩形 · 120 × 80');
    expect(translate('en', 'missing.key')).toBe('missing.key');
    expect(translate('en', 'status.shape', { w: 1, h: 2 }))
      .toBe('{label} · 1 × 2');
  });

  it('accepts locale tags and falls back to English for unsupported ones', () => {
    expect(translate('zh-CN', 'action.new')).toBe('新建');
    expect(translate('en-GB', 'action.new')).toBe('New');
    expect(translate('zh-TW', 'action.new')).toBe('New');
    expect(translate('fr', 'action.new')).toBe('New');
  });

  it('uses the matching plural form', () => {
    expect(translateCount('en', 'status.shapes', 0)).toBe('0 shapes');
    expect(translateCount('en', 'status.shapes', 1)).toBe('1 shape');
    expect(translateCount('en', 'status.shapes', 2)).toBe('2 shapes');
    expect(translateCount('zh', 'status.shapes', 1)).toBe('1 个图形');
    expect(translateCount('zh', 'status.shapes', 4)).toBe('4 个图形');
    expect(translateCount('en', 'selection.title', 2)).toBe('2 shapes');
    expect(translateCount('en', 'selection.title', 1)).toBe('1 shape');
  });

  it('interpolates values into plural forms', () => {
    expect(translateCount('en', 'inspector.commandsCount', 3)).toBe('3 COMMANDS');
    expect(translateCount('zh', 'inspector.verticesCount', 5)).toBe('5 个顶点');
    expect(translateCount('en', 'status.selected', 2, { w: 20, h: 10 }))
      .toBe('2 shapes · 20 × 10');
  });
});

describe('dictionary parity', () => {
  it('has the same keys in both languages', () => {
    expect(Object.keys(MESSAGES.zh).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it('covers every data-i18n attribute in the HTML shell', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const keys = [...html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of new Set(keys)) {
      expect(MESSAGES.zh[key], `zh.${key}`).toBeTruthy();
      expect(MESSAGES.en[key], `en.${key}`).toBeTruthy();
    }
  });

  it('has non-empty strings for every key', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      for (const [key, value] of Object.entries(MESSAGES[language])) {
        expect(typeof value, `${language}.${key}`).toBe('string');
        expect(value.length, `${language}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});
