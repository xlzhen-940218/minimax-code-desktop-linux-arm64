const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_LAYOUT,
  addMappedImage,
  addMappedShape,
  addMappedText,
  createElementMapRecorder,
  toNormalizedRect,
} = require('../mavis-ppt-map.cjs');

function createFakeSlide() {
  const calls = [];
  return {
    calls,
    addText(text, options) {
      calls.push({ method: 'addText', text, options });
    },
    addShape(shapeType, options) {
      calls.push({ method: 'addShape', shapeType, options });
    },
    addImage(options) {
      calls.push({ method: 'addImage', options });
    },
  };
}

function run() {
  assert.deepStrictEqual(toNormalizedRect({ x: 1, y: 1.125, w: 2, h: 1.125 }), {
    x: 0.1,
    y: 0.2,
    w: 0.2,
    h: 0.2,
  });

  const recorder = createElementMapRecorder({
    fileName: 'demo.pptx',
    filePath: '/tmp/demo.pptx',
    layout: DEFAULT_LAYOUT,
    createdAtMs: 123,
  });
  recorder.startSlide({ slideNumber: 1, slideId: 'cover', title: 'Cover' });

  const slide = createFakeSlide();
  addMappedText(slide, recorder, {
    elementId: 'cover.title',
    role: 'title',
    text: 'Title',
    x: 0.5,
    y: 1,
    w: 4,
    h: 0.75,
    options: { fontSize: 40, color: 'FFFFFF', margin: 0 },
    source: { file: 'slides/slide-01.js', method: 'addText' },
  });
  addMappedShape(slide, recorder, 'rect', {
    elementId: 'cover.band',
    role: 'shape',
    x: 0,
    y: 0,
    w: 10,
    h: 0.2,
    options: { fill: { color: 'FF0000' } },
  });
  addMappedImage(slide, recorder, {
    elementId: 'cover.logo',
    role: 'image',
    path: './logo.png',
    x: 8,
    y: 0.4,
    w: 1,
    h: 1,
  });

  assert.strictEqual(slide.calls.length, 3);
  assert.deepStrictEqual(slide.calls[0], {
    method: 'addText',
    text: 'Title',
    options: { fontSize: 40, color: 'FFFFFF', margin: 0, x: 0.5, y: 1, w: 4, h: 0.75 },
  });

  const map = recorder.toJSON();
  assert.strictEqual(map.schema, 'mavis.ppt_element_map.v1');
  assert.strictEqual(map.layout.widthIn, 10);
  assert.strictEqual(map.layout.heightIn, 5.625);
  assert.strictEqual(map.slides[0].elements.length, 3);
  assert.deepStrictEqual(map.slides[0].elements[0].normalizedRect, {
    x: 0.05,
    y: 0.1778,
    w: 0.4,
    h: 0.1333,
  });

  assert.throws(
    () =>
      recorder.recordElement({
        elementId: 'cover.title',
        kind: 'text',
        text: 'Duplicate',
        x: 1,
        y: 1,
        w: 1,
        h: 1,
      }),
    /Duplicate PPT element map elementId/,
  );

  assert.throws(
    () =>
      recorder.recordElement({
        elementId: 'cover.overflow',
        kind: 'text',
        text: 'Overflow',
        x: 9.8,
        y: 1,
        w: 1,
        h: 1,
      }),
    /outside LAYOUT_16x9 bounds/,
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mavis-ppt-map-'));
  const filePath = path.join(dir, 'demo.mavis-ppt-map.json');
  assert.strictEqual(recorder.writeFile(filePath), filePath);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), map);
}

run();
console.log('mavis-ppt-map tests passed');
