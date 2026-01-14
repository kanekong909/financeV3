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
    
    try {
        // 1. Buscar si ya existe el archivo
        const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${CONFIG.NOMBRE_ARCHIVO_DRIVE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
        const searchRes = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        const searchData = await searchRes.json();

        if (searchData.files && searchData.files.length > 0) {
            return searchData.files[0].id;
        }

        // 2. Si no existe, crear uno nuevo
        console.log("Creando nueva base de datos en tu Drive...");
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

        // 3. Crear cabeceras en la nueva hoja
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newId}/values/${CONFIG.NOMBRE_HOJA}!A1:D1?valueInputOption=USER_ENTERED`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [["Fecha", "Monto", "Categoría", "Descripción"]] })
        });

        return newId;
    } catch (error) {
        console.error("Error en Drive:", error);
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
                id: index + 2,
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
    
    // 1. Limpiar la lista actual
    listElement.innerHTML = '';

    // 2. ACTUALIZAR EL GRÁFICO 
    // Usamos los mismos datos que recibe la lista para que el gráfico sea coherente
    updateChart(expenses); 

    // 3. Renderizar cada item en el HTML
    expenses.forEach(expense => {
        const item = document.createElement('div');
        item.className = 'expense-item';
        
        // Escapamos el objeto expense para que el onclick no de errores con comillas
        const expenseData = JSON.stringify(expense).replace(/"/g, '&quot;');

        item.innerHTML = `
            <div class="expense-info">
                <strong>${expense.descripcion || 'Sin descripción'}</strong>
                <small>${expense.fechaTexto} • ${expense.categoria}</small>
            </div>
            <div class="expense-actions">
                <span class="expense-amount">$${expense.monto.toLocaleString()}</span>
                <div class="action-buttons">
                    <button class="btn-icon edit" onclick="openEditModal(${expenseData})">
                      <img src="./assets/img/edit.svg" alt="Editar" />
                    </button>
                    <button class="btn-icon delete" onclick="openDeleteModal(${expense.id})">
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
        const searchTerm = searchInput.value.toLowerCase();
        const categoryTerm = categorySelect.value;

        const filtered = allExpenses.filter(exp => {
            const matchesSearch = exp.descripcion.toLowerCase().includes(searchTerm);
            const matchesCategory = categoryTerm === 'All' || exp.categoria === categoryTerm;
            return matchesSearch && matchesCategory;
        });

        renderExpenses(filtered);
        updateTotal(filtered);
    };

    if (searchInput) searchInput.addEventListener('input', filterData);
    if (categorySelect) categorySelect.addEventListener('change', filterData);
}

// =================================
// 6. ELIMINAR Y EDITAR GASTOS
// =================================
// --- ELIMINAR ---
function openDeleteModal(id) {
    currentDeleteId = id;
    document.getElementById('delete-modal').classList.add('active');
}

document.getElementById('confirm-delete-btn').onclick = async () => {
    const token = localStorage.getItem('gapi_token');
    // CAMBIO: Usar USER_SPREADSHEET_ID
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${USER_SPREADSHEET_ID}/values/${CONFIG.NOMBRE_HOJA}!A${currentDeleteId}:D${currentDeleteId}:clear`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            showToast("Gasto eliminado");
            closeModals();
            loadExpenses();
        }
    } catch (error) {
        showToast("Error al eliminar", true);
    }
};

// --- EDITAR ---
function openEditModal(expense) {
    currentEditId = expense.id;

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
            closeModals();
            loadExpenses();
        }
    } catch (error) {
        showToast("Error al actualizar", true);
    }
};

// --- CERRAR MODALES ---
function closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

document.querySelectorAll('.modal-close, .modal-cancel, #cancel-delete-btn, #close-delete-x').forEach(btn => {
    btn.onclick = closeModals;
});

// =================================
// 7. VER HISTORIAL COMPLETO
// =================================
// 1. Abrir el historial
document.getElementById('view-history-btn').onclick = async () => {
    document.getElementById('history-modal').classList.add('active');
    await loadFullHistory();
};

// 2. Cargar todos los datos de Sheets
async function loadFullHistory() {
    const token = localStorage.getItem('gapi_token');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${USER_SPREADSHEET_ID}/values/${CONFIG.NOMBRE_HOJA}!A2:D?majorDimension=ROWS`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.values) {
            const ahora = new Date();
            const mesActual = ahora.getMonth();
            const anioActual = ahora.getFullYear();

            // Mapeamos y luego FILTRAMOS para que NO sea el mes actual
            fullHistory = data.values.map((row, index) => {
                const rawDate = row[0] || "";
                let fechaProcesada;

                // Lógica de limpieza de fecha (igual que en loadExpenses)
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
                    id: index + 2,
                    fechaObjeto: fechaProcesada,
                    fechaTexto: rawDate,
                    monto: parseFloat(row[1]) || 0,
                    categoria: row[2],
                    descripcion: row[3] || ''
                };
            })
            .filter(expense => {
                // EXCLUIR MES ACTUAL: 
                // Solo pasa si el mes es diferente O el año es diferente al actual
                const esMesActual = expense.fechaObjeto.getMonth() === mesActual && 
                                   expense.fechaObjeto.getFullYear() === anioActual;
                
                return !esMesActual; // Solo devolvemos los que NO son del mes actual
            })
            .reverse();
            
            renderHistory(fullHistory);
        }
    } catch (error) {
        console.error("Error cargando historial:", error);
        showToast("Error al cargar el historial", true);
    }
}

