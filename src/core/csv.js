/**
 * csv.js — Simple CSV parser/unparser for the browser.
 *
 * Limitation: fields must NOT contain commas or newlines (no quoted-field support).
 * See README.md for details.
 */

/**
 * Parse a CSV string into an array of objects.
 * The first row is treated as headers.
 * @param {string} text
 * @returns {Object[]}
 */
export function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] !== undefined ? values[i].trim() : '';
    });
    return obj;
  });
}

/**
 * Serialize an array of objects back to a CSV string.
 * Column order follows the keys of the first object.
 * @param {Object[]} rows
 * @returns {string}
 */
export function unparseCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => (row[h] === undefined || row[h] === null ? '' : String(row[h]))).join(','));
  }
  return lines.join('\n');
}

/**
 * Trigger a browser download of a text file.
 * @param {string} filename
 * @param {string} content
 * @param {string} [mime]
 */
export function downloadText(filename, content, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
