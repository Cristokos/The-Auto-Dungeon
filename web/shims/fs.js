// src/sheetpdf.js reads its blank sheet with fs.readFileSync; in the browser the sheet is built into the page.
import template from '../../src/assets/character-sheet.pdf';
export const readFileSync = () => template;
export default { readFileSync };
