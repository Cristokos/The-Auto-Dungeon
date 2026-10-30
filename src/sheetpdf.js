// Fills the fillable 5e character sheet (src/assets/character-sheet.pdf) with a character's numbers.
// The fields stay editable, so the sheet can be changed and printed like any other.
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFTextField, PDFCheckBox, PDFButton, StandardFonts, rgb } = require('pdf-lib');

const TEMPLATE = path.join(__dirname, 'assets', 'character-sheet.pdf');
// Small boxes get a fixed size; the big text areas shrink their text to fit.
const AUTO = /^(AttacksSpellcasting|Equipment|Features and Traits|ProficienciesLang|Backstory|Treasure|Allies|Feat\+Traits|PersonalityTraits |Ideals|Bonds|Flaws|Appearance)$/;
// Page 2's Character Appearance box: the portrait on top, a written description under it.
const LOOK_BOX = { x: 36.5, y: 443.4, width: 162.7, height: 218.1 };
const IMAGE_HEIGHT = 112;
// Baselines of the three attuned item rows at the foot of page 2's backstory box, well spaced for handwriting.
const ATTUNE_ROWS = [122, 91, 60];
const ATTUNE_TOP = 164;

// Boxes whose text marks names in bold (**like this**). A form field holds one font, so these are printed on the page
// instead of filled in; every other box stays an editable field.
const RICH = new Set(['Features and Traits', 'Feat+Traits']);

/** Words with their weight, line by line: [[{ word, bold, indent }]] per paragraph line. */
function richWords(text) {
  return text.split('\n').map(line => {
    const indent = line.match(/^ */)[0].length;
    const out = [];
    let bold = false, joined = false;
    for (const part of line.trim().split(/(\*\*)/)) {
      if (part === '**') { bold = !bold; continue; }
      part.split(' ').forEach((w, i) => {
        // A word split by a bold marker ("**Hammer**:") joins up again with no space.
        if (w) out.push({ word: w, bold, glue: i === 0 && joined });
      });
      if (part) joined = !part.endsWith(' ');
    }
    return { indent, words: out };
  });
}

/** Lays out bold-marked text in a box at the largest size that fits (9 pt down to `min`), and draws it. Whole paragraphs
 * that still don't fit are left out and given back, for the overflow page. */
function drawRich(page, text, box, fonts, min = 4) {
  let rest = '';
  const blocks = text.split('\n\n');
  // At the smallest size, drop trailing paragraphs until the rest fits, with a pointer to where they went.
  for (;;) {
    const lines = layoutRich(text, box, fonts, min);
    if (lines.length * min * 1.2 <= box.height - 4 || blocks.length <= 1) break;
    rest = [blocks.pop(), rest].filter(Boolean).join('\n\n');
    text = `${blocks.join('\n\n')}\n\n(Continued on the last page.)`;
  }
  let size = 9, lines = layoutRich(text, box, fonts, size);
  while (size > min && lines.length * size * 1.2 > box.height - 4) { size -= 0.5; lines = layoutRich(text, box, fonts, size); }
  lines.forEach((line, i) => {
    const y = box.y + box.height - 3 - size - i * size * 1.2;
    if (y < box.y) return;
    for (const w of line) page.drawText(w.word, { x: box.x + 2 + w.x, y, size, font: w.font, color: rgb(0, 0, 0) });
  });
  return rest;
}

function layoutRich(text, box, fonts, size) {
  const paras = richWords(text);
  const layout = size => {
    const lines = [];
    const space = fonts.regular.widthOfTextAtSize(' ', size);
    for (const { indent, words } of paras) {
      const x0 = indent * space * 2;
      let line = [], x = x0;
      for (const w of words) {
        const font = w.bold ? fonts.bold : fonts.regular;
        const width = font.widthOfTextAtSize(w.word, size);
        const gap = line.length && !w.glue ? space : 0;
        if (line.length && x + gap + width > box.width - 4) { lines.push(line); line = []; x = x0 + space * 2; }
        line.push({ ...w, x: x + (line.length ? gap : 0), font });
        x += (line.length > 1 ? gap : 0) + width;
      }
      lines.push(line);
    }
    return lines;
  };
  return layout(size);
}

