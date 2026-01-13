// === CONFIGURACIÓN ===
const CLIENT_ID = '574094373828-h613uosf818tdq6q619bv76ah0upmbb4.apps.googleusercontent.com';
const SPREADSHEET_ID = '1kKvepYlD-5EBQdC3CQ6-42-pen3YW6mGuZ_9PCjmdW0';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// Intentamos recuperar el token del almacenamiento de sesión al cargar
let accessToken = sessionStorage.getItem('ds_access_token') || null;
let tokenClient = null;

// Filtros
let allExpensesData = []; // Aquí guardaremos la lista completa

// Elementos DOM
const loginScreen = document.getElementById('login-screen');
const authScreen  = document.getElementById('auth-screen');
const mainScreen  = document.getElementById('main-screen');
const authorizeBtn = document.getElementById('authorize-btn');
const signoutBtn   = document.getElementById('signout-btn');
const form         = document.getElementById('expense-form');
const amountInput  = document.getElementById('amount');
const categorySelect = document.getElementById('category');
const descInput    = document.getElementById('description');
const list         = document.getElementById('expenses-list');
const totalEl      = document.getElementById('total-amount');

// Modal edición
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const editFecha = document.getElementById('edit-fecha');
const editMonto = document.getElementById('edit-monto');
const editCategoria = document.getElementById('edit-categoria');
const editDescripcion = document.getElementById('edit-descripcion');
let currentRowNumber = null;

// Modal eliminar
const deleteModal = document.getElementById('delete-modal');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
let rowToDelete = null; // Variable para guardar temporalmente la fila

// Historial de gastos
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');

// DETERMINAR MES ACTUAL
// Obtener mes y año actual en formato "MM/YYYY" para comparar
function getMonthKey(date = new Date()) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${year}`;
}

const currentMonthKey = getMonthKey(); // Ej: "01/2026"

// --- LÓGICA DE NAVEGACIÓN ---
function showScreen(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// --- INTEGRACIÓN GOOGLE IDENTITY SERVICES ---

window.handleCredentialResponse = function(response) {
  console.log('Login con ID token exitoso');
  // Una vez logueado con Google, pedimos permiso para Sheets
  showScreen(authScreen);
};

function initializeGoogle() {
  console.log('Inicializando Google SDK...');

  google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: handleCredentialResponse,
    auto_select: true,
    cancel_on_tap_outside: false
  });

  const signinDiv = document.getElementById("g_id_signin");
  if (signinDiv) {
    google.accounts.id.renderButton(signinDiv, { theme: "outline", size: "large" });
  }

  // Cliente para obtener el Access Token (OAuth2)
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        accessToken = tokenResponse.access_token;
        // PERSISTENCIA: Guardamos el token para que no se pierda al refrescar
        sessionStorage.setItem('ds_access_token', accessToken); 
        
        showScreen(mainScreen);
        loadExpenses();
      }
    }
  });

  authorizeBtn.onclick = () => {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  };
}

function waitForGoogle() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    initializeGoogle();
  } else {
    setTimeout(waitForGoogle, 100);
  }
}

// --- OPERACIONES CON SHEETS ---

async function loadExpenses() {
  if (!accessToken) return;

  // Mostramos un estado de carga opcional en la lista
  list.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">Actualizando...</p>';

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Gastos!A2:D1000`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (response.status === 401) {
      sessionStorage.removeItem('ds_access_token');
      showScreen(loginScreen);
      return;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const rows = data.values || [];

    // 1. GUARDAR EN VARIABLE GLOBAL:
    // Transformamos los datos y los guardamos para que applyFilters() tenga acceso
    allExpensesData = rows.map((row, index) => ({
      rowData: row,
      rowNumber: index + 2
    }));

    // 2. DISPARAR FILTROS:
    // Llamamos a applyFilters en lugar de renderExpenses. 
    // Esto asegura que si el usuario tiene algo escrito en el buscador, se mantenga aplicado.
    applyFilters();
    updateExportSelector()

  } catch (err) {
    console.error('Error en loadExpenses:', err);
    list.innerHTML = '<p style="text-align:center; color:red; padding:20px;">Error al conectar con Google Sheets</p>';
  }
}

