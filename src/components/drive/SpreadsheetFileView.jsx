import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_ROW_HEIGHT = 34;
const DEFAULT_COL_WIDTH = 120;
const DEFAULT_ROW_COUNT = 100;
const DEFAULT_COL_COUNT = 26;

const DENSITY = {
  gap: 8,
  radius: 10,
  border: "1px solid #1f1f1f",
  panelBg: "rgba(255,255,255,0.015)",
  buttonPad: "7px 10px",
  inputPad: "8px 10px",
  fieldHeight: 36,
};

const FUNCTION_GROUPS = [
  {
    label: "Math",
    items: [
      { name: "SUM", stub: "=SUM()", caretOffset: 1, description: "Total a range" },
      { name: "AVERAGE", stub: "=AVERAGE()", caretOffset: 1, description: "Average a range" },
      { name: "MIN", stub: "=MIN()", caretOffset: 1, description: "Smallest value" },
      { name: "MAX", stub: "=MAX()", caretOffset: 1, description: "Largest value" },
      { name: "ROUND", stub: "=ROUND(,0)", caretOffset: 2, description: "Round a number" },
    ],
  },
  {
    label: "Logic",
    items: [
      { name: "IF", stub: "=IF(,,)", caretOffset: 1, description: "Conditional value" },
      { name: "AND", stub: "=AND(,)", caretOffset: 1, description: "All true" },
      { name: "OR", stub: "=OR(,)", caretOffset: 1, description: "Any true" },
      { name: "NOT", stub: "=NOT()", caretOffset: 1, description: "Invert value" },
    ],
  },
  {
    label: "Text",
    items: [
      { name: "CONCAT", stub: "=CONCAT(,)", caretOffset: 1, description: "Join values" },
      { name: "LEFT", stub: "=LEFT(,)", caretOffset: 1, description: "Left characters" },
      { name: "RIGHT", stub: "=RIGHT(,)", caretOffset: 1, description: "Right characters" },
      { name: "LEN", stub: "=LEN()", caretOffset: 1, description: "Text length" },
      { name: "TRIM", stub: "=TRIM()", caretOffset: 1, description: "Trim spaces" },
    ],
  },
  {
    label: "Date",
    items: [
      { name: "TODAY", stub: "=TODAY()", caretOffset: 0, description: "Current date" },
      { name: "NOW", stub: "=NOW()", caretOffset: 0, description: "Current date and time" },
    ],
  },
];

const DEFAULT_SHEET = {
  type: "bondfire-sheet",
  version: 4,
  activeSheetId: "sheet_1",
  sheets: [
    {
      id: "sheet_1",
      name: "Sheet1",
      rowCount: DEFAULT_ROW_COUNT,
      columnCount: DEFAULT_COL_COUNT,
      cells: {},
      columnWidths: {},
      rowHeights: {},
    },
  ],
};