/** An extra page at the end for whatever didn't fit: [{ title, text }], two columns, as many pages as it takes. */
function overflowPages(pdf, chunks, fonts, name) {
  const text = chunks.map(c => `**${c.title.toUpperCase()}**\n${c.text}`).join('\n\n');
  const col = { width: 258, height: 690 };
  let rest = text.split('\n\n');
  while (rest.length) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`${name ? `${name}: ` : ''}continued`, { x: 36, y: 750, size: 12, font: fonts.bold, color: rgb(0, 0, 0) });
    for (const x of [36, 318]) {
      if (!rest.length) break;
      const box = { x, y: 40, ...col };
      // Fill the column a paragraph at a time at 8 pt.
      let take = rest.length;
      while (take > 1 && layoutRich(rest.slice(0, take).join('\n\n'), box, fonts, 8).length * 9.6 > box.height - 4) take--;
      drawRich(page, rest.slice(0, take).join('\n\n'), box, fonts, 8);
      rest = rest.slice(take);
    }
  }
}

/** The largest font size (4 to 9 pt) at which the text, word-wrapped, fits the box. */
function fitSize(text, box, font) {
  for (let size = 9; size > 4; size -= 0.5) {
    const width = box.width - 4;
    let lines = 0;
    for (const para of text.split('\n')) {
      let line = '';
      lines++;
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(next, size) > width) { lines++; line = word; } else line = next;
      }
    }
    if (lines * size * 1.2 <= box.height - 4) return size;
  }
  return 4;
}