// Agregar gasto
form.onsubmit = async (e) => {
  e.preventDefault(); // EVITA QUE LA PÁGINA SE RECARGUE (Crucial)

  const values = [
    new Date().toLocaleString('es-CO', { 
        day: '2-digit', month: '2-digit', year: 'numeric', 
        hour: '2-digit', minute: '2-digit', hour12: false 
    }).replace(',', ''),
    amountInput.value,
    categorySelect.value,
    descInput.value.trim() || ''
  ];

  try {
    const resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Gastos!A:D:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [values] })
      }
    );

    if (!resp.ok) throw new Error('Error al agregar');

    form.reset();
    loadExpenses();
  } catch (err) {
    console.error('Error al agregar:', err);
  }
};

// Renderizar lista
function renderExpenses(expensesWithRow) {
  list.innerHTML = '';
  let total = 0;

  const formatter = new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });

  if (expensesWithRow.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">Sin gastos aún</p>';
  } else {
    // Invertimos para ver los más recientes arriba
    expensesWithRow.reverse().forEach(({ rowData, rowNumber }) => {
      const [fecha, monto, categoria, desc] = rowData;
      const mNum = Number(monto || 0);
      const montoFormateado = formatter.format(mNum);

      const item = document.createElement('div');
      item.className = 'expense-item';
      item.innerHTML = `
        <div class="expense-info">
          <strong>${desc || 'Sin descripción'}</strong>
          <div class="small">${fecha} • ${categoria}</div>
        </div>
        <div class="expense-amount">${montoFormateado}</div>
        <div class="expense-actions">
          <button class="btn-edit" title="Editar">
            <img src="/assets/img/edit.svg" alt="Editar" width="26" height="26">
          </button>
          <button class="btn-delete" title="Eliminar">
            <img src="/assets/img/delete.svg" alt="Eliminar" width="26" height="26">
          </button>
        </div>
      `;

      item.querySelector('.btn-delete').onclick = () => {
        openDeleteModal(rowNumber); // Ya no usamos confirm()
      };

      item.querySelector('.btn-edit').onclick = () => {
        openEditModal(rowNumber, { fecha, monto, categoria, desc });
      };

      list.appendChild(item);
      total += mNum;
    });
  }
  totalEl.textContent = formatter.format(total);
}

// Eliminar gasto
async function deleteExpense(rowNumber) {
  try {
    const request = {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: 0, // Asegúrate que 'Gastos' sea la pestaña ID 0
            dimension: "ROWS",
            startIndex: rowNumber - 1,
            endIndex: rowNumber
          }
        }
      }]
    };

    const resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      }
    );

    if (!resp.ok) throw new Error('Error al eliminar');
    loadExpenses();
  } catch (err) {
    console.error('Error al eliminar:', err);
  }
}

// --- MODAL DE EDICIÓN ---
function openEditModal(rowNumber, gasto) {
  currentRowNumber = rowNumber;

  let fechaHoraInput = '';
  if (gasto.fecha) {
    try {
      const [fechaStr, horaStr] = gasto.fecha.split(' ');
      const [dia, mes, anio] = fechaStr.split('/');
      fechaHoraInput = `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T${horaStr || '12:00'}`;
    } catch (e) { console.warn('Fecha mal formateada'); }
  }

  editFecha.value = fechaHoraInput;
  editMonto.value = gasto.monto;
  editCategoria.value = gasto.categoria;
  editDescripcion.value = gasto.desc || '';

  editModal.classList.add('active');
}

function closeEditModal() {
  editModal.classList.remove('active');
  currentRowNumber = null;
}

document.querySelector('.modal-close')?.addEventListener('click', closeEditModal);
document.querySelector('.modal-cancel')?.addEventListener('click', closeEditModal);

// Editar
editForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const dateObj = new Date(editFecha.value);
  const fechaFormateada = dateObj.toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '');

  const values = [
    fechaFormateada,
    editMonto.value,
    editCategoria.value,
    editDescripcion.value.trim() || ''
  ];

  try {
    const resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Gastos!A${currentRowNumber}:D${currentRowNumber}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [values] })
      }
    );

    if (!resp.ok) throw new Error('Error al actualizar');

    closeEditModal();
    loadExpenses();
  } catch (err) {
    console.error('Error al editar:', err);
  }
});

// Eliminar registro
function openDeleteModal(rowNumber) {
    rowToDelete = rowNumber;
    deleteModal.classList.add('active');
}

