# Anexo Técnico FE V1.9 — Referencia rápida

Fuente: *Resolución 000165 del 01/11/2023 — Anexo técnico de la Factura Electrónica de Venta, Versión 1.9* (DIAN, 753 páginas).

---

## 1) Consumidor final — identificación estándar

Aplica para Invoice (FAK*), CreditNote (CAK*) y DebitNote (DAK*).

| Campo | XPath | Valor |
|---|---|---|
| `cbc:AdditionalAccountID` | `…/cac:AccountingCustomerParty/cbc:AdditionalAccountID` | `2` (Persona Natural) |
| `cbc:ID` en `PartyIdentification` | `…/Party/cac:PartyIdentification/cbc:ID` | `222222222222` |
| `@schemeName` del ID | mismo nodo | `13` |
| `@schemeID` (DV) | mismo nodo | **omitir** (no aplica porque schemeName ≠ 31) |
| `cbc:CompanyID` en `PartyTaxScheme` | `…/cac:PartyTaxScheme/cbc:CompanyID` | `222222222222` |
| `@schemeName` del CompanyID | mismo nodo | `13` |
| `@schemeID` del CompanyID | mismo nodo | **omitir** |
| `cbc:RegistrationName` | `…/cac:PartyTaxScheme/cbc:RegistrationName` | literal `consumidor final` |
| `cbc:TaxLevelCode` | `…/cac:PartyTaxScheme/cbc:TaxLevelCode` | `R-99-PN` |

Reglas relacionadas: si `AdditionalAccountID = "2"` y `PartyIdentification` se omite → **Notificación** (no rechazo), pero la DIAN documenta `222222222222` como la forma canónica.

---

## 2) Extensiones del XML (`ext:UBLExtensions`)

Mínimo 2 ocurrencias de `ext:UBLExtension`: una con `sts:DianExtensions` y otra con `ds:Signature` (FAB01/FAC01).

```
/Invoice/ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent
 ├── sts:DianExtensions                       (1..1, una sola ocurrencia)
 │   ├── sts:InvoiceControl
 │   │   ├── sts:InvoiceAuthorization         (N, 14)
 │   │   ├── sts:AuthorizationPeriod
 │   │   │   ├── cbc:StartDate               (F, 10)
 │   │   │   └── cbc:EndDate                 (F, 10)
 │   │   └── sts:AuthorizedInvoices
 │   │       ├── sts:Prefix                  (A, 0-4)  = sucursal
 │   │       ├── sts:From                    (N, 1-9)
 │   │       └── sts:To                      (N, 1-9)
 │   ├── sts:InvoiceSource
 │   │   └── cbc:IdentificationCode = "CO"
 │   │       @listAgencyID = "6"
 │   │       @listAgencyName = "United Nations Economic Commission for Europe"
 │   │       @listSchemeURI = "urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1"
 │   ├── sts:SoftwareProvider                ◄── PROVEEDOR TECNOLÓGICO
 │   │   ├── sts:ProviderID                  (NIT del PT sin DV, 3-15)
 │   │   │   @schemeAgencyID = "195"
 │   │   │   @schemeAgencyName = "CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"
 │   │   │   @schemeID = DV del NIT del PT
 │   │   │   @schemeName = "31"
 │   │   └── sts:softwareID                  (id software)
 │   │       @schemeAgencyID = "195"
 │   │       @schemeAgencyName = "CO, DIAN..."
 │   ├── sts:SoftwareSecurityCode            (A, 48)  ← huella DIAN
 │   │   @schemeAgencyID = "195"
 │   │   @schemeAgencyName = "CO, DIAN..."
 │   ├── sts:AuthorizationProvider           (NIT DIAN = 800197268)
 │   │   └── sts:AuthorizationProviderID
 │   │       @schemeAgencyID = "195"
 │   │       @schemeAgencyName = "CO, DIAN..."
 │   │       @schemeID = "4"                 (DV de la DIAN)
 │   │       @schemeName = "31"
 │   └── sts:QRCode
 │       "https://catalogo-vpfe.dian.gov.co/document/searchrch?documentkey={CUFE}"
 └── ds:Signature
```