// 3. Renderizar el historial en el modal
function renderHistory(data) {
    const container = document.getElementById('history-list-container');
    container.innerHTML = '';

    data.forEach(expense => {
        const item = document.createElement('div');
        item.className = 'expense-item'; 
        // Reutilizamos la clase expense-item para mantener el estilo
        item.innerHTML = `
            <div class="expense-info">
                <strong>${expense.descripcion}</strong>
                <small>${expense.fechaTexto} • ${expense.categoria}</small>
            </div>
            <div class="expense-actions">
                <span class="expense-amount">$${expense.monto.toLocaleString()}</span>
                <div class="action-buttons" style="opacity: 1;"> 
                    <button class="btn-icon edit" onclick="openEditFromHistory(${JSON.stringify(expense).replace(/"/g, '&quot;')})">
                      <img src="./assets/img/edit.svg" alt="Editar" />
                    </button>
                    <button class="btn-icon delete" onclick="openDeleteModal(${expense.id})">
                      <img src="./assets/img/delete.svg" alt="Eliminar" />
                    </button>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

// 4. Puente para editar desde el historial
function openEditFromHistory(expense) {
    // Cerramos el modal de historial para que no estorbe al de edición
    document.getElementById('history-modal').classList.remove('active');
    openEditModal(expense);
}

// 5. Buscador interno del historial
document.getElementById('history-search').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = fullHistory.filter(exp => 
        exp.descripcion.toLowerCase().includes(term) || 
        exp.categoria.toLowerCase().includes(term)
    );
    renderHistory(filtered);
};

// Cerrar el modal
document.getElementById('close-history').onclick = () => {
    document.getElementById('history-modal').classList.remove('active');
};

async function loadFullHistoryQuiet() {
    const token = localStorage.getItem('gapi_token');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.NOMBRE_HOJA}!A2:D?majorDimension=ROWS`;
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        if (data.values) {
            fullHistory = data.values.map((row, index) => ({
                id: index + 2,
                fechaObjeto: row[0].includes('/') ? 
                    new Date(row[0].split(' ')[0].split('/').reverse().join('-')) : new Date(row[0]),
                fechaTexto: row[0],
                monto: parseFloat(row[1]) || 0,
                categoria: row[2],
                descripcion: row[3] || ''
            }));
        }
    } catch (e) { console.log("Error silencioso", e); }
}

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
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    
    const year = document.getElementById('export-year-select').value;
    const monthIndex = document.getElementById('export-month-select').value;
    const monthName = CONFIG.MESES[monthIndex];

    const reportData = [...allExpenses, ...fullHistory].filter(exp => {
        const d = new Date(exp.fechaObjeto);
        return d.getFullYear() == year && d.getMonth() == monthIndex;
    }).sort((a, b) => a.fechaObjeto - b.fechaObjeto);

    if (reportData.length === 0) {
        showToast("No hay datos para este periodo", true);
        return;
    }

    // --- 1. FONDO CON DEGRADADO ---
    // Simulamos un degradado dibujando rectángulos finos de oscuro a un poco más claro
    for (let i = 0; i < pageHeight; i++) {
        const factor = i / pageHeight;
        // De un azul/negro profundo (18, 18, 18) a un violeta muy oscuro (30, 20, 50)
        const r = Math.floor(18 + factor * 12);
        const g = Math.floor(18 + factor * 2);
        const b = Math.floor(18 + factor * 32);
        doc.setDrawColor(r, g, b);
        doc.line(0, i, pageWidth, i);
    }

    // --- 2. ENCABEZADO PREMIUM ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.setTextColor(187, 134, 252); // Tu primary color (Lila)
    doc.text("Mis Gastos", 14, 25);
    
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.text("REPORTE FINANCIERO MENSUAL", 14, 32);

    // --- 3. TARJETA DE RESUMEN (Glassmorphism effect) ---
    const totalMes = reportData.reduce((sum, exp) => sum + exp.monto, 0);
    
    doc.setFillColor(40, 40, 40); // Color de fondo de la tarjeta
    doc.roundedRect(14, 40, pageWidth - 28, 30, 3, 3, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.text(`Periodo: ${monthName} ${year}`, 20, 52);
    
    doc.setFontSize(16);
    doc.setTextColor(187, 134, 252);
    doc.text(`Total: $${totalMes.toLocaleString('es-CO')}`, 20, 62);

    // --- 4. TABLA ESTILO OSCURO ---
    doc.autoTable({
        startY: 80,
        head: [['FECHA', 'CATEGORÍA', 'DESCRIPCIÓN', 'MONTO']],
        body: reportData.map(exp => [
            exp.fechaTexto.split(' ')[0],
            exp.categoria.toUpperCase(),
            exp.descripcion || '-',
            `$${exp.monto.toLocaleString('es-CO')}`
        ]),
        theme: 'plain', // Usamos plain para controlar nosotros los colores
        headStyles: {
            fillColor: [30, 30, 30],
            textColor: [187, 134, 252],
            fontStyle: 'bold',
            fontSize: 11,
            halign: 'center',
            lineWidth: 0.1,
            lineColor: [60, 60, 60]
        },
        bodyStyles: {
            fillColor: [25, 25, 25],
            textColor: [230, 230, 230],
            fontSize: 10,
            lineWidth: 0.1,
            lineColor: [45, 45, 45]
        },
        alternateRowStyles: {
            fillColor: [32, 32, 32]
        },
        columnStyles: {
            3: { halign: 'right', fontStyle: 'bold', textColor: [255, 255, 255] }
        },
        margin: { left: 14, right: 14 }
    });

    // --- 5. PIE DE PÁGINA ---
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(
            `Generado el ${new Date().toLocaleDateString()} • Página ${i} de ${totalPages}`,
            pageWidth / 2,
            pageHeight - 10,
            { align: 'center' }
        );
    }

    doc.save(`Reporte_Premium_${monthName}.pdf`);
    showToast("Reporte elegante generado");
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
    localStorage.clear();
    window.location.href = './login.html';
});