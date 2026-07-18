// Categorías
const CAT_ANALGESICOS = 'cat_analgesicos' as const;
const CAT_ANTIBIOTICOS = 'cat_antibioticos' as const;
const CAT_ANTIINFLAMATORIOS = 'cat_antiinflamatorios' as const;
const CAT_ANTIHISTAMINICOS = 'cat_antihistaminicos' as const;
const CAT_CARDIOVASCULAR = 'cat_cardiovascular' as const;
const CAT_GASTROINTESTINAL = 'cat_gastrointestinal' as const;
const CAT_RESPIRATORIO = 'cat_respiratorio' as const;
const CAT_VITAMINAS = 'cat_vitaminas' as const;
const CAT_CUIDADO_PERSONAL = 'cat_cuidado_personal' as const;
const CAT_MATERIAL_CURACION = 'cat_material_curacion' as const;
const CAT_SISTEMA_NERVIOSO = 'cat_sistema_nervioso' as const;

// Formas farmacéuticas
const FORM_TABLETA = 'form_tableta' as const;
const FORM_CAPSULA = 'form_capsula' as const;
const FORM_JARABE = 'form_jarabe' as const;
const FORM_INYECTABLE = 'form_inyectable' as const;
const FORM_CREMA = 'form_crema' as const;
const FORM_OVULO = 'form_ovulo' as const;
const FORM_GOTAS = 'form_gotas' as const;
const FORM_SOBRE = 'form_sobre' as const;
const FORM_SPRAY = 'form_spray' as const;

// Esquemas de impuestos
const TAX_IVA_19 = 'tax_iva_19' as const;
const TAX_IVA_5 = 'tax_iva_5' as const;
const TAX_EXENTO = 'tax_exento' as const;

// Métodos de pago
const PAY_EFECTIVO = 'pay_efectivo' as const;
const PAY_TARJETA_DEBITO = 'pay_tarjeta_debito' as const;
const PAY_TARJETA_CREDITO = 'pay_tarjeta_credito' as const;
const PAY_TRANSFERENCIA = 'pay_transferencia' as const;
const PAY_BOTON_PSE = 'pay_boton_pse' as const;
const PAY_NEQUI = 'pay_nequi' as const;
const PAY_DAVIPLATA = 'pay_daviplata' as const;

// Clasificaciones de clientes
const CLASS_PARTICULAR = 'class_particular' as const;
const CLASS_FRECUENTE = 'class_frecuente' as const;
const CLASS_INSTITUCIONAL = 'class_institucional' as const;

// Estaciones de trabajo
const WS_PRINCIPAL = 'ws_principal' as const;
const WS_SECUNDARIA = 'ws_secundaria' as const;

// Usuarios
const USER_ADMIN = 'user_admin' as const;
const USER_CASHIER1 = 'user_cashier1' as const;
const USER_CASHIER2 = 'user_cashier2' as const;
const USER_INVENTORY = 'user_inventory' as const;
const USER_ACCOUNTANT = 'user_accountant' as const;

// Proveedores
const SUP_DISFARMA = 'sup_disfarma' as const;
const SUP_COLVAN = 'sup_colvan' as const;
const SUP_CRUZ_VERDE = 'sup_cruz_verde' as const;

// Clientes
const CLIENT_JUAN = 'client_juan' as const;
const CLIENT_MARIA = 'client_maria' as const;
const CLIENT_CARLOS = 'client_carlos' as const;
const CLIENT_ANDREA = 'client_andrea' as const;
const CLIENT_PEDRO = 'client_pedro' as const;
const CLIENT_LAURA = 'client_laura' as const;
const CLIENT_DIEGO = 'client_diego' as const;
const CLIENT_SOFIA = 'client_sofia' as const;
const CLIENT_CLINICA_SAN_JOSE = 'client_clinica_san_jose' as const;
const CLIENT_HOGAR_GERIATRICO = 'client_hogar_geriatrico' as const;

const PROD_TRAMADOL_50 = 'prod_tramadol_50' as const;
const PROD_CLONAZEPAM_2 = 'prod_clonazepam_2' as const;

