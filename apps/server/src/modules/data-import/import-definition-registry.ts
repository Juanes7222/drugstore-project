import { Injectable } from '@nestjs/common';
import type { ImportColumnMeta } from '@pharmacy/shared-validation';
import { ImportDefinition } from './import-definition';
import { ProductImportDefinition } from './product-import.definition';
import { ClientImportDefinition } from './client-import.definition';
import { ImportDefinitionNotFoundException } from './exceptions/import-definition-not-found.exception';

/** Registry of importable entities; the controller exposes it as metadata. */
@Injectable()
export class ImportDefinitionRegistry {
  private readonly definitionsByKey = new Map<
    string,
    ImportDefinition<unknown, unknown>
  >();

  constructor(
    productDefinition: ProductImportDefinition,
    clientDefinition: ClientImportDefinition,
  ) {
    for (const definition of [productDefinition, clientDefinition]) {
      this.definitionsByKey.set(definition.entityKey, definition);
    }
  }

  get<TInput, TCreated>(entityKey: string): ImportDefinition<TInput, TCreated> {
    const definition = this.definitionsByKey.get(entityKey);
    if (!definition) {
      throw new ImportDefinitionNotFoundException(entityKey);
    }
    return definition as ImportDefinition<TInput, TCreated>;
  }

  list(): Array<{
    entityKey: string;
    entityLabel: string;
    columns: ImportColumnMeta[];
  }> {
    return [...this.definitionsByKey.values()].map((definition) => ({
      entityKey: definition.entityKey,
      entityLabel: definition.entityLabel,
      columns: definition.columns,
    }));
  }
}
