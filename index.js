// =================================
// 1. CONFIGURACIÓN Y VARIABLES
// =================================
const CONFIG = {
    // Ya no usamos un ID fijo aquí para que cada usuario tenga el suyo
    NOMBRE_ARCHIVO_DRIVE: 'GastoApp_DB', 
    NOMBRE_HOJA: 'Gastos',
    MESES: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
};

let USER_SPREADSHEET_ID = null; // Se llenará al iniciar sesión
let allExpenses = [];
let currentEditId = null;
let currentDeleteId = null;
let fullHistory = [];
let myChart = null;
let deleteFromHistory = false;


if (!localStorage.getItem('gapi_token')) {
    window.location.href = '../login.html';
}

// =================================
// 2. CONTROL DE FLUJO (INIT)
// =================================
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('gapi_token');
    if (!token) {
        window.location.href = './login.html';
        return;
    }
    inicializarApp();
});

async function inicializarApp() {
    console.log("Iniciando conexión con Google Drive...");
    
    // PASO CLAVE: Buscar o Crear la hoja del usuario
    USER_SPREADSHEET_ID = await obtenerIdHojaUsuario();

    if (USER_SPREADSHEET_ID) {
        actualizarFechaInput();
        setupFilters();
        loadExpenses(); 
        setupFormListener();
    } else {
        showToast("Error al preparar la base de datos", true);
    }
}

// =================================
// 3. GESTIÓN DE DRIVE
// =================================
async function obtenerIdHojaUsuario() {
    const token = localStorage.getItem('gapi_token');

    // 1. Intentar leer del caché local (evita duplicados al recargar)
    const idGuardado = localStorage.getItem('user_spreadsheet_id');
    if (idGuardado) return idGuardado;

    try {
        // 2. Búsqueda exhaustiva en Drive
        // Buscamos archivos que NO estén en la papelera y sean Spreadsheets
        const q = `name = '${CONFIG.NOMBRE_ARCHIVO_DRIVE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
        const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id, name, createdTime)`;
        
        const res = await fetch(searchUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        // 3. Si existen archivos con ese nombre
        if (data.files && data.files.length > 0) {
            // Ordenamos por fecha de creación para agarrar siempre el PRIMERO que se creó en la historia
            data.files.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
            
            const idExistente = data.files[0].id;
            localStorage.setItem('user_spreadsheet_id', idExistente);
            console.log("Se reutilizará la hoja existente:", idExistente);
            return idExistente;
        }

        // 4. Si realmente no existe, lo creamos
        // console.log("No se encontró base de datos. Creando una nueva...");
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                properties: { title: CONFIG.NOMBRE_ARCHIVO_DRIVE },
                sheets: [{ properties: { title: CONFIG.NOMBRE_HOJA } }]
            })
        });
        
        const newSheet = await createRes.json();
        const newId = newSheet.spreadsheetId;

        // Inicializar cabeceras
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newId}/values/${CONFIG.NOMBRE_HOJA}!A1:D1?valueInputOption=USER_ENTERED`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [["Fecha", "Monto", "Categoría", "Descripción"]] })
        });

        localStorage.setItem('user_spreadsheet_id', newId);
        return newId;

    } catch (error) {
        console.error("Error gestionando Drive:", error);
        return null;
    }
}

// =================================
// 4. FUNCIONES DE INTERFAZ (UI)
// =================================
function actualizarFechaInput() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const dateInput = document.getElementById('date');
    if (dateInput) dateInput.value = now.toISOString().slice(0, 16);
}

function showToast(mensaje, esError = false) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }

    toast.style.borderColor = esError ? 'var(--error-color)' : 'var(--primary-color)';
    toast.innerHTML = `
        <div class="toast-icon" style="background:${esError ? 'var(--error-color)' : 'var(--primary-color)'}">
            ${esError ? '!' : '✓'}
        </div>
        <span>${mensaje}</span>
    `;

    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// =================================
// 5. LÓGICA DE DATOS (GOOGLE SHEETS)
// =================================
async function loadExpenses() {
    const token = localStorage.getItem('gapi_token');
    
    // VALIDACIÓN: Si aún no tenemos el ID de la hoja del usuario, no podemos continuar
    if (!USER_SPREADSHEET_ID) {
        console.warn("USER_SPREADSHEET_ID no definido aún.");
        return;
    }

    // Cambiamos CONFIG.SPREADSHEET_ID por USER_SPREADSHEET_ID
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${USER_SPREADSHEET_ID}/values/${CONFIG.NOMBRE_HOJA}!A2:D?majorDimension=ROWS`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        // Si hay un error de autenticación (Token expirado)
        if (data.error) {
            // Si el error es 401 (no autorizado), limpiamos y salimos
            if (data.error.code === 401) {
                localStorage.clear();
                window.location.href = './login.html';
            } else {
                console.error("Error de la API:", data.error.message);
                showToast("Error de permisos o archivo no encontrado", true);
            }
            return;
        }

        if (!data.values) {
            renderExpenses([]);
            updateTotal([]);
            // Importante: inicializar historial vacío para que el PDF no falle
            fullHistory = []; 
            return;
        }

        const ahora = new Date();
        const mesActual = ahora.getMonth();
        const anioActual = ahora.getFullYear();

        // 1. Procesar todos los datos
        const todosLosDatosProcesados = data.values.map((row, index) => {
            const rawDate = row[0] || "";
            let fechaProcesada;

            if (rawDate.includes('/')) {
                const partes = rawDate.split(' ')[0].split('/'); 
                const dia = parseInt(partes[0]);
                const mes = parseInt(partes[1]) - 1;
                const anio = parseInt(partes[2]);
                fechaProcesada = new Date(anio, mes, dia);
            } else {
                fechaProcesada = new Date(rawDate);
            }

            return {
                rowIndex: index + 2,
                fechaObjeto: fechaProcesada,
                fechaTexto: rawDate,
                monto: parseFloat(row[1]) || 0,
                categoria: row[2] || 'Otros',
                descripcion: row[3] || ''
            };
        });

        // 2. Guardar en las variables globales
        fullHistory = todosLosDatosProcesados; 
        
        // 3. Filtrar solo para el mes actual
        allExpenses = todosLosDatosProcesados.filter(expense => {
            return expense.fechaObjeto.getMonth() === mesActual && 
                   expense.fechaObjeto.getFullYear() === anioActual;
        }).reverse();
        
        // 4. Renderizar UI
        renderExpenses(allExpenses);
        updateTotal(allExpenses);

        // 5. Actualizar selectores de PDF
        updateExportSelector();

    } catch (error) {
        console.error("Error crítico en loadExpenses:", error);
        showToast("Error al conectar con tu base de datos", true);
    }
}