// Ventas
const SALE_CLOSED_001 = 'sale_closed_001' as const;
const SALE_CLOSED_002 = 'sale_closed_002' as const;
const SALE_OPEN_001 = 'sale_open_001' as const;

// Conteo físico y ajustes
const PHYS_COUNT_001 = 'phys_count_001' as const;
const ADJ_DOC_001 = 'adj_doc_001' as const;

// Prescripciones médicas
const PRESC_SALE1_IT = 'presc_sale1_losartan' as const;
const PRESC_SALE2_AMOX = 'presc_sale2_amox' as const;

// Devolución de cliente
const RETURN_CLOSED_001 = 'return_closed_001' as const;

// Cola de sincronización
const SYNC_SALE_001 = 'sync_sale_001' as const;
const SYNC_SALE_002 = 'sync_sale_002' as const;
const SYNC_CLIENT_001 = 'sync_client_001' as const;

// Órdenes de compra
const PO_DISFARMA_001 = 'po_disfarma_001' as const;
const PO_COLVAN_001 = 'po_colvan_001' as const;

// Configuración fiscal DIAN
const FISCAL_ISSUER = 'fiscal_issuer_default' as const;
const TECH_PROVIDER = 'tech_provider_default' as const;
const RESOLUTION_INVOICE = 'res_invoice_001' as const;
const RESOLUTION_POS = 'res_pos_001' as const;
const ALLOC_INVOICE_WS1 = 'alloc_invoice_ws1' as const;
const ALLOC_POS_WS1 = 'alloc_pos_ws1' as const;
const ALLOC_INVOICE_WS2 = 'alloc_invoice_ws2' as const;

// Productos
const PROD_ACETAMINOFEN_500 = 'prod_acetaminofen_500' as const;
const PROD_IBUPROFENO_400 = 'prod_ibuprofeno_400' as const;
const PROD_IBUPROFENO_800 = 'prod_ibuprofeno_800' as const;
const PROD_DICLOFENACO_50 = 'prod_diclofenaco_50' as const;
const PROD_NAPROXENO_250 = 'prod_naproxeno_250' as const;
const PROD_AMOXICILINA_500 = 'prod_amoxicilina_500' as const;
const PROD_AZITROMICINA_500 = 'prod_azitromicina_500' as const;
const PROD_CEFALEXINA_500 = 'prod_cefalexina_500' as const;
const PROD_COTRIMOXAZOL = 'prod_cotrimoxazol' as const;
const PROD_LORATADINA_10 = 'prod_loratadina_10' as const;
const PROD_CETIRIZINA_10 = 'prod_cetirizina_10' as const;
const PROD_DESLORATADINA_5 = 'prod_desloratadina_5' as const;
const PROD_LOSARTAN_50 = 'prod_losartan_50' as const;
const PROD_ENALAPRIL_10 = 'prod_enalapril_10' as const;
const PROD_OMEPRAZOL_20 = 'prod_omeprazol_20' as const;
const PROD_ESOMEPRAZOL_40 = 'prod_esomeprazol_40' as const;
const PROD_RANITIDINA_150 = 'prod_ranitidina_150' as const;
const PROD_SALBUTAMOL_100 = 'prod_salbutamol_100' as const;
const PROD_DOLEX_FORTE = 'prod_dolex_forte' as const;
const PROD_VITAMINA_C_500 = 'prod_vitamina_c_500' as const;
const PROD_ALCOHOL_70 = 'prod_alcohol_70' as const;
const PROD_GUANTES_LATEX_M = 'prod_guantes_latex_m' as const;
const PROD_JERINGA_3ML = 'prod_jeringa_3ml' as const;
const PROD_BAJALENGUAS = 'prod_bajalenguas' as const;
const PROD_GASA_ESTERIL = 'prod_gasa_esteril' as const;

const BC_TRAMADOL_50 = 'bc_tramadol_50' as const;
const BC_CLONAZEPAM_2 = 'bc_clonazepam_2' as const;

const PRICE_TRAMADOL_50 = 'price_tramadol_50' as const;
const PRICE_CLONAZEPAM_2 = 'price_clonazepam_2' as const;