function closeDeleteModal() {
    deleteModal.classList.remove('active');
    rowToDelete = null;
}

// Eventos para cerrar
document.getElementById('cancel-delete-btn').onclick = closeDeleteModal;
document.getElementById('close-delete-x').onclick = closeDeleteModal;

// Evento para confirmar la eliminación
confirmDeleteBtn.onclick = async () => {
    if (rowToDelete) {
        // Deshabilitamos el botón para evitar múltiples clics
        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.textContent = "Eliminando...";
        
        await deleteExpense(rowToDelete);
        
        // Restauramos y cerramos
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.textContent = "Eliminar ahora";
        closeDeleteModal();
    }
};

// Funcion filtrar
function applyFilters() {
    const searchTerm = document.getElementById('filter-search').value.toLowerCase();
    const categoryTerm = document.getElementById('filter-category').value;

    const filtered = allExpensesData.filter(({ rowData }) => {
        const [fecha, monto, categoria, desc] = rowData;
        
        // --- NUEVA LÓGICA DE FECHA MÁS ROBUSTA ---
        // 1. Dividimos por espacio para quitar la hora: "10/1/2026 17:00" -> "10/1/2026"
        const soloFecha = fecha.split(' ')[0];
        // 2. Dividimos por la barra: ["10", "1", "2026"]
        const partes = soloFecha.split('/');
        
        // 3. Creamos la llave MM/YYYY asegurando que el mes tenga dos dígitos
        // partes[1] es el mes, partes[2] es el año
        const mesGasto = partes[1]?.padStart(2, '0');
        const anioGasto = partes[2];
        const monthKeyGasto = `${mesGasto}/${anioGasto}`; 

        // Comparación
        const isCurrentMonth = monthKeyGasto === currentMonthKey;
        // ------------------------------------------

        const matchesSearch = (desc || "").toLowerCase().includes(searchTerm);
        const matchesCategory = categoryTerm === "All" || categoria === categoryTerm;

        return isCurrentMonth && matchesSearch && matchesCategory;
    });

    renderExpenses(filtered);
}

// Escuchar cambios en los inputs de filtro
document.getElementById('filter-search').addEventListener('input', applyFilters);
document.getElementById('filter-category').addEventListener('change', applyFilters);

// Historial de gastos
document.getElementById('view-history-btn').onclick = () => {
    renderHistory();
    historyModal.classList.add('active');
};

document.getElementById('close-history').onclick = () => {
    historyModal.classList.remove('active');
};

// Historial 
function renderHistory() {
    historyList.innerHTML = '';
    
    // 1. Definir el formateador de moneda (estilo COP)
    const formatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP',
        minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // 2. Filtrar con la lógica robusta de partes de fecha
    const historyData = allExpensesData.filter(({ rowData }) => {
        const fechaCelda = rowData[0]; // Ej: "10/1/2026 17:00"
        
        const soloFecha = fechaCelda.split(' ')[0]; // "10/1/2026"
        const partes = soloFecha.split('/');        // ["10", "1", "2026"]
        
        // Creamos la llave MM/YYYY (asegurando 01 en lugar de 1)
        const mesGasto = partes[1]?.padStart(2, '0');
        const anioGasto = partes[2];
        const monthKeyGasto = `${mesGasto}/${anioGasto}`;

        // Retornamos los que NO coinciden con el mes actual
        return monthKeyGasto !== currentMonthKey;
    });

    // 3. Validar si hay datos
    if (historyData.length === 0) {
        historyList.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-secondary);">No hay gastos de meses anteriores.</p>';
        return;
    }

    // 4. Renderizar (Invertimos para ver lo más reciente del pasado primero)
    // Usamos [...historyData] para no mutar el array original al hacer reverse
    [...historyData].reverse().forEach(({ rowData }) => {
        const [fecha, monto, categoria, desc] = rowData;
        const mNum = Number(monto || 0);

        const item = document.createElement('div');
        item.className = 'expense-item';
        item.innerHTML = `
            <div class="expense-info">
                <strong>${desc || 'Sin descripción'}</strong>
                <div class="small">${fecha} • ${categoria}</div>
            </div>
            <div class="expense-amount">${formatter.format(mNum)}</div>
        `;
        historyList.appendChild(item);
    });
}