/** fields: { text: { name: value }, checks: [names] }; image: { bytes, type: 'png' | 'jpg' } or null. Returns the PDF bytes. */
async function fillSheet(fields, image = null, template = TEMPLATE) {
  const pdf = await PDFDocument.load(fs.readFileSync(template));
  const form = pdf.getForm();
  // Confluence takes the place of experience points: cover the old label and write the new one.
  const [page1, page2] = pdf.getPages();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page1.drawRectangle({ x: 478, y: 692.5, width: 94, height: 9, color: rgb(1, 1, 1) });
  page1.drawText('CONFLUENCE', { x: 480.5, y: 695.6, size: 5.6, font: helv, color: rgb(0, 0, 0) });
  // Weight changes with rank, so page 2's Weight box holds the rank instead.
  page2.drawRectangle({ x: 473, y: 715, width: 45, height: 9, color: rgb(1, 1, 1) });
  page2.drawText('RANK', { x: 475.6, y: 718.2, size: 5.6, font: helv, color: rgb(0, 0, 0) });
  // The appearance box has no text field of its own, so add one under a shorter portrait slot.
  const imageSlot = form.getFieldMaybe('CHARACTER IMAGE');
  if (imageSlot) imageSlot.acroField.getWidgets()[0].setRectangle({ ...LOOK_BOX, y: LOOK_BOX.y + LOOK_BOX.height - IMAGE_HEIGHT, height: IMAGE_HEIGHT });
  const look = form.createTextField('Appearance');
  look.acroField.setDefaultAppearance('/Helv 8 Tf 0 g');
  look.enableMultiline();
  look.addToPage(page2, { ...LOOK_BOX, height: LOOK_BOX.height - IMAGE_HEIGHT - 2, borderWidth: 0, font: helv });
  // The bottom of the backstory box holds three rows for attuned items, each with room to write.
  const story = form.getFieldMaybe('Backstory');
  if (story) {
    const r = story.acroField.getWidgets()[0].getRectangle();
    const top = ATTUNE_TOP;
    story.acroField.getWidgets()[0].setRectangle({ ...r, y: top + 6, height: r.y + r.height - top - 20 });
    // The box's own label moves to the top, so it can't be read as the attuned items' heading.
    const bold = helvBold;
    const label = 'CHARACTER BACKSTORY';
    page2.drawRectangle({ x: r.x + 20, y: 26, width: r.width - 40, height: 12, color: rgb(1, 1, 1) });
    page2.drawText(label, { x: r.x + (r.width - bold.widthOfTextAtSize(label, 6)) / 2, y: r.y + r.height - 9, size: 6, font: bold, color: rgb(0, 0, 0) });
    page2.drawLine({ start: { x: r.x + 4, y: top }, end: { x: r.x + r.width - 4, y: top }, thickness: 0.6, color: rgb(0.55, 0.55, 0.55) });
    page2.drawText('ATTUNED ITEMS (UP TO 3)', { x: r.x + 6, y: top - 15, size: 6, font: helv, color: rgb(0, 0, 0) });
    ATTUNE_ROWS.forEach((y, i) => {
      page2.drawText(`${i + 1}.`, { x: r.x + 6, y: y + 4, size: 7, font: helv, color: rgb(0.35, 0.35, 0.35) });
      page2.drawLine({ start: { x: r.x + 16, y }, end: { x: r.x + r.width - 6, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
      const f = form.createTextField(`Attuned ${i + 1}`);
      f.acroField.setDefaultAppearance('/Helv 9 Tf 0 g');
      f.addToPage(page2, { x: r.x + 16, y: y + 1, width: r.width - 22, height: 16, borderWidth: 0, font: helv });
    });
  }
  const byName = new Map(form.getFields().map(f => [f.getName(), f]));
  const overflow = [];
  for (const [name, value] of Object.entries(fields.text || {})) {
    const f = byName.get(name);
    if (!(f instanceof PDFTextField)) continue;
    if (RICH.has(name)) {
      const w = f.acroField.getWidgets()[0];
      const page = pdf.getPages().find(pg => pg.ref === w.P()) || page1;
      const left = drawRich(page, String(value), w.getRectangle(), { regular: helv, bold: helvBold }, 6);
      if (left) overflow.push({ title: name === 'Feat+Traits' ? 'Additional features and traits' : 'Features and traits', text: left });
      // Taken off the form so nothing types over the printed text.
      const ref = pdf.context.getObjectRef(w.dict);
      if (ref) page.node.removeAnnot(ref);
      form.acroForm.removeField(f.acroField);
      byName.delete(name);
      continue;
    }
    const text = String(value).replace(/\*\*/g, '');
    // Some boxes carry no font settings of their own.
    if (!f.acroField.getDefaultAppearance()) f.acroField.setDefaultAppearance('/Helv 10 Tf 0 g');
    if (AUTO.test(name)) { f.enableMultiline(); f.setFontSize(fitSize(text, f.acroField.getWidgets()[0].getRectangle(), helv)); }
    else {
      // One line: as big as fits the box's width, up to 10 pt.
      const width = f.acroField.getWidgets()[0].getRectangle().width - 4;
      f.setFontSize(Math.max(4, Math.min(10, Math.floor(width / helv.widthOfTextAtSize(text || ' ', 1) * 2) / 2)));
    }
    f.setText(text);
  }
  for (const name of fields.checks || []) {
    const f = byName.get(name);
    if (f instanceof PDFCheckBox) f.check();
  }
  const slot = byName.get('CHARACTER IMAGE');
  if (image && slot instanceof PDFButton) {
    try { slot.setImage(image.type === 'jpg' ? await pdf.embedJpg(image.bytes) : await pdf.embedPng(image.bytes)); } catch { /* a portrait the PDF can't hold is left out */ }
  }
  overflow.push(...(fields.extra || []));
  if (overflow.length) overflowPages(pdf, overflow, { regular: helv, bold: helvBold }, fields.text?.CharacterName);
  return pdf.save();
}

module.exports = { fillSheet, TEMPLATE };
