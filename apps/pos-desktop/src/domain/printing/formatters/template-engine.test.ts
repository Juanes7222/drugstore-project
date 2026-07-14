/**
 * Tests for the template engine — variable substitution in receipt templates.
 *
 * Verifies that `{{dot.separated.path}}` placeholders are resolved from a
 * VariableContext, that missing paths get a visible placeholder, and that
 * numbers/dates are formatted according to Spanish locale conventions.
 */
import { describe, expect, it } from "vitest";
import {
  resolveTemplateVariables,
  resolveHeaderLines,
  resolveFooterLines,
  buildResolvedReceipt,
} from "./template-engine";
import type { VariableContext } from "../printing-types";

describe("resolveTemplateVariables", () => {
  it("replaces a simple top-level path like {{client.name}}", () => {
    const context: VariableContext = { client: { name: "María López" } };
    const template = "Cliente: {{client.name}}";

    const result = resolveTemplateVariables(template, context);

    expect(result).toBe("Cliente: María López");
  });

  it("replaces a nested path like {{sale.totalAmount}}", () => {
    const context: VariableContext = {
      sale: { totalAmount: 1234.56, items: 3 },
    };
    const template = "Total: {{sale.totalAmount}} ({{sale.items}} artículos)";

    const result = resolveTemplateVariables(template, context);

    expect(result).not.toContain("{{sale.totalAmount}}");
    expect(result).not.toContain("{{sale.items}}");
    expect(result).toContain("artículos");
    expect(result).toMatch(/1\.?[0-9,\s]*234/);
  });

  it("replaces an unknown path with a bracketed placeholder", () => {
    const context: VariableContext = { client: { name: "Test" } };
    const template = "{{client.name}} {{missing.field}}";

    const result = resolveTemplateVariables(template, context);

    expect(result).toBe("Test [MISSING_FIELD]");
  });

  it("returns an empty string for an empty template", () => {
    const context: VariableContext = { sale: { total: 100 } };

    const result = resolveTemplateVariables("", context);

    expect(result).toBe("");
  });

  it("formats numeric values with es-CO locale", () => {
    const context: VariableContext = { sale: { total: 2500 } };
    const template = "${{sale.total}}";

    const result = resolveTemplateVariables(template, context);

    expect(result).not.toContain("{{sale.total}}");
    expect(result).toContain("2");
    expect(result).not.toContain("undefined");
  });

  it("formats Date values as a localized string", () => {
    const date = new Date(2025, 0, 15, 10, 30);
    const context: VariableContext = { sale: { createdAt: date } };
    const template = "Fecha: {{sale.createdAt}}";

    const result = resolveTemplateVariables(template, context);

    expect(result).not.toContain("{{sale.createdAt}}");
    expect(result).toContain("2025");
    expect(result).toMatch(/10:30|10:30/);
  });

  it("resolves variables nested under invoice", () => {
    const context: VariableContext = {
      invoice: {
        invoiceNumber: "FAC-001",
        cufeOfficial: "abc123cufe",
      },
    };
    const template = "Factura: {{invoice.invoiceNumber}} — CUFE: {{invoice.cufeOfficial}}";

    const result = resolveTemplateVariables(template, context);

    expect(result).toBe("Factura: FAC-001 — CUFE: abc123cufe");
  });

  it("resolves a template with multiple occurrences of the same path", () => {
    const context: VariableContext = { client: { name: "Carlos" } };
    const template = "{{client.name}} {{client.name}} {{client.name}}";

    const result = resolveTemplateVariables(template, context);

    expect(result).toBe("Carlos Carlos Carlos");
  });

  it("returns the original template when there are no placeholders", () => {
    const context: VariableContext = {};
    const template = "Plain text without variables";

    const result = resolveTemplateVariables(template, context);

    expect(result).toBe("Plain text without variables");
  });
});

describe("resolveHeaderLines", () => {
  it("resolves variables in each header line", () => {
    const context: VariableContext = {
      client: { name: "Ana" },
      sale: { id: "S-001" },
    };
    const lines = ["Cliente: {{client.name}}", "Venta: {{sale.id}}", "Gracias"];

    const result = resolveHeaderLines(lines, context);

    expect(result).toEqual(["Cliente: Ana", "Venta: S-001", "Gracias"]);
  });

  it("preserves lines without placeholders unchanged", () => {
    const context: VariableContext = {};
    const lines = ["Farmacia Salud", "---", "NIT: 123"];

    const result = resolveHeaderLines(lines, context);

    expect(result).toEqual(lines);
  });

  it("replaces missing variables with placeholder in header lines", () => {
    const context: VariableContext = {};
    const lines = ["{{client.name}}"];

    const result = resolveHeaderLines(lines, context);

    expect(result).toEqual(["[CLIENT_NAME]"]);
  });
});

describe("resolveFooterLines", () => {
  it("resolves variables in each footer line", () => {
    const context: VariableContext = {
      shift: { cashierName: "Pedro" },
    };
    const lines = ["Atendido por: {{shift.cashierName}}", "Gracias por su compra"];

    const result = resolveFooterLines(lines, context);

    expect(result).toEqual(["Atendido por: Pedro", "Gracias por su compra"]);
  });

  it("preserves lines without placeholders unchanged", () => {
    const context: VariableContext = {};
    const lines = ["¡Vuelva pronto!"];

    const result = resolveFooterLines(lines, context);

    expect(result).toEqual(["¡Vuelva pronto!"]);
  });
});

describe("buildResolvedReceipt", () => {
  it("returns header, body, and footer with all variables resolved", () => {
    const context: VariableContext = {
      client: { name: "Sofía" },
      sale: { total: 45000 },
    };
    const headerLines = ["Cliente: {{client.name}}"];
    const templateBody = "Total: ${{sale.total}}";
    const footerLines = ["Gracias"];

    const result = buildResolvedReceipt(headerLines, templateBody, footerLines, context);

    expect(result).toEqual({
      header: ["Cliente: Sofía"],
      body: expect.stringContaining("Total: $"),
      footer: ["Gracias"],
    });
    expect(result.body).not.toContain("{{sale.total}}");
  });

  it("handles empty header and footer arrays", () => {
    const context: VariableContext = {};
    const result = buildResolvedReceipt([], "Cuerpo", [], context);

    expect(result).toEqual({
      header: [],
      body: "Cuerpo",
      footer: [],
    });
  });
});
