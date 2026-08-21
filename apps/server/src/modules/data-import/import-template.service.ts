import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { ImportSourceFormat } from '@pharmacy/database';
import { ImportDefinitionRegistry } from './import-definition-registry';

export interface GeneratedTemplate {
  content: Buffer | string;
  contentType: string;
  fileName: string;
}

/**
 * Generates downloadable import templates per entity and format. Templates
 * contain only headers (plus a description sheet for Excel), never example
 * data, so a template imported as-is cannot create accidental records.
 */
@Injectable()
export class ImportTemplateService {
  constructor(private readonly registry: ImportDefinitionRegistry) {}

  async generateTemplate(
    entityKey: string,
    format: ImportSourceFormat,
  ): Promise<GeneratedTemplate> {
    const definition = this.registry.get<unknown, unknown>(entityKey);
    const headers = definition.columns.map((column) => column.label);

    switch (format) {
      case ImportSourceFormat.CSV:
        return {
          // Semicolon separator: the common CSV dialect in Colombia; the
          // parser auto-detects the delimiter regardless of what is used.
          // BOM so Excel opens the file as UTF-8.
          content: `\uFEFF${headers.join(';')}\n`,
          contentType: 'text/csv; charset=utf-8',
          fileName: `${entityKey}-import-template.csv`,
        };
      case ImportSourceFormat.XLSX:
        return this.generateExcelTemplate(
          definition.entityKey,
          headers,
          definition.columns,
        );
      case ImportSourceFormat.JSON:
        return {
          content: JSON.stringify({ headers, rows: [] }, null, 2),
          contentType: 'application/json; charset=utf-8',
          fileName: `${entityKey}-import-template.json`,
        };
    }
  }

  private async generateExcelTemplate(
    entityKey: string,
    headers: string[],
    columns: Array<{
      key: string;
      label: string;
      required: boolean;
      description: string;
    }>,
  ): Promise<GeneratedTemplate> {
    const workbook = new Workbook();

    const sheet = workbook.addWorksheet('Datos');
    sheet.addRow(headers).eachCell((cell) => {
      cell.font = { bold: true };
    });
    sheet.columns = headers.map((header, index) => ({
      header,
      width: Math.max(header.length + 4, 16),
      key: String(index),
    }));

    const instructions = workbook.addWorksheet('Instrucciones');
    instructions.addRow(['Columna', 'Obligatoria', 'Descripcion']);
    instructions.getRow(1).font = { bold: true };
    columns.forEach((column) => {
      instructions.addRow([
        column.label,
        column.required ? 'Si' : 'No',
        column.description,
      ]);
    });
    instructions.columns = [
      { header: 'Columna', width: 30, key: 'column' },
      { header: 'Obligatoria', width: 14, key: 'required' },
      { header: 'Descripcion', width: 60, key: 'description' },
    ];

    const content = await workbook.xlsx.writeBuffer();
    return {
      content: Buffer.from(content),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `${entityKey}-import-template.xlsx`,
    };
  }
}
