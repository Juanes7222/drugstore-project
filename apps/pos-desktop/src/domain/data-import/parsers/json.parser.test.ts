/**
 * Unit tests for the JSON source parser: both accepted shapes (array of
 * objects, { headers, rows }) and the file-level failure modes.
 */
import { describe, expect, it } from "vitest";
import { parseJson } from "./json.parser";

const encoder = new TextEncoder();

const jsonBuffer = (text: string): ArrayBuffer => encoder.encode(text).buffer;

describe("parseJson", () => {
  it("parses an array of objects using the union of keys as headers", async () => {
    const table = await parseJson(
      jsonBuffer('[{"codigo":"P001","nombre":"A"},{"codigo":"P002"}]'),
    );

    expect(table.headers).toEqual(["codigo", "nombre"]);
    expect(table.rows).toEqual([
      { codigo: "P001", nombre: "A" },
      { codigo: "P002", nombre: "" },
    ]);
  });

  it("parses a { headers, rows } payload aligned by index", async () => {
    const payload = {
      headers: ["codigo", "nombre"],
      rows: [["P001", "A"], ["P002"]],
    };
    const table = await parseJson(jsonBuffer(JSON.stringify(payload)));

    expect(table.headers).toEqual(["codigo", "nombre"]);
    expect(table.rows).toEqual([
      { codigo: "P001", nombre: "A" },
      { codigo: "P002", nombre: "" },
    ]);
  });

  it("throws on an empty array", async () => {
    await expect(parseJson(jsonBuffer("[]"))).rejects.toThrow(
      /contains no rows/,
    );
  });

  it("throws when an array element is not an object", async () => {
    await expect(parseJson(jsonBuffer('[{"a":1},42]'))).rejects.toThrow(
      /must be an object/,
    );
  });

  it("throws on duplicate headers in a { headers, rows } payload", async () => {
    const payload = { headers: ["codigo", "codigo"], rows: [["1", "2"]] };
    await expect(parseJson(jsonBuffer(JSON.stringify(payload)))).rejects.toThrow(
      /Duplicate column headers/,
    );
  });

  it("throws when a rows element is not an array", async () => {
    const payload = { headers: ["codigo"], rows: [{ codigo: "P001" }] };
    await expect(parseJson(jsonBuffer(JSON.stringify(payload)))).rejects.toThrow(
      /must be an array aligned/,
    );
  });

  it("throws on malformed JSON", async () => {
    await expect(parseJson(jsonBuffer("{ not json"))).rejects.toThrow(
      /JSON file is invalid/,
    );
  });

  it("throws when the payload is neither an array nor a headers/rows object", async () => {
    await expect(parseJson(jsonBuffer('"just a string"'))).rejects.toThrow(
      /array of objects or an object with "headers"/,
    );
  });
});
