import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { COMMON_PRICE_DATE } from '../constants/dates';

interface SeedProductData {
  id: string;
  internalCode: string;
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  concentration: string;
  concentrationUnit: string;
  laboratory: string;
  saleType: 'FREE_SALE' | 'PRESCRIPTION' | 'CONTROLLED_SUBSTANCE';
  minimumStock: number;
  categoryId: string;
  pharmaceuticalFormId: string | null;
  invimaRegistry: string | null;
  price: string;
  priceHistoryId: string;
  taxHistoryId: string;
  taxSchemeId: string;
  barcode: string;
  barcodeType: 'EAN13';
  barcodeId: string;
}

function buildProductList(): SeedProductData[] {
  return [
    { id: IDS.PROD_ACETAMINOFEN_500, internalCode: 'P001', commercialName: 'Acetaminofén 500mg', genericName: 'Acetaminofén', activePrinciple: 'Acetaminofén', concentration: '500', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'FREE_SALE', minimumStock: 50, categoryId: IDS.CAT_ANALGESICOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2012M-001234', price: '3500.00', priceHistoryId: IDS.PRICE_ACET_500, taxHistoryId: IDS.TAXH_ACET_500, taxSchemeId: IDS.TAX_IVA_5, barcode: '7702001012345', barcodeType: 'EAN13', barcodeId: 'bc_acet_500' },
    { id: IDS.PROD_IBUPROFENO_400, internalCode: 'P002', commercialName: 'Ibuprofeno 400mg', genericName: 'Ibuprofeno', activePrinciple: 'Ibuprofeno', concentration: '400', concentrationUnit: 'mg', laboratory: 'La Santé', saleType: 'FREE_SALE', minimumStock: 40, categoryId: IDS.CAT_ANTIINFLAMATORIOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2015M-002345', price: '2800.00', priceHistoryId: IDS.PRICE_IBU_400, taxHistoryId: IDS.TAXH_IBU_400, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012346', barcodeType: 'EAN13', barcodeId: 'bc_ibu_400' },
    { id: IDS.PROD_IBUPROFENO_800, internalCode: 'P003', commercialName: 'Ibuprofeno 800mg', genericName: 'Ibuprofeno', activePrinciple: 'Ibuprofeno', concentration: '800', concentrationUnit: 'mg', laboratory: 'La Santé', saleType: 'PRESCRIPTION', minimumStock: 30, categoryId: IDS.CAT_ANTIINFLAMATORIOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2015M-002346', price: '5200.00', priceHistoryId: IDS.PRICE_IBU_800, taxHistoryId: IDS.TAXH_IBU_800, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012353', barcodeType: 'EAN13', barcodeId: 'bc_ibu_800' },
    { id: IDS.PROD_DICLOFENACO_50, internalCode: 'P004', commercialName: 'Diclofenaco Sódico 50mg', genericName: 'Diclofenaco', activePrinciple: 'Diclofenaco Sódico', concentration: '50', concentrationUnit: 'mg', laboratory: 'MK', saleType: 'FREE_SALE', minimumStock: 35, categoryId: IDS.CAT_ANTIINFLAMATORIOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2013M-003456', price: '2100.00', priceHistoryId: IDS.PRICE_DIC_50, taxHistoryId: IDS.TAXH_DIC_50, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012360', barcodeType: 'EAN13', barcodeId: 'bc_dic_50' },
    { id: IDS.PROD_NAPROXENO_250, internalCode: 'P005', commercialName: 'Naproxeno Sódico 250mg', genericName: 'Naproxeno', activePrinciple: 'Naproxeno Sódico', concentration: '250', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'FREE_SALE', minimumStock: 30, categoryId: IDS.CAT_ANTIINFLAMATORIOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2014M-004567', price: '4100.00', priceHistoryId: IDS.PRICE_NAP_250, taxHistoryId: IDS.TAXH_NAP_250, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012377', barcodeType: 'EAN13', barcodeId: 'bc_nap_250' },
    { id: IDS.PROD_AMOXICILINA_500, internalCode: 'P006', commercialName: 'Amoxicilina 500mg', genericName: 'Amoxicilina', activePrinciple: 'Amoxicilina Trihidrato', concentration: '500', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'PRESCRIPTION', minimumStock: 60, categoryId: IDS.CAT_ANTIBIOTICOS, pharmaceuticalFormId: IDS.FORM_CAPSULA, invimaRegistry: 'INVIMA-2011M-005678', price: '1800.00', priceHistoryId: IDS.PRICE_AMOX_500, taxHistoryId: IDS.TAXH_AMOX_500, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012384', barcodeType: 'EAN13', barcodeId: 'bc_amox_500' },
    { id: IDS.PROD_AZITROMICINA_500, internalCode: 'P007', commercialName: 'Azitromicina 500mg', genericName: 'Azitromicina', activePrinciple: 'Azitromicina Dihidrato', concentration: '500', concentrationUnit: 'mg', laboratory: 'Pfizer', saleType: 'PRESCRIPTION', minimumStock: 25, categoryId: IDS.CAT_ANTIBIOTICOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2013M-006789', price: '12500.00', priceHistoryId: IDS.PRICE_AZIT_500, taxHistoryId: IDS.TAXH_AZIT_500, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012391', barcodeType: 'EAN13', barcodeId: 'bc_azit_500' },
    { id: IDS.PROD_CEFALEXINA_500, internalCode: 'P008', commercialName: 'Cefalexina 500mg', genericName: 'Cefalexina', activePrinciple: 'Cefalexina Monohidrato', concentration: '500', concentrationUnit: 'mg', laboratory: 'MK', saleType: 'PRESCRIPTION', minimumStock: 25, categoryId: IDS.CAT_ANTIBIOTICOS, pharmaceuticalFormId: IDS.FORM_CAPSULA, invimaRegistry: 'INVIMA-2012M-007890', price: '3400.00', priceHistoryId: IDS.PRICE_CEF_500, taxHistoryId: IDS.TAXH_CEF_500, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012407', barcodeType: 'EAN13', barcodeId: 'bc_cef_500' },
    { id: IDS.PROD_COTRIMOXAZOL, internalCode: 'P009', commercialName: 'Cotrimoxazol Forte', genericName: 'Trimetoprim + Sulfametoxazol', activePrinciple: 'Trimetoprim + Sulfametoxazol', concentration: '160+800', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'PRESCRIPTION', minimumStock: 20, categoryId: IDS.CAT_ANTIBIOTICOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2014M-008901', price: '2600.00', priceHistoryId: IDS.PRICE_COTRI, taxHistoryId: IDS.TAXH_COTRI, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012414', barcodeType: 'EAN13', barcodeId: 'bc_cotri' },
    { id: IDS.PROD_LORATADINA_10, internalCode: 'P010', commercialName: 'Loratadina 10mg', genericName: 'Loratadina', activePrinciple: 'Loratadina', concentration: '10', concentrationUnit: 'mg', laboratory: 'Bayer', saleType: 'FREE_SALE', minimumStock: 40, categoryId: IDS.CAT_ANTIHISTAMINICOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2010M-009012', price: '4500.00', priceHistoryId: IDS.PRICE_LORAT_10, taxHistoryId: IDS.TAXH_LORAT_10, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012421', barcodeType: 'EAN13', barcodeId: 'bc_lorat_10' },
    { id: IDS.PROD_CETIRIZINA_10, internalCode: 'P011', commercialName: 'Cetirizina 10mg', genericName: 'Cetirizina', activePrinciple: 'Cetirizina Diclorhidrato', concentration: '10', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'FREE_SALE', minimumStock: 35, categoryId: IDS.CAT_ANTIHISTAMINICOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2011M-010123', price: '3200.00', priceHistoryId: IDS.PRICE_CET_10, taxHistoryId: IDS.TAXH_CET_10, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012438', barcodeType: 'EAN13', barcodeId: 'bc_cet_10' },
    { id: IDS.PROD_DESLORATADINA_5, internalCode: 'P012', commercialName: 'Desloratadina 5mg', genericName: 'Desloratadina', activePrinciple: 'Desloratadina', concentration: '5', concentrationUnit: 'mg', laboratory: 'Bayer', saleType: 'FREE_SALE', minimumStock: 25, categoryId: IDS.CAT_ANTIHISTAMINICOS, pharmaceuticalFormId: IDS.FORM_JARABE, invimaRegistry: 'INVIMA-2012M-011234', price: '15000.00', priceHistoryId: IDS.PRICE_DESL_5, taxHistoryId: IDS.TAXH_DESL_5, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012445', barcodeType: 'EAN13', barcodeId: 'bc_desl_5' },
    { id: IDS.PROD_LOSARTAN_50, internalCode: 'P013', commercialName: 'Losartán 50mg', genericName: 'Losartán Potásico', activePrinciple: 'Losartán Potásico', concentration: '50', concentrationUnit: 'mg', laboratory: 'Tecnoquímicas', saleType: 'PRESCRIPTION', minimumStock: 50, categoryId: IDS.CAT_CARDIOVASCULAR, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2010M-012345', price: '6800.00', priceHistoryId: IDS.PRICE_LOS_50, taxHistoryId: IDS.TAXH_LOS_50, taxSchemeId: IDS.TAX_IVA_5, barcode: '7702002012452', barcodeType: 'EAN13', barcodeId: 'bc_los_50' },
    { id: IDS.PROD_ENALAPRIL_10, internalCode: 'P014', commercialName: 'Enalapril 10mg', genericName: 'Enalapril Maleato', activePrinciple: 'Enalapril Maleato', concentration: '10', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'PRESCRIPTION', minimumStock: 30, categoryId: IDS.CAT_CARDIOVASCULAR, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2010M-013456', price: '2900.00', priceHistoryId: IDS.PRICE_ENAL_10, taxHistoryId: IDS.TAXH_ENAL_10, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012469', barcodeType: 'EAN13', barcodeId: 'bc_enal_10' },
    { id: IDS.PROD_OMEPRAZOL_20, internalCode: 'P015', commercialName: 'Omeprazol 20mg', genericName: 'Omeprazol', activePrinciple: 'Omeprazol', concentration: '20', concentrationUnit: 'mg', laboratory: 'La Santé', saleType: 'FREE_SALE', minimumStock: 60, categoryId: IDS.CAT_GASTROINTESTINAL, pharmaceuticalFormId: IDS.FORM_CAPSULA, invimaRegistry: 'INVIMA-2011M-014567', price: '2200.00', priceHistoryId: IDS.PRICE_OME_20, taxHistoryId: IDS.TAXH_OME_20, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012476', barcodeType: 'EAN13', barcodeId: 'bc_ome_20' },
    { id: IDS.PROD_ESOMEPRAZOL_40, internalCode: 'P016', commercialName: 'Esomeprazol 40mg', genericName: 'Esomeprazol', activePrinciple: 'Esomeprazol Magnésico', concentration: '40', concentrationUnit: 'mg', laboratory: 'AstraZeneca', saleType: 'PRESCRIPTION', minimumStock: 20, categoryId: IDS.CAT_GASTROINTESTINAL, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2013M-015678', price: '18500.00', priceHistoryId: IDS.PRICE_ESO_40, taxHistoryId: IDS.TAXH_ESO_40, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012483', barcodeType: 'EAN13', barcodeId: 'bc_eso_40' },
    { id: IDS.PROD_RANITIDINA_150, internalCode: 'P017', commercialName: 'Ranitidina 150mg', genericName: 'Ranitidina', activePrinciple: 'Ranitidina Clorhidrato', concentration: '150', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'FREE_SALE', minimumStock: 35, categoryId: IDS.CAT_GASTROINTESTINAL, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2010M-016789', price: '1600.00', priceHistoryId: IDS.PRICE_RAN_150, taxHistoryId: IDS.TAXH_RAN_150, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012490', barcodeType: 'EAN13', barcodeId: 'bc_ran_150' },
    { id: IDS.PROD_SALBUTAMOL_100, internalCode: 'P018', commercialName: 'Salbutamol 100mcg/inh', genericName: 'Salbutamol', activePrinciple: 'Salbutamol Sulfato', concentration: '100', concentrationUnit: 'mcg', laboratory: 'GSK', saleType: 'PRESCRIPTION', minimumStock: 15, categoryId: IDS.CAT_RESPIRATORIO, pharmaceuticalFormId: IDS.FORM_SPRAY, invimaRegistry: 'INVIMA-2011M-017890', price: '22000.00', priceHistoryId: IDS.PRICE_SALB_100, taxHistoryId: IDS.TAXH_SALB_100, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012506', barcodeType: 'EAN13', barcodeId: 'bc_salb_100' },
    { id: IDS.PROD_DOLEX_FORTE, internalCode: 'P019', commercialName: 'Dolex Forte', genericName: 'Acetaminofén + Cafeína', activePrinciple: 'Acetaminofén + Cafeína', concentration: '500+65', concentrationUnit: 'mg', laboratory: 'GSK', saleType: 'FREE_SALE', minimumStock: 80, categoryId: IDS.CAT_ANALGESICOS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2009M-018901', price: '5600.00', priceHistoryId: IDS.PRICE_DOLEX, taxHistoryId: IDS.TAXH_DOLEX, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012513', barcodeType: 'EAN13', barcodeId: 'bc_dolex' },
    { id: IDS.PROD_VITAMINA_C_500, internalCode: 'P020', commercialName: 'Vitamina C 500mg', genericName: 'Ácido Ascórbico', activePrinciple: 'Ácido Ascórbico', concentration: '500', concentrationUnit: 'mg', laboratory: 'MK', saleType: 'FREE_SALE', minimumStock: 50, categoryId: IDS.CAT_VITAMINAS, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2014M-019012', price: '2800.00', priceHistoryId: IDS.PRICE_VITC_500, taxHistoryId: IDS.TAXH_VITC_500, taxSchemeId: IDS.TAX_EXENTO, barcode: '7702002012520', barcodeType: 'EAN13', barcodeId: 'bc_vitc_500' },
    { id: IDS.PROD_ALCOHOL_70, internalCode: 'P021', commercialName: 'Alcohol Antiséptico 70%', genericName: 'Alcohol Etílico', activePrinciple: 'Alcohol Etílico', concentration: '70', concentrationUnit: '%', laboratory: 'JGB', saleType: 'FREE_SALE', minimumStock: 30, categoryId: IDS.CAT_CUIDADO_PERSONAL, pharmaceuticalFormId: null, invimaRegistry: null, price: '8500.00', priceHistoryId: IDS.PRICE_ALCOHOL, taxHistoryId: IDS.TAXH_ALCOHOL, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012537', barcodeType: 'EAN13', barcodeId: 'bc_alcohol_70' },
    { id: IDS.PROD_GUANTES_LATEX_M, internalCode: 'P022', commercialName: 'Guantes de Látex Talla M', genericName: 'Guantes de Látex', activePrinciple: 'Látex Natural', concentration: 'N/A', concentrationUnit: '', laboratory: 'Protec', saleType: 'FREE_SALE', minimumStock: 100, categoryId: IDS.CAT_MATERIAL_CURACION, pharmaceuticalFormId: null, invimaRegistry: null, price: '12000.00', priceHistoryId: IDS.PRICE_GUANTES, taxHistoryId: IDS.TAXH_GUANTES, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012544', barcodeType: 'EAN13', barcodeId: 'bc_guantes_m' },
    { id: IDS.PROD_JERINGA_3ML, internalCode: 'P023', commercialName: 'Jeringa Desechable 3ml', genericName: 'Jeringa Desechable', activePrinciple: 'N/A', concentration: '3', concentrationUnit: 'ml', laboratory: 'BD', saleType: 'FREE_SALE', minimumStock: 200, categoryId: IDS.CAT_MATERIAL_CURACION, pharmaceuticalFormId: null, invimaRegistry: null, price: '800.00', priceHistoryId: IDS.PRICE_JERINGA, taxHistoryId: IDS.TAXH_JERINGA, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012551', barcodeType: 'EAN13', barcodeId: 'bc_jeringa_3ml' },
    { id: IDS.PROD_BAJALENGUAS, internalCode: 'P024', commercialName: 'Bajalenguas de Madera x100', genericName: 'Bajalenguas', activePrinciple: 'N/A', concentration: 'N/A', concentrationUnit: '', laboratory: 'Genérico', saleType: 'FREE_SALE', minimumStock: 50, categoryId: IDS.CAT_MATERIAL_CURACION, pharmaceuticalFormId: null, invimaRegistry: null, price: '4500.00', priceHistoryId: IDS.PRICE_BAJA, taxHistoryId: IDS.TAXH_BAJA, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012568', barcodeType: 'EAN13', barcodeId: 'bc_bajalenguas' },
    { id: IDS.PROD_GASA_ESTERIL, internalCode: 'P025', commercialName: 'Gasa Estéril 10x10cm x10', genericName: 'Gasa Estéril', activePrinciple: 'Algodón', concentration: 'N/A', concentrationUnit: '', laboratory: 'Protec', saleType: 'FREE_SALE', minimumStock: 40, categoryId: IDS.CAT_MATERIAL_CURACION, pharmaceuticalFormId: null, invimaRegistry: null, price: '6500.00', priceHistoryId: IDS.PRICE_GASA, taxHistoryId: IDS.TAXH_GASA, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012575', barcodeType: 'EAN13', barcodeId: 'bc_gasa' },
    // Controlled substance: opioid analgesic (Resolución 1478/2006)
    { id: IDS.PROD_TRAMADOL_50, internalCode: 'P026', commercialName: 'Tramadol HCl 50mg', genericName: 'Tramadol Clorhidrato', activePrinciple: 'Tramadol Clorhidrato', concentration: '50', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'CONTROLLED_SUBSTANCE', minimumStock: 20, categoryId: IDS.CAT_ANALGESICOS, pharmaceuticalFormId: IDS.FORM_CAPSULA, invimaRegistry: 'INVIMA-2015M-020123', price: '9800.00', priceHistoryId: IDS.PRICE_TRAMADOL_50, taxHistoryId: IDS.TAXH_TRAMADOL_50, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012582', barcodeType: 'EAN13', barcodeId: 'bc_tramadol_50' },
    // Controlled substance: benzodiazepine (Resolución 1478/2006)
    { id: IDS.PROD_CLONAZEPAM_2, internalCode: 'P027', commercialName: 'Clonazepam 2mg', genericName: 'Clonazepam', activePrinciple: 'Clonazepam', concentration: '2', concentrationUnit: 'mg', laboratory: 'Roche', saleType: 'CONTROLLED_SUBSTANCE', minimumStock: 15, categoryId: IDS.CAT_SISTEMA_NERVIOSO, pharmaceuticalFormId: IDS.FORM_TABLETA, invimaRegistry: 'INVIMA-2012M-021234', price: '14200.00', priceHistoryId: IDS.PRICE_CLONAZEPAM_2, taxHistoryId: IDS.TAXH_CLONAZEPAM_2, taxSchemeId: IDS.TAX_IVA_19, barcode: '7702002012599', barcodeType: 'EAN13', barcodeId: 'bc_clonazepam_2' },
  ];
}

async function seedProductBase(product: SeedProductData): Promise<void> {
  await prisma.product.upsert({
    where: { id: product.id },
    update: {
      commercialName: product.commercialName,
      genericName: product.genericName,
      saleType: product.saleType,
      categoryId: product.categoryId,
      pharmaceuticalFormId: product.pharmaceuticalFormId,
    },
    create: {
      id: product.id,
      internalCode: product.internalCode,
      commercialName: product.commercialName,
      genericName: product.genericName,
      activePrinciple: product.activePrinciple,
      concentration: product.concentration,
      concentrationUnit: product.concentrationUnit,
      laboratory: product.laboratory,
      saleType: product.saleType,
      minimumStock: product.minimumStock,
      isActive: true,
      categoryId: product.categoryId,
      pharmaceuticalFormId: product.pharmaceuticalFormId,
      invimaRegistry: product.invimaRegistry,
      createdById: IDS.USER_ADMIN,
    },
  });
}

async function seedProductPrice(product: SeedProductData): Promise<void> {
  await prisma.productPriceHistory.upsert({
    where: { id: product.priceHistoryId },
    update: { price: product.price },
    create: {
      id: product.priceHistoryId,
      productId: product.id,
      price: product.price,
      effectiveFrom: COMMON_PRICE_DATE,
      changedById: IDS.USER_ADMIN,
      changedAt: COMMON_PRICE_DATE,
      changeReason: 'Precio inicial de carga',
    },
  });

  await prisma.product.update({
    where: { id: product.id },
    data: { currentPriceId: product.priceHistoryId },
  });
}

async function seedProductTax(product: SeedProductData): Promise<void> {
  await prisma.productTaxHistory.upsert({
    where: { id: product.taxHistoryId },
    update: { taxSchemeId: product.taxSchemeId },
    create: {
      id: product.taxHistoryId,
      productId: product.id,
      taxSchemeId: product.taxSchemeId,
      effectiveFrom: COMMON_PRICE_DATE,
      changedById: IDS.USER_ADMIN,
      changedAt: COMMON_PRICE_DATE,
      changeReason: 'Asignación inicial de impuesto',
    },
  });

  await prisma.product.update({
    where: { id: product.id },
    data: { currentTaxHistoryId: product.taxHistoryId },
  });
}

async function seedProductBarcode(product: SeedProductData): Promise<void> {
  await prisma.productBarcode.upsert({
    where: { id: product.barcodeId },
    update: { barcode: product.barcode },
    create: {
      id: product.barcodeId,
      productId: product.id,
      barcode: product.barcode,
      barcodeType: product.barcodeType,
      isPrimary: true,
    },
  });
}

async function seedSingleProduct(product: SeedProductData): Promise<void> {
  await seedProductBase(product);
  await seedProductPrice(product);
  await seedProductTax(product);
  await seedProductBarcode(product);
}

export async function seedProducts(): Promise<void> {
  console.log('Seeding products...');
  const products = buildProductList();
  for (const product of products) {
    await seedSingleProduct(product);
  }
  console.log(`   ${products.length} products (${products.filter(p => p.saleType === 'CONTROLLED_SUBSTANCE').length} controlled substances)`);
}