/**
 * GLOBAL STORAGE MANAGER
 * Provides cross-file localStorage access with fallbacks
 */
class GlobalStorageManager {
  constructor() {
    this.storageKey = 'invoiceApp_globalData';
    this.isAvailable = this.checkStorageAvailability();
    this.fallbackStorage = {};
    
    console.log('🌐 Global Storage Manager initialized');
    console.log('📦 Storage available:', this.isAvailable);
  }

  checkStorageAvailability() {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      console.warn('⚠️ localStorage not available, using fallback');
      return false;
    }
  }

  // Save data globally
  saveGlobalData(data) {
    const globalData = this.getGlobalData();
    const updatedData = { ...globalData, ...data };
    
    if (this.isAvailable) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(updatedData));
        console.log('💾 Data saved to global storage');
        return true;
      } catch (e) {
        console.error('❌ Failed to save to localStorage:', e);
        this.fallbackStorage = updatedData;
        return false;
      }
    } else {
      this.fallbackStorage = updatedData;
      console.log('💾 Data saved to fallback storage');
      return true;
    }
  }

  // Load data globally
  getGlobalData() {
    if (this.isAvailable) {
      try {
        const data = localStorage.getItem(this.storageKey);
        return data ? JSON.parse(data) : {};
      } catch (e) {
        console.error('❌ Failed to load from localStorage:', e);
        return this.fallbackStorage;
      }
    } else {
      return this.fallbackStorage;
    }
  }

  // Save specific quote data (storage key kept for backward compatibility)
  saveInvoiceData(invoiceData) {
    return this.saveGlobalData({
      currentInvoice: invoiceData,
      lastSaved: new Date().toISOString()
    });
  }

  // Load specific quote data
  getInvoiceData() {
    const globalData = this.getGlobalData();
    return globalData.currentInvoice || null;
  }

  // Save products data
  saveProductsData(products) {
    return this.saveGlobalData({ products });
  }

  // Load products data
  getProductsData() {
    const globalData = this.getGlobalData();
    return globalData.products || [];
  }

  // Save clients data
  saveClientsData(clients) {
    return this.saveGlobalData({ clients });
  }

  // Load clients data
  getClientsData() {
    const globalData = this.getGlobalData();
    return globalData.clients || [];
  }

  // Save company data
  saveCompanyData(company) {
    return this.saveGlobalData({ company });
  }

  // Load company data
  getCompanyData() {
    const globalData = this.getGlobalData();
    return globalData.company || {};
  }

  // Clear all data
  clearAllData() {
    if (this.isAvailable) {
      try {
        localStorage.removeItem(this.storageKey);
        console.log('🗑️ Global storage cleared');
        return true;
      } catch (e) {
        console.error('❌ Failed to clear localStorage:', e);
        return false;
      }
    } else {
      this.fallbackStorage = {};
      console.log('🗑️ Fallback storage cleared');
      return true;
    }
  }

  // Export data for backup
  exportData() {
    const data = this.getGlobalData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quote-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('📤 Data exported');
  }

  // Import data from backup
  importData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          this.saveGlobalData(data);
          console.log('📥 Data imported successfully');
          resolve(data);
        } catch (error) {
          console.error('❌ Failed to import data:', error);
          reject(error);
        }
      };
      reader.readAsText(file);
    });
  }

  // Get storage info
  getStorageInfo() {
    const globalData = this.getGlobalData();
    const dataSize = JSON.stringify(globalData).length;
    
    return {
      isAvailable: this.isAvailable,
      dataSize: dataSize,
      dataSizeKB: Math.round(dataSize / 1024 * 100) / 100,
      hasInvoiceData: !!globalData.currentInvoice,
      hasProductsData: !!globalData.products,
      hasClientsData: !!globalData.clients,
      hasCompanyData: !!globalData.company,
      lastSaved: globalData.lastSaved
    };
  }
}

// Create global instance
window.GlobalStorage = new GlobalStorageManager();

// Make it available globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GlobalStorageManager;
}
