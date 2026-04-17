const EMAIL_STORAGE_KEY = "emails";

export const normStr = (s = "") =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

export const normInsta = (s = "") =>
  s
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\s/g, "");

const isMarkedStatus = (value) => value === "OK" || value === "X";

export function getStoredEmailMap(condicoes) {
  return condicoes?.[EMAIL_STORAGE_KEY] || {};
}

function parseEmailLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) return null;

  const email = emailMatch[0].toLowerCase();
  const withoutEmail = trimmed.replace(emailMatch[0], " ");
  const tokens = withoutEmail
    .split(/[;,|\t]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  let instagram = "";
  let nome = "";

  for (const token of tokens) {
    if (token.includes("@")) {
      const instaMatch = token.match(/@([a-zA-Z0-9_.]+)/);
      if (instaMatch) {
        instagram = normInsta(instaMatch[1]);
        continue;
      }
    }
    if (!instagram && /^[a-zA-Z0-9_.]+$/.test(token) && !token.includes(" ")) {
      instagram = normInsta(token);
      continue;
    }
    if (!nome) nome = token.replace(/^[-–:]+/, "").trim();
  }

  if (!nome) {
    const cleaned = withoutEmail
      .replace(/@([a-zA-Z0-9_.]+)/g, " ")
      .replace(/[;,|\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    nome = cleaned;
  }

  return {
    raw: trimmed,
    email,
    instagram,
    nome,
  };
}

export function parseEmailImport(text) {
  return text
    .split(/\r?\n/)
    .map((line) => parseEmailLine(line))
    .filter(Boolean);
}

function scoreEmailMatch(entry, divulgadora) {
  const entryIg = normInsta(entry.instagram);
  const divIg = normInsta(divulgadora.instagram);
  if (entryIg && divIg && entryIg === divIg) return 1;

  const entryName = normStr(entry.nome);
  const divName = normStr(divulgadora.nome);
  if (entryName && divName && entryName === divName) return 0.95;

  if (entryIg && divIg && (entryIg.includes(divIg) || divIg.includes(entryIg)) && Math.max(entryIg.length, divIg.length) >= 6) {
    return 0.92;
  }

  if (entryName && divName && (entryName.includes(divName) || divName.includes(entryName)) && Math.max(entryName.length, divName.length) >= 8) {
    return 0.9;
  }

  return 0;
}

export function buildEmailImportPreview(text, divulgadoras) {
  const parsed = parseEmailImport(text);
  const emailMap = {};
  const matched = [];
  const unmatched = [];
  const usedIds = new Set();

  for (const entry of parsed) {
    let best = null;
    let bestScore = 0;
    for (const divulgadora of divulgadoras || []) {
      const score = scoreEmailMatch(entry, divulgadora);
      if (score > bestScore) {
        best = divulgadora;
        bestScore = score;
      }
    }

    if (best && bestScore >= 0.9) {
      emailMap[best.id] = entry.email;
      usedIds.add(best.id);
      matched.push({
        ...entry,
        divulgadoraId: best.id,
        divulgadoraNome: best.nome,
        divulgadoraInstagram: best.instagram,
      });
    } else {
      unmatched.push(entry);
    }
  }

  return {
    parsed,
    matched,
    unmatched,
    emailMap,
    duplicateTargets: matched.filter((item, index, arr) => arr.findIndex((x) => x.divulgadoraId === item.divulgadoraId) !== index),
  };
}

function getDrinksMetaLabel(percentual, metas) {
  const ordered = [...(metas || [])].sort((a, b) => b.percentual - a.percentual);
  const qualifiedDrinkMeta = ordered.find((meta) => /drink/i.test(meta.label || "") && percentual >= Number(meta.percentual || 0));
  if (!qualifiedDrinkMeta) return "NAO";

  const match = qualifiedDrinkMeta.label.match(/(\d+)\s*drink/i);
  if (match) return `${match[1]} DRINK${match[1] === "1" ? "" : "S"}`;
  return qualifiedDrinkMeta.label.toUpperCase();
}

function getFinalMetaHit(percentual, metas) {
  if (!(metas || []).length) return "NAO";
  const threshold = Math.min(...metas.map((meta) => Number(meta.percentual || 0)).filter((value) => Number.isFinite(value)));
  if (!Number.isFinite(threshold)) return "NAO";
  return percentual >= threshold ? "SIM" : "NAO";
}

export function buildConferenceRows({ divulgadoras, acoes, marcacoes, metas, emailMap }) {
  const orderedActions = [...(acoes || [])].sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));

  return [...(divulgadoras || [])]
    .map((divulgadora) => {
      const actionValues = orderedActions.map((acao) => marcacoes?.[`${divulgadora.id}_${acao.id}`] || "");
      const ok = actionValues.filter((value) => value === "OK").length;
      const total = actionValues.filter((value) => isMarkedStatus(value)).length;
      const pct = total ? (ok / total) * 100 : 0;
      return {
        ...divulgadora,
        email: emailMap?.[divulgadora.id] || "",
        ok,
        total,
        pct,
        drinksMeta: getDrinksMetaLabel(pct, metas),
        finalMetaHit: getFinalMetaHit(pct, metas),
        actionValues,
      };
    })
    .sort((a, b) => b.pct - a.pct || b.ok - a.ok || a.nome.localeCompare(b.nome, "pt-BR"));
}