// Historiales de precios
const PRICE_ACET_500 = 'price_acet_500' as const;
const PRICE_IBU_400 = 'price_ibu_400' as const;
const PRICE_IBU_800 = 'price_ibu_800' as const;
const PRICE_DIC_50 = 'price_dic_50' as const;
const PRICE_NAP_250 = 'price_nap_250' as const;
const PRICE_AMOX_500 = 'price_amox_500' as const;
const PRICE_AZIT_500 = 'price_azit_500' as const;
const PRICE_CEF_500 = 'price_cef_500' as const;
const PRICE_COTRI = 'price_cotri' as const;
const PRICE_LORAT_10 = 'price_lorat_10' as const;
const PRICE_CET_10 = 'price_cet_10' as const;
const PRICE_DESL_5 = 'price_desl_5' as const;
const PRICE_LOS_50 = 'price_los_50' as const;
const PRICE_ENAL_10 = 'price_enal_10' as const;
const PRICE_OME_20 = 'price_ome_20' as const;
const PRICE_ESO_40 = 'price_eso_40' as const;
const PRICE_RAN_150 = 'price_ran_150' as const;
const PRICE_SALB_100 = 'price_salb_100' as const;
const PRICE_DOLEX = 'price_dolex' as const;
const PRICE_VITC_500 = 'price_vitc_500' as const;
const PRICE_ALCOHOL = 'price_alcohol' as const;
const PRICE_GUANTES = 'price_guantes' as const;
const PRICE_JERINGA = 'price_jeringa' as const;
const PRICE_BAJA = 'price_baja' as const;
const PRICE_GASA = 'price_gasa' as const;

const TAXH_TRAMADOL_50 = 'taxh_tramadol_50' as const;
const TAXH_CLONAZEPAM_2 = 'taxh_clonazepam_2' as const;

// Historiales de impuestos
const TAXH_ACET_500 = 'taxh_acet_500' as const;
const TAXH_IBU_400 = 'taxh_ibu_400' as const;
const TAXH_IBU_800 = 'taxh_ibu_800' as const;
const TAXH_DIC_50 = 'taxh_dic_50' as const;
const TAXH_NAP_250 = 'taxh_nap_250' as const;
const TAXH_AMOX_500 = 'taxh_amox_500' as const;
const TAXH_AZIT_500 = 'taxh_azit_500' as const;
const TAXH_CEF_500 = 'taxh_cef_500' as const;
const TAXH_COTRI = 'taxh_cotri' as const;
const TAXH_LORAT_10 = 'taxh_lorat_10' as const;
const TAXH_CET_10 = 'taxh_cet_10' as const;
const TAXH_DESL_5 = 'taxh_desl_5' as const;
const TAXH_LOS_50 = 'taxh_los_50' as const;
const TAXH_ENAL_10 = 'taxh_enal_10' as const;
const TAXH_OME_20 = 'taxh_ome_20' as const;
const TAXH_ESO_40 = 'taxh_eso_40' as const;
const TAXH_RAN_150 = 'taxh_ran_150' as const;
const TAXH_SALB_100 = 'taxh_salb_100' as const;
const TAXH_DOLEX = 'taxh_dolex' as const;
const TAXH_VITC_500 = 'taxh_vitc_500' as const;
const TAXH_ALCOHOL = 'taxh_alcohol' as const;
const TAXH_GUANTES = 'taxh_guantes' as const;
const TAXH_JERINGA = 'taxh_jeringa' as const;
const TAXH_BAJA = 'taxh_baja' as const;
const TAXH_GASA = 'taxh_gasa' as const;

const LOT_TRAMADOL_001 = 'lot_tramadol_001' as const;
const LOT_CLONAZEPAM_001 = 'lot_clonazepam_001' as const;

