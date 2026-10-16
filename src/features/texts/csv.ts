// CSV / TSV for the viewer's table (the thumbnail's is texts/mod.rs `parse_delimited`).

/** Rows of a CSV / TSV: quoted cells may hold the separator, quotes and line breaks. At most `maxRows`. */
export function parseDelimited(text: string, sep: "," | "\t", maxRows: number): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      if (rows.length >= maxRows) return { rows, more: i + 1 < text.length };
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, more: false };
}
