/**
 * Unit tests for the CSV source parser. Real byte buffers exercise the
 * text-decoding and header-validation paths end to end.
 */
import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.parser";
import { ImportFileInvalidException } from "../exceptions";

const encoder = new TextEncoder();

const csvBuffer = (text: string): ArrayBuffer => encoder.encode(text).buffer;

describe("parseCsv", () => {
  it("throws on an empty file", async () => {
    await expect(parseCsv(csvBuffer(""))).rejects.toBeInstanceOf(
      ImportFileInvalidException,
    );
    await expect(parseCsv(csvBuffer("  \n \n"))).rejects.toBeInstanceOf(
      ImportFileInvalidException,
    );
  });

  it("throws when the first row has no header", async () => {
    // A single delimiter-only line is non-blank (survives the empty check)
    // but yields a header row of empty cells.
    await expect(parseCsv(csvBuffer(","))).rejects.toThrow(
      /no header row/,
    );
  });

  it("throws when a header column name is empty", async () => {
    const text = "codigo,nombre,\n1,a,2";
    await expect(parseCsv(csvBuffer(text))).rejects.toThrow(
      /empty column names/,
    );
  });

  it("throws when headers are duplicated", async () => {
    const text = "codigo,codigo\n1,2";
    await expect(parseCsv(csvBuffer(text))).rejects.toThrow(
      /Duplicate column headers/,
    );
  });

  it("keeps cells as raw strings and fills missing cells with empty strings", async () => {
    const text = "codigo,nombre,precio\n1,Acetaminofen,\n2,,12500.50";
    const table = await parseCsv(csvBuffer(text));

    expect(table.headers).toEqual(["codigo", "nombre", "precio"]);
    expect(table.rows).toEqual([
      { codigo: "1", nombre: "Acetaminofen", precio: "" },
      { codigo: "2", nombre: "", precio: "12500.50" },
    ]);
    expect(table.warnings).toEqual([]);
  });

  it("decodes CP1252 bytes without a BOM via the Latin-1 fallback", async () => {
    // "Código" in CP1252 — 0xF3 is invalid UTF-8, forcing the fallback.
    const bytes = [
      0x43, 0xf3, 0x64, 0x69, 0x67, 0x6f, 0x0a, 0x50, 0x30, 0x30, 0x31,
    ];
    const table = await parseCsv(Uint8Array.from(bytes).buffer);

    expect(table.headers).toEqual(["Código"]);
    expect(table.rows).toEqual([{ Código: "P001" }]);
  });

  it("strips a UTF-8 BOM from the header row", async () => {
    const text = "\uFEFFcodigo,nombre\n1,a";
    const table = await parseCsv(csvBuffer(text));
    expect(table.headers).toEqual(["codigo", "nombre"]);
  });

  it("surfaces papaparse issues as warnings without failing the file", async () => {
    // An unclosed quote is a recoverable parse issue in PapaParse.
    const text = 'codigo,nombre\n"unclosed,value';
    const table = await parseCsv(csvBuffer(text));

    expect(table.headers).toEqual(["codigo", "nombre"]);
    expect(table.warnings.length).toBeGreaterThan(0);
    expect(table.warnings[0]).toMatch(/CSV parse issue/);
  });
});
