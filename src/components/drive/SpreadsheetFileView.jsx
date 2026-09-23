import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

function rewriteFormulaReferences(input, axis, index, mode) {
  const raw = String(input || "");
  if (!raw.startsWith("=")) return raw;
  return raw.replace(/\b([A-Z]+)(\d+)\b/g, (match, letters, rowNumber) => {
    const ref = parseCellRef(`${letters}${rowNumber}`);
    if (!ref) return match;
    let { row, col } = ref;

    if (axis === "row") {
      if (mode === "delete" && row === index) return "#REF!";
      if (mode === "delete" && row > index) row -= 1;
      if (mode === "insert" && row >= index) row += 1;
    } else {
      if (mode === "delete" && col === index) return "#REF!";
      if (mode === "delete" && col > index) col -= 1;
      if (mode === "insert" && col >= index) col += 1;
    }
    return cellKey(row, col);
  });
}

function remapRowHeights(rowHeights, index, mode) {
  const next = {};
  Object.entries(rowHeights || {}).forEach(([key, value]) => {
    const row = Number(key) - 1;
    if (!Number.isFinite(row) || row < 0) return;
    if (mode === "delete" && row === index) return;
    const target = mode === "delete"
      ? (row > index ? row - 1 : row)
      : (row >= index ? row + 1 : row);
    next[String(target + 1)] = value;
  });
  return next;
}

function remapColumnWidths(columnWidths, index, mode) {
  const next = {};
  Object.entries(columnWidths || {}).forEach(([key, value]) => {
    const parsed = parseCellRef(`${String(key || "").toUpperCase()}1`);
    if (!parsed) return;
    const col = parsed.col;
    if (mode === "delete" && col === index) return;
    const target = mode === "delete"
      ? (col > index ? col - 1 : col)
      : (col >= index ? col + 1 : col);
    next[columnLabel(target)] = value;
  });
  return next;
}

function transformSheetAxis(sheet, axis, index, mode) {
  const nextCells = {};
  Object.entries(sheet?.cells || {}).forEach(([key, cell]) => {
    const parsed = parseCellRef(key);
    if (!parsed) return;
    let { row, col } = parsed;

    if (axis === "row") {
      if (mode === "delete" && row === index) return;
      if (mode === "delete" && row > index) row -= 1;
      if (mode === "insert" && row >= index) row += 1;
    } else {
      if (mode === "delete" && col === index) return;
      if (mode === "delete" && col > index) col -= 1;
      if (mode === "insert" && col >= index) col += 1;
    }

    nextCells[cellKey(row, col)] = {
      ...cell,
      input: rewriteFormulaReferences(cell?.input, axis, index, mode),
    };
  });

  return {
    ...sheet,
    rowCount: axis === "row"
      ? Math.max(1, sheet.rowCount + (mode === "insert" ? 1 : -1))
      : sheet.rowCount,
    columnCount: axis === "column"
      ? Math.max(1, sheet.columnCount + (mode === "insert" ? 1 : -1))
      : sheet.columnCount,
    cells: nextCells,
    rowHeights: axis === "row" ? remapRowHeights(sheet.rowHeights, index, mode) : sheet.rowHeights,
    columnWidths: axis === "column" ? remapColumnWidths(sheet.columnWidths, index, mode) : sheet.columnWidths,
  };
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
        padding: "7px 9px",
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

function SheetActionMenu({ label, items = [], footer = null }) {
  return (
    <details className="bf-sheet-actionMenu">
      <summary className="bf-sheet-toolButton">{label}<span aria-hidden="true">⌄</span></summary>
      <div className="bf-sheet-actionPopover">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={item.danger ? "bf-sheet-menuItem is-danger" : "bf-sheet-menuItem"}
            disabled={item.disabled}
            onClick={(event) => {
              item.onClick?.();
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span>{item.label}</span>
            {item.hint ? <small>{item.hint}</small> : null}
          </button>
        ))}
        {footer ? <div className="bf-sheet-menuFooter">{footer}</div> : null}
      </div>
    </details>
  );
}

function SheetContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(() => ({
    left: Number(menu?.x || 8),
    top: Number(menu?.y || 8),
  }));

  useEffect(() => {
    if (!menu || typeof window === "undefined") return undefined;
    const place = () => {
      const node = ref.current;
      const width = Number(node?.offsetWidth || 220);
      const height = Number(node?.offsetHeight || 260);
      const edge = 8;
      setPosition({
        left: Math.max(edge, Math.min(Number(menu.x || edge), window.innerWidth - width - edge)),
        top: Math.max(edge, Math.min(Number(menu.y || edge), window.innerHeight - height - edge)),
      });
    };
    place();
    const frame = window.requestAnimationFrame(place);
    const close = () => onClose?.();
    const onDown = (event) => {
      if (ref.current?.contains(event.target)) return;
      onClose?.();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, onClose]);

  if (!menu || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="bf-sheet-contextMenu"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {(menu.items || []).map((item, index) => item.separator ? (
        <div key={`sep-${index}`} className="bf-sheet-contextSeparator" />
      ) : (
        <button
          key={`${item.label}-${index}`}
          type="button"
          className={item.danger ? "bf-sheet-contextItem is-danger" : "bf-sheet-contextItem"}
          disabled={item.disabled}
          onClick={async () => {
            await item.onClick?.();
            onClose?.();
          }}
        >
          <span>{item.label}</span>
          {item.hint ? <small>{item.hint}</small> : null}
        </button>
      ))}
    </div>,
    document.body,
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
  const [contextMenu, setContextMenu] = useState(null);
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

  const insertRowAt = (rowIndex) => {
    patchActiveSheet((sheet) => transformSheetAxis(sheet, "row", rowIndex, "insert"));
    const next = cellKey(rowIndex, selectedRef.col);
    setSelectedCell(next);
    setEditingCell(next);
  };

  const deleteRowAt = (rowIndex) => {
    if (activeSheet.rowCount <= 1) return;
    if (!window.confirm(`Delete row ${rowIndex + 1}? Cells below it will move up.`)) return;
    patchActiveSheet((sheet) => transformSheetAxis(sheet, "row", rowIndex, "delete"));
    const nextRow = Math.min(rowIndex, activeSheet.rowCount - 2);
    const next = cellKey(Math.max(0, nextRow), selectedRef.col);
    setSelectedCell(next);
    setEditingCell(next);
  };

  const clearRowAt = (rowIndex) => {
    patchActiveSheet((sheet) => ({
      ...sheet,
      cells: Object.fromEntries(
        Object.entries(sheet.cells || {}).filter(([key]) => parseCellRef(key)?.row !== rowIndex),
      ),
    }));
  };

  const insertColumnAt = (colIndex) => {
    patchActiveSheet((sheet) => transformSheetAxis(sheet, "column", colIndex, "insert"));
    const next = cellKey(selectedRef.row, colIndex);
    setSelectedCell(next);
    setEditingCell(next);
  };

  const deleteColumnAt = (colIndex) => {
    if (activeSheet.columnCount <= 1) return;
    if (!window.confirm(`Delete column ${columnLabel(colIndex)}? Cells to the right will move left.`)) return;
    patchActiveSheet((sheet) => transformSheetAxis(sheet, "column", colIndex, "delete"));
    const nextCol = Math.min(colIndex, activeSheet.columnCount - 2);
    const next = cellKey(selectedRef.row, Math.max(0, nextCol));
    setSelectedCell(next);
    setEditingCell(next);
  };

  const clearColumnAt = (colIndex) => {
    patchActiveSheet((sheet) => ({
      ...sheet,
      cells: Object.fromEntries(
        Object.entries(sheet.cells || {}).filter(([key]) => parseCellRef(key)?.col !== colIndex),
      ),
    }));
  };

  const openContextMenu = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: items.filter(Boolean),
    });
  };

  const copyCell = async (cellRef) => {
    const value = String(activeSheet?.cells?.[cellRef]?.input || "");
    try {
      await navigator.clipboard.writeText(value);
    } catch {}
  };

  const pasteCell = async (cellRef) => {
    if (readOnly) return;
    try {
      const value = await navigator.clipboard.readText();
      setCellInput(cellRef, value);
      setFormulaDraft(value);
    } catch {}
  };

  const duplicateSheet = (sheetId) => {
    const source = doc.sheets.find((sheet) => sheet.id === sheetId);
    if (!source) return;
    const id = `sheet_${Date.now()}`;
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = id;
    copy.name = `${source.name} copy`;
    commit({ ...doc, activeSheetId: id, sheets: [...doc.sheets, copy] });
    setSelectedCell("A1");
    setEditingCell("A1");
  };

  const deleteSheet = (sheetId) => {
    if (doc.sheets.length <= 1) return;
    const sheet = doc.sheets.find((item) => item.id === sheetId);
    if (!window.confirm(`Delete sheet "${sheet?.name || "Sheet"}"?`)) return;
    const nextSheets = doc.sheets.filter((item) => item.id !== sheetId);
    const nextActive = doc.activeSheetId === sheetId ? nextSheets[0].id : doc.activeSheetId;
    commit({ ...doc, activeSheetId: nextActive, sheets: nextSheets });
    setSelectedCell("A1");
    setEditingCell("A1");
  };

  const rowContextItems = (rowIndex) => [
    { label: "Insert row above", onClick: () => insertRowAt(rowIndex) },
    { label: "Insert row below", onClick: () => insertRowAt(rowIndex + 1) },
    { label: "Auto-fit row", onClick: () => autoFitRow(rowIndex) },
    { separator: true },
    { label: "Clear row", onClick: () => clearRowAt(rowIndex) },
    { label: "Delete row", danger: true, disabled: activeSheet.rowCount <= 1, onClick: () => deleteRowAt(rowIndex) },
  ];

  const columnContextItems = (colIndex) => [
    { label: "Insert column left", onClick: () => insertColumnAt(colIndex) },
    { label: "Insert column right", onClick: () => insertColumnAt(colIndex + 1) },
    { label: "Auto-fit column", onClick: () => autoFitColumn(colIndex) },
    { separator: true },
    { label: "Clear column", onClick: () => clearColumnAt(colIndex) },
    { label: "Delete column", danger: true, disabled: activeSheet.columnCount <= 1, onClick: () => deleteColumnAt(colIndex) },
  ];

  const cellContextItems = (rowIndex, colIndex) => {
    const ref = cellKey(rowIndex, colIndex);
    return [
      { label: "Edit cell", onClick: () => selectCell(ref, true) },
      { label: "Copy cell", onClick: () => copyCell(ref) },
      { label: "Paste into cell", disabled: readOnly, onClick: () => pasteCell(ref) },
      { label: "Clear cell", disabled: readOnly, onClick: () => setCellInput(ref, "") },
      { separator: true },
      ...rowContextItems(rowIndex),
      { separator: true },
      ...columnContextItems(colIndex),
    ];
  };

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
    if (!trimmed || doc.sheets.find((sheet) => sheet.id === sheetId)?.name === trimmed) return;
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
    <div className="bf-sheet">
      <div className="bf-sheet-toolbar">
        <div className="bf-sheet-toolbarActions">
          {!readOnly ? (
            <>
              <SheetActionMenu
                label={`Row ${selectedRef.row + 1}`}
                items={[
                  { label: "Insert above", onClick: () => insertRowAt(selectedRef.row) },
                  { label: "Insert below", onClick: () => insertRowAt(selectedRef.row + 1) },
                  { label: "Auto-fit height", onClick: () => autoFitRow(selectedRef.row) },
                  { label: "Clear row", onClick: () => clearRowAt(selectedRef.row) },
                  { label: "Delete row", danger: true, disabled: activeSheet.rowCount <= 1, onClick: () => deleteRowAt(selectedRef.row) },
                ]}
                footer={
                  <label className="bf-sheet-sizeField">
                    <span>Height</span>
                    <input className="input" type="number" min="24" max="180" value={selectedRowHeight} onChange={(e) => setRowHeight(selectedRef.row, e.target.value)} />
                    <small>px</small>
                  </label>
                }
              />
              <SheetActionMenu
                label={`Column ${columnLabel(selectedRef.col)}`}
                items={[
                  { label: "Insert left", onClick: () => insertColumnAt(selectedRef.col) },
                  { label: "Insert right", onClick: () => insertColumnAt(selectedRef.col + 1) },
                  { label: "Auto-fit width", onClick: () => autoFitColumn(selectedRef.col) },
                  { label: "Clear column", onClick: () => clearColumnAt(selectedRef.col) },
                  { label: "Delete column", danger: true, disabled: activeSheet.columnCount <= 1, onClick: () => deleteColumnAt(selectedRef.col) },
                ]}
                footer={
                  <label className="bf-sheet-sizeField">
                    <span>Width</span>
                    <input className="input" type="number" min="60" max="420" value={selectedColWidth} onChange={(e) => setColumnWidth(selectedRef.col, e.target.value)} />
                    <small>px</small>
                  </label>
                }
              />
              <div ref={functionsRef} className="bf-sheet-functions">
                <button className="bf-sheet-toolButton" type="button" onClick={() => setFunctionsOpen((v) => !v)}>
                  <span className="bf-sheet-fxMark">fx</span> Functions
                </button>
                {functionsOpen ? (
                  <div className="bf-sheet-functionPopover">
                    {FUNCTION_GROUPS.map((group) => (
                      <div key={group.label} className="bf-sheet-functionGroup">
                        <div className="bf-sheet-functionLabel">{group.label}</div>
                        {group.items.map((item) => <MenuButton key={item.name} item={item} onSelect={insertFunction} />)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <SheetActionMenu
                label="Add"
                items={[
                  { label: "25 rows", hint: "Append to bottom", onClick: () => addRow(25) },
                  { label: "5 columns", hint: "Append to right", onClick: () => addColumn(5) },
                ]}
              />
            </>
          ) : (
            <span className="bf-sheet-readOnlyLabel">Preview</span>
          )}
        </div>
        <div className="bf-sheet-dimensions">{activeSheet.rowCount} × {activeSheet.columnCount}</div>
      </div>

      <div className="bf-sheet-formulaBar">
        <div className="bf-sheet-cellRef">{selectedCell}</div>
        <div className="bf-sheet-formulaFx" aria-hidden="true">fx</div>
        <input
          ref={formulaInputRef}
          className="input bf-sheet-formulaInput"
          value={formulaDraft}
          disabled={readOnly}
          onChange={(e) => { setFormulaDraft(e.target.value); setCellInput(selectedCell, e.target.value); }}
          onFocus={() => setEditingCell(selectedCell)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              inputRefs.current[selectedCell]?.focus();
            }
          }}
          placeholder="Enter a value or formula"
        />
      </div>

      {isMobile ? <div className="bf-sheet-mobileHint">Swipe to pan · tap a cell to edit · formulas live in the bar above.</div> : null}

      <div
        className="bf-sheet-gridViewport"
        onContextMenu={(event) => {
          if (event.target.closest?.(".bf-sheet-cell, .bf-sheet-rowHeader, .bf-sheet-columnHeader")) return;
          openContextMenu(event, [
            { label: "Add 25 rows", onClick: () => addRow(25) },
            { label: "Add 5 columns", onClick: () => addColumn(5) },
            { separator: true },
            { label: "Add sheet", onClick: addSheet },
          ]);
        }}
      >
        <div
          className="bf-sheet-grid"
          style={{
            gridTemplateColumns: `46px ${columnLabels.map((label) => `${Number(activeSheet.columnWidths?.[label] || DEFAULT_COL_WIDTH)}px`).join(" ")}`,
            minWidth: isMobile ? `${Math.max(680, activeSheet.columnCount * 92)}px` : "max-content",
          }}
        >
          <div className="bf-sheet-corner" />
          {columnLabels.map((label, colIndex) => (
            <button
              key={label}
              type="button"
              onClick={() => selectCell(cellKey(selectedRef.row, colIndex), false)}
              onDoubleClick={() => autoFitColumn(colIndex)}
              onContextMenu={(event) => {
                const ref = cellKey(selectedRef.row, colIndex);
                setSelectedCell(ref);
                setEditingCell(ref);
                openContextMenu(event, columnContextItems(colIndex));
              }}
              className={selectedRef.col === colIndex ? "bf-sheet-columnHeader is-selected" : "bf-sheet-columnHeader"}
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
                onContextMenu={(event) => {
                  const ref = cellKey(rowIndex, selectedRef.col);
                  setSelectedCell(ref);
                  setEditingCell(ref);
                  openContextMenu(event, rowContextItems(rowIndex));
                }}
                className={selectedRef.row === rowIndex ? "bf-sheet-rowHeader is-selected" : "bf-sheet-rowHeader"}
                style={{ height: rowHeight, minHeight: isMobile ? 34 : rowHeight }}
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
                  className={selected ? "bf-sheet-cell is-selected" : "bf-sheet-cell"}
                  onContextMenu={(event) => {
                    setSelectedCell(key);
                    setEditingCell(key);
                    setFormulaDraft(input);
                    openContextMenu(event, cellContextItems(rowIndex, colIndex));
                  }}
                  style={{ height: rowHeight, minHeight: isMobile ? 34 : rowHeight }}
                >
                  {readOnly ? (
                    <div className="bf-sheet-cellValue">{display}</div>
                  ) : (
                    <input
                      ref={(node) => { inputRefs.current[key] = node; }}
                      className="input bf-sheet-cellInput"
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
                      style={{ padding: isMobile ? "6px 8px" : "7px 9px" }}
                    />
                  )}
                </div>
              );
            });
            return [rowHeader, ...cells];
          })}
        </div>
      </div>

      <div className="bf-sheet-tabs">
        {doc.sheets.map((sheet) => {
          const active = sheet.id === activeSheet.id;
          const isRenaming = renamingSheetId === sheet.id && !readOnly;
          return (
            <div key={sheet.id} style={{ display: "flex", alignItems: "center" }}>
              {isRenaming ? (
                <input
                  className="input"
                  autoFocus
                  data-drive-native-undo
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
                  className={active ? "bf-sheet-tab is-active" : "bf-sheet-tab"}
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
                  onContextMenu={(event) => openContextMenu(event, [
                    { label: "Rename sheet", disabled: readOnly, onClick: () => { setSheetNameDraft(sheet.name); setRenamingSheetId(sheet.id); } },
                    { label: "Duplicate sheet", disabled: readOnly, onClick: () => duplicateSheet(sheet.id) },
                    { separator: true },
                    { label: "Delete sheet", danger: true, disabled: readOnly || doc.sheets.length <= 1, onClick: () => deleteSheet(sheet.id) },
                  ])}
                  title={readOnly ? sheet.name : `${sheet.name} · double click to rename`}

                >
                  {sheet.name}
                </button>
              )}
            </div>
          );
        })}
        {!readOnly ? (
          <button className="bf-sheet-addTab" type="button" onClick={addSheet}>＋ Sheet</button>
        ) : null}
      </div>
      <SheetContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
