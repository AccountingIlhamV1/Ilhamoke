/* =====================================================
   ILHAM ERP — EKSPOR LAPORAN (Excel berformat + PDF)

   Dipakai semua halaman laporan lewat:
     ERP.exportReport(format, namaFile, sheets)
   format = "xlsx" atau "pdf"; sheets = [{ name, rows, colWidths }]
   (bentuk data sama seperti ERP.exportToExcel sebelumnya, jadi
   isi laporan di tiap halaman tidak perlu diubah).

   Yang dilakukan secara otomatis:
   - Excel: judul, tabel berborder dengan header berwarna, format
     Rupiah, tanggal asli (dd/mm/yyyy), freeze header, filter, dan
     pengaturan cetak A4. Baris TOTAL diberi rumus SUM, tetapi hanya
     kalau hasil rumusnya persis sama dengan angka aslinya (jadi tidak
     mungkin salah tebak). Rumus lain (mis. Laba Bersih) ditulis
     eksplisit oleh halaman lewat sel { f: "...", v: angka }.
   - PDF: tabel yang sama, tanpa rumus, otomatis potret/lanskap,
     ada nomor halaman.

   Sel berumus: { v: nilaiHasil, f: "template" } dengan token:
     {r}  {r-3}  {r+2}   nomor baris (relatif ke baris sel ini)
     {Label}             sel di kolom yang sama pada baris berlabel itu
     {Sheet!Label}       sama, tetapi di sheet lain (alamat absolut)
   Label = isi sebuah sel teks pada baris tersebut.
===================================================== */