function cloneStyle(source, target) {
  target.style = JSON.parse(JSON.stringify(source.style || {}));
  if (source.numFmt) target.numFmt = source.numFmt;
  if (source.alignment) target.alignment = { ...source.alignment };
  if (source.font) target.font = { ...source.font };
  if (source.fill) target.fill = { ...source.fill };
  if (source.border) target.border = { ...source.border };
}

function styleActionCell(cell, value) {
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.font = {
    ...(cell.font || {}),
    bold: true,
    color: { argb: value === "OK" ? "FF166534" : "FF991B1B" },
  };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: value === "OK" ? "FFDCFCE7" : "FFFEE2E2" },
  };
}

function styleBadgeCell(cell, positive) {
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.font = {
    ...(cell.font || {}),
    bold: true,
    color: { argb: positive ? "FF166534" : "FF991B1B" },
  };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: positive ? "FFDCFCE7" : "FFFEE2E2" },
  };
}

export async function generateConferenceWorkbook({
  templateUrl,
  eventName,
  eventDate,
  divulgadoras,
  acoes,
  marcacoes,
  metas,
  emailMap,
}) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error("Não foi possível carregar o template da planilha.");
  const buffer = await response.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Template inválido.");

  const actionCount = (acoes || []).length;
  const rows = buildConferenceRows({ divulgadoras, acoes, marcacoes, metas, emailMap });
  const orderedActions = [...(acoes || [])].sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));

  worksheet.spliceRows(1, 0, [], []);

  worksheet.spliceColumns(3, 0, [], []);
  worksheet.spliceColumns(5, 0, [], []);

  const headerRow = 3;
  const sampleRow = 4;
  const firstActionColumn = 6;
  const maxTemplateActions = Math.max(worksheet.columnCount - 5, actionCount);
  const pctColumn = firstActionColumn + maxTemplateActions;
  const finalMetaColumn = pctColumn + 1;

  worksheet.spliceColumns(pctColumn, 0, [], []);
  worksheet.spliceColumns(finalMetaColumn, 0, [], []);

  const originalHeaderCells = {
    name: worksheet.getCell(headerRow, 1),
    instagram: worksheet.getCell(headerRow, 2),
    total: worksheet.getCell(headerRow, 4),
    action: worksheet.getCell(headerRow, 6),
  };
  const originalDataCells = {
    name: worksheet.getCell(sampleRow, 1),
    instagram: worksheet.getCell(sampleRow, 2),
    total: worksheet.getCell(sampleRow, 4),
    action: worksheet.getCell(sampleRow, 6),
  };

  const lastColumn = finalMetaColumn;
  worksheet.mergeCells(1, 1, 1, lastColumn);
  worksheet.mergeCells(2, 1, 2, lastColumn);
  worksheet.getCell(1, 1).value = eventName ? `CONFERENCIA FINAL - ${eventName}` : "CONFERENCIA FINAL";
  worksheet.getCell(2, 1).value = eventDate ? `Data do evento: ${eventDate}` : "Data do evento: -";
  worksheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FFF8FAFC" } };
  worksheet.getCell(2, 1).font = { bold: true, size: 11, color: { argb: "FFCBD5E1" } };
  worksheet.getCell(1, 1).alignment = { horizontal: "left", vertical: "middle" };
  worksheet.getCell(2, 1).alignment = { horizontal: "left", vertical: "middle" };
  worksheet.getCell(1, 1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  worksheet.getCell(2, 1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" },
  };

  worksheet.getCell(headerRow, 1).value = "Nome:";
  worksheet.getCell(headerRow, 2).value = "Instagram:";
  worksheet.getCell(headerRow, 3).value = "Email:";
  worksheet.getCell(headerRow, 4).value = "TOTAL:";
  worksheet.getCell(headerRow, 5).value = "META DRINKS:";

  for (let col = 1; col <= 5; col++) {
    cloneStyle(col <= 2 ? originalHeaderCells.name : originalHeaderCells.total, worksheet.getCell(headerRow, col));
    cloneStyle(col <= 2 ? originalDataCells.name : originalDataCells.total, worksheet.getCell(sampleRow, col));
  }
  cloneStyle(originalHeaderCells.instagram, worksheet.getCell(headerRow, 2));
  cloneStyle(originalDataCells.instagram, worksheet.getCell(sampleRow, 2));
  cloneStyle(originalHeaderCells.instagram, worksheet.getCell(headerRow, 3));
  cloneStyle(originalDataCells.instagram, worksheet.getCell(sampleRow, 3));
  cloneStyle(originalHeaderCells.total, worksheet.getCell(headerRow, 5));
  cloneStyle(originalDataCells.total, worksheet.getCell(sampleRow, 5));

  for (let index = 0; index < maxTemplateActions; index++) {
    const col = firstActionColumn + index;
    const headerCell = worksheet.getCell(headerRow, col);
    const dataCell = worksheet.getCell(sampleRow, col);
    cloneStyle(originalHeaderCells.action, headerCell);
    cloneStyle(originalDataCells.action, dataCell);
    headerCell.value = index < actionCount ? `AÇÃO ${orderedActions[index].numero}:` : "";
  }

  cloneStyle(originalHeaderCells.total, worksheet.getCell(headerRow, pctColumn));
  cloneStyle(originalDataCells.total, worksheet.getCell(sampleRow, pctColumn));
  worksheet.getCell(headerRow, pctColumn).value = "%:";

  cloneStyle(originalHeaderCells.total, worksheet.getCell(headerRow, finalMetaColumn));
  cloneStyle(originalDataCells.total, worksheet.getCell(sampleRow, finalMetaColumn));
  worksheet.getCell(headerRow, finalMetaColumn).value = "BATEU META FINAL:";

  if (actionCount < maxTemplateActions) {
    for (let col = firstActionColumn + actionCount; col < firstActionColumn + maxTemplateActions; col++) {
      worksheet.getColumn(col).hidden = true;
    }
  }

  if (rows.length + sampleRow - 1 > worksheet.rowCount) {
    for (let row = worksheet.rowCount + 1; row <= rows.length + sampleRow - 1; row++) {
      worksheet.addRow([]);
    }
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const rowNumber = rowIndex + sampleRow;
    const dataRow = worksheet.getRow(rowNumber);
    const item = rows[rowIndex];

    for (let col = 1; col <= finalMetaColumn; col++) {
      const sourceCell = worksheet.getCell(sampleRow, Math.min(col, worksheet.columnCount));
      cloneStyle(sourceCell, dataRow.getCell(col));
    }

    dataRow.getCell(1).value = item.nome;
    dataRow.getCell(2).value = item.instagram ? `@${item.instagram}` : "";
    dataRow.getCell(3).value = item.email || "";
    dataRow.getCell(4).value = item.ok;
    dataRow.getCell(5).value = item.drinksMeta;

    item.actionValues.forEach((value, index) => {
      const cell = dataRow.getCell(firstActionColumn + index);
      cell.value = value || "";
      if (value === "OK" || value === "X") styleActionCell(cell, value);
    });

    const pctCell = dataRow.getCell(pctColumn);
    pctCell.value = Number(item.pct.toFixed(2));
    pctCell.numFmt = "0.00";
    pctCell.font = { ...(pctCell.font || {}), bold: true, color: { argb: "FF0F172A" } };
    pctCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: item.pct >= 85 ? "FFDCFCE7" : item.pct >= 70 ? "FFFEF3C7" : "FFFEE2E2" },
    };
    pctCell.alignment = { horizontal: "center", vertical: "middle" };

    const metaCell = dataRow.getCell(finalMetaColumn);
    metaCell.value = item.finalMetaHit;
    styleBadgeCell(metaCell, item.finalMetaHit === "SIM");
  }

  for (let rowNumber = rows.length + sampleRow; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    for (let col = 1; col <= finalMetaColumn; col++) {
      row.getCell(col).value = null;
    }
  }

  worksheet.getColumn(1).width = 28;
  worksheet.getColumn(2).width = 18;
  worksheet.getColumn(3).width = 28;
  worksheet.getColumn(4).width = 10;
  worksheet.getColumn(5).width = 18;
  for (let index = 0; index < actionCount; index++) {
    worksheet.getColumn(firstActionColumn + index).width = 11;
  }
  worksheet.getColumn(pctColumn).width = 10;
  worksheet.getColumn(finalMetaColumn).width = 18;
  worksheet.getRow(1).height = 24;
  worksheet.getRow(2).height = 20;

  worksheet.views = [{ state: "frozen", ySplit: headerRow, xSplit: 2 }];
  worksheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: finalMetaColumn },
  };

  if (eventName) {
    worksheet.name = "Conferencia Final";
  }

  const output = await workbook.xlsx.writeBuffer();
  return new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