// Exportar PDF
function updateExportSelector() {
    const select = document.getElementById('export-month-select');
    select.innerHTML = '';
    
    // Extraer meses únicos de todos los datos
    const months = [...new Set(allExpensesData.map(({ rowData }) => {
        const partes = rowData[0].split(' ')[0].split('/');
        return `${partes[1]?.padStart(2, '0')}/${partes[2]}`;
    }))].sort().reverse(); // De más reciente a más antiguo

    months.forEach(m => {
        const option = document.createElement('option');
        option.value = m;
        option.textContent = m;
        select.appendChild(option);
    });
}

document.getElementById('download-pdf-btn').onclick = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const selectedMonth = document.getElementById('export-month-select').value;

    const dataToExport = allExpensesData.filter(({ rowData }) => {
        const partes = rowData[0].split(' ')[0].split('/');
        const monthKey = `${partes[1]?.padStart(2, '0')}/${partes[2]}`;
        return monthKey === selectedMonth;
    });

    if (dataToExport.length === 0) return alert("No hay datos para este mes");

    // --- DISEÑO DE CABECERA ---
    // Rectángulo decorativo superior (Púrpura)
    doc.setFillColor(94, 5, 5);
    doc.rect(0, 0, 210, 40, 'F');

    // Título Principal
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text("REPORTE MENSUAL DE GASTOS", 14, 25);

    // Subtítulo con el periodo
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Periodo: ${selectedMonth}`, 14, 32);

    // Info de generación (Derecha)
    doc.setFontSize(9);
    doc.text(`Generado: ${new Date().toLocaleDateString()}`, 160, 32);

    // --- RESUMEN RÁPIDO ---
    let total = dataToExport.reduce((acc, { rowData }) => acc + Number(rowData[1] || 0), 0);
    
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.text("RESUMEN GENERAL", 14, 50);
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`Total Gastado: $ ${total.toLocaleString('es-CO')}`, 14, 58);
    
    // Línea divisoria sutil
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 62, 196, 62);

    // --- PREPARACIÓN DE TABLA ---
    const tableRows = dataToExport.map(({ rowData }) => {
        const [fecha, monto, categoria, desc] = rowData;
        return [
            fecha.split(' ')[0],
            desc || 'Sin descripción',
            categoria,
            `$ ${Number(monto).toLocaleString('es-CO')}`
        ];
    });

    // --- GENERACIÓN DE TABLA ELEGANTE ---
    doc.autoTable({
        startY: 70,
        head: [['FECHA', 'DESCRIPCIÓN', 'CATEGORÍA', 'MONTO']],
        body: tableRows,
        theme: 'grid', // 'grid' para un look más estructurado y limpio
        styles: {
            fontSize: 9,
            cellPadding: 4,
            valign: 'middle',
            font: 'helvetica'
        },
        headStyles: {
            fillColor: [30, 30, 30], // Fondo oscuro para cabecera
            textColor: [187, 134, 252], // Texto púrpura
            fontStyle: 'bold',
            halign: 'center'
        },
        columnStyles: {
            0: { halign: 'center', cellWidth: 25 },
            3: { halign: 'right', fontStyle: 'bold', cellWidth: 35 }
        },
        alternateRowStyles: {
            fillColor: [250, 250, 250]
        },
        margin: { left: 14, right: 14 },
        didDrawPage: function (data) {
            // Pie de página en cada hoja
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text("Desarrollado por Mytic", 14, doc.internal.pageSize.height - 10);
            doc.text(`Página ${data.pageNumber}`, 180, doc.internal.pageSize.height - 10);
        }
    });

    // --- DESCARGA ---
    doc.save(`Reporte_Gastos_${selectedMonth.replace('/', '-')}.pdf`);
};

// Cerrar sesión completo
signoutBtn.onclick = () => {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {
      accessToken = null;
      sessionStorage.removeItem('ds_access_token');
      google.accounts.id.disableAutoSelect();
      showScreen(loginScreen);
    });
  } else {
    showScreen(loginScreen);
  }
};

// --- INICIO DE LA APP ---

document.addEventListener('DOMContentLoaded', () => {
  if (accessToken) {
    // Si ya hay token, vamos directo a la pantalla principal
    showScreen(mainScreen);
    loadExpenses();
  } else {
    // Si no, mostramos login
    showScreen(loginScreen);
  }
  waitForGoogle();
});