// Lotes
const LOT_ACET_001 = 'lot_acet_001' as const;
const LOT_IBU_001 = 'lot_ibu_001' as const;
const LOT_IBU_002 = 'lot_ibu_002' as const;
const LOT_DIC_001 = 'lot_dic_001' as const;
const LOT_NAP_001 = 'lot_nap_001' as const;
const LOT_AMOX_001 = 'lot_amox_001' as const;
const LOT_AZIT_001 = 'lot_azit_001' as const;
const LOT_CEF_001 = 'lot_cef_001' as const;
const LOT_COTRI_001 = 'lot_cotri_001' as const;
const LOT_LORAT_001 = 'lot_lorat_001' as const;
const LOT_CET_001 = 'lot_cet_001' as const;
const LOT_DESL_001 = 'lot_desl_001' as const;
const LOT_LOS_001 = 'lot_los_001' as const;
const LOT_ENAL_001 = 'lot_enal_001' as const;
const LOT_OME_001 = 'lot_ome_001' as const;
const LOT_ESO_001 = 'lot_eso_001' as const;
const LOT_RAN_001 = 'lot_ran_001' as const;
const LOT_SALB_001 = 'lot_salb_001' as const;
const LOT_DOLEX_001 = 'lot_dolex_001' as const;
const LOT_VITC_001 = 'lot_vitc_001' as const;
const LOT_ALCOHOL_001 = 'lot_alcohol_001' as const;
const LOT_GUANTES_001 = 'lot_guantes_001' as const;
const LOT_JERINGA_001 = 'lot_jeringa_001' as const;
const LOT_BAJA_001 = 'lot_baja_001' as const;
const LOT_GASA_001 = 'lot_gasa_001' as const;

// Arqueos de caja
const SHIFT_OPEN = 'shift_open' as const;
const SHIFT_CLOSED_YESTERDAY = 'shift_closed_yesterday' as const;
const SHIFT_COUNT_CLOSED_1 = 'shiftcount_closed_1' as const;

