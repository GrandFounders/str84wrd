/**
 * Data management modal: products, clients, company, invoice counter.
 * Used by the parent shell only; expects CanvasShellControls for data + sync + invoiceAction.
 * @file js/invoice-catalog-admin.js
 */
(function (global) {
  'use strict';

  class InvoiceCatalogAdmin {
    /** @param {{ data: object, saveData: Function, syncInvoiceFrameFromStorage: Function, invoiceAction: Function }} shell */
    constructor(shell) {
      this.shell = shell;
    }

    init() {
      const dataBtn = document.getElementById('dataManagementBtn');
      const modal = document.getElementById('dataModal');
      const closeBtn = document.getElementById('closeModal');
      if (!dataBtn || !modal || !closeBtn) return;

      dataBtn.addEventListener('click', () => {
        this.showDataManagement();
      });

      closeBtn.addEventListener('click', () => {
        modal.classList.remove('show');
        this.shell.syncInvoiceFrameFromStorage();
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('show');
          this.shell.syncInvoiceFrameFromStorage();
        }
      });

      document.querySelectorAll('.tab-button').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const el = e.currentTarget;
          const tabId = el && el.dataset ? el.dataset.tab : null;
          if (tabId) this.switchTab(tabId);
        });
      });

      this.initThemePresets();
      this.initProductForm();
      this.initClientForm();
      this.initCompanyForm();
      this.initCounterControl();
    }

    showDataManagement() {
      const modal = document.getElementById('dataModal');
      if (!modal) return;
      modal.classList.add('show');
      this.populateDataModal();
    }

    switchTab(tabId) {
      document.querySelectorAll('.tab-button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
      });
      document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('active', content.id === `${tabId}-tab`);
      });
      if (tabId === 'products') {
        this.populateProductsList();
      } else if (tabId === 'clients') {
        this.populateClientsList();
      } else if (tabId === 'company') {
        this.populateCompanyForm();
      } else if (tabId === 'export') {
        this.refreshCounterControl();
      } else if (tabId === 'themes') {
        this.syncThemePresetHighlight();
      }
      // about, help — static tab content
    }

    syncThemePresetHighlight() {
      let current = 'default';
      try {
        current = localStorage.getItem('shell-ui-theme') || 'default';
      } catch (e) {}
      document.querySelectorAll('.theme-preset-btn').forEach((btn) => {
        const t = btn.getAttribute('data-shell-theme') || 'default';
        btn.classList.toggle('theme-preset-btn--active', t === current);
      });
    }

    initThemePresets() {
      this.syncThemePresetHighlight();
      document.querySelectorAll('.theme-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const t = btn.getAttribute('data-shell-theme') || 'default';
          try {
            if (t === 'default') localStorage.removeItem('shell-ui-theme');
            else localStorage.setItem('shell-ui-theme', t);
          } catch (e) {}
          if (t === 'default') document.documentElement.removeAttribute('data-shell-theme');
          else document.documentElement.setAttribute('data-shell-theme', t);
          this.syncThemePresetHighlight();
        });
      });
    }

    populateDataModal() {
      this.populateProductsList();
      this.populateClientsList();
      this.populateCompanyForm();
      this.refreshCounterControl();
    }

    initCounterControl() {
      const input = document.getElementById('counterInput');
      const minusBtn = document.getElementById('counterStepperMinus');
      const plusBtn = document.getElementById('counterStepperPlus');
      const resetBtn = document.getElementById('counterResetBtn');
      if (!input || !minusBtn || !plusBtn || !resetBtn) return;

      const syncInputFromStorage = () => {
        const n = typeof GlobalStorage !== 'undefined' ? GlobalStorage.getNextInvoiceNumber() : 1;
        input.value = n;
      };

      const applyAndUpdate = (value) => {
        const n = Math.max(1, Math.min(99999, Math.floor(Number(value)) || 1));
        if (typeof GlobalStorage !== 'undefined' && GlobalStorage.setNextInvoiceNumber) {
          GlobalStorage.setNextInvoiceNumber(n);
        } else if (typeof GlobalStorage !== 'undefined') {
          GlobalStorage.saveGlobalData({ nextInvoiceNumber: n });
        }
        input.value = n;
        if (this.shell.invoiceAction) {
          this.shell.invoiceAction('applyCounterToDraft', { value: n });
        }
        this.shell.syncInvoiceFrameFromStorage();
      };

      syncInputFromStorage();

      minusBtn.addEventListener('click', () => {
        const current = Math.max(1, Math.floor(Number(input.value)) || 1);
        applyAndUpdate(current - 1);
      });
      plusBtn.addEventListener('click', () => {
        const current = Math.max(1, Math.floor(Number(input.value)) || 1);
        applyAndUpdate(current + 1);
      });
      resetBtn.addEventListener('click', () => applyAndUpdate(1));

      input.addEventListener('change', () => applyAndUpdate(input.value));
      input.addEventListener('blur', () => {
        const v = input.value;
        if (v === '' || isNaN(Number(v))) syncInputFromStorage();
        else applyAndUpdate(v);
      });
    }

    refreshCounterControl() {
      const input = document.getElementById('counterInput');
      if (input && typeof GlobalStorage !== 'undefined') {
        input.value = GlobalStorage.getNextInvoiceNumber();
      }
    }

    initProductForm() {
      const addBtn = document.getElementById('addProductBtn');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          this.showProductForm();
        });
      }
    }

    showProductForm(product = null) {
      const isEdit = !!product;
      const formHtml = `
          <div class="form-row">
            <div class="form-group">
              <label>Name *</label>
              <input type="text" id="productName" value="${product?.name || ''}" required>
            </div>
            <div class="form-group">
              <label>Type</label>
              <select id="productCategory">
                <option value="product" ${product?.category === 'product' ? 'selected' : ''}>Product</option>
                <option value="service" ${product?.category === 'service' ? 'selected' : ''}>Service</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Price (£)</label>
              <input type="number" id="productPrice" step="0.01" value="${product?.price || '0.00'}" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Icon</label>
              <input type="text" id="productIcon" value="${product?.icon || '📦'}" placeholder="📦">
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="productDescription" placeholder="Item description...">${product?.description || ''}</textarea>
          </div>
          <div class="form-group">
            <label>Item Image</label>
            <div class="image-upload" onclick="document.getElementById('productImageFile').click()">
              <input type="file" id="productImageFile" accept="image/*" style="display: none;">
              <p>📁 Click to upload item image</p>
              <div class="image-preview" id="productImagePreview">
                ${product?.image ? `<img src="${product.image}" alt="Item">` : ''}
              </div>
            </div>
          </div>
          <div class="text-center mt-20">
            <button type="button" class="btn btn-primary" onclick="app.saveProduct(${isEdit ? product.id : 'null'})">
              💾 ${isEdit ? 'Update' : 'Add'} Item
            </button>
            <button type="button" class="btn btn-secondary" onclick="app.populateProductsList()">
              ❌ Cancel
            </button>
          </div>
        `;

      document.getElementById('productsList').innerHTML = formHtml;

      document.getElementById('productImageFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            document.getElementById('productImagePreview').innerHTML =
              `<img src="${ev.target.result}" alt="Product">`;
          };
          reader.readAsDataURL(file);
        }
      });
    }

    saveProduct(editId = null) {
      const name = document.getElementById('productName').value.trim();
      const category = document.getElementById('productCategory').value;
      const price = parseFloat(document.getElementById('productPrice').value) || 0.0;
      const icon = document.getElementById('productIcon').value.trim() || '📦';
      const description = document.getElementById('productDescription').value.trim();
      const imagePreview = document.querySelector('#productImagePreview img');
      const image = imagePreview ? imagePreview.src : null;

      if (!name) {
        alert('Name is required!');
        return;
      }

      const productData = { name, category, price, icon, description, image };
      const data = this.shell.data;

      if (editId) {
        const index = data.products.findIndex((p) => p.id === editId);
        if (index !== -1) {
          data.products[index] = { ...data.products[index], ...productData };
        }
      } else {
        const newId = Math.max(...data.products.map((p) => p.id), 0) + 1;
        data.products.push({ id: newId, ...productData });
      }

      this.shell.saveData();
      this.populateProductsList();
      this.shell.syncInvoiceFrameFromStorage();

      console.log(`✅ Product ${editId ? 'updated' : 'added'}: ${name}`);
    }

    deleteProduct(id) {
      if (confirm('Are you sure you want to delete this product?')) {
        this.shell.data.products = this.shell.data.products.filter((p) => p.id !== id);
        this.shell.saveData();
        this.populateProductsList();
        this.shell.syncInvoiceFrameFromStorage();
        console.log(`🗑️ Product deleted: ID ${id}`);
      }
    }

    populateProductsList() {
      const container = document.getElementById('productsList');
      if (!container) return;
      if (this.shell.data.products.length === 0) {
        container.innerHTML =
          '<div class="text-center" style="padding: 40px; color: #666;">No products added yet.</div>';
        return;
      }

      const html = this.shell.data.products
        .map(
          (product) => `
          <div class="data-item">
            <div class="data-item-info">
              <div class="data-item-name">${product.icon} ${product.name}</div>
              <div class="data-item-details">
                ${product.category} • £${product.price.toFixed(2)} • ${product.description}
              </div>
            </div>
            <div class="data-item-actions">
              <button class="btn-sm btn-edit" onclick="app.showProductForm(${JSON.stringify(product).replace(/"/g, '&quot;')})">
                ✏️ Edit
              </button>
              <button class="btn-sm btn-delete" onclick="app.deleteProduct(${product.id})">
                🗑️ Delete
              </button>
            </div>
          </div>
        `
        )
        .join('');

      container.innerHTML = html;
    }

    initClientForm() {
      const addBtn = document.getElementById('addClientBtn');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          this.showClientForm();
        });
      }
    }

    showClientForm(clientData = null) {
      const isEdit = !!clientData;
      const client = clientData?.client || {};

      const formHtml = `
          <div class="form-row">
            <div class="form-group">
              <label>Client Name *</label>
              <input type="text" id="clientName" value="${client.name || ''}" required>
            </div>
            <div class="form-group">
              <label>Type</label>
              <select id="clientType">
                <option value="Individual" ${client.type === 'Individual' ? 'selected' : ''}>Individual</option>
                <option value="Company" ${client.type === 'Company' ? 'selected' : ''}>Company</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Address</label>
              <input type="text" id="clientAddress" value="${client.address || ''}">
            </div>
            <div class="form-group">
              <label>City</label>
              <input type="text" id="clientCity" value="${client.city || ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Phone</label>
              <input type="text" id="clientPhone" value="${client.phone || ''}">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="clientEmail" value="${client.email || ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="clientNotes" placeholder="Additional notes...">${client.notes || ''}</textarea>
          </div>
          <div class="text-center mt-20">
            <button type="button" class="btn btn-primary" onclick="app.saveClient(${isEdit ? clientData.clientId : 'null'})">
              💾 ${isEdit ? 'Update' : 'Add'} Client
            </button>
            <button type="button" class="btn btn-secondary" onclick="app.populateClientsList()">
              ❌ Cancel
            </button>
          </div>
        `;

      document.getElementById('clientsList').innerHTML = formHtml;
    }

    saveClient(editId = null) {
      const name = document.getElementById('clientName').value.trim();
      const type = document.getElementById('clientType').value;
      const address = document.getElementById('clientAddress').value.trim();
      const city = document.getElementById('clientCity').value.trim();
      const phone = document.getElementById('clientPhone').value.trim();
      const email = document.getElementById('clientEmail').value.trim();
      const notes = document.getElementById('clientNotes').value.trim();

      if (!name) {
        alert('Client name is required!');
        return;
      }

      const clientPayload = {
        client: { name, type, address, city, phone, email, notes, status: 'active' }
      };
      const data = this.shell.data;

      if (editId) {
        const index = data.clients.findIndex((c) => c.clientId === editId);
        if (index !== -1) {
          data.clients[index] = { clientId: editId, ...clientPayload };
        }
      } else {
        const newId = Math.max(...data.clients.map((c) => c.clientId), 0) + 1;
        data.clients.push({ clientId: newId, ...clientPayload });
      }

      this.shell.saveData();
      this.populateClientsList();
      this.shell.syncInvoiceFrameFromStorage();

      console.log(`✅ Client ${editId ? 'updated' : 'added'}: ${name}`);
    }

    deleteClient(id) {
      if (confirm('Are you sure you want to delete this client?')) {
        this.shell.data.clients = this.shell.data.clients.filter((c) => c.clientId !== id);
        this.shell.saveData();
        this.populateClientsList();
        this.shell.syncInvoiceFrameFromStorage();
        console.log(`🗑️ Client deleted: ID ${id}`);
      }
    }

    populateClientsList() {
      const container = document.getElementById('clientsList');
      if (!container) return;
      if (this.shell.data.clients.length === 0) {
        container.innerHTML =
          '<div class="text-center" style="padding: 40px; color: #666;">No clients added yet.</div>';
        return;
      }

      const html = this.shell.data.clients
        .map((clientData) => {
          const client = clientData.client;
          return `
            <div class="data-item">
              <div class="data-item-info">
                <div class="data-item-name">👤 ${client.name}</div>
                <div class="data-item-details">
                  ${client.type} • ${client.address}, ${client.city} • ${client.phone} • ${client.email}
                </div>
              </div>
              <div class="data-item-actions">
                <button class="btn-sm btn-edit" onclick="app.showClientForm(${JSON.stringify(clientData).replace(/"/g, '&quot;')})">
                  ✏️ Edit
                </button>
                <button class="btn-sm btn-delete" onclick="app.deleteClient(${clientData.clientId})">
                  🗑️ Delete
                </button>
              </div>
            </div>
          `;
        })
        .join('');

      container.innerHTML = html;
    }

    initCompanyForm() {
      const form = document.getElementById('companyForm');
      const logoUpload = document.getElementById('logoUpload');
      const logoFile = document.getElementById('logoFile');
      if (!form || !logoUpload || !logoFile) return;

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveCompanyInfo();
      });

      logoUpload.addEventListener('click', () => {
        logoFile.click();
      });

      logoFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            document.getElementById('logoPreview').innerHTML =
              `<img src="${ev.target.result}" alt="Company Logo">`;
          };
          reader.readAsDataURL(file);
        }
      });
    }

    populateCompanyForm() {
      const c = this.shell.data.company;
      document.getElementById('companyName').value = c.name || '';
      document.getElementById('companyPhone').value = c.phone || '';
      document.getElementById('companyAddress').value = c.address || '';
      document.getElementById('companyCity').value = c.city || '';
      document.getElementById('companyEmail').value = c.email || '';
      document.getElementById('companyNumber').value = c.companyNumber || '';
      document.getElementById('vatNumber').value = c.vatNumber || '';
      document.getElementById('companyBankName').value = c.bankName || '';
      document.getElementById('companyAccountName').value = c.accountName || '';
      document.getElementById('companySortCode').value = c.sortCode || '';
      document.getElementById('companyAccountNo').value = c.account || '';

      const logoPreview = document.getElementById('logoPreview');
      if (c.logo) {
        logoPreview.innerHTML = `<img src="${c.logo}" alt="Company Logo">`;
      } else {
        logoPreview.innerHTML = '';
      }
    }

    saveCompanyInfo() {
      const logoPreview = document.querySelector('#logoPreview img');
      const prev = this.shell.data.company;

      this.shell.data.company = {
        name: document.getElementById('companyName').value.trim(),
        phone: document.getElementById('companyPhone').value.trim(),
        address: document.getElementById('companyAddress').value.trim(),
        city: document.getElementById('companyCity').value.trim(),
        email: document.getElementById('companyEmail').value.trim(),
        companyNumber: document.getElementById('companyNumber').value.trim(),
        vatNumber: document.getElementById('vatNumber').value.trim(),
        bankName: document.getElementById('companyBankName').value.trim(),
        accountName: document.getElementById('companyAccountName').value.trim(),
        sortCode: document.getElementById('companySortCode').value.trim(),
        account: document.getElementById('companyAccountNo').value.trim(),
        logo: logoPreview ? logoPreview.src : prev.logo
      };

      this.shell.saveData();
      this.shell.syncInvoiceFrameFromStorage();

      alert('✅ Company information saved successfully!');
      console.log('✅ Company information updated');
    }
  }

  global.InvoiceCatalogAdmin = InvoiceCatalogAdmin;
})(typeof window !== 'undefined' ? window : this);
