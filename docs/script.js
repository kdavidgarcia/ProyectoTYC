let chart = null;
let metricasChart = null;
let utilizacionChart = null;
let pnChart = null;
let resultadosTablaCompletos = [];
const exportState = {
    tabla: false,
    costos: false,
    metricas: false,
    utilizacion: false,
    pn: false
};
const RENDER_BASE_URL = "https://proyectotyc.onrender.com";
const LOCAL_API_URL = "http://127.0.0.1:5000/calcular";
const RENDER_API_URL = `${RENDER_BASE_URL}/calcular`;
const isLocalHost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
const shouldTryLocalFirst = isLocalHost;
const API_URL = shouldTryLocalFirst ? LOCAL_API_URL : RENDER_API_URL;
const REQUEST_TIMEOUT_MS = 120000;
const LOCAL_REQUEST_TIMEOUT_MS = 2500;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const THEME_KEY = "queue_theme";

async function postJsonWithTimeout(url, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

function parseJsonSafe(text) {
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pingRenderInBackground() {
    if (shouldTryLocalFirst) {
        return;
    }

    try {
        await fetch(RENDER_BASE_URL, {
            method: "GET",
            mode: "no-cors",
            cache: "no-store"
        });
    } catch {
        // Mantener silencio: este calentamiento es solo un intento preventivo.
    }
}

async function solicitarCalculo(data) {
    // En localhost se intenta primero Flask local y luego Render como respaldo.
    const endpoints = shouldTryLocalFirst
        ? [LOCAL_API_URL, RENDER_API_URL]
        : [RENDER_API_URL];
    let ultimoError = new Error("No se pudo conectar con el servidor.");

    for (const endpoint of endpoints) {
        const timeoutMs = endpoint === LOCAL_API_URL ? LOCAL_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;

        for (let intento = 1; intento <= 2; intento += 1) {
            try {
                const response = await postJsonWithTimeout(endpoint, data, timeoutMs);
                const raw = await response.text();
                const result = parseJsonSafe(raw);

                if (response.ok) {
                    return result;
                }

                const mensaje = result.error || "Error en el servidor";
                const backendDesactualizado =
                    endpoint === LOCAL_API_URL
                    && ["mmsk", "costos"].includes(String(data?.modelo || ""))
                    && /modelo\s+inv[aá]lido/i.test(mensaje);

                // Si el backend local esta desactualizado, intentar Render antes de fallar.
                if (backendDesactualizado) {
                    break;
                }

                if (RETRYABLE_STATUS.has(response.status) && intento === 1) {
                    await delay(1200);
                    continue;
                }

                throw new Error(mensaje);
            } catch (error) {
                if (error.name === "AbortError" && intento === 1) {
                    await delay(1200);
                    continue;
                }

                ultimoError = error;
                break;
            }
        }
    }

    throw ultimoError;
}

document.addEventListener("DOMContentLoaded", () => {
    inicializarTema();

    const modelo = document.getElementById("modelo");
    if (modelo) {
        modelo.value = "mm1";
    }
    cambiarFormulario();
    toggleAcciones(false);
    limpiarAnalisis();
    pingRenderInBackground();
});

function inicializarTema() {
    const savedTheme = localStorage.getItem(THEME_KEY) || "light";
    aplicarTema(savedTheme);

    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) {
        return;
    }

    themeToggle.addEventListener("click", () => {
        const current = document.body.getAttribute("data-theme") || "light";
        const next = current === "dark" ? "light" : "dark";
        aplicarTema(next);
        localStorage.setItem(THEME_KEY, next);
    });
}

function aplicarTema(theme) {
    const isDark = theme === "dark";
    document.body.setAttribute("data-theme", isDark ? "dark" : "light");

    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
        themeToggle.textContent = isDark ? "\u2600\uFE0F" : "\uD83C\uDF19";
        themeToggle.setAttribute("title", isDark ? "Modo claro" : "Modo oscuro");
        themeToggle.setAttribute("aria-label", isDark ? "Activar modo claro" : "Activar modo oscuro");
    }
}

