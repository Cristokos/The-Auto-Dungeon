// Just enough of Node's path module for src/sheetpdf.js to name its template.
export const join = (...parts) => parts.join('/');
export default { join };
