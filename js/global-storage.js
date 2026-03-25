/**
 * Global Storage Manager - Shared storage for invoices and statements
 * Same storage slot, separate counters for invoice vs statement numbers.
 * Uses same keys as reference (FreeGUAP) so this upgrade picks up existing browser storage.
 */
(function () {
  "use strict";

  const GLOBAL_KEY = "invoiceApp_globalData";

  function getGlobalData() {
    try {
      const raw = localStorage.getItem(GLOBAL_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return {
        nextInvoiceNumber: data.nextInvoiceNumber != null ? data.nextInvoiceNumber : 1,
        nextStatementNumber: data.nextStatementNumber != null ? data.nextStatementNumber : 1,
        currentInvoice: data.currentInvoice || null,
        savedInvoices: Array.isArray(data.savedInvoices) ? data.savedInvoices : [],
        lastSaved: data.lastSaved || null
      };
    } catch (e) {
      console.error("GlobalStorage getGlobalData error:", e);
      return {
        nextInvoiceNumber: 1,
        nextStatementNumber: 1,
        currentInvoice: null,
        savedInvoices: [],
        lastSaved: null
      };
    }
  }

  function saveGlobalData(data) {
    try {
      const existing = getGlobalData();
      const merged = {
        nextInvoiceNumber: data.nextInvoiceNumber != null ? data.nextInvoiceNumber : existing.nextInvoiceNumber,
        nextStatementNumber: data.nextStatementNumber != null ? data.nextStatementNumber : existing.nextStatementNumber,
        currentInvoice: data.currentInvoice !== undefined ? data.currentInvoice : existing.currentInvoice,
        savedInvoices: data.savedInvoices !== undefined ? data.savedInvoices : existing.savedInvoices,
        lastSaved: data.lastSaved !== undefined ? data.lastSaved : existing.lastSaved
      };
      localStorage.setItem(GLOBAL_KEY, JSON.stringify(merged));
    } catch (e) {
      console.error("GlobalStorage saveGlobalData error:", e);
    }
  }

  function getInvoiceData() {
    const g = getGlobalData();
    return g.currentInvoice;
  }

  function saveInvoiceData(data) {
    const g = getGlobalData();
    g.currentInvoice = data;
    g.lastSaved = new Date().toISOString();
    saveGlobalData(g);
  }

  function formatInvoiceNumber(num) {
    return String(num).padStart(5, "0");
  }

  function formatStatementNumber(num) {
    return String(num).padStart(5, "0");
  }

  function getNextInvoiceNumber() {
    const g = getGlobalData();
    return g.nextInvoiceNumber;
  }

  function getNextStatementNumber() {
    const g = getGlobalData();
    return g.nextStatementNumber;
  }

  function advanceInvoiceNumberIfUsed(usedNo) {
    const g = getGlobalData();
    const numeric = parseInt(String(usedNo).replace(/\D/g, ""), 10);
    const current = g.nextInvoiceNumber;
    if (!isNaN(numeric) && numeric >= current) {
      g.nextInvoiceNumber = Math.max(current, numeric) + 1;
      saveGlobalData(g);
    }
  }

  function advanceStatementNumberIfUsed(usedNo) {
    const g = getGlobalData();
    const numeric = parseInt(String(usedNo).replace(/\D/g, ""), 10);
    const current = g.nextStatementNumber;
    if (!isNaN(numeric) && numeric >= current) {
      g.nextStatementNumber = Math.max(current, numeric) + 1;
      saveGlobalData(g);
    }
  }

  function saveAndArchiveInvoice(invoiceData) {
    try {
      const g = getGlobalData();
      const id = invoiceData.id || "inv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      const documentType = invoiceData.documentType || "invoice";
      const archived = {
        ...invoiceData,
        documentType: documentType,
        id: id,
        originalId: invoiceData.originalId || id,
        createdAt: invoiceData.createdAt || new Date().toISOString(),
        archivedAt: new Date().toISOString()
      };
      g.savedInvoices = g.savedInvoices.filter(function (inv) {
        return inv.id !== id && inv.originalId !== id;
      });
      g.savedInvoices.unshift(archived);
      g.currentInvoice = null;
      g.lastSaved = new Date().toISOString();
      saveGlobalData(g);
      return true;
    } catch (e) {
      console.error("GlobalStorage saveAndArchiveInvoice error:", e);
      return false;
    }
  }

  function getAllSavedInvoices() {
    const g = getGlobalData();
    return g.savedInvoices || [];
  }

  function loadInvoiceForEditing(invoiceId) {
    const g = getGlobalData();
    const inv = g.savedInvoices.find(function (i) {
      return i.id === invoiceId || i.originalId === invoiceId;
    });
    if (!inv) return false;
    g.currentInvoice = { ...inv, loadedForEdit: true };
    saveGlobalData(g);
    return true;
  }

  function isEditingMode() {
    const inv = getInvoiceData();
    if (!inv) return false;
    return inv.loadedForEdit === true;
  }

  function setNextInvoiceNumber(value) {
    const num = Math.max(1, Math.min(99999, Math.floor(Number(value)) || 1));
    saveGlobalData({ nextInvoiceNumber: num });
    return num;
  }

  function searchSavedInvoices(query) {
    const list = getAllSavedInvoices();
    if (!query || !query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter(function (inv) {
      const no = (inv.invoiceNo || inv.statementNo || inv.receiptNo || "").toLowerCase();
      const name = (inv.customerName || "").toLowerCase();
      const email = (inv.customerEmail || "").toLowerCase();
      const phone = (inv.customerPhone || "").toLowerCase();
      return no.indexOf(q) !== -1 || name.indexOf(q) !== -1 || email.indexOf(q) !== -1 || phone.indexOf(q) !== -1;
    });
  }

  function getAllSavedReceipts() {
    return (getAllSavedInvoices() || []).filter(function (doc) {
      return doc.documentType === "receipt";
    });
  }

  function getAllSavedStatements() {
    return (getAllSavedInvoices() || []).filter(function (doc) {
      return doc.documentType === "statement";
    });
  }

  function deleteSavedInvoice(invoiceId) {
    const g = getGlobalData();
    const before = g.savedInvoices.length;
    g.savedInvoices = g.savedInvoices.filter(function (i) {
      return i.id !== invoiceId && i.originalId !== invoiceId;
    });
    if (g.savedInvoices.length < before) {
      saveGlobalData(g);
      return true;
    }
    return false;
  }

  window.GlobalStorage = {
    getGlobalData: getGlobalData,
    saveGlobalData: saveGlobalData,
    getInvoiceData: getInvoiceData,
    saveInvoiceData: saveInvoiceData,
    getNextInvoiceNumber: getNextInvoiceNumber,
    setNextInvoiceNumber: setNextInvoiceNumber,
    formatInvoiceNumber: formatInvoiceNumber,
    advanceInvoiceNumberIfUsed: advanceInvoiceNumberIfUsed,
    getNextStatementNumber: getNextStatementNumber,
    formatStatementNumber: formatStatementNumber,
    advanceStatementNumberIfUsed: advanceStatementNumberIfUsed,
    saveAndArchiveInvoice: saveAndArchiveInvoice,
    getAllSavedInvoices: getAllSavedInvoices,
    getAllSavedReceipts: getAllSavedReceipts,
    getAllSavedStatements: getAllSavedStatements,
    loadInvoiceForEditing: loadInvoiceForEditing,
    isEditingMode: isEditingMode,
    searchSavedInvoices: searchSavedInvoices,
    deleteSavedInvoice: deleteSavedInvoice
  };
})();
