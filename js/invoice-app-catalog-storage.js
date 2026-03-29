/**
 * Catalog + company + settings in localStorage (shared shell + invoice-style templates).
 * Does not handle invoiceApp_globalData — see global-storage.js.
 * Save only writes keys present on the state object (so shell can omit customTerms).
 */
(function (global) {
  'use strict';

  const KEYS = {
    products: 'invoiceApp_products',
    clients: 'invoiceApp_clients',
    company: 'invoiceApp_company',
    settings: 'invoiceApp_settings',
    customTerms: 'invoiceApp_customTerms'
  };

  function getDefaultSettings() {
    return { currentMode: 'edit', autoSave: true, defaultCurrency: '£' };
  }

  function getDefaultProducts() {
    return [
      {
        id: 1,
        name: 'Example Product',
        category: 'product',
        icon: '📦',
        image: null,
        description: 'Sample product for demonstration',
        price: 0.0
      },
      {
        id: 2,
        name: 'Service Example',
        category: 'service',
        icon: '🔧',
        image: null,
        description: 'Sample service for demonstration',
        price: 0.0
      }
    ];
  }

  function getDefaultClients() {
    return [
      {
        clientId: 1,
        client: {
          name: 'John Smith',
          address: '123 Main Street',
          city: 'London, E1 1AA',
          phone: '+44 20 1234 5678',
          email: 'john.smith@email.com',
          type: 'Individual',
          status: 'active',
          notes: 'Regular customer, prefers morning deliveries'
        }
      },
      {
        clientId: 2,
        client: {
          name: 'Sarah Johnson',
          address: '456 High Road',
          city: 'Manchester, M1 1AA',
          phone: '+44 161 123 4567',
          email: 'sarah.j@email.com',
          type: 'Company',
          status: 'active',
          notes: 'Business client, office hours only'
        }
      }
    ];
  }

  function getDefaultCompany() {
    return {
      name: 'Your Company Name',
      address: 'Your Company Address',
      city: 'Your City, Postcode',
      phone: 'Your Phone Number',
      email: 'your.email@company.com',
      companyNumber: 'Your Company Number',
      vatNumber: 'Your VAT Number',
      bankName: 'Your Bank Name',
      accountName: 'Your Account Name',
      sortCode: 'Your Sort Code',
      account: 'Your Account Number',
      logo: null
    };
  }

  function parseJson(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function normalizeSettings(parsed) {
    const base = getDefaultSettings();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.assign({}, base, parsed);
    }
    return base;
  }

  function fallbackBundle(defaultProducts) {
    return {
      products: Array.isArray(defaultProducts) ? defaultProducts : getDefaultProducts(),
      clients: getDefaultClients(),
      company: getDefaultCompany(),
      settings: getDefaultSettings(),
      customTerms: []
    };
  }

  /**
   * @param {object} [options]
   * @param {Array} [options.defaultProducts] — e.g. statement template uses different defaults; omit for invoice/shell defaults.
   */
  function loadCatalogState(options) {
    options = options || {};
    const defaultProducts =
      Array.isArray(options.defaultProducts) ? options.defaultProducts : getDefaultProducts();

    try {
      const rawProducts = localStorage.getItem(KEYS.products);
      const products = parseJson(rawProducts, null);
      const productsOut = Array.isArray(products) ? products : defaultProducts;

      const rawClients = localStorage.getItem(KEYS.clients);
      const clients = parseJson(rawClients, null);
      const clientsOut = Array.isArray(clients) ? clients : getDefaultClients();

      const rawCompany = localStorage.getItem(KEYS.company);
      const company = parseJson(rawCompany, null);
      const companyOut =
        company && typeof company === 'object' && !Array.isArray(company)
          ? company
          : getDefaultCompany();

      const rawSettings = localStorage.getItem(KEYS.settings);
      const settingsOut = normalizeSettings(parseJson(rawSettings, null));

      const rawTerms = localStorage.getItem(KEYS.customTerms);
      let customTerms = parseJson(rawTerms, null);
      if (!Array.isArray(customTerms)) customTerms = [];

      return {
        products: productsOut,
        clients: clientsOut,
        company: companyOut,
        settings: settingsOut,
        customTerms
      };
    } catch (e) {
      console.error('InvoiceAppCatalogStorage loadCatalogState:', e);
      return fallbackBundle(defaultProducts);
    }
  }

  function saveCatalogState(state) {
    if (!state || typeof state !== 'object') return;
    try {
      if (Object.prototype.hasOwnProperty.call(state, 'products')) {
        localStorage.setItem(KEYS.products, JSON.stringify(state.products));
      }
      if (Object.prototype.hasOwnProperty.call(state, 'clients')) {
        localStorage.setItem(KEYS.clients, JSON.stringify(state.clients));
      }
      if (Object.prototype.hasOwnProperty.call(state, 'company')) {
        localStorage.setItem(KEYS.company, JSON.stringify(state.company));
      }
      if (Object.prototype.hasOwnProperty.call(state, 'settings')) {
        localStorage.setItem(KEYS.settings, JSON.stringify(state.settings));
      }
      if (Object.prototype.hasOwnProperty.call(state, 'customTerms')) {
        localStorage.setItem(KEYS.customTerms, JSON.stringify(state.customTerms));
      }
    } catch (e) {
      console.error('InvoiceAppCatalogStorage saveCatalogState:', e);
    }
  }

  function clearCatalogKeys() {
    Object.keys(KEYS).forEach(function (k) {
      localStorage.removeItem(KEYS[k]);
    });
  }

  global.InvoiceAppCatalogStorage = {
    KEYS: KEYS,
    getDefaultSettings: getDefaultSettings,
    getDefaultProducts: getDefaultProducts,
    getDefaultClients: getDefaultClients,
    getDefaultCompany: getDefaultCompany,
    loadCatalogState: loadCatalogState,
    saveCatalogState: saveCatalogState,
    clearCatalogKeys: clearCatalogKeys
  };
})(typeof window !== 'undefined' ? window : this);