Notas:
- `sts:DianExtensions` solo puede aparecer una vez (rechazo si se duplica).
- `SoftwareSecurityCode` (48 chars) ≠ `ClTec` del CUFE. La primera vive en el XML; la segunda se consulta por `GetNumberingRange`.
- `sts:Prefix` debe coincidir con el `cbc:ID` de la sucursal en `CorporateRegistrationScheme` (regla FAB10).

---

## 3) CUFE — fórmula de concatenación (SHA-384)

`@schemeName = "CUFE-SHA384"`. Hash hexadecimal de 96 caracteres.

```
CUFE = SHA-384( NumFac
              + FecFac
              + HorFac
              + ValFac
              + "01" + ValImp1     // IVA
              + "04" + ValImp2     // INC (si no aplica → 0.00)
              + "03" + ValImp3     // ICA (si no aplica → 0.00)
              + ValTot
              + NitOFE
              + NumAdq
              + ClTec
              + TipoAmbie )         // en el anexo aparece como "TipoAmbie" (typo)
```

`+` = concatenación de cadenas, sin separador.

### Variables y origen

| Variable | Significado | XPath / Origen |
|---|---|---|
| `NumFac` | Prefijo + número de factura | `/Invoice/cbc:ID` |
| `FecFac` | Fecha de emisión | `/Invoice/cbc:IssueDate/` |
| `HorFac` | Hora con offset GMT | `/Invoice/cbc:IssueTime/` |
| `ValFac` | Valor sin impuestos (2 dec truncados, sin separadores) | `/Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount/` |
| `ValImp1` | IVA (mismo formato; `0.00` si no aplica) | `TaxTotal[x]/cbc:TaxAmount` con `TaxScheme/cbc:ID = 01` |
| `ValImp2` | INC | `TaxTotal[y]/cbc:TaxAmount` con `TaxScheme/cbc:ID = 04` |
| `ValImp3` | ICA | `TaxTotal[z]/cbc:TaxAmount` con `TaxScheme/cbc:ID = 03` |
| `ValTot` | Total a pagar | `/Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount/` |
| `NitOFE` | NIT facturador sin DV | `/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID/` |
| `NumAdq` | ID adquiriente sin DV | `/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID/` |
| `ClTec` | Clave técnica del rango | **No en XML** — vía WS `GetNumberingRange` |
| `TipoAmbie` | Ambiente | `/Invoice/cbc:ProfileExecutionID` |

### Ejemplo de validación (pág. 657)

```
NumFac     = 323200000129
FecFac     = 2019-01-16
HorFac     = 10:53:10-05:00
ValFac     = 1500000.00
ValImp1    = 285000.00   (CodImp1 = "01")
ValImp2    = 0.00        (CodImp2 = "04")
ValImp3    = 0.00        (CodImp3 = "03")
ValTot     = 1785000.00
NitOFE     = 700085371
NumAdq     = 800199436
ClTec      = 693ff6f2a553c3646a063436fd4dd9ded0311471
TipoAmbie  = 1
```

Cadena:
```
3232000001292019-01-1610:53:10-05:001500000.0001285000.00040.00030.001785000.00700085371800199436693ff6f2a553c3646a063436fd4dd9ded03114711
```

CUFE:
```
8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4
```

### Gotchas de implementación

1. Formato numérico: **punto decimal**, **2 dígitos truncados** (no redondeados), sin separador de miles, sin símbolo.
2. NIT **sin DV** en `NitOFE` y `NumAdq` (DV va aparte en `@schemeID` cuando `@schemeName = 31`).
3. Orden de `TaxTotal`: `01 → 04 → 03`, no por orden de aparición.
4. Si un tributo no aplica, su `ValImp` se concatena como `0.00` y su `CodImp` igual se incluye (es literal fijo).
5. `ClTec` es la **única** pieza del CUFE que no vive en el XML.
6. `TipoAmbie` es typo en el documento; la variable real es `TipoAmbiente` y viene de `cbc:ProfileExecutionID`.