function columnLabel(index) {
  let n = Number(index) + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellKey(rowIndex, colIndex) {
  return `${columnLabel(colIndex)}${rowIndex + 1}`;
}

function safeParse(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function normalizeLegacySheet(parsed) {
  const columns = Array.isArray(parsed?.columns) && parsed.columns.length
    ? parsed.columns.map((x, idx) => String(x || columnLabel(idx)))
    : Array.from({ length: DEFAULT_COL_COUNT }, (_, idx) => columnLabel(idx));
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const cells = {};
  rows.forEach((row, rowIndex) => {
    (Array.isArray(row) ? row : []).forEach((value, colIndex) => {
      if (String(value || "") !== "") cells[cellKey(rowIndex, colIndex)] = { input: String(value) };
    });
  });
  return {
    type: "bondfire-sheet",
    version: 4,
    activeSheetId: "sheet_1",
    sheets: [
      {
        id: "sheet_1",
        name: "Sheet1",
        rowCount: Math.max(rows.length || 0, DEFAULT_ROW_COUNT),
        columnCount: Math.max(columns.length || 0, DEFAULT_COL_COUNT),
        cells,
        columnWidths: {},
        rowHeights: {},
      },
    ],
  };
}

function normalizeSheet(input) {
  if (!input || typeof input !== "object") return DEFAULT_SHEET;
  if (Array.isArray(input?.sheets) && input.sheets.length) {
    const sheets = input.sheets.map((sheet, idx) => ({
      id: String(sheet?.id || `sheet_${idx + 1}`),
      name: String(sheet?.name || `Sheet${idx + 1}`),
      rowCount: Math.max(1, Number(sheet?.rowCount || DEFAULT_ROW_COUNT)),
      columnCount: Math.max(1, Number(sheet?.columnCount || DEFAULT_COL_COUNT)),
      cells: sheet && typeof sheet.cells === "object" && !Array.isArray(sheet.cells)
        ? Object.fromEntries(Object.entries(sheet.cells).map(([key, cell]) => [key, { input: String(cell?.input ?? cell ?? "") }]))
        : {},
      columnWidths: sheet && typeof sheet.columnWidths === "object" && !Array.isArray(sheet.columnWidths)
        ? Object.fromEntries(Object.entries(sheet.columnWidths).map(([key, width]) => [key, Math.max(60, Number(width || DEFAULT_COL_WIDTH))]))
        : {},
      rowHeights: sheet && typeof sheet.rowHeights === "object" && !Array.isArray(sheet.rowHeights)
        ? Object.fromEntries(Object.entries(sheet.rowHeights).map(([key, height]) => [key, Math.max(24, Number(height || DEFAULT_ROW_HEIGHT))]))
        : {},
    }));
    const activeSheetId = sheets.some((sheet) => sheet.id === input.activeSheetId) ? input.activeSheetId : sheets[0].id;
    return { type: "bondfire-sheet", version: 4, activeSheetId, sheets };
  }
  return normalizeLegacySheet(input);
}

function serialize(sheetDoc) {
  return JSON.stringify(sheetDoc, null, 2);
}

function parseCellRef(ref) {
  const match = String(ref || "").toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (const char of match[1]) col = (col * 26) + (char.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

function expandRange(startRef, endRef) {
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef);
  if (!start || !end) return [];
  const rows = [start.row, end.row].sort((a, b) => a - b);
  const cols = [start.col, end.col].sort((a, b) => a - b);
  const out = [];
  for (let row = rows[0]; row <= rows[1]; row += 1) {
    for (let col = cols[0]; col <= cols[1]; col += 1) out.push(cellKey(row, col));
  }
  return out;
}

function evaluateFormula(input, getter, stack = new Set()) {
  const raw = String(input || "").trim();
  if (!raw.startsWith("=")) return raw;
  const expr = raw.slice(1).trim();
  const fnMatch = expr.match(/^(SUM|AVERAGE|AVG|MIN|MAX|ROUND|CONCAT|LEFT|RIGHT|LEN|TRIM|TODAY|NOW|IF|AND|OR|NOT)\((.*)\)$/i);
  if (fnMatch) {
    const fn = fnMatch[1].toUpperCase();
    const argsRaw = fnMatch[2];
    const args = argsRaw.length ? argsRaw.split(",").map((token) => token.trim()) : [];
    const numericRefs = args.flatMap((part) => {
      if (part.includes(":")) {
        const [start, end] = part.split(":");
        return expandRange(start, end);
      }
      return [part];
    });
    if (["SUM", "AVERAGE", "AVG", "MIN", "MAX"].includes(fn)) {
      const nums = numericRefs
        .map((ref) => Number(getter(String(ref).toUpperCase(), stack) || 0))
        .filter((value) => Number.isFinite(value));
      if (!nums.length) return "";
      if (fn === "SUM") return String(nums.reduce((sum, value) => sum + value, 0));
      if (fn === "AVERAGE" || fn === "AVG") return String(nums.reduce((sum, value) => sum + value, 0) / nums.length);
      if (fn === "MIN") return String(Math.min(...nums));
      if (fn === "MAX") return String(Math.max(...nums));
    }
    if (fn === "ROUND") {
      const base = Number(args[0] ? getter(String(args[0]).toUpperCase(), stack) || args[0] : 0);
      const places = Number(args[1] || 0);
      return Number.isFinite(base) ? String(Number(base).toFixed(Number.isFinite(places) ? places : 0)) : "#ERR";
    }
    if (fn === "CONCAT") return args.map((arg) => getter(String(arg).toUpperCase(), stack) || arg.replace(/^"|"$/g, "")).join("");
    if (fn === "LEFT") {
      const text = String(getter(String(args[0] || "").toUpperCase(), stack) || args[0] || "");
      return text.slice(0, Math.max(0, Number(args[1] || 1)));
    }
    if (fn === "RIGHT") {
      const text = String(getter(String(args[0] || "").toUpperCase(), stack) || args[0] || "");
      return text.slice(Math.max(0, text.length - Math.max(0, Number(args[1] || 1))));
    }
    if (fn === "LEN") return String(String(getter(String(args[0] || "").toUpperCase(), stack) || args[0] || "").length);
    if (fn === "TRIM") return String(getter(String(args[0] || "").toUpperCase(), stack) || args[0] || "").trim();
    if (fn === "TODAY") return new Date().toLocaleDateString();
    if (fn === "NOW") return new Date().toLocaleString();
    if (fn === "NOT") return String(!(String(getter(String(args[0] || "").toUpperCase(), stack) || args[0] || "").toLowerCase() === "true"));
    if (fn === "AND") return String(args.every((arg) => String(getter(String(arg).toUpperCase(), stack) || arg || "").toLowerCase() === "true"));
    if (fn === "OR") return String(args.some((arg) => String(getter(String(arg).toUpperCase(), stack) || arg || "").toLowerCase() === "true"));
    if (fn === "IF") {
      const condition = String(getter(String(args[0] || "").toUpperCase(), stack) || args[0] || "").toLowerCase();
      return condition === "true" || condition === "1" ? String(getter(String(args[1] || "").toUpperCase(), stack) || args[1] || "") : String(getter(String(args[2] || "").toUpperCase(), stack) || args[2] || "");
    }
  }
  const replaced = expr.replace(/\b([A-Z]+\d+)\b/g, (_, ref) => {
    const value = getter(ref.toUpperCase(), stack);
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : "0";
  });
  if (!/^[0-9+\-*/().\s]+$/.test(replaced)) return "#ERR";
  try {
    const result = Function(`"use strict"; return (${replaced});`)();
    return Number.isFinite(result) ? String(result) : "#ERR";
  } catch {
    return "#ERR";
  }
}

function getDisplayValue(sheet, key, stack = new Set()) {
  const input = String(sheet?.cells?.[key]?.input || "");
  if (!input.startsWith("=")) return input;
  if (stack.has(key)) return "#CYCLE";
  const nextStack = new Set(stack);
  nextStack.add(key);
  return evaluateFormula(input, (ref, nestedStack) => getDisplayValue(sheet, ref, nestedStack || nextStack), nextStack);
}

function estimateWidth(sheet, colIndex) {
  const targetLabel = columnLabel(colIndex);
  let maxLen = targetLabel.length;
  const targetIndex = Number(colIndex);
  Object.entries(sheet?.cells || {}).forEach(([key, cell]) => {
    const parsed = parseCellRef(key);
    if (!parsed || parsed.col !== targetIndex) return;
    const raw = String(cell?.input || "");
    const shown = raw.startsWith("=") ? getDisplayValue(sheet, key) : raw;
    const longestLine = String(shown || "").split(/\n/).reduce((m, line) => Math.max(m, line.length), 0);
    maxLen = Math.max(maxLen, longestLine);
  });
  return Math.max(80, Math.min(420, Math.round(maxLen * 8.5 + 24)));
}

function estimateHeight(value) {
  const text = String(value || "");
  const lines = Math.max(1, text.split(/\n/).length);
  return Math.max(28, Math.min(180, 18 + (lines * 16)));
}

function MenuButton({ item, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      style={{
        display: "grid",
        gap: 2,
        width: "100%",
        padding: isMobile ? "6px 8px" : "7px 9px",
        background: "transparent",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ fontWeight: 700 }}>{item.name}</span>
      <span className="helper" style={{ fontSize: 11 }}>{item.description}</span>
    </button>
  );
}

export default function SpreadsheetFileView({ value, onChange, mode = "edit" }) {
  const doc = useMemo(() => normalizeSheet(safeParse(value)), [value]);
  const readOnly = mode === "preview";
  const [selectedCell, setSelectedCell] = useState("A1");
  const [editingCell, setEditingCell] = useState("A1");
  const [formulaDraft, setFormulaDraft] = useState("");
  const [sheetNameDraft, setSheetNameDraft] = useState("");
  const [renamingSheetId, setRenamingSheetId] = useState("");
  const [functionsOpen, setFunctionsOpen] = useState(false);
  const inputRefs = useRef({});
  const formulaInputRef = useRef(null);
  const functionsRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 760 : false));

  const activeSheet = doc.sheets.find((sheet) => sheet.id === doc.activeSheetId) || doc.sheets[0];
  const selectedInput = String(activeSheet?.cells?.[selectedCell]?.input || "");
  const selectedRef = parseCellRef(selectedCell) || { row: 0, col: 0 };

  useEffect(() => {
    setFormulaDraft(selectedInput);
  }, [selectedInput, selectedCell]);

  useEffect(() => {
    if (!readOnly && editingCell && inputRefs.current[editingCell]) {
      const node = inputRefs.current[editingCell];
      node.focus();
      node.select?.();
    }
  }, [editingCell, activeSheet?.id, readOnly]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setIsMobile(!!media.matches);
    sync();
    if (typeof media.addEventListener === "function") media.addEventListener("change", sync);
    else media.addListener(sync);
    return () => {
      if (typeof media.removeEventListener === "function") media.removeEventListener("change", sync);
      else media.removeListener(sync);
    };
  }, []);

  useEffect(() => {
    if (!functionsOpen) return undefined;
    const onDown = (e) => {
      if (!functionsRef.current?.contains(e.target)) setFunctionsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [functionsOpen]);

  const commit = (nextDoc) => onChange?.(serialize(nextDoc));

  const patchActiveSheet = (updater) => {
    const nextSheets = doc.sheets.map((sheet) => (sheet.id === activeSheet.id ? updater(sheet) : sheet));
    commit({ ...doc, sheets: nextSheets });
  };

  const setCellInput = (cell, nextInput) => {
    patchActiveSheet((sheet) => {
      const nextCells = { ...sheet.cells };
      if (String(nextInput || "") === "") delete nextCells[cell];
      else nextCells[cell] = { input: String(nextInput) };
      return { ...sheet, cells: nextCells };
    });
  };

  const setSheetProp = (patch) => patchActiveSheet((sheet) => ({ ...sheet, ...patch }));
  const addRow = (count = 25) => setSheetProp({ rowCount: activeSheet.rowCount + count });
  const addColumn = (count = 5) => setSheetProp({ columnCount: activeSheet.columnCount + count });

  const addSheet = () => {
    const id = `sheet_${Date.now()}`;
    commit({
      ...doc,
      activeSheetId: id,
      sheets: [...doc.sheets, {
        id,
        name: `Sheet${doc.sheets.length + 1}`,
        rowCount: DEFAULT_ROW_COUNT,
        columnCount: DEFAULT_COL_COUNT,
        cells: {},
        columnWidths: {},
        rowHeights: {},
      }],
    });
    setSelectedCell("A1");
    setEditingCell("A1");
    setSheetNameDraft(`Sheet${doc.sheets.length + 1}`);
    setRenamingSheetId(id);
  };

  const renameSheet = (sheetId, nextName) => {
    const trimmed = String(nextName || "").trim();
    if (!trimmed) return;
    commit({
      ...doc,
      sheets: doc.sheets.map((sheet) => (sheet.id === sheetId ? { ...sheet, name: trimmed } : sheet)),
    });
  };

  const setColumnWidth = (colIndex, width) => patchActiveSheet((sheet) => ({
    ...sheet,
    columnWidths: { ...sheet.columnWidths, [columnLabel(colIndex)]: Math.max(60, Number(width || DEFAULT_COL_WIDTH)) },
  }));

  const setRowHeight = (rowIndex, height) => patchActiveSheet((sheet) => ({
    ...sheet,
    rowHeights: { ...sheet.rowHeights, [String(rowIndex + 1)]: Math.max(24, Number(height || DEFAULT_ROW_HEIGHT)) },
  }));

  const autoFitColumn = (colIndex) => setColumnWidth(colIndex, estimateWidth(activeSheet, colIndex));
  const autoFitRow = (rowIndex) => setRowHeight(rowIndex, estimateHeight(activeSheet?.cells?.[cellKey(rowIndex, selectedRef.col)]?.input || ""));

  const columnLabels = Array.from({ length: activeSheet.columnCount }, (_, idx) => columnLabel(idx));
  const rowIndices = Array.from({ length: activeSheet.rowCount }, (_, idx) => idx);

  const selectCell = (cell, shouldEdit = true) => {
    setSelectedCell(cell);
    if (shouldEdit) setEditingCell(cell);
  };

  const moveSelection = (deltaRow, deltaCol) => {
    const nextRow = Math.max(0, Math.min(activeSheet.rowCount - 1, selectedRef.row + deltaRow));
    const nextCol = Math.max(0, Math.min(activeSheet.columnCount - 1, selectedRef.col + deltaCol));
    const next = cellKey(nextRow, nextCol);
    setSelectedCell(next);
    setEditingCell(next);
  };

  const commitFormulaBar = () => {
    if (readOnly) return;
    setCellInput(selectedCell, formulaDraft);
  };

  const insertFunction = (item) => {
    const next = item.stub;
    setFormulaDraft(next);
    setFunctionsOpen(false);
    if (!readOnly) setCellInput(selectedCell, next);
    requestAnimationFrame(() => {
      const node = formulaInputRef.current;
      if (!node) return;
      const closeIndex = next.indexOf(")");
      const position = closeIndex >= 0 ? closeIndex - (item.caretOffset || 0) : next.length;
      node.focus();
      node.setSelectionRange(position, position);
    });
  };

  const selectedColWidth = Number(activeSheet.columnWidths?.[columnLabel(selectedRef.col)] || DEFAULT_COL_WIDTH);
  const selectedRowHeight = Number(activeSheet.rowHeights?.[String(selectedRef.row + 1)] || DEFAULT_ROW_HEIGHT);
  const mobileFieldHeight = isMobile ? 34 : DENSITY.fieldHeight;
  const compactButtonPad = isMobile ? "6px 9px" : DENSITY.buttonPad;

  return (
    <div style={{ display: "grid", gap: DENSITY.gap, maxWidth: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: DENSITY.gap, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {!readOnly ? (
            <>
              <button className="btn" type="button" onClick={() => addRow(25)} style={{ padding: compactButtonPad }}>Add 25 rows</button>
              <button className="btn" type="button" onClick={() => addColumn(5)} style={{ padding: compactButtonPad }}>Add 5 columns</button>
            </>
          ) : null}
        </div>
        <div className="helper">{activeSheet.rowCount} rows · {activeSheet.columnCount} columns</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: readOnly ? (isMobile ? "1fr" : "84px minmax(0,1fr)") : (isMobile ? "1fr" : "84px auto minmax(0,1fr)"), gap: 6, alignItems: "center" }}>
        <div style={{ fontWeight: 700, minWidth: 0 }}>{selectedCell}</div>
        {!readOnly ? (
          <div ref={functionsRef} style={{ position: "relative" }}>
            <button className="btn" type="button" onClick={() => setFunctionsOpen((v) => !v)} style={{ padding: compactButtonPad, whiteSpace: "nowrap", width: isMobile ? "100%" : "auto" }}>Functions</button>
            {functionsOpen ? (
              <div style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", width: 320, maxHeight: 340, overflow: "auto", background: "rgba(16,16,20,0.98)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 8, boxShadow: "0 14px 32px rgba(0,0,0,0.42)", zIndex: 120, display: "grid", gap: 8 }}>
                {FUNCTION_GROUPS.map((group) => (
                  <div key={group.label} style={{ display: "grid", gap: 4 }}>
                    <div className="helper" style={{ fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>{group.label}</div>
                    <div style={{ display: "grid", gap: 2 }}>
                      {group.items.map((item) => <MenuButton key={item.name} item={item} onSelect={insertFunction} />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <input
          ref={formulaInputRef}
          className="input"
          value={formulaDraft}
          disabled={readOnly}
          onChange={(e) => setFormulaDraft(e.target.value)}
          onFocus={() => setEditingCell(selectedCell)}
          onBlur={commitFormulaBar}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitFormulaBar();
            }
          }}
          placeholder="Value or formula, like =SUM(A1:B4)"
          style={{ padding: isMobile ? "7px 10px" : DENSITY.inputPad, height: mobileFieldHeight, width: "100%" }}
        />
      </div>

      {!readOnly ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {isMobile ? <div className="helper" style={{ width: "100%" }}>Tip: swipe to pan the grid, tap a cell to edit, and use the formula bar for formulas.</div> : null}
          <div className="helper">Column {columnLabel(selectedRef.col)} width</div>
          <input className="input" type="number" min="60" max="420" value={selectedColWidth} onChange={(e) => setColumnWidth(selectedRef.col, e.target.value)} style={{ width: isMobile ? 72 : 82, padding: isMobile ? "6px 8px" : "7px 9px", height: mobileFieldHeight }} />
          <button className="btn" type="button" onClick={() => autoFitColumn(selectedRef.col)} style={{ padding: compactButtonPad }}>Auto-fit column</button>
          <div className="helper">Row {selectedRef.row + 1} height</div>
          <input className="input" type="number" min="24" max="180" value={selectedRowHeight} onChange={(e) => setRowHeight(selectedRef.row, e.target.value)} style={{ width: isMobile ? 72 : 82, padding: isMobile ? "6px 8px" : "7px 9px", height: mobileFieldHeight }} />
          <button className="btn" type="button" onClick={() => autoFitRow(selectedRef.row)} style={{ padding: compactButtonPad }}>Auto-fit row</button>
        </div>
      ) : null}

      <div style={{ overflow: "auto", border: DENSITY.border, borderRadius: DENSITY.radius, background: DENSITY.panelBg, WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y", maxWidth: "100%" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `52px ${columnLabels.map((label) => `${Number(activeSheet.columnWidths?.[label] || DEFAULT_COL_WIDTH)}px`).join(" ")}`,
            minWidth: isMobile ? `${Math.max(680, activeSheet.columnCount * 92)}px` : "max-content",
          }}
        >
          <div style={{ position: "sticky", left: 0, top: 0, zIndex: 4, borderBottom: "1px solid #222", borderRight: "1px solid #222", background: "#0f1012", minHeight: isMobile ? 34 : 36 }} />
          {columnLabels.map((label, colIndex) => (
            <button
              key={label}
              type="button"
              onClick={() => selectCell(cellKey(selectedRef.row, colIndex), false)}
              onDoubleClick={() => autoFitColumn(colIndex)}
              style={{
                position: "sticky",
                top: 0,
                zIndex: 3,
                border: "none",
                borderBottom: "1px solid #222",
                borderRight: "1px solid #222",
                background: selectedRef.col === colIndex ? "rgba(24,129,242,0.18)" : "#0f1012",
                color: "#fff",
                minHeight: isMobile ? 34 : 36,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}

          {rowIndices.flatMap((rowIndex) => {
            const rowKey = String(rowIndex + 1);
            const rowHeight = Number(activeSheet.rowHeights?.[rowKey] || DEFAULT_ROW_HEIGHT);
            const rowHeader = (
              <button
                key={`row_header_${rowKey}`}
                type="button"
                onClick={() => selectCell(cellKey(rowIndex, selectedRef.col), false)}
                onDoubleClick={() => autoFitRow(rowIndex)}
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  border: "none",
                  borderBottom: "1px solid #1d1d1d",
                  borderRight: "1px solid #222",
                  background: selectedRef.row === rowIndex ? "rgba(24,129,242,0.18)" : "#0f1012",
                  color: "#fff",
                  height: rowHeight,
                  minHeight: isMobile ? 34 : rowHeight,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {rowIndex + 1}
              </button>
            );
            const cells = columnLabels.map((label, colIndex) => {
              const key = cellKey(rowIndex, colIndex);
              const input = String(activeSheet?.cells?.[key]?.input || "");
              const display = input.startsWith("=") ? getDisplayValue(activeSheet, key) : input;
              const selected = selectedCell === key;
              return (
                <div
                  key={key}
                  style={{
                    borderBottom: "1px solid #1d1d1d",
                    borderRight: "1px solid #1d1d1d",
                    height: rowHeight,
                  minHeight: isMobile ? 34 : rowHeight,
                    background: selected ? "rgba(24,129,242,0.08)" : "transparent",
                  }}
                >
                  {readOnly ? (
                    <div style={{ padding: isMobile ? "6px 8px" : "7px 9px", whiteSpace: "pre-wrap", overflow: "hidden", textOverflow: "ellipsis", height: "100%" }}>{display}</div>
                  ) : (
                    <input
                      ref={(node) => { inputRefs.current[key] = node; }}
                      className="input"
                      value={selected && editingCell === key ? input : (selected ? input : display)}
                      onFocus={() => { setSelectedCell(key); setEditingCell(key); setFormulaDraft(input); }}
                      onClick={() => { setSelectedCell(key); setEditingCell(key); }}
                      onChange={(e) => { setSelectedCell(key); setEditingCell(key); setFormulaDraft(e.target.value); setCellInput(key, e.target.value); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          moveSelection(1, 0);
                        } else if (e.key === "Tab") {
                          e.preventDefault();
                          moveSelection(0, e.shiftKey ? -1 : 1);
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          moveSelection(1, 0);
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          moveSelection(-1, 0);
                        } else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
                          e.preventDefault();
                          moveSelection(0, -1);
                        } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length && e.currentTarget.selectionEnd === e.currentTarget.value.length) {
                          e.preventDefault();
                          moveSelection(0, 1);
                        }
                      }}
                      style={{
                        width: "100%",
                        height: "100%",
                        border: selected ? "1px solid #1881f2" : "1px solid transparent",
                        borderRadius: 0,
                        background: "transparent",
                        padding: isMobile ? "6px 8px" : "7px 9px",
                        boxShadow: "none",
                        outline: "none",
                      }}
                    />
                  )}
                </div>
              );
            });
            return [rowHeader, ...cells];
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, alignItems: "center" }}>
        {doc.sheets.map((sheet) => {
          const active = sheet.id === activeSheet.id;
          const isRenaming = renamingSheetId === sheet.id && !readOnly;
          return (
            <div key={sheet.id} style={{ display: "flex", alignItems: "center" }}>
              {isRenaming ? (
                <input
                  className="input"
                  autoFocus
                  value={sheetNameDraft}
                  onChange={(e) => setSheetNameDraft(e.target.value)}
                  onBlur={() => {
                    renameSheet(sheet.id, sheetNameDraft || sheet.name);
                    setRenamingSheetId("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      renameSheet(sheet.id, sheetNameDraft || sheet.name);
                      setRenamingSheetId("");
                    }
                    if (e.key === "Escape") setRenamingSheetId("");
                  }}
                  style={{ width: 120, padding: isMobile ? "6px 8px" : "7px 9px", height: 34 }}
                />
              ) : (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    commit({ ...doc, activeSheetId: sheet.id });
                    setSelectedCell("A1");
                    setEditingCell("A1");
                  }}
                  onDoubleClick={() => {
                    if (readOnly) return;
                    setSheetNameDraft(sheet.name);
                    setRenamingSheetId(sheet.id);
                  }}
                  title={readOnly ? sheet.name : `${sheet.name} · double click to rename`}
                  style={{
                    padding: isMobile ? "6px 10px" : "7px 11px",
                    borderRadius: 12,
                    background: active ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.02)",
                    borderColor: active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
                  }}
                >
                  {sheet.name}
                </button>
              )}
            </div>
          );
        })}
        {!readOnly ? (
          <button className="btn" type="button" onClick={addSheet} style={{ padding: isMobile ? "6px 9px" : "7px 10px", borderRadius: 12 }}>＋ Sheet</button>
        ) : null}
      </div>
    </div>
  );
}
