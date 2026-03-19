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
const isLocalHost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
const API_URL = isLocalHost
    ? "http://127.0.0.1:5000/calcular"
    : `${RENDER_BASE_URL}/calcular`;
const THEME_KEY = "queue_theme";

document.addEventListener("DOMContentLoaded", () => {
    inicializarTema();

    const modelo = document.getElementById("modelo");
    if (modelo) {
        modelo.value = "mm1";
    }
    cambiarFormulario();
    toggleAcciones(false);
    limpiarAnalisis();
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
        themeToggle.textContent = isDark ? "☀️ Modo claro" : "🌙 Modo oscuro";
    }
}

function cambiarFormulario() {
    const modelo = document.getElementById("modelo").value;
    let html = `
        <div class="param-group">
            <label for="lambda">λ (Tasa de llegadas):</label>
            <input id="lambda" type="number" min="0" step="any" placeholder="Ej: 5">
        </div>
        <div class="param-group">
            <label for="mu">μ (Tasa de servicio):</label>
            <input id="mu" type="number" min="0" step="any" placeholder="Ej: 8">
        </div>
    `;

    let descripcion = "";

    if (modelo === "mm1") {
        descripcion = "Una cola con un único servidor. λ debe ser menor a μ para estabilidad. Este modelo no solicita costos.";
    } else if (modelo === "mms") {
        descripcion = "Una cola con múltiples servidores en paralelo. Ingresa el número de servidores.";
        html += `
        <div class="param-group">
            <label for="Cs">Costo de servicio (Cs):</label>
            <input id="Cs" type="number" min="0" step="any" placeholder="Ej: 10">
        </div>
        <div class="param-group">
            <label for="Cw">Costo de espera (Cw):</label>
            <input id="Cw" type="number" min="0" step="any" placeholder="Ej: 5">
        </div>
        <div class="param-group">
            <label for="s_max">Número de servidores (s):</label>
            <input id="s_max" type="number" min="1" step="1" placeholder="Ej: 3">
        </div>
        `;
    } else if (modelo === "mm1k") {
        descripcion = "Una cola con un servidor y capacidad máxima limitada (K clientes max).";
        html += `
        <div class="param-group">
            <label for="Cs">Costo de servicio (Cs):</label>
            <input id="Cs" type="number" min="0" step="any" placeholder="Ej: 10">
        </div>
        <div class="param-group">
            <label for="Cw">Costo de espera (Cw):</label>
            <input id="Cw" type="number" min="0" step="any" placeholder="Ej: 5">
        </div>
        <div class="param-group">
            <label for="K">Capacidad máxima (K):</label>
            <input id="K" type="number" min="1" step="1" placeholder="Ej: 10">
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
    const esMms = modelo === "mms";
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
        estado.textContent = "Ingresa parametros y presiona Calcular.";
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

    if (modelo === "mms") {
        data.s_max = parseInt(document.getElementById("s_max")?.value || 1);
    }

    if (modelo === "mm1k") {
        data.K = parseInt(document.getElementById("K")?.value || 1);
    }

    // Validaciones
    if (!data.lambda || !data.mu) {
        mostrarMensaje("Completa λ y μ.", true);
        return;
    }

    if (data.lambda <= 0 || data.mu <= 0) {
        mostrarMensaje("λ y μ deben ser mayores a cero.", true);
        return;
    }

    if (modelo !== "mm1" && (data.Cs < 0 || data.Cw < 0)) {
        mostrarMensaje("Los costos no pueden ser negativos.", true);
        return;
    }

    if (modelo !== "mm1" && (!Number.isFinite(data.Cs) || !Number.isFinite(data.Cw))) {
        mostrarMensaje("Completa Cs y Cw con valores validos.", true);
        return;
    }

    if (modelo === "mms" && (!data.s_max || data.s_max < 1)) {
        mostrarMensaje("Ingresa un número de servidores válido (≥ 1).", true);
        return;
    }

    if (modelo === "mm1k" && (!data.K || data.K < 1)) {
        mostrarMensaje("Ingresa una capacidad K válida (≥ 1).", true);
        return;
    }

    setLoading(true);
    try {
        mostrarMensaje("Calculando...", false);
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Error en el servidor");
        }

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
        mostrarMensaje("Calculo completado.", false);
    } catch (error) {
        toggleAcciones(false);
        mostrarMensaje(`No se pudo calcular: ${error.message}`, true);
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

    const mostrar = modelo === "mms" && totalResultados > 10;
    aviso.style.display = mostrar ? "block" : "none";
    aviso.textContent = mostrar
        ? "Solo se muestran 10 resultados, si deseas ver mas puedes descargar el Excel."
        : "";
}

function graficar(datos) {
    const labels = [];
    const costoServicio = [];
    const costoEspera = [];
    const costoTotal = [];

    datos.forEach((fila) => {
        if (fila[1] !== "Inestable") {
            labels.push(`S=${fila[0]}`);
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
                    label: "Costo Servicio",
                    data: costoServicioFinal,
                    borderColor: tieneDatos ? "#1f77b4" : "#cbd5e1",
                    backgroundColor: tieneDatos ? "rgba(31,119,180,0.2)" : "rgba(203,213,225,0.25)",
                    tension: 0.2
                },
                {
                    label: "Costo Espera",
                    data: costoEsperaFinal,
                    borderColor: tieneDatos ? "#ff7f0e" : "#cbd5e1",
                    backgroundColor: tieneDatos ? "rgba(255,127,14,0.2)" : "rgba(203,213,225,0.25)",
                    tension: 0.2
                },
                {
                    label: "Costo Total",
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
        chips.innerHTML = "<span class='chip-muted'>Sin resultados aun.</span>";
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
        paramModelo.textContent = modelo === "mm1"
            ? "M/M/1"
            : modelo === "mms"
                ? "M/M/s"
                : modelo === "mm1k"
                    ? "M/M/1/K"
                    : "-";
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
        { nombre: "Factor de utilizacion (ρ)", desc: "Proporcion del tiempo que el servidor esta ocupado" },
        { nombre: "Clientes en el sistema (L)", desc: "Numero promedio de clientes en el sistema" },
        { nombre: "Clientes en cola (Lq)", desc: "Numero promedio esperando en cola" },
        { nombre: "Tiempo en el sistema (W)", desc: "Tiempo promedio que un cliente pasa en el sistema" },
        { nombre: "Tiempo en cola (Wq)", desc: "Tiempo promedio que un cliente espera en cola" },
        { nombre: "Probabilidad sistema vacio (P0)", desc: "Probabilidad de que no haya clientes" }
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
        { nombre: "Factor de utilizacion (ρ)", desc: "Proporcion del tiempo que el servidor esta ocupado" },
        { nombre: "Clientes en el sistema (L)", desc: "Numero promedio de clientes en el sistema" },
        { nombre: "Clientes en cola (Lq)", desc: "Numero promedio esperando en cola" },
        { nombre: "Tiempo en el sistema (W)", desc: "Tiempo promedio que un cliente pasa en el sistema" },
        { nombre: "Tiempo en cola (Wq)", desc: "Tiempo promedio que un cliente espera en cola" },
        { nombre: "Probabilidad sistema vacio (P0)", desc: "Probabilidad de que no haya clientes" }
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
            : "<span class='chip-muted'>No disponible para sistema inestable.</span>";

        const paramModelo = document.getElementById("paramModelo");
        const estadoSistema = document.getElementById("estadoSistema");
        if (paramModelo) {
            paramModelo.textContent = requestData.modelo === "mm1"
                ? "M/M/1"
                : requestData.modelo === "mms"
                    ? "M/M/s"
                    : "M/M/1/K";
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

    const metricas = [
        { nombre: "Factor de utilizacion (ρ)", desc: "Proporcion del tiempo que el servidor esta ocupado", valor: `${(rho * 100).toFixed(2)}%` },
        { nombre: "Clientes en el sistema (L)", desc: "Numero promedio de clientes en el sistema", valor: formatearValor(l) },
        { nombre: "Clientes en cola (Lq)", desc: "Numero promedio esperando en cola", valor: formatearValor(lq) },
        { nombre: "Tiempo en el sistema (W)", desc: "Tiempo promedio que un cliente pasa en el sistema", valor: `${formatearValor(w)} unidades` },
        { nombre: "Tiempo en cola (Wq)", desc: "Tiempo promedio que un cliente espera en cola", valor: `${formatearValor(wq)} unidades` },
        { nombre: "Probabilidad sistema vacio (P0)", desc: "Probabilidad de que no haya clientes", valor: `${(p0 * 100).toFixed(4)}%` }
    ];

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
        chips.innerHTML = "<span class='chip-muted'>P(n) detallada disponible para M/M/1 y M/M/1/K.</span>";
    } else {
        chips.innerHTML = probabilidades.map((p) => `<span class="pn-chip">P(${p.n}) = ${(p.pn * 100).toFixed(2)}%</span>`).join("");
    }

    const nombreModelo = requestData.modelo === "mm1"
        ? "M/M/1"
        : requestData.modelo === "mms"
            ? "M/M/s"
            : "M/M/1/K";

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
    if (paramModelo) paramModelo.textContent = nombreModelo;
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
            labels: ["L", "Lq", "W", "Wq"],
            datasets: [{
                label: "Valor",
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
            labels: ["Utilizado", "Disponible"],
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
    XLSX.writeFile(wb, "resultados_teoria_colas.xlsx", { cellStyles: true, compression: true });
}

function obtenerChartPorTipo(tipo) {
    if (tipo === "metricas") return metricasChart;
    if (tipo === "utilizacion") return utilizacionChart;
    if (tipo === "pn") return pnChart;
    return chart;
}

function exportarDatosGraficaExcel(tipo) {
    if (!exportState[tipo]) {
        mostrarMensaje("Primero genera la grafica para exportar sus datos.", true);
        return;
    }

    const targetChart = obtenerChartPorTipo(tipo);
    if (!targetChart || !targetChart.data) {
        mostrarMensaje("Primero genera la grafica para exportar sus datos.", true);
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

    const ws = XLSX.utils.aoa_to_sheet([encabezados, ...filas]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Datos");
    XLSX.writeFile(wb, `datos_${tipo}_teoria_colas.xlsx`);
}

function exportarPDF(canvasId = "grafica", fileName = "grafica_teoria_colas.pdf", titulo = "Grafica de costos") {
    const tipo = canvasId === "grafica"
        ? "costos"
        : canvasId === "metricasChart"
            ? "metricas"
            : canvasId === "utilizacionChart"
                ? "utilizacion"
                : "pn";

    if (!exportState[tipo]) {
        mostrarMensaje("Primero genera una grafica para exportar.", true);
        return;
    }

    const canvas = document.getElementById(canvasId);

    if (!canvas) {
        mostrarMensaje("Primero genera una grafica para exportar.", true);
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
    pdf.save(fileName);
}

function exportarGrafica(canvasId = "grafica", fileName = "grafica_teoria_colas.png") {
    const tipo = canvasId === "grafica"
        ? "costos"
        : canvasId === "metricasChart"
            ? "metricas"
            : canvasId === "utilizacionChart"
                ? "utilizacion"
                : "pn";

    if (!exportState[tipo]) {
        mostrarMensaje("Primero genera una grafica para exportar.", true);
        return;
    }

    const canvas = document.getElementById(canvasId);

    if (!canvas) {
        mostrarMensaje("Primero genera una grafica para exportar.", true);
        return;
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png", 1.0);
    link.download = fileName;
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
        ? `✅ ${texto}`
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