function cambiarFormulario() {
    const modelo = document.getElementById("modelo").value;
    let html = `
        <div class="param-group">
            <label for="lambda">\u03BB (Clientes que llegan por hora):</label>
            <input id="lambda" type="number" min="0" step="any" placeholder="Ej: 24">
        </div>
        <div class="param-group">
            <label for="mu">\u03BC (Clientes atendidos por cajero por hora):</label>
            <input id="mu" type="number" min="0" step="any" placeholder="Ej: 30">
        </div>
    `;

    let descripcion = "";

    if (modelo === "mm1") {
        descripcion = "Escenario base con 1 cajero. \u03BB debe ser menor a \u03BC para estabilidad. Se usa para medir la espera actual.";
    } else if (modelo === "mms") {
        descripcion = "Escenario de mejora con varios cajeros en paralelo. Compara costo de operacion versus tiempo de espera.";
        html += `
        <div class="param-group">
            <label for="Cs">Costo de servicio (Cs):</label>
            <input id="Cs" type="number" min="0" step="any" placeholder="Ej: 80">
        </div>
        <div class="param-group">
            <label for="Cw">Costo de espera (Cw):</label>
            <input id="Cw" type="number" min="0" step="any" placeholder="Ej: 50">
        </div>
        <div class="param-group">
            <label for="s_max">Numero maximo de cajeros a evaluar (s):</label>
            <input id="s_max" type="number" min="1" step="1" placeholder="Ej: 5">
        </div>
        `;
    } else if (modelo === "mm1k") {
        descripcion = "Escenario con aforo limitado en sucursal: calcula bloqueo cuando el sistema llega a su capacidad K.";
        html += `
        <div class="param-group">
            <label for="Cs">Costo de servicio (Cs):</label>
            <input id="Cs" type="number" min="0" step="any" placeholder="Ej: 80">
        </div>
        <div class="param-group">
            <label for="Cw">Costo de espera (Cw):</label>
            <input id="Cw" type="number" min="0" step="any" placeholder="Ej: 50">
        </div>
        <div class="param-group">
            <label for="K">Capacidad maxima del sistema (K):</label>
            <input id="K" type="number" min="1" step="1" placeholder="Ej: 10">
        </div>
        `;
    } else if (modelo === "mmsk") {
        // M/M/s/K: varios servidores con capacidad finita K y costo opcional por bloqueo Cb.
        descripcion = "Escenario con varios cajeros y capacidad limitada total K. Incluye costo por clientes bloqueados.";
        html += `
        <div class="param-group">
            <label for="Cs">Costo de servicio por cajero (Cs):</label>
            <input id="Cs" type="number" min="0" step="any" placeholder="Ej: 80">
        </div>
        <div class="param-group">
            <label for="Cw">Costo de espera (Cw):</label>
            <input id="Cw" type="number" min="0" step="any" placeholder="Ej: 50">
        </div>
        <div class="param-group">
            <label for="Cb">Costo por cliente bloqueado (Cb):</label>
            <input id="Cb" type="number" min="0" step="any" placeholder="Ej: 120">
        </div>
        <div class="param-group">
            <label for="s">Numero de cajeros activos (s):</label>
            <input id="s" type="number" min="1" step="1" placeholder="Ej: 3">
        </div>
        <div class="param-group">
            <label for="K">Capacidad maxima del sistema (K):</label>
            <input id="K" type="number" min="1" step="1" placeholder="Ej: 12">
        </div>
        `;
    } else if (modelo === "costos") {
        // Modelo de costos: evalua varios valores de s para identificar el costo total minimo.
        descripcion = "Modelo de costos para encontrar el numero de cajeros que minimiza el costo total (servicio + espera).";
        html += `
        <div class="param-group">
            <label for="Cs">Costo de servicio por cajero (Cs):</label>
            <input id="Cs" type="number" min="0" step="any" placeholder="Ej: 80">
        </div>
        <div class="param-group">
            <label for="Cw">Costo de espera (Cw):</label>
            <input id="Cw" type="number" min="0" step="any" placeholder="Ej: 50">
        </div>
        <div class="param-group">
            <label for="s_max">Numero maximo de cajeros a evaluar (s):</label>
            <input id="s_max" type="number" min="1" step="1" placeholder="Ej: 8">
        </div>
        `;
    }

    document.getElementById("formulario").innerHTML = html;
    document.getElementById("modelo-desc").textContent = descripcion;
    ajustarTarjetasPorModelo(modelo);
    limpiarVistaPorCambioModelo();
}

function ajustarTarjetasPorModelo(modelo) {
    const pnCol = document.getElementById("pnCol");
    const costosCol = document.getElementById("costosCol");
    const esMms = modelo === "mms" || modelo === "costos";
    const mostrarPn = !esMms;
    const mostrarCostos = esMms;

    if (pnCol) {
        pnCol.style.display = mostrarPn ? "block" : "none";
        pnCol.style.gridColumn = mostrarPn ? "1 / -1" : "auto";
    }

    if (costosCol) {
        costosCol.style.display = mostrarCostos ? "block" : "none";
        costosCol.style.gridColumn = mostrarCostos ? "1 / -1" : "auto";
    }
}

function limpiarVistaPorCambioModelo() {
    mostrarTabla([]);

    if (chart) {
        chart.destroy();
        chart = null;
    }

    destruirGraficasAnalisis();
    limpiarAnalisis();
    renderizarGraficasVacias();
    toggleAcciones(false);

    const estado = document.getElementById("estado");
    if (estado) {
        estado.textContent = "Define el escenario de hora pico y presiona Calcular.";
        estado.className = "estado";
    }
}