// Formulario guardar gasto
function setupFormListener() {
    const expenseForm = document.getElementById('expense-form');
    if (!expenseForm) return;

    expenseForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Validar si ya tenemos el ID de la hoja del usuario
        if (!USER_SPREADSHEET_ID) {
            showToast('Error: Base de datos no vinculada aún', true);
            return;
        }

        const token = localStorage.getItem('gapi_token');
        const btn = expenseForm.querySelector('button');
        const originalText = btn.innerText;
        
        // UI Feedback
        btn.innerText = 'Enviando...';
        btn.disabled = true;

        const values = [[
            document.getElementById('date').value,
            document.getElementById('amount').value,
            document.getElementById('category').value,
            document.getElementById('description').value
        ]];

        try {
            // CAMBIO: Usamos USER_SPREADSHEET_ID en lugar de CONFIG.SPREADSHEET_ID
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${USER_SPREADSHEET_ID}/values/${CONFIG.NOMBRE_HOJA}!A1:append?valueInputOption=USER_ENTERED`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ values })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error.message || "Error en la API");
            }

            showToast('¡Gasto guardado con éxito!');
            expenseForm.reset();
            actualizarFechaInput();
            
            // Recargar la lista para mostrar el nuevo gasto y actualizar el gráfico
            loadExpenses(); 
            
        } catch (err) {
            console.error("Error al guardar:", err);
            showToast('Error: ' + err.message, true);
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    });
}

// =================================
// 5. RENDERIZADO Y FILTROS
// =================================
function renderExpenses(expenses) {
    const listElement = document.getElementById('expenses-list');
    if (!listElement) return;

    // 1. Limpiar la lista
    listElement.innerHTML = '';

    // 2. Ordenar DESCENDENTE por fecha (más reciente ARRIBA)
    const sortedExpenses = [...expenses].sort((a, b) => {
        // Convertimos a Date para comparar correctamente
        const fechaA = new Date(a.fechaObjeto);
        const fechaB = new Date(b.fechaObjeto);
        return fechaB - fechaA; // b (más nuevo) antes que a
    });

    // 3. Actualizar gráfico con los datos ya ordenados
    updateChart(sortedExpenses);

    // 4. Si no hay gastos
    if (sortedExpenses.length === 0) {
        listElement.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">Sin gastos aún</p>';
        return;
    }

    // 5. Renderizar cada gasto (ahora en orden descendente)
    sortedExpenses.forEach(expense => {
        const item = document.createElement('div');
        item.className = 'expense-item';
        
        // Escapamos para evitar problemas con JSON en onclick
        const expenseData = JSON.stringify(expense).replace(/"/g, '&quot;');

        item.innerHTML = `
            <div class="expense-info">
                <strong>${expense.descripcion || 'Sin descripción'}</strong>
                <small>${expense.fechaTexto} • ${expense.categoria}</small>
            </div>
            <div class="expense-actions">
                <span class="expense-amount">$${expense.monto.toLocaleString('es-CO')}</span>
                <div class="action-buttons">
                    <button class="btn-icon edit" onclick="openEditModal(${expenseData})">
                      <img src="./assets/img/edit.svg" alt="Editar" />
                    </button>
                    <button class="btn-icon delete" onclick="openDeleteModal(${expense.rowIndex})">
                      <img src="./assets/img/delete.svg" alt="Eliminar" />
                    </button>
                </div>
            </div>
        `;
        listElement.appendChild(item);
    });
}

function updateTotal(expenses) {
    const total = expenses.reduce((sum, exp) => sum + exp.monto, 0);
    const totalElement = document.getElementById('total-amount');
    const monthElement = document.getElementById('current-month-name');
    
    if (totalElement) totalElement.innerText = `$${total.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
    
    // Esto asegura que el HTML diga "Resumen Enero" (o el mes actual)
    if (monthElement) {
        const ahora = new Date();
        monthElement.innerText = CONFIG.MESES[ahora.getMonth()] + " " + ahora.getFullYear();
    }
}

function setupFilters() {
    const searchInput = document.getElementById('filter-search');
    const categorySelect = document.getElementById('filter-category');

    const filterData = () => {
        const searchTerm = searchInput?.value?.toLowerCase() || '';
        const categoryTerm = categorySelect?.value || 'All';

        // Filtrar
        let filtered = allExpenses.filter(exp => {
            const matchesSearch = exp.descripcion.toLowerCase().includes(searchTerm);
            const matchesCategory = categoryTerm === 'All' || exp.categoria === categoryTerm;
            return matchesSearch && matchesCategory;
        });

        // Orden descendente (más reciente arriba)
        filtered.sort((a, b) => new Date(b.fechaObjeto) - new Date(a.fechaObjeto));

        renderExpenses(filtered);
        updateTotal(filtered);
    };

    if (searchInput) searchInput.addEventListener('input', filterData);
    if (categorySelect) categorySelect.addEventListener('change', filterData);

    // Aplicar filtro y orden inicial al cargar
    filterData();
}

// =================================
// 6. ELIMINAR Y EDITAR GASTOS
// =================================
// --- ELIMINAR ---
function openDeleteModal(id, fromHistory = true) {
    deleteFromHistory = fromHistory;
    currentDeleteId = id;
    document.getElementById('delete-modal').classList.add('active');
}

document.getElementById('confirm-delete-btn').onclick = async () => {
    const token = localStorage.getItem('gapi_token');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${USER_SPREADSHEET_ID}/values/${CONFIG.NOMBRE_HOJA}!A${currentDeleteId}:D${currentDeleteId}:clear`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            showToast("Gasto eliminado");

            // ✅ cerrar SOLO el modal de eliminar
            document.getElementById('delete-modal').classList.remove('active');

            if (deleteFromHistory) {
                await loadFullHistory(); // refresca historial
                deleteFromHistory = false;
                return;
            }

            // flujo normal fuera del historial
            closeModals();
            loadExpenses();
        }
    } catch (error) {
        showToast("Error al eliminar", true);
    }
};


// --- EDITAR ---
function openEditModal(expense) {
    currentEditId = expense.rowIndex;;

    // --- CONVERSIÓN DE FECHA PARA EL INPUT ---
    let fechaParaInput = "";
    try {
        // Si la fecha tiene el formato DD/MM/YYYY HH:mm
        if (expense.fechaTexto && expense.fechaTexto.includes('/')) {
            const [fechaPart, horaPart] = expense.fechaTexto.split(' ');
            const [dia, mes, anio] = fechaPart.split('/');
            
            // Armamos el formato ISO: YYYY-MM-DD
            const fechaISO = `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
            
            // Si tiene hora, la agregamos; si no, ponemos 00:00
            const horaISO = horaPart ? horaPart.substring(0, 5) : "00:00";
            
            fechaParaInput = `${fechaISO}T${horaISO}`;
        } else {
            // Si ya venía en formato ISO desde la base de datos
            fechaParaInput = new Date(expense.fechaTexto).toISOString().slice(0, 16);
        }
    } catch (e) {
        console.error("Error al formatear fecha para el modal:", e);
    }

    // Asignar los valores a los campos del modal
    document.getElementById('edit-fecha').value = fechaParaInput;
    document.getElementById('edit-monto').value = expense.monto;
    document.getElementById('edit-categoria').value = expense.categoria;
    document.getElementById('edit-descripcion').value = expense.descripcion;
    
    document.getElementById('edit-modal').classList.add('active');
}

document.getElementById('edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('gapi_token');
    
    const values = [[
        document.getElementById('edit-fecha').value,
        document.getElementById('edit-monto').value,
        document.getElementById('edit-categoria').value,
        document.getElementById('edit-descripcion').value
    ]];

    // CAMBIO: Usar USER_SPREADSHEET_ID
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${USER_SPREADSHEET_ID}/values/${CONFIG.NOMBRE_HOJA}!A${currentEditId}:D${currentEditId}?valueInputOption=USER_ENTERED`;

    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values })
        });

        if (response.ok) {
            showToast("Gasto actualizado");
            closeEditModal();     // SOLO cerrar edición
            await loadFullHistory(); // refresca historial
            loadExpenses();       // refresca mes actual
        }

    } catch (error) {
        showToast("Error al actualizar", true);
    }
};

// --- CERRAR MODALES ---
function closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

function closeEditModal() {
    document.getElementById('edit-modal')?.classList.remove('active');
}

function closeDeleteModal() {
    document.getElementById('delete-modal')?.classList.remove('active');
}


document.querySelectorAll('#edit-modal .modal-close, #edit-modal .modal-cancel')
    .forEach(btn => {
        btn.onclick = closeEditModal;
});


// =================================
// 7. VER HISTORIAL COMPLETO
// =================================
// 1. Abrir el historial
document.getElementById('view-history-btn').onclick = async () => {
    document.getElementById('history-modal').classList.add('active');
    await loadFullHistory();
};

// 2. Cargar todos los datos de Sheets y agrupar por mes
async function loadFullHistory() {
    const token = localStorage.getItem('gapi_token');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${USER_SPREADSHEET_ID}/values/${CONFIG.NOMBRE_HOJA}!A2:D?majorDimension=ROWS`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!data.values) {
            renderHistory([]);
            return;
        }

        const ahora = new Date();
        const mesActual = ahora.getMonth();
        const anioActual = ahora.getFullYear();

        // Procesar todos los gastos (excluyendo el mes actual)
        const processed = data.values.map((row, index) => {
            const rawDate = row[0] || "";
            let fechaProcesada;

            if (rawDate.includes('/')) {
                const partes = rawDate.split(' ')[0].split('/');
                const dia = parseInt(partes[0]);
                const mes = parseInt(partes[1]) - 1;
                const anio = parseInt(partes[2]);
                fechaProcesada = new Date(anio, mes, dia);
            } else {
                fechaProcesada = new Date(rawDate);
            }

            return {
                rowIndex: index + 2,
                fechaObjeto: fechaProcesada,
                fechaTexto: rawDate,
                monto: parseFloat(row[1]) || 0,
                categoria: row[2] || 'Otros',
                descripcion: row[3] || ''
            };
        }).filter(expense => {
            // Excluir mes actual
            return !(expense.fechaObjeto.getMonth() === mesActual && 
                     expense.fechaObjeto.getFullYear() === anioActual);
        });

        // Agrupar por mes/año (clave: "MM/YYYY")
        const grouped = {};
        processed.forEach(exp => {
            const mes = exp.fechaObjeto.getMonth() + 1; // 1-12
            const anio = exp.fechaObjeto.getFullYear();
            const key = `${mes.toString().padStart(2, '0')}/${anio}`;

            if (!grouped[key]) {
                grouped[key] = {
                    mes: mes,
                    anio: anio,
                    gastos: [],
                    total: 0
                };
            }

            grouped[key].gastos.push(exp);
            grouped[key].total += exp.monto;
        });

        // Convertir a array y ordenar por fecha descendente (mes más reciente primero)
        fullHistory = Object.values(grouped).sort((a, b) => {
            const dateA = new Date(a.anio, a.mes - 1);
            const dateB = new Date(b.anio, b.mes - 1);
            return dateB - dateA;
        });

        // Renderizar el historial agrupado
        renderHistory(fullHistory);

    } catch (error) {
        console.error("Error cargando historial:", error);
        showToast("Error al cargar el historial", true);
    }
}

// 3. Renderizar historial agrupado por mes con totales
function renderHistory(groupedData) {
    const container = document.getElementById('history-list-container');
    if (!container) return;

    container.innerHTML = '';

    if (groupedData.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#888; padding:30px;">No hay gastos en meses anteriores.</p>';
        return;
    }

    groupedData.forEach(group => {
        // Separador de mes con total
        const monthHeader = document.createElement('div');
        monthHeader.className = 'history-month-header';
        monthHeader.innerHTML = `
            <div class="month-title">
                ${CONFIG.MESES[group.mes - 1]} ${group.anio}
            </div>
            <div class="month-total">
                Total: $${group.total.toLocaleString('es-CO', { minimumFractionDigits: 0 })}
            </div>
        `;
        container.appendChild(monthHeader);

        // Lista de gastos de este mes (orden descendente)
        group.gastos.sort((a, b) => new Date(b.fechaObjeto) - new Date(a.fechaObjeto));

        group.gastos.forEach(expense => {
            const item = document.createElement('div');
            item.className = 'expense-item';
            
            const expenseData = JSON.stringify(expense).replace(/"/g, '&quot;');

            item.innerHTML = `
                <div class="expense-info">
                    <strong>${expense.descripcion || 'Sin descripción'}</strong>
                    <small>${expense.fechaTexto} • ${expense.categoria}</small>
                </div>
                <div class="expense-actions">
                    <span class="expense-amount">
                        $${expense.monto.toLocaleString('es-CO')}
                    </span>
                    <div class="action-buttons">
                        <button class="btn-icon edit" onclick="openEditFromHistory(${expenseData})">
                          <img src="./assets/img/edit.svg" alt="Editar" />
                        </button>
                        <button class="btn-icon delete" onclick="openDeleteModal(${expense.rowIndex})">
                          <img src="./assets/img/delete.svg" alt="Eliminar" />
                        </button>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    });
}

// 4. Puente para editar desde el historial
function openEditFromHistory(expense) {
    openEditModal(expense, { fromHistory: true });
}

// 5. Buscador interno del historial
document.getElementById('history-search').oninput = (e) => {
    const term = e.target.value.toLowerCase().trim();

    if (!term) {
        renderHistory(fullHistory);
        return;
    }

    const filtered = fullHistory
        .map(group => {
            const gastosFiltrados = group.gastos.filter(expense =>
                (expense.descripcion || '').toLowerCase().includes(term) ||
                (expense.categoria || '').toLowerCase().includes(term)
            );

            if (gastosFiltrados.length === 0) return null;

            return {
                ...group,
                gastos: gastosFiltrados,
                total: gastosFiltrados.reduce((sum, g) => sum + g.monto, 0)
            };
        })
        .filter(Boolean);

    renderHistory(filtered);
};

// Cerrar el modal
document.getElementById('close-history').onclick = () => {
    document.getElementById('history-modal').classList.remove('active');
};

// =================================
// 8. DESCARGAR PDF
// =================================
// --- CONFIGURACIÓN DE SELECTORES DE EXPORTACIÓN ---
function updateExportSelector() {
    const yearSelect = document.getElementById('export-year-select');
    
    // Unimos todos los datos para buscar años
    const todosLosDatos = [...allExpenses, ...fullHistory];
    
    // Obtenemos años únicos
    const añosExistentes = [...new Set(todosLosDatos.map(exp => 
        new Date(exp.fechaObjeto).getFullYear()
    ))].sort((a, b) => b - a); // Ordenar de más reciente a más viejo

    if (añosExistentes.length === 0) {
        // Si no hay datos, ponemos al menos el año actual
        añosExistentes.push(new Date().getFullYear());
    }

    yearSelect.innerHTML = añosExistentes.map(año => 
        `<option value="${año}">${año}</option>`
    ).join('');

    // Cuando cambie el año, actualizamos los meses disponibles
    yearSelect.onchange = () => updateMonthsDropdown(yearSelect.value);
    
    // Carga inicial de meses para el primer año de la lista
    updateMonthsDropdown(yearSelect.value);
}

function updateMonthsDropdown(yearSelected) {
    const monthSelect = document.getElementById('export-month-select');
    const todosLosDatos = [...allExpenses, ...fullHistory];
    
    // 1. Filtrar gastos que pertenecen al año seleccionado
    const gastosDelAño = todosLosDatos.filter(exp => 
        new Date(exp.fechaObjeto).getFullYear() == yearSelected
    );

    // 2. Obtener los índices de los meses únicos (0-11) que tienen registros
    const mesesConDatos = [...new Set(gastosDelAño.map(exp => 
        new Date(exp.fechaObjeto).getMonth()
    ))].sort((a, b) => a - b); // Ordenar de Enero a Diciembre

    // 3. Llenar el selector solo con esos meses
    if (mesesConDatos.length > 0) {
        monthSelect.innerHTML = mesesConDatos.map(monthIndex => 
            `<option value="${monthIndex}">${CONFIG.MESES[monthIndex]}</option>`
        ).join('');
    } else {
        monthSelect.innerHTML = `<option value="">Sin registros</option>`;
    }
}

// --- GENERACIÓN DEL PDF ---
document.getElementById('download-pdf-btn').onclick = async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    // Colores de tu tema
    const primary = [187, 134, 252];     // #bb86fc
    const accent  = [3, 218, 198];       // #03dac6
    const dark   = [30, 30, 40];
    const gray   = [140, 140, 160];

    // 1. Obtener periodo seleccionado
    const year = document.getElementById('export-year-select').value;
    const monthNum = document.getElementById('export-month-select').value;
    const monthName = CONFIG.MESES[parseInt(monthNum)]; // Ajusta según tu array

    // 2. Filtrar datos
    const reportData = [...allExpenses, ...fullHistory].filter(exp => {
        const d = new Date(exp.fechaObjeto);
        return d.getFullYear() === parseInt(year) && d.getMonth() === parseInt(monthNum);
    }).sort((a, b) => a.fechaObjeto - b.fechaObjeto);

    if (reportData.length === 0) {
        showToast("No hay gastos para este periodo", true);
        return;
    }

    const totalMes = reportData.reduce((sum, exp) => sum + exp.monto, 0);

    // ==========================================
    // ENCABEZADO ELEGANTE
    // ==========================================
    // Fondo degradado superior
    // Simulación de degradado con franjas
    const gradientSteps = 20;
    for (let i = 0; i < gradientSteps; i++) {
        const ratio = i / gradientSteps;
        const r = Math.round(30 + ratio * (90 - 30));
        const g = Math.round(30 + ratio * (50 - 30));
        const b = Math.round(40 + ratio * (120 - 40));

        doc.setFillColor(r, g, b);
        doc.rect(0, i * (45 / gradientSteps), 210, 45 / gradientSteps, 'F');
    }

    doc.rect(0, 0, 210, 45, 'F');

    // Título principal
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(...primary);
    doc.text("REPORTE DE GASTOS", 20, 25);

    // Subtítulo periodo
    doc.setFontSize(12);
    doc.setTextColor(220, 220, 255);
    doc.text(`Periodo: ${monthName} ${year}`, 20, 35);

    // Info de generación (derecha)
    doc.setFontSize(9);
    doc.setTextColor(...gray);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CO')} a las ${new Date().toLocaleTimeString('es-CO', {hour: '2-digit', minute:'2-digit'})}`, 190, 38, { align: 'right' });

    // ==========================================
    // RESUMEN VISUAL
    // ==========================================
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...primary);
    doc.text("Total Gastado", 20, 55);

    doc.setFontSize(32);
    doc.setTextColor(...primary);
    doc.text(`$${totalMes.toLocaleString('es-CO')}`, 20, 75);

    // Línea divisoria
    doc.setDrawColor(80, 80, 100);
    doc.line(20, 80, 190, 80);

    // ==========================================
    // TABLA DE GASTOS
    // ==========================================
    const tableData = reportData.map(exp => {
     const fecha = new Date(exp.fechaObjeto);

        return [
            fecha.toLocaleDateString('es-CO') + ' ' +
            fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),

            `$${exp.monto.toLocaleString('es-CO')}`, // 👈 MONTO AQUÍ

            exp.categoria.toUpperCase(),

            exp.descripcion || '—'
        ];
    });

    doc.autoTable({
        startY: 90,
        head: [['FECHA', 'MONTO', 'CATEGORÍA', 'DESCRIPCIÓN']],
        body: tableData,
        theme: 'grid',

        styles: {
            font: 'helvetica',
            fontSize: 9,
            cellPadding: 4,
            overflow: 'linebreak',
            textColor: [220, 220, 230],
            fillColor: [25, 25, 35],   // 👈 fondo base oscuro
            lineColor: [60, 60, 80],
            lineWidth: 0.1
        },

        headStyles: {
            fillColor: [187, 134, 252],
            textColor: 255,
            fontStyle: 'bold',
            halign: 'center'
        },

        columnStyles: {
            0: { cellWidth: 40 }, // Fecha + hora
            1: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }, // Monto
            2: { cellWidth: 35 }, // Categoría
            3: { cellWidth: 65 }  // Descripción
        },

        alternateRowStyles: {
            fillColor: [35, 35, 45]
        },

        margin: { left: 20, right: 20 }
    });

    // ==========================================
    // PIE DE PÁGINA EN TODAS LAS PÁGINAS
    // ==========================================
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(...gray);
        doc.text(
            `Generado con Gastos Diarios - Página ${i} de ${pageCount}`,
            105, 290,
            { align: 'center' }
        );
    }

    // Descarga
    doc.save(`Reporte_Gastos_${monthName}_${year}.pdf`);
    showToast("Reporte PDF descargado correctamente");
};

// =================================
// 9. GRAFICOS
// =================================
function updateChart(expenses) {
    const ctx = document.getElementById('expensesChart');
    if (!ctx) return;

    // 1. Agrupar montos por categoría
    const categoriasMap = {};
    expenses.forEach(exp => {
        const cat = exp.categoria || 'Otros';
        categoriasMap[cat] = (categoriasMap[cat] || 0) + exp.monto;
    });

    const labels = Object.keys(categoriasMap);
    const data = Object.values(categoriasMap);

    // 2. Si el gráfico ya existe, lo destruimos para crearlo de nuevo con datos frescos
    if (myChart) {
        myChart.destroy();
    }

    // 3. Configuración del gráfico
    myChart = new Chart(ctx, {
        type: 'doughnut', // Estilo dona (más moderno que el de torta normal)
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#5600bf', // Lila (tu color principal)
                    '#15da03', // Turquesa
                    '#ff0266', // Rosa neón
                    '#cf6679', // Coral
                    '#03a9f4', // Azul
                    '#ffeb3b'  // Amarillo
                ],
                borderWidth: 0, // Sin bordes para un look más limpio
                hoverOffset: 15 // Efecto al pasar el mouse
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#e0e0e0', // Texto claro para modo oscuro
                        padding: 20,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const value = context.raw;
                            const percentage = ((value / total) * 100).toFixed(1);
                            return ` $${value.toLocaleString()} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '70%' // Hace el hueco central más grande
        }
    });
}

// =================================
// 10. EVENTOS DE SALIDA
// =================================
document.getElementById('signout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('gapi_token');          // Token OAuth (Sheets / Drive)
    localStorage.removeItem('user_spreadsheet_id'); // ID de la hoja
    localStorage.removeItem('google_authorized');   // Marca de permisos
    localStorage.removeItem('userToken');           // Login con Google Identity

    window.location.href = './login.html';
});

// =================================
// 11. DATOS DEL USUARIO
// =================================
function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
}

function mostrarNombreUsuario() {
    const token = localStorage.getItem('userToken');
    if (!token) return;

    const payload = parseJwt(token);

    const userNameEl = document.getElementById('user-name');
    const avatar = document.getElementById('user-avatar');

    if (userNameEl) {
       userNameEl.textContent = `Bienvenido/a, ${payload.given_name}`;
    }

    if (avatar && payload.picture) {
        avatar.src = payload.picture;
        avatar.alt = payload.name;
    }
}

mostrarNombreUsuario();