(function () {
  "use strict";

  var MONEY_FMT = '"Rp "#,##0;[Red]("Rp "#,##0);"-"';
  var DATE_FMT = "dd/mm/yyyy";
  var PCT_FMT = '0.00"%"';
  var INT_FMT = "0";

  var FONT = "Arial";
  var NAVY = "FF1F3A5F";
  var HEAD_FILL = "FFDCE6F2";
  var TOTAL_FILL = "FFF2F2F2";
  var BORDER_COLOR = "FFBFC7D1";
  var GRAY_TEXT = "FF5D6B82";

  /* ---------- util ---------- */

  function colLetter(n) {
    var s = "";
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function isBlank(v) { return v === "" || v === null || v === undefined; }
  function isFormulaCell(v) { return !!v && typeof v === "object" && !Array.isArray(v) && typeof v.f === "string"; }
  function cellValue(v) { return isFormulaCell(v) ? v.v : v; }
  function isDateStr(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }

  function sanitizeSheetName(name) {
    return String(name || "Sheet").replace(/[:\\\/\?\*\[\]]/g, "-").slice(0, 31) || "Sheet";
  }

  /* ---------- 1. KLASIFIKASI BARIS ----------
     Setiap baris diklasifikasi: title, subtitle, heading, header,
     data (baris tabel), kv (baris label-nilai tanpa header), total,
     blank. Klasifikasi hanya bergantung pada pola data, bukan nama
     halaman, sehingga berlaku untuk semua laporan. */

  var SUM_TOTAL_RE = /^(total|kas bersih dari)\b/i;
  var STYLE_TOTAL_RE = /^(total|kas bersih dari|saldo kas akhir|modal akhir|laba \(rugi\) bersih|kenaikan \(penurunan\))/i;

  function typeCell(v, j, headers) {
    var hint = isFormulaCell(v) ? v : null;
    var val = hint ? hint.v : v;

    if (isBlank(val) && !hint) return { t: "empty" };

    if (typeof val === "number") {
      var h = headers ? String(headers[j] || "") : "";
      var t = "money";
      if (/^\s*(no|nomor)\.?\s*$/i.test(h)) t = "int";
      else if (/%/.test(h)) t = "pct";
      var cell = { t: t, v: val };
      if (hint) cell.ftpl = hint.f;
      return cell;
    }

    if (isDateStr(val)) return { t: "date", v: val };

    var text = val === null || val === undefined ? "" : String(val);
    var lead = /^( +)\S/.exec(text);
    if (lead) return { t: "text", v: text.trim(), indent: Math.min(4, Math.max(1, Math.floor(lead[1].length / 2))) };
    return { t: "text", v: text };
  }

  function classifySheet(sheet) {
    var raw = sheet.rows || [];
    var rows = [];
    var labels = {};
    var headerRows = [];

    var inTable = false;
    var block = null;
    var tidCounter = 0;

    raw.forEach(function (cellsIn, i) {
      var cells = Array.isArray(cellsIn) ? cellsIn : [];
      var r = i + 1;

      var filled = [];
      cells.forEach(function (v, j) { if (!isBlank(cellValue(v))) filled.push(j); });
      var stringIdx = filled.filter(function (j) { return typeof cells[j] === "string"; });

      stringIdx.forEach(function (j) {
        if (labels[cells[j]] === undefined) labels[cells[j]] = r;
      });

      // Baris kosong
      if (filled.length === 0) {
        rows.push({ r: r, kind: "blank", cells: [] });
        // Baris kosong di dalam tabel (pemisah antar jurnal) tidak mengakhiri tabel.
        if (!(block && block.headers && !block.closed)) inTable = false;
        return;
      }

      // Baris teks tunggal: judul, subjudul, atau judul bagian
      if (cells.length === 1 && typeof cells[0] === "string") {
        var kind = "heading";
        if (i === 0) kind = "title";
        else if (rows[i - 1] && (rows[i - 1].kind === "title" || rows[i - 1].kind === "subtitle")) kind = "subtitle";
        rows.push({ r: r, kind: kind, text: cells[0], cells: [] });
        if (kind === "heading") { inTable = false; block = null; }
        return;
      }

      // Header tabel: semua sel teks tak kosong, dan bukan di dalam tabel
      var allStrings = cells.length >= 2 && cells.every(function (v) { return typeof v === "string" && v !== ""; });
      if (!inTable && allStrings) {
        inTable = true;
        block = { tid: ++tidCounter, rows: [], closed: false, headers: cells.slice(), headerRow: r };
        headerRows.push(r);
        rows.push({
          r: r, kind: "header", tid: block.tid, ncols: cells.length,
          cells: cells.map(function (v) { return { t: "text", v: v }; })
        });
        return;
      }

      // Baris data / label-nilai / total
      var labelText = null;
      if (stringIdx.length === 1) labelText = String(cells[stringIdx[0]]).trim();
      var isSumTotal = labelText !== null && SUM_TOTAL_RE.test(labelText);
      var isStyleTotal = labelText !== null && STYLE_TOTAL_RE.test(labelText);

      if (!isStyleTotal && (!block || block.closed)) {
        block = { tid: ++tidCounter, rows: [], closed: false, headers: null, headerRow: null };
      }
      if (!block) block = { tid: ++tidCounter, rows: [], closed: true, headers: null, headerRow: null };

      var headers = block.headers;
      var typed = cells.map(function (v, j) { return typeCell(v, j, headers); });

      // Rumus SUM hanya jika hasilnya persis sama dengan angka aslinya.
      if (isSumTotal && !block.closed && block.rows.length) {
        typed.forEach(function (cell, j) {
          if (cell.t !== "money" || cell.ftpl) return;
          var sum = 0, count = 0;
          block.rows.forEach(function (rr) {
            var src = raw[rr - 1][j];
            var val = cellValue(src);
            if (typeof val === "number") { sum += val; count++; }
          });
          if (count > 0 && Math.abs(sum - cell.v) < 0.5) {
            var L = colLetter(j + 1);
            cell.f = "SUM(" + L + block.rows[0] + ":" + L + block.rows[block.rows.length - 1] + ")";
          }
        });
      }

      var ncols = headers ? headers.length : cells.length;
      var rowKind = isStyleTotal ? "total" : (headers ? "data" : "kv");

      if (isStyleTotal) block.closed = true;
      else block.rows.push(r);

      rows.push({ r: r, kind: rowKind, tid: block.tid, ncols: ncols, cells: typed });
    });

    return { rows: rows, labels: labels, headerRows: headerRows };
  }

  /* ---------- 2. MODEL LENGKAP (semua sheet) ---------- */

  function buildModel(sheets) {
    var used = {};
    var names = sheets.map(function (sheet) {
      var safe = sanitizeSheetName(sheet.name);
      if (used[safe] !== undefined) {
        used[safe] += 1;
        var suffix = " (" + used[safe] + ")";
        safe = safe.slice(0, 31 - suffix.length) + suffix;
      } else {
        used[safe] = 0;
      }
      return safe;
    });

    var byName = {};
    sheets.forEach(function (sheet, i) {
      byName[sheet.name] = i;
      byName[names[i]] = i;
    });

    var models = sheets.map(function (sheet, i) {
      var m = classifySheet(sheet);
      var ncols = 0;
      m.rows.forEach(function (row) {
        var n = row.ncols || row.cells.length;
        if (n > ncols) ncols = n;
      });

      var widths = (sheet.colWidths || []).slice();
      for (var j = 0; j < ncols; j++) {
        if (!widths[j]) {
          var w = 10;
          m.rows.forEach(function (row) {
            var c = row.cells[j];
            if (c && c.t === "text") w = Math.max(w, Math.min(40, String(c.v).length + 2));
          });
          widths[j] = w;
        }
      }
      widths = widths.slice(0, Math.max(ncols, widths.length));

      var sumWidth = widths.slice(0, ncols).reduce(function (s, x) { return s + x; }, 0);
      var title = "", subtitle = "";
      m.rows.forEach(function (row) {
        if (row.kind === "title") title = row.text;
        if (row.kind === "subtitle") subtitle = row.text;
      });

      var out = {
        name: names[i],
        title: title,
        subtitle: subtitle,
        rows: m.rows,
        labels: m.labels,
        ncols: ncols,
        colWidths: widths,
        landscape: sheet.orientation ? sheet.orientation === "landscape" : sumWidth > 95,
        centerTitles: !!sheet.centerTitles,
        freezeRow: null,
        filterRange: null,
        printTitlesRow: null
      };

      if (m.headerRows.length === 1) {
        var hr = m.headerRows[0];
        var headerRow = m.rows.filter(function (row) { return row.r === hr; })[0];
        var dataRows = m.rows.filter(function (row) { return row.tid === headerRow.tid && row.kind === "data"; });
        if (hr <= 6) { out.freezeRow = hr; out.printTitlesRow = hr; }
        if (dataRows.length >= 2 && !sheet.noFilter) {
          out.filterRange = "A" + hr + ":" + colLetter(headerRow.ncols) + dataRows[dataRows.length - 1].r;
        }
      }

      return out;
    });

    // Selesaikan rumus eksplisit (token {Label}, {Sheet!Label}, {r+n}).
    models.forEach(function (model, si) {
      model.rows.forEach(function (row) {
        row.cells.forEach(function (cell, j) {
          if (!cell.ftpl) return;
          var col = colLetter(j + 1);
          var ok = true;

          var f = String(cell.ftpl).replace(/\{([^{}]+)\}/g, function (match, keyRaw) {
            var key = keyRaw.trim();
            var rm = /^r([+-]\d+)?$/.exec(key);
            if (rm) return String(row.r + (rm[1] ? parseInt(rm[1], 10) : 0));

            var targetIdx = si;
            var label = key;
            var cross = false;
            var bang = key.indexOf("!");
            if (bang > 0 && byName[key.slice(0, bang)] !== undefined) {
              targetIdx = byName[key.slice(0, bang)];
              label = key.slice(bang + 1);
              cross = true;
            }

            var targetRow = models[targetIdx].labels[label];
            if (!targetRow) { ok = false; return ""; }

            if (cross) return "'" + models[targetIdx].name.replace(/'/g, "''") + "'!$" + col + "$" + targetRow;
            return col + targetRow;
          });

          if (ok) cell.f = f.replace(/^=/, "");
          else console.warn("Rumus ekspor dilewati (label tidak ditemukan):", cell.ftpl);
          delete cell.ftpl;
        });
      });
    });

    return { sheets: models };
  }

  /* ---------- 3. PENULIS EXCEL (ExcelJS) ---------- */

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function toExcelDate(str) {
    var p = String(str).split("-");
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  }

  function writeExcel(model, filename) {
    if (typeof ExcelJS === "undefined") {
      alert("Gagal export: library Excel (ExcelJS) belum termuat. Pastikan koneksi internet aktif, lalu coba lagi.");
      return;
    }

    var wb = new ExcelJS.Workbook();
    wb.creator = "Ilham ERP";
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };

    var thin = { style: "thin", color: { argb: BORDER_COLOR } };
    var allBorders = { top: thin, left: thin, bottom: thin, right: thin };

    model.sheets.forEach(function (sheet) {
      var view = { showGridLines: false };
      if (sheet.freezeRow) { view.state = "frozen"; view.ySplit = sheet.freezeRow; }

      var ws = wb.addWorksheet(sheet.name, {
        views: [view],
        pageSetup: {
          paperSize: 9,
          orientation: sheet.landscape ? "landscape" : "portrait",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 }
        }
      });

      if (sheet.printTitlesRow) ws.pageSetup.printTitlesRow = sheet.printTitlesRow + ":" + sheet.printTitlesRow;
      ws.headerFooter = { oddFooter: "&L&8Ilham ERP&R&8Halaman &P dari &N" };

      ws.columns = sheet.colWidths.map(function (w) { return { width: w }; });

      sheet.rows.forEach(function (row) {
        var r = row.r;

        if (row.kind === "blank") return;

        if (row.kind === "title" || row.kind === "subtitle") {
          var isTitle = row.kind === "title";
          var tc = ws.getCell(r, 1);
          tc.value = row.text;
          if (sheet.centerTitles) {
            tc.font = { name: FONT, size: isTitle ? 14 : 11, bold: true, color: { argb: isTitle ? NAVY : "FF000000" } };
            tc.alignment = { horizontal: "center", vertical: "middle" };
            if (sheet.ncols > 1) ws.mergeCells(r, 1, r, sheet.ncols);
          } else if (isTitle) {
            tc.font = { name: FONT, size: 14, bold: true, color: { argb: NAVY } };
          } else {
            tc.font = { name: FONT, size: 10, italic: true, color: { argb: GRAY_TEXT } };
          }
          if (isTitle) ws.getRow(r).height = 22;
          return;
        }

        if (row.kind === "heading") {
          for (var h = 1; h <= sheet.ncols; h++) {
            var hc = ws.getCell(r, h);
            if (h === 1) hc.value = row.text;
            hc.font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } };
            hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
            hc.alignment = { vertical: "middle" };
          }
          ws.getRow(r).height = 18;
          return;
        }

        var n = row.ncols || row.cells.length;

        for (var j = 0; j < n; j++) {
          var cell = row.cells[j] || { t: "empty" };
          var c = ws.getCell(r, j + 1);

          if (cell.t !== "empty") {
            if (cell.f) c.value = { formula: cell.f, result: cell.v };
            else if (cell.t === "date") c.value = toExcelDate(cell.v);
            else c.value = cell.v;
          }

          c.border = allBorders;

          if (row.kind === "header") {
            c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
            c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            continue;
          }

          var bold = row.kind === "total";
          c.font = { name: FONT, size: 10, bold: bold };
          if (bold) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };

          if (cell.t === "money") { c.numFmt = MONEY_FMT; c.alignment = { horizontal: "right", vertical: "middle" }; }
          else if (cell.t === "pct") { c.numFmt = PCT_FMT; c.alignment = { horizontal: "right", vertical: "middle" }; }
          else if (cell.t === "int") { c.numFmt = INT_FMT; c.alignment = { horizontal: "center", vertical: "middle" }; }
          else if (cell.t === "date") { c.numFmt = DATE_FMT; c.alignment = { horizontal: "center", vertical: "middle" }; }
          else { c.alignment = { horizontal: "left", vertical: "middle", wrapText: true, indent: cell.indent || 0 }; }
        }
      });

      if (sheet.filterRange) ws.autoFilter = sheet.filterRange;
    });

    wb.xlsx.writeBuffer().then(function (buffer) {
      downloadBlob(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        filename
      );
    }).catch(function (err) {
      console.error(err);
      alert("Gagal membuat file Excel.");
    });
  }

  /* ---------- 4. PENULIS PDF (jsPDF + autoTable) ---------- */

  function pdfText(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/≤/g, "<=").replace(/≥/g, ">=")
      .replace(/[–—]/g, "-").replace(/→/g, "->")
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/[^\u0000-\u00FF]/g, "");
  }

  function pdfRupiah(n) {
    var abs = Math.abs(Math.round(n * 100) / 100);
    if (abs < 0.005) return "-";
    var s = abs.toLocaleString("id-ID", { maximumFractionDigits: 2 });
    return n < 0 ? "(Rp " + s + ")" : "Rp " + s;
  }

  function pdfDate(str) {
    var p = String(str).split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  function pdfCellText(cell) {
    if (!cell || cell.t === "empty") return "";
    if (cell.t === "money") return pdfRupiah(cell.v);
    if (cell.t === "pct") return cell.v.toFixed(2) + "%";
    if (cell.t === "int") return String(cell.v);
    if (cell.t === "date") return pdfDate(cell.v);
    return pdfText(cell.v);
  }

  function pdfAlign(cell) {
    if (!cell) return "left";
    if (cell.t === "money" || cell.t === "pct") return "right";
    if (cell.t === "int" || cell.t === "date") return "center";
    return "left";
  }

  function writePdf(model, filename) {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) {
      alert("Gagal export: library PDF (jsPDF) belum termuat. Pastikan koneksi internet aktif, lalu coba lagi.");
      return;
    }

    var doc = null;
    var MARGIN = 14;

    model.sheets.forEach(function (sheet) {
      var orientation = sheet.landscape ? "landscape" : "portrait";
      if (!doc) doc = new jsPDFCtor({ orientation: orientation, unit: "mm", format: "a4" });
      else doc.addPage("a4", orientation);

      if (typeof doc.autoTable !== "function") {
        alert("Gagal export: plugin tabel PDF (autoTable) belum termuat. Pastikan koneksi internet aktif, lalu coba lagi.");
        throw new Error("autoTable tidak tersedia");
      }

      var pageW = doc.internal.pageSize.getWidth();
      var pageH = doc.internal.pageSize.getHeight();
      var availW = pageW - MARGIN * 2;
      var y = 16;

      function ensure(h) {
        if (y + h > pageH - 16) { doc.addPage("a4", orientation); y = 16; }
      }

      var fontSize = sheet.ncols >= 7 ? 7.5 : (sheet.ncols >= 5 ? 8.5 : 9.5);

      // Kumpulkan tabel (baris berurutan dengan tid sama)
      var table = null;

      function flush() {
        if (!table) return;

        var ncols = table.ncols;
        var columnStyles = {};
        var tableWidth = availW;

        if (table.head) {
          var total = 0;
          for (var j = 0; j < ncols; j++) total += sheet.colWidths[j] || 10;
          for (var k = 0; k < ncols; k++) {
            columnStyles[k] = { cellWidth: ((sheet.colWidths[k] || 10) / total) * availW };
          }
        } else {
          tableWidth = Math.min(availW, availW * 0.8);
          columnStyles[0] = { cellWidth: tableWidth * 0.68 };
          for (var q = 1; q < ncols; q++) columnStyles[q] = { cellWidth: (tableWidth * 0.32) / (ncols - 1) };
        }

        ensure(20);
        doc.autoTable({
          startY: y,
          head: table.head ? [table.head] : undefined,
          body: table.body,
          margin: { left: MARGIN, right: MARGIN },
          tableWidth: tableWidth,
          theme: "grid",
          styles: { font: "helvetica", fontSize: fontSize, cellPadding: 1.6, lineColor: [191, 199, 209], lineWidth: 0.1, valign: "middle", overflow: "linebreak" },
          headStyles: { fillColor: [31, 58, 95], textColor: [255, 255, 255], halign: "center", fontStyle: "bold" },
          columnStyles: columnStyles
        });
        y = doc.lastAutoTable.finalY + 5;
        table = null;
      }

      sheet.rows.forEach(function (row) {
        if (row.kind === "title") {
          doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(31, 58, 95);
          if (sheet.centerTitles) doc.text(pdfText(row.text), pageW / 2, y, { align: "center" });
          else doc.text(pdfText(row.text), MARGIN, y);
          y += 6;
          return;
        }
        if (row.kind === "subtitle") {
          if (sheet.centerTitles) {
            doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
            doc.text(pdfText(row.text), pageW / 2, y, { align: "center" });
            y += 5.5;
          } else {
            doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(93, 107, 130);
            doc.text(pdfText(row.text), MARGIN, y);
            y += 7;
          }
          return;
        }
        if (row.kind === "blank") return;

        if (row.kind === "heading") {
          flush();
          ensure(14);
          doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(31, 58, 95);
          doc.text(pdfText(row.text), MARGIN, y);
          y += 3;
          return;
        }

        if (!table || table.tid !== row.tid) {
          flush();
          table = { tid: row.tid, ncols: row.ncols || row.cells.length, head: null, body: [] };
        }

        var n = table.ncols;

        if (row.kind === "header") {
          table.head = row.cells.map(function (c) { return pdfText(c.v); });
          return;
        }

        var bodyRow = [];
        for (var j = 0; j < n; j++) {
          var cell = row.cells[j];
          var styles = { halign: pdfAlign(cell) };
          if (cell && cell.indent) styles.cellPadding = { top: 1.6, bottom: 1.6, right: 1.6, left: 1.6 + 4 * cell.indent };
          if (row.kind === "total") { styles.fontStyle = "bold"; styles.fillColor = [242, 242, 242]; }
          bodyRow.push({ content: pdfCellText(cell), styles: styles });
        }
        table.body.push(bodyRow);
      });

      flush();
    });

    // Footer: nama aplikasi, waktu cetak, nomor halaman
    var total = doc.getNumberOfPages();
    var now = new Date();
    var stamp = now.toLocaleDateString("id-ID") + " " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

    for (var p = 1; p <= total; p++) {
      doc.setPage(p);
      var w = doc.internal.pageSize.getWidth();
      var h = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text("Ilham ERP - dicetak " + stamp, MARGIN, h - 8);
      doc.text("Halaman " + p + " dari " + total, w - MARGIN, h - 8, { align: "right" });
    }

    doc.save(filename);
  }

  /* ---------- 5. FORMAT JURNAL KLASIK ----------
     Format buku jurnal standar: TGL | KODE | PERKIRAAN | KETERANGAN |
     DEBET | KREDIT. Akun debit di baris atas, akun kredit di baris bawah
     (menjorok ke dalam), satu baris kosong antar jurnal, TOTAL di bawah.
     entries: [{ date, reference, description, debit:{code,name},
                 credit:{code,name}, amount }] */

  function buildJournalSheet(opts) {
    var title = String(opts.title || "Jurnal");
    var rows = [
      [title.toUpperCase()],
      [String(opts.businessName || "").toUpperCase()],
      ["TAHUN " + (opts.period || "")],
      [],
      ["TGL", "KODE", "PERKIRAAN", "KETERANGAN", "DEBET", "KREDIT"]
    ];

    var totalDebit = 0;
    var totalCredit = 0;

    (opts.entries || []).forEach(function (e) {
      var amount = Number(e.amount) || 0;
      var desc = String(e.description || "-");
      if (e.reference && desc.indexOf(e.reference) === -1) desc += " (" + e.reference + ")";
      var d = e.debit || {};
      var k = e.credit || {};
      var date = e.date || "-";

      rows.push([date, d.code || "", d.name || "-", desc, amount, ""]);
      rows.push([date, k.code || "", "    " + (k.name || "-"), desc, "", amount]);
      rows.push([]);

      totalDebit += amount;
      totalCredit += amount;
    });

    rows.push(["", "", "", "TOTAL", totalDebit, totalCredit]);

    return {
      name: opts.sheetName || title,
      rows: rows,
      colWidths: [11, 9, 32, 36, 16, 16],
      centerTitles: true,
      noFilter: true,
      orientation: "portrait"
    };
  }

  /* ---------- 6. API PUBLIK ---------- */

  function exportReport(format, filename, sheets) {
    try {
      var model = buildModel(sheets);
      if (String(format).toLowerCase() === "pdf") {
        writePdf(model, String(filename).replace(/\.xlsx$/i, "") + ".pdf");
      } else {
        writeExcel(model, /\.xlsx$/i.test(filename) ? filename : filename + ".xlsx");
      }
    } catch (err) {
      console.error(err);
      alert("Gagal membuat file: " + (err && err.message ? err.message : err));
    }
  }

  var api = {
    exportReport: exportReport,
    exportToExcel: function (filename, sheets) { exportReport("xlsx", filename, sheets); },
    buildJournalSheet: buildJournalSheet,
    _buildReportModel: buildModel,
    MONEY_FMT: MONEY_FMT
  };

  if (typeof ERP !== "undefined") {
    Object.keys(api).forEach(function (k) { ERP[k] = api[k]; });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})();