async function calcular() {
    const modelo = document.getElementById("modelo").value;

    if (!modelo) {
        mostrarMensaje("Selecciona un modelo primero.", true);
        return;
    }

    const data = {
        modelo,
        lambda: parseFloat(document.getElementById("lambda")?.value || 0),
        mu: parseFloat(document.getElementById("mu")?.value || 0)
    };

    if (modelo === "mm1") {
        data.Cs = 0;
        data.Cw = 0;
    } else {
        data.Cs = parseFloat(document.getElementById("Cs")?.value || 0);
        data.Cw = parseFloat(document.getElementById("Cw")?.value || 0);
    }

    if (modelo === "mms" || modelo === "costos") {
        // Estos modelos recorren escenarios de servidores desde 1 hasta s_max.
        data.s_max = parseInt(document.getElementById("s_max")?.value || 1);
    }

    if (modelo === "mm1k") {
        data.K = parseInt(document.getElementById("K")?.value || 1);
    }

    if (modelo === "mmsk") {
        // M/M/s/K usa s y K fijos, mas una penalizacion por bloqueo Cb.
        data.Cb = parseFloat(document.getElementById("Cb")?.value || 0);
        data.s = parseInt(document.getElementById("s")?.value || 1);
        data.K = parseInt(document.getElementById("K")?.value || data.s || 1);
    }

    // Validaciones
    if (!data.lambda || !data.mu) {
        mostrarMensaje("Completa \u03BB y \u03BC para el escenario.", true);
        return;
    }

    if (data.lambda <= 0 || data.mu <= 0) {
        mostrarMensaje("\u03BB y \u03BC deben ser mayores a cero (clientes por hora).", true);
        return;
    }

    if (modelo !== "mm1" && (data.Cs < 0 || data.Cw < 0)) {
        mostrarMensaje("Los costos no pueden ser negativos.", true);
        return;
    }

    if (modelo !== "mm1" && (!Number.isFinite(data.Cs) || !Number.isFinite(data.Cw))) {
        mostrarMensaje("Completa Cs y Cw con valores válidos.", true);
        return;
    }

    if ((modelo === "mms" || modelo === "costos") && (!data.s_max || data.s_max < 1)) {
        mostrarMensaje("Ingresa un numero valido de cajeros (s >= 1).", true);
        return;
    }

    if (modelo === "mm1k" && (!data.K || data.K < 1)) {
        mostrarMensaje("Ingresa una capacidad K valida (K >= 1).", true);
        return;
    }

    if (modelo === "mmsk") {
        if (!Number.isFinite(data.Cb) || data.Cb < 0) {
            mostrarMensaje("Cb debe ser un costo valido y no negativo.", true);
            return;
        }
        if (!data.s || data.s < 1) {
            mostrarMensaje("Ingresa un numero valido de cajeros activos (s >= 1).", true);
            return;
        }
        if (!data.K || data.K < data.s) {
            mostrarMensaje("Ingresa una capacidad valida con K >= s.", true);
            return;
        }
    }

    setLoading(true);
    try {
        mostrarMensaje("Analizando escenario de atencion...", false);
        const result = await solicitarCalculo(data);

        const filas = result.resultados || [];
        mostrarTabla(filas, modelo);
        const tieneCostos = graficar(filas);
        const estadoAnalisis = renderizarAnalisis(filas, data);
        toggleAcciones({
            tabla: filas.length > 0,
            costos: tieneCostos,
            metricas: estadoAnalisis.metricas,
            utilizacion: estadoAnalisis.utilizacion,
            pn: estadoAnalisis.pn
        });
        mostrarMensaje("Analisis completado.", false);
    } catch (error) {
        toggleAcciones(false);
        if (error.name === "AbortError") {
            mostrarMensaje("No se pudo calcular: el servidor tardó demasiado en responder (posible arranque en frío). Intenta de nuevo en unos segundos.", true);
        } else if (error.name === "TypeError") {
            mostrarMensaje(`No se pudo calcular: no hay conexión con la API (${API_URL}).`, true);
        } else {
            mostrarMensaje(`No se pudo calcular: ${error.message}`, true);
        }
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    const overlay = document.getElementById("loadingOverlay");
    if (!overlay) {
        return;
    }

    overlay.classList.toggle("active", isLoading);
    overlay.setAttribute("aria-hidden", isLoading ? "false" : "true");
}

function mostrarTabla(datos, modelo = "") {
    const tbody = document.querySelector("#tabla tbody");
    const modeloActual = modelo || document.getElementById("modelo")?.value || "";
    resultadosTablaCompletos = Array.isArray(datos) ? [...datos] : [];
    const mostrarSoloDiez = modeloActual === "mms" && resultadosTablaCompletos.length > 10;
    const filasVisibles = mostrarSoloDiez ? resultadosTablaCompletos.slice(0, 10) : resultadosTablaCompletos;

    actualizarAvisoLimiteTabla(modeloActual, resultadosTablaCompletos.length);

    if (!tbody) {
        return;
    }

    tbody.innerHTML = "";

    filasVisibles.forEach((fila) => {
        const tr = document.createElement("tr");
        const filaInestable = fila.some((col) => String(col).toLowerCase() === "inestable");
        if (filaInestable) {
            tr.classList.add("inestable-row");
        }

        fila.forEach((col) => {
            const td = document.createElement("td");
            td.textContent = formatearValor(col);
            if (String(col).toLowerCase() === "inestable") {
                td.classList.add("inestable-cell");
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function actualizarAvisoLimiteTabla(modelo, totalResultados) {
    const aviso = document.getElementById("tableLimitNotice");
    if (!aviso) {
        return;
    }

    const mostrar = (modelo === "mms" || modelo === "costos") && totalResultados > 10;
    aviso.style.display = mostrar ? "block" : "none";
    aviso.textContent = mostrar
        ? "Solo se muestran 10 escenarios; descarga Excel para ver el comparativo completo."
        : "";
}

function graficar(datos) {
    const labels = [];
    const costoServicio = [];
    const costoEspera = [];
    const costoTotal = [];

    datos.forEach((fila) => {
        if (fila[1] !== "Inestable") {
            labels.push(`Cajeros=${fila[0]}`);
            costoServicio.push(Number(fila[7]));
            costoEspera.push(Number(fila[8]));
            costoTotal.push(Number(fila[9]));
        }
    });

    const tieneDatos = labels.length > 0;
    const labelsFinales = tieneDatos ? labels : ["Sin datos"];
    const costoServicioFinal = tieneDatos ? costoServicio : [0];
    const costoEsperaFinal = tieneDatos ? costoEspera : [0];
    const costoTotalFinal = tieneDatos ? costoTotal : [0];

    const ctx = document.getElementById("grafica").getContext("2d");
    if (chart) {
        chart.destroy();
    }

    chart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labelsFinales,
            datasets: [
                {
                    label: "Costo de servicio",
                    data: costoServicioFinal,
                    borderColor: tieneDatos ? "#1f77b4" : "#cbd5e1",
                    backgroundColor: tieneDatos ? "rgba(31,119,180,0.2)" : "rgba(203,213,225,0.25)",
                    tension: 0.2
                },
                {
                    label: "Costo de espera",
                    data: costoEsperaFinal,
                    borderColor: tieneDatos ? "#ff7f0e" : "#cbd5e1",
                    backgroundColor: tieneDatos ? "rgba(255,127,14,0.2)" : "rgba(203,213,225,0.25)",
                    tension: 0.2
                },
                {
                    label: "Costo total",
                    data: costoTotalFinal,
                    borderColor: tieneDatos ? "#2ca02c" : "#cbd5e1",
                    backgroundColor: tieneDatos ? "rgba(44,160,44,0.2)" : "rgba(203,213,225,0.25)",
                    tension: 0.2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: "top"
                }
            }
        }
    });

    return tieneDatos;
}

function renderizarGraficasVacias() {
    graficar([]);
    renderizarGraficasAnalisis({
        rho: 0,
        l: 0,
        lq: 0,
        w: 0,
        wq: 0,
        probabilidades: []
    });
}

function limpiarAnalisis() {
    const rows = document.getElementById("analisisRows");
    const chips = document.getElementById("pnChips");
    if (rows) {
        rows.innerHTML = construirFilasAnalisisVacias();
    }
    if (chips) {
        chips.innerHTML = "<span class='chip-muted'>Sin resultados aún.</span>";
    }

    const paramLambda = document.getElementById("paramLambda");
    const paramMu = document.getElementById("paramMu");
    const paramCs = document.getElementById("paramCs");
    const paramCw = document.getElementById("paramCw");
    const paramModelo = document.getElementById("paramModelo");
    const estadoSistema = document.getElementById("estadoSistema");
    const paramLineCs = document.getElementById("paramLineCs");
    const paramLineCw = document.getElementById("paramLineCw");
    const modelo = document.getElementById("modelo")?.value || "";
    const mostrarCostos = modelo === "mms" || modelo === "mm1k";

    if (paramLambda) paramLambda.textContent = "-";
    if (paramMu) paramMu.textContent = "-";
    if (paramCs) paramCs.textContent = "-";
    if (paramCw) paramCw.textContent = "-";
    if (paramModelo) {
        paramModelo.textContent = nombreModelo(modelo);
    }
    if (estadoSistema) {
        estadoSistema.textContent = "-";
        estadoSistema.classList.remove("estado-estable", "estado-inestable");
    }
    if (paramLineCs) paramLineCs.style.display = mostrarCostos ? "flex" : "none";
    if (paramLineCw) paramLineCw.style.display = mostrarCostos ? "flex" : "none";
}

function construirFilasAnalisisVacias() {
    const metricas = [
        { nombre: "Factor de utilizacion (rho)", desc: "Fraccion del tiempo en que la caja permanece ocupada" },
        { nombre: "Clientes en el sistema (L)", desc: "Promedio total de clientes dentro del sistema" },
        { nombre: "Clientes en cola (Lq)", desc: "Promedio de clientes esperando en fila" },
        { nombre: "Tiempo total (W)", desc: "Tiempo promedio desde llegada hasta salida" },
        { nombre: "Tiempo de espera (Wq)", desc: "Tiempo promedio solo en fila" },
        { nombre: "Probabilidad de sistema vacio (P0)", desc: "Probabilidad de no tener clientes en el sistema" }
    ];

    return metricas.map((m) => `
        <div class="analisis-row">
            <div>
                <p class="analisis-nombre">${m.nombre}</p>
                <p class="analisis-desc">${m.desc}</p>
            </div>
            <strong class="analisis-valor">-</strong>
        </div>
    `).join("");
}

function construirFilasAnalisisInestable() {
    const metricas = [
        { nombre: "Factor de utilizacion (rho)", desc: "Fraccion del tiempo en que la caja permanece ocupada" },
        { nombre: "Clientes en el sistema (L)", desc: "Promedio total de clientes dentro del sistema" },
        { nombre: "Clientes en cola (Lq)", desc: "Promedio de clientes esperando en fila" },
        { nombre: "Tiempo total (W)", desc: "Tiempo promedio desde llegada hasta salida" },
        { nombre: "Tiempo de espera (Wq)", desc: "Tiempo promedio solo en fila" },
        { nombre: "Probabilidad de sistema vacio (P0)", desc: "Probabilidad de no tener clientes en el sistema" }
    ];

    return metricas.map((m) => `
        <div class="analisis-row">
            <div>
                <p class="analisis-nombre">${m.nombre}</p>
                <p class="analisis-desc">${m.desc}</p>
            </div>
            <strong class="analisis-valor analisis-valor-inestable">Inestable</strong>
        </div>
    `).join("");
}

function obtenerFilaReferencia(filas) {
    const estables = filas.filter((f) => typeof f[1] === "number");
    if (estables.length === 0) {
        return null;
    }

    const conCosto = estables.filter((f) => typeof f[9] === "number" && Number.isFinite(f[9]));
    if (conCosto.length === 0) {
        return estables[0];
    }

    return conCosto.reduce((mejor, actual) => (actual[9] < mejor[9] ? actual : mejor));
}

function nombreModelo(modelo) {
    if (modelo === "mm1") return "M/M/1";
    if (modelo === "mms") return "M/M/s";
    if (modelo === "mm1k") return "M/M/1/K";
    if (modelo === "mmsk") return "M/M/s/K";
    if (modelo === "costos") return "Modelo de costos";
    return "-";
}

function construirProbabilidades(modelo, p0, rho, kMax) {
    if (!Number.isFinite(p0) || !Number.isFinite(rho) || rho < 0) {
        return [];
    }

    const probabilidades = [];
    if (modelo === "mm1k" && Number.isInteger(kMax) && kMax > 0) {
        for (let n = 0; n <= kMax; n += 1) {
            const pn = p0 * (rho ** n);
            probabilidades.push({ n, pn });
        }
        return probabilidades;
    }

    if (modelo === "mmsk") {
        // Construye P(n) para M/M/s/K de capacidad finita con ecuaciones por tramos.
        const s = Number(document.getElementById("s")?.value || 0);
        const lambda = Number(document.getElementById("lambda")?.value || 0);
        const mu = Number(document.getElementById("mu")?.value || 0);
        if (!Number.isFinite(s) || s < 1 || !Number.isFinite(lambda) || !Number.isFinite(mu) || mu <= 0) {
            return [];
        }

        const a = lambda / mu;
        for (let n = 0; n <= kMax; n += 1) {
            let pn = 0;
            if (n < s) {
                let factorial = 1;
                for (let i = 2; i <= n; i += 1) factorial *= i;
                pn = p0 * ((a ** n) / factorial);
            } else {
                let factorialS = 1;
                for (let i = 2; i <= s; i += 1) factorialS *= i;
                pn = p0 * ((a ** n) / (factorialS * (s ** (n - s))));
            }
            probabilidades.push({ n, pn });
        }
        return probabilidades;
    }

    if (modelo !== "mm1") {
        return [];
    }

    let n = 0;
    while (n <= 30) {
        const pn = p0 * (rho ** n);
        probabilidades.push({ n, pn });
        if (n > 0 && pn < 0.01) {
            break;
        }
        n += 1;
    }
    return probabilidades;
}

function renderizarAnalisis(filas, requestData) {
    ajustarTarjetasPorModelo(requestData.modelo);

    const fila = obtenerFilaReferencia(filas);
    const rows = document.getElementById("analisisRows");
    const chips = document.getElementById("pnChips");
    if (!rows || !chips) {
        return { metricas: false, utilizacion: false, pn: false };
    }

    if (!fila) {
        const esInestable = filas.some((f) => String(f[1]).toLowerCase() === "inestable");
        rows.innerHTML = esInestable ? construirFilasAnalisisInestable() : construirFilasAnalisisVacias();
        chips.innerHTML = esInestable
            ? "<span class='chip-muted'>Sistema inestable: no se pueden calcular probabilidades P(n).</span>"
            : "<span class='chip-muted'>No hay datos para diagnostico en este escenario.</span>";

        const paramModelo = document.getElementById("paramModelo");
        const estadoSistema = document.getElementById("estadoSistema");
        if (paramModelo) {
            paramModelo.textContent = nombreModelo(requestData.modelo);
        }
        if (estadoSistema) {
            estadoSistema.textContent = esInestable ? "Inestable" : "-";
            estadoSistema.classList.toggle("estado-inestable", esInestable);
            estadoSistema.classList.remove("estado-estable");
        }

        renderizarGraficasAnalisis({ rho: 0, l: 0, lq: 0, w: 0, wq: 0, probabilidades: [] });
        return { metricas: false, utilizacion: false, pn: false };
    }

    const rho = Number(fila[1]);
    const p0 = Number(fila[2]);
    const lq = Number(fila[3]);
    const l = Number(fila[4]);
    const wq = Number(fila[5]);
    const w = Number(fila[6]);
    const k = Number(requestData.K);
    const pk = (requestData.modelo === "mm1k" || requestData.modelo === "mmsk") && Number.isInteger(k) && k >= 1
        ? p0 * (rho ** k)
        : null;
    const bloqueadosHora = Number.isFinite(pk) ? Number(requestData.lambda) * pk : null;

    const metricas = [
        { nombre: "Factor de utilizacion (rho)", desc: "Fraccion del tiempo en que la caja esta ocupada", valor: `${(rho * 100).toFixed(2)}%` },
        { nombre: "Clientes en el sistema (L)", desc: "Promedio total de clientes dentro del sistema", valor: formatearValor(l) },
        { nombre: "Clientes en cola (Lq)", desc: "Promedio de clientes esperando en fila", valor: formatearValor(lq) },
        { nombre: "Tiempo total (W)", desc: "Tiempo promedio desde llegada hasta salida", valor: formatearUnidadTiempo(w) },
        { nombre: "Tiempo de espera (Wq)", desc: "Tiempo promedio solo en fila", valor: formatearUnidadTiempo(wq) },
        { nombre: "Probabilidad de sistema vacio (P0)", desc: "Probabilidad de no tener clientes en el sistema", valor: `${(p0 * 100).toFixed(4)}%` }
    ];

    if (Number.isFinite(pk)) {
        metricas.push({
            nombre: "Probabilidad de bloqueo P(K)",
            desc: "Probabilidad de que un cliente llegue con el sistema lleno",
            valor: `${(pk * 100).toFixed(4)}%`
        });
        metricas.push({
            nombre: "Clientes bloqueados por hora",
            desc: "Estimacion de clientes que no logran ingresar por aforo",
            valor: formatearValor(bloqueadosHora)
        });
    }

    rows.innerHTML = metricas.map((m) => `
        <div class="analisis-row">
            <div>
                <p class="analisis-nombre">${m.nombre}</p>
                <p class="analisis-desc">${m.desc}</p>
            </div>
            <strong class="analisis-valor">${m.valor}</strong>
        </div>
    `).join("");

    const probabilidades = construirProbabilidades(requestData.modelo, p0, rho, Number(requestData.K));
    if (probabilidades.length === 0) {
        chips.innerHTML = "<span class='chip-muted'>P(n) detallada disponible para los escenarios M/M/1 y M/M/1/K.</span>";
    } else {
        chips.innerHTML = probabilidades.map((p) => `<span class="pn-chip">P(${p.n}) = ${(p.pn * 100).toFixed(2)}%</span>`).join("");
    }

    const modeloLabel = nombreModelo(requestData.modelo);

    const paramLambda = document.getElementById("paramLambda");
    const paramMu = document.getElementById("paramMu");
    const paramCs = document.getElementById("paramCs");
    const paramCw = document.getElementById("paramCw");
    const paramModelo = document.getElementById("paramModelo");
    const estadoSistema = document.getElementById("estadoSistema");
    const paramLineCs = document.getElementById("paramLineCs");
    const paramLineCw = document.getElementById("paramLineCw");
    if (paramLambda) paramLambda.textContent = formatearValor(Number(requestData.lambda));
    if (paramMu) paramMu.textContent = formatearValor(Number(requestData.mu));
    if (paramCs) paramCs.textContent = formatearValor(Number(fila[7]));
    if (paramCw) paramCw.textContent = formatearValor(Number(fila[8]));
    if (paramModelo) paramModelo.textContent = modeloLabel;
    if (estadoSistema) {
        const esEstable = rho < 1;
        estadoSistema.textContent = esEstable ? "Estable" : "Inestable";
        estadoSistema.classList.toggle("estado-estable", esEstable);
        estadoSistema.classList.toggle("estado-inestable", !esEstable);
    }
    if (paramLineCs) paramLineCs.style.display = requestData.modelo === "mm1" ? "none" : "flex";
    if (paramLineCw) paramLineCw.style.display = requestData.modelo === "mm1" ? "none" : "flex";

    renderizarGraficasAnalisis({ rho, l, lq, w, wq, probabilidades });
    return { metricas: true, utilizacion: true, pn: probabilidades.length > 0 };
}

function destruirGraficasAnalisis() {
    if (metricasChart) {
        metricasChart.destroy();
        metricasChart = null;
    }
    if (utilizacionChart) {
        utilizacionChart.destroy();
        utilizacionChart = null;
    }
    if (pnChart) {
        pnChart.destroy();
        pnChart = null;
    }
}

function renderizarGraficasAnalisis(data) {
    const metricasCtx = document.getElementById("metricasChart")?.getContext("2d");
    const utilCtx = document.getElementById("utilizacionChart")?.getContext("2d");
    const pnCtx = document.getElementById("pnChart")?.getContext("2d");
    if (!metricasCtx || !utilCtx || !pnCtx) {
        return;
    }

    destruirGraficasAnalisis();

    metricasChart = new Chart(metricasCtx, {
        type: "bar",
        data: {
            labels: ["Clientes en sistema (L)", "Clientes en cola (Lq)", "Tiempo total (W)", "Espera (Wq)"],
            datasets: [{
                label: "Indicadores del escenario",
                data: [data.l, data.lq, data.w, data.wq],
                backgroundColor: ["#3b82f6", "#14b8a6", "#f59e0b", "#64748b"]
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } }
        }
    });

    utilizacionChart = new Chart(utilCtx, {
        type: "doughnut",
        data: {
            labels: ["Tiempo ocupado", "Capacidad libre"],
            datasets: [{
                data: [Math.max(0, data.rho), Math.max(0, 1 - data.rho)],
                backgroundColor: ["#f59e0b", "#d1d5db"]
            }]
        },
        options: {
            responsive: true,
            cutout: "68%",
            plugins: { legend: { position: "bottom" } }
        }
    });

    const probabilidades = Array.isArray(data.probabilidades) && data.probabilidades.length > 0
        ? data.probabilidades
        : [{ n: 0, pn: 0 }];
    const tieneProbabilidades = Array.isArray(data.probabilidades) && data.probabilidades.length > 0;

    pnChart = new Chart(pnCtx, {
        type: "bar",
        data: {
            labels: probabilidades.map((p) => `n=${p.n}`),
            datasets: [{
                label: "P(n)",
                data: probabilidades.map((p) => p.pn * 100),
                backgroundColor: tieneProbabilidades ? "#f59e0b" : "#cbd5e1"
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    ticks: {
                        callback: (value) => `${value}%`
                    }
                }
            }
        }
    });
}

function exportarExcel() {
    if (!exportState.tabla || !Array.isArray(resultadosTablaCompletos) || resultadosTablaCompletos.length === 0) {
        mostrarMensaje("No hay datos en la tabla para exportar.", true);
        return;
    }

    const encabezados = Array.from(document.querySelectorAll("#tabla thead th"))
        .map((th) => th.textContent.trim());
    const filas = resultadosTablaCompletos.map((fila) => fila.map((col) => formatearValor(col)));

    const ws = XLSX.utils.aoa_to_sheet([encabezados, ...filas]);
    const wb = XLSX.utils.book_new();

    const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "FF0F172A" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
            top: { style: "thin", color: { rgb: "FFCBD5E1" } },
            bottom: { style: "thin", color: { rgb: "FFCBD5E1" } },
            left: { style: "thin", color: { rgb: "FFCBD5E1" } },
            right: { style: "thin", color: { rgb: "FFCBD5E1" } }
        }
    };

    const bodyStyle = {
        alignment: { horizontal: "center", vertical: "center" },
        border: {
            top: { style: "thin", color: { rgb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { rgb: "FFE2E8F0" } },
            left: { style: "thin", color: { rgb: "FFE2E8F0" } },
            right: { style: "thin", color: { rgb: "FFE2E8F0" } }
        }
    };

    const ref = ws["!ref"];
    if (ref) {
        const range = XLSX.utils.decode_range(ref);

        for (let col = range.s.c; col <= range.e.c; col += 1) {
            const headerAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            if (ws[headerAddress]) {
                ws[headerAddress].s = { ...headerStyle };
            }
        }

        for (let row = 1; row <= range.e.r; row += 1) {
            for (let col = range.s.c; col <= range.e.c; col += 1) {
                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                if (ws[cellAddress]) {
                    ws[cellAddress].s = { ...bodyStyle };
                }
            }
        }
    }

    ws["!cols"] = encabezados.map(() => ({ wch: 12 }));
    XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    XLSX.writeFile(wb, agregarTimestampNombreArchivo("resultados_sucursal_bancaria.xlsx"), { cellStyles: true, compression: true });
}

function obtenerChartPorTipo(tipo) {
    if (tipo === "metricas") return metricasChart;
    if (tipo === "utilizacion") return utilizacionChart;
    if (tipo === "pn") return pnChart;
    return chart;
}

function obtenerCanvasIdPorTipo(tipo) {
    if (tipo === "metricas") return "metricasChart";
    if (tipo === "utilizacion") return "utilizacionChart";
    if (tipo === "pn") return "pnChart";
    return "grafica";
}

function obtenerTituloPorTipo(tipo) {
    if (tipo === "metricas") return "Metricas de atencion";
    if (tipo === "utilizacion") return "Ocupacion del sistema";
    if (tipo === "pn") return "Distribucion de clientes P(n)";
    return "Costos del escenario";
}

function obtenerTimestampArchivo() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = String(now.getFullYear());
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${dd}${mm}${yyyy}${hh}${min}${ss}`;
}

function agregarTimestampNombreArchivo(fileName) {
    const timestamp = obtenerTimestampArchivo();
    const dotIndex = fileName.lastIndexOf(".");

    if (dotIndex <= 0) {
        return `${fileName}_${timestamp}`;
    }

    const nombre = fileName.slice(0, dotIndex);
    const extension = fileName.slice(dotIndex);
    return `${nombre}_${timestamp}${extension}`;
}

async function exportarDatosGraficaExcel(tipo) {
    if (!exportState[tipo]) {
        mostrarMensaje("Primero genera la gráfica para exportar sus datos.", true);
        return;
    }

    if (!window.ExcelJS) {
        mostrarMensaje("No se encontró ExcelJS para exportar la gráfica en Excel.", true);
        return;
    }

    const targetChart = obtenerChartPorTipo(tipo);
    if (!targetChart || !targetChart.data) {
        mostrarMensaje("Primero genera la gráfica para exportar sus datos.", true);
        return;
    }

    const canvasId = obtenerCanvasIdPorTipo(tipo);
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        mostrarMensaje("No se encontró el lienzo de la gráfica para exportar.", true);
        return;
    }

    const labels = targetChart.data.labels || [];
    const datasets = targetChart.data.datasets || [];
    if (labels.length === 0 || datasets.length === 0) {
        mostrarMensaje("No hay datos disponibles para exportar.", true);
        return;
    }

    const encabezados = ["Etiqueta", ...datasets.map((d) => d.label || "Serie")];
    const filas = labels.map((label, i) => {
        const row = [String(label)];
        datasets.forEach((d) => {
            const valor = Array.isArray(d.data) ? d.data[i] : "";
            row.push(valor ?? "");
        });
        return row;
    });

    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet("Grafica");
    const titulo = obtenerTituloPorTipo(tipo);

    ws.getCell("A1").value = titulo;
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0F172A" } };

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);

    const imageId = wb.addImage({
        base64: tempCanvas.toDataURL("image/png"),
        extension: "png"
    });

    const imageWidth = 920;
    const imageHeight = 360;
    ws.addImage(imageId, {
        tl: { col: 0, row: 2 },
        ext: { width: imageWidth, height: imageHeight }
    });

    const dataStartRow = 24;
    ws.getCell(`A${dataStartRow - 1}`).value = "Datos de la gráfica";
    ws.getCell(`A${dataStartRow - 1}`).font = { bold: true, size: 11 };

    const headerRow = ws.getRow(dataStartRow);
    encabezados.forEach((header, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    filas.forEach((fila, filaIndex) => {
        const row = ws.getRow(dataStartRow + filaIndex + 1);
        fila.forEach((valor, colIndex) => {
            const cell = row.getCell(colIndex + 1);
            cell.value = valor;
            cell.alignment = { horizontal: "center", vertical: "middle" };
        });
    });

    encabezados.forEach((_, i) => {
        ws.getColumn(i + 1).width = i === 0 ? 20 : 16;
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob(
        [buffer],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = agregarTimestampNombreArchivo(`grafica_${tipo}_sucursal_bancaria.xlsx`);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function exportarPDF(canvasId = "grafica", fileName = "grafica_sucursal_bancaria.pdf", titulo = "Costos del escenario") {
    const tipo = canvasId === "grafica"
        ? "costos"
        : canvasId === "metricasChart"
            ? "metricas"
            : canvasId === "utilizacionChart"
                ? "utilizacion"
                : "pn";

    if (!exportState[tipo]) {
        mostrarMensaje("Primero genera una gráfica para exportar.", true);
        return;
    }

    const canvas = document.getElementById(canvasId);

    if (!canvas) {
        mostrarMensaje("Primero genera una gráfica para exportar.", true);
        return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("l", "mm", "a4");

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");

    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);

    const imgData = tempCanvas.toDataURL("image/png");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;

    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2 - 8;

    const ratio = Math.min(usableWidth / tempCanvas.width, usableHeight / tempCanvas.height);
    const imgWidth = tempCanvas.width * ratio;
    const imgHeight = tempCanvas.height * ratio;

    const x = (pageWidth - imgWidth) / 2;
    const y = 14;

    pdf.text(titulo, margin, 8);
    pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight);
    pdf.save(agregarTimestampNombreArchivo(fileName));
}

function exportarGrafica(canvasId = "grafica", fileName = "grafica_sucursal_bancaria.png") {
    const tipo = canvasId === "grafica"
        ? "costos"
        : canvasId === "metricasChart"
            ? "metricas"
            : canvasId === "utilizacionChart"
                ? "utilizacion"
                : "pn";

    if (!exportState[tipo]) {
        mostrarMensaje("Primero genera una gráfica para exportar.", true);
        return;
    }

    const canvas = document.getElementById(canvasId);

    if (!canvas) {
        mostrarMensaje("Primero genera una gráfica para exportar.", true);
        return;
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png", 1.0);
    link.download = agregarTimestampNombreArchivo(fileName);
    link.click();
}

function toggleAcciones(state) {
    const nextState = typeof state === "boolean"
        ? {
            tabla: state,
            costos: state,
            metricas: state,
            utilizacion: state,
            pn: state
        }
        : {
            tabla: Boolean(state?.tabla),
            costos: Boolean(state?.costos),
            metricas: Boolean(state?.metricas),
            utilizacion: Boolean(state?.utilizacion),
            pn: Boolean(state?.pn)
        };

    Object.assign(exportState, nextState);

    const setDisabled = (selector, enabled) => {
        document.querySelectorAll(selector).forEach((btn) => {
            btn.disabled = !enabled;
        });
    };

    setDisabled('button[onclick*="exportarExcel()"]', exportState.tabla);

    setDisabled('button[onclick*="exportarDatosGraficaExcel(\'costos\')"]', exportState.costos);
    setDisabled('button[onclick*="exportarPDF(\'grafica\'"]', exportState.costos);
    setDisabled('button[onclick*="exportarGrafica(\'grafica\'"]', exportState.costos);

    setDisabled('button[onclick*="exportarDatosGraficaExcel(\'metricas\')"]', exportState.metricas);
    setDisabled('button[onclick*="exportarPDF(\'metricasChart\'"]', exportState.metricas);
    setDisabled('button[onclick*="exportarGrafica(\'metricasChart\'"]', exportState.metricas);

    setDisabled('button[onclick*="exportarDatosGraficaExcel(\'utilizacion\')"]', exportState.utilizacion);
    setDisabled('button[onclick*="exportarPDF(\'utilizacionChart\'"]', exportState.utilizacion);
    setDisabled('button[onclick*="exportarGrafica(\'utilizacionChart\'"]', exportState.utilizacion);

    setDisabled('button[onclick*="exportarDatosGraficaExcel(\'pn\')"]', exportState.pn);
    setDisabled('button[onclick*="exportarPDF(\'pnChart\'"]', exportState.pn);
    setDisabled('button[onclick*="exportarGrafica(\'pnChart\'"]', exportState.pn);
}

function mostrarMensaje(texto, isError) {
    const estado = document.getElementById("estado");
    if (!estado) {
        return;
    }

    const mensajeFinal = !isError && /completado/i.test(texto)
           ? `\u2705 ${texto}`
        : texto;

    estado.textContent = mensajeFinal;
    estado.className = isError ? "estado error" : "estado ok";
}

function formatearValor(valor) {
    if (typeof valor !== "number") {
        return valor;
    }
    if (Number.isInteger(valor)) {
        return String(valor);
    }
    return valor.toFixed(4);
}

function formatearUnidadTiempo(valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) {
        return "-";
    }

    const horas = formatearValor(numero);
    if (numero < 1) {
        const minutos = (numero * 60).toFixed(2);
        return `${minutos} min (${horas} h)`;
    }
    return `${horas} h`;
}