export const IDS = {
  CAT_ANALGESICOS,
  CAT_ANTIBIOTICOS,
  CAT_ANTIINFLAMATORIOS,
  CAT_ANTIHISTAMINICOS,
  CAT_CARDIOVASCULAR,
  CAT_GASTROINTESTINAL,
  CAT_RESPIRATORIO,
  CAT_VITAMINAS,
  CAT_CUIDADO_PERSONAL,
  CAT_MATERIAL_CURACION,
  CAT_SISTEMA_NERVIOSO,
  FORM_TABLETA,
  FORM_CAPSULA,
  FORM_JARABE,
  FORM_INYECTABLE,
  FORM_CREMA,
  FORM_OVULO,
  FORM_GOTAS,
  FORM_SOBRE,
  FORM_SPRAY,
  TAX_IVA_19,
  TAX_IVA_5,
  TAX_EXENTO,
  PAY_EFECTIVO,
  PAY_TARJETA_DEBITO,
  PAY_TARJETA_CREDITO,
  PAY_TRANSFERENCIA,
  PAY_BOTON_PSE,
  PAY_NEQUI,
  PAY_DAVIPLATA,
  CLASS_PARTICULAR,
  CLASS_FRECUENTE,
  CLASS_INSTITUCIONAL,
  WS_PRINCIPAL,
  WS_SECUNDARIA,
  USER_ADMIN,
  USER_CASHIER1,
  USER_CASHIER2,
  USER_INVENTORY,
  USER_ACCOUNTANT,
  SUP_DISFARMA,
  SUP_COLVAN,
  SUP_CRUZ_VERDE,
  CLIENT_JUAN,
  CLIENT_MARIA,
  CLIENT_CARLOS,
  CLIENT_ANDREA,
  CLIENT_PEDRO,
  CLIENT_LAURA,
  CLIENT_DIEGO,
  CLIENT_SOFIA,
  CLIENT_CLINICA_SAN_JOSE,
  CLIENT_HOGAR_GERIATRICO,
  PROD_ACETAMINOFEN_500,
  PROD_IBUPROFENO_400,
  PROD_IBUPROFENO_800,
  PROD_DICLOFENACO_50,
  PROD_NAPROXENO_250,
  PROD_AMOXICILINA_500,
  PROD_AZITROMICINA_500,
  PROD_CEFALEXINA_500,
  PROD_COTRIMOXAZOL,
  PROD_LORATADINA_10,
  PROD_CETIRIZINA_10,
  PROD_DESLORATADINA_5,
  PROD_LOSARTAN_50,
  PROD_ENALAPRIL_10,
  PROD_OMEPRAZOL_20,
  PROD_ESOMEPRAZOL_40,
  PROD_RANITIDINA_150,
  PROD_SALBUTAMOL_100,
  PROD_DOLEX_FORTE,
  PROD_VITAMINA_C_500,
  PROD_ALCOHOL_70,
  PROD_GUANTES_LATEX_M,
  PROD_JERINGA_3ML,
  PROD_BAJALENGUAS,
  PROD_GASA_ESTERIL,
  PROD_TRAMADOL_50,
  PROD_CLONAZEPAM_2,
  BC_TRAMADOL_50,
  BC_CLONAZEPAM_2,
  SALE_CLOSED_001,
  SALE_CLOSED_002,
  SALE_OPEN_001,
  PHYS_COUNT_001,
  ADJ_DOC_001,
  PRESC_SALE1_IT,
  PRESC_SALE2_AMOX,
  RETURN_CLOSED_001,
  SYNC_SALE_001,
  SYNC_SALE_002,
  SYNC_CLIENT_001,
  PO_DISFARMA_001,
  PO_COLVAN_001,
  FISCAL_ISSUER,
  TECH_PROVIDER,
  RESOLUTION_INVOICE,
  RESOLUTION_POS,
  ALLOC_INVOICE_WS1,
  ALLOC_POS_WS1,
  ALLOC_INVOICE_WS2,
  PRICE_ACET_500,
  PRICE_IBU_400,
  PRICE_IBU_800,
  PRICE_DIC_50,
  PRICE_NAP_250,
  PRICE_AMOX_500,
  PRICE_AZIT_500,
  PRICE_CEF_500,
  PRICE_COTRI,
  PRICE_LORAT_10,
  PRICE_CET_10,
  PRICE_DESL_5,
  PRICE_LOS_50,
  PRICE_ENAL_10,
  PRICE_OME_20,
  PRICE_ESO_40,
  PRICE_RAN_150,
  PRICE_SALB_100,
  PRICE_DOLEX,
  PRICE_VITC_500,
  PRICE_ALCOHOL,
  PRICE_GUANTES,
  PRICE_JERINGA,
  PRICE_BAJA,
  PRICE_GASA,
  PRICE_TRAMADOL_50,
  PRICE_CLONAZEPAM_2,
  TAXH_ACET_500,
  TAXH_IBU_400,
  TAXH_IBU_800,
  TAXH_DIC_50,
  TAXH_NAP_250,
  TAXH_AMOX_500,
  TAXH_AZIT_500,
  TAXH_CEF_500,
  TAXH_COTRI,
  TAXH_LORAT_10,
  TAXH_CET_10,
  TAXH_DESL_5,
  TAXH_LOS_50,
  TAXH_ENAL_10,
  TAXH_OME_20,
  TAXH_ESO_40,
  TAXH_RAN_150,
  TAXH_SALB_100,
  TAXH_DOLEX,
  TAXH_VITC_500,
  TAXH_ALCOHOL,
  TAXH_GUANTES,
  TAXH_JERINGA,
  TAXH_BAJA,
  TAXH_GASA,
  TAXH_TRAMADOL_50,
  TAXH_CLONAZEPAM_2,
  LOT_ACET_001,
  LOT_IBU_001,
  LOT_IBU_002,
  LOT_DIC_001,
  LOT_NAP_001,
  LOT_AMOX_001,
  LOT_AZIT_001,
  LOT_CEF_001,
  LOT_COTRI_001,
  LOT_LORAT_001,
  LOT_CET_001,
  LOT_DESL_001,
  LOT_LOS_001,
  LOT_ENAL_001,
  LOT_OME_001,
  LOT_ESO_001,
  LOT_RAN_001,
  LOT_SALB_001,
  LOT_DOLEX_001,
  LOT_VITC_001,
  LOT_ALCOHOL_001,
  LOT_GUANTES_001,
  LOT_JERINGA_001,
  LOT_BAJA_001,
  LOT_GASA_001,
  LOT_TRAMADOL_001,
  LOT_CLONAZEPAM_001,
  SHIFT_OPEN,
  SHIFT_CLOSED_YESTERDAY,
  SHIFT_COUNT_CLOSED_1,
} as const